import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import type { BetterChatConfig } from './config';
import { AppError } from './errors';
import {
  parseCreateConversationMessageRequest,
  parseImageUploadForm,
  parseMembershipCommandRequest,
  parseUpdateMessageRequest,
  uploadTempFilePrefix,
} from './http-helpers';

const testConfig = {
  maxUploadBytes: 10 * 1024 * 1024,
} as BetterChatConfig;

const pngBytes = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};

const tempUploadPaths = (): string[] =>
  readdirSync(tmpdir())
    .filter((entry) => entry.startsWith(uploadTempFilePrefix))
    .sort();

const trackedTempPaths = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...trackedTempPaths].map(async (path) => {
      trackedTempPaths.delete(path);
      await rm(path, { force: true });
    }),
  );
});

describe('parseImageUploadForm', () => {
  test('spools image uploads to a temp file and removes it on cleanup', async () => {
    const formData = new FormData();
    formData.set('file', new File([Buffer.from(pngBytes(1024))], 'upload.png', { type: 'image/png' }));
    formData.set('text', 'caption');

    const request = new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      body: formData,
    });

    const upload = await parseImageUploadForm(request, testConfig);
    trackedTempPaths.add(upload.tempFilePath);

    try {
      expect(upload.file.size).toBe(1024);
      expect(upload.text).toBe('caption');
      expect(existsSync(upload.tempFilePath)).toBe(true);
      expect([...new Uint8Array(await upload.file.slice(0, 8).arrayBuffer())]).toEqual([...pngBytes(8)]);

      await upload.cleanup();
      trackedTempPaths.delete(upload.tempFilePath);

      expect(existsSync(upload.tempFilePath)).toBe(false);

      await upload.cleanup();
      expect(existsSync(upload.tempFilePath)).toBe(false);
    } finally {
      await upload.cleanup().catch(() => undefined);
      trackedTempPaths.delete(upload.tempFilePath);
    }
  });

  test('does not leak temp files when image sniffing rejects the payload after spooling', async () => {
    const before = tempUploadPaths();
    const formData = new FormData();
    formData.set('file', new File([Buffer.from('not-an-image')], 'upload.png', { type: 'image/png' }));

    const request = new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      body: formData,
    });

    let thrown: unknown;
    try {
      await parseImageUploadForm(request, testConfig);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(new AppError('VALIDATION_ERROR', '"file" must be an image upload', 400));
    expect(tempUploadPaths()).toEqual(before);
  });
});

describe('conversation request parsing', () => {
  test('normalizes conversation-target message creation requests', () => {
    expect(parseCreateConversationMessageRequest({
      submissionId: '  submission-1  ',
      target: {
        kind: 'conversation',
        replyToMessageId: '  message-1  ',
      },
      content: {
        format: 'markdown',
        text: '  hello world  ',
      },
    })).toEqual({
      submissionId: 'submission-1',
      target: {
        kind: 'conversation',
        replyToMessageId: 'message-1',
      },
      content: {
        format: 'markdown',
        text: 'hello world',
      },
    });
  });

  test('normalizes thread-target message creation requests', () => {
    expect(parseCreateConversationMessageRequest({
      submissionId: '  submission-2  ',
      target: {
        kind: 'thread',
        threadId: '  thread-1  ',
        echoToConversation: true,
      },
      content: {
        format: 'markdown',
        text: '  threaded reply  ',
      },
    })).toEqual({
      submissionId: 'submission-2',
      target: {
        kind: 'thread',
        threadId: 'thread-1',
        echoToConversation: true,
      },
      content: {
        format: 'markdown',
        text: 'threaded reply',
      },
    });
  });

  test('rejects blank submission ids when provided', () => {
    expect(() =>
      parseCreateConversationMessageRequest({
        submissionId: '   ',
        target: {
          kind: 'conversation',
        },
        content: {
          format: 'markdown',
          text: 'hello',
        },
      }),
    ).toThrow(new AppError('VALIDATION_ERROR', '"submissionId" must be a non-empty string when provided', 400));
  });

  test('rejects unsupported membership command shapes', () => {
    expect(() =>
      parseMembershipCommandRequest({
        type: 'set-listing',
        value: 'collapsed',
      } as never),
    ).toThrow(new AppError('VALIDATION_ERROR', '"value" must be "listed" or "hidden" for set-listing', 400));

    expect(() =>
      parseMembershipCommandRequest({
        type: 'mark-unread',
        fromMessageId: '   ',
      }),
    ).toThrow(new AppError('VALIDATION_ERROR', '"fromMessageId" must be a non-empty string when provided', 400));
  });

  test('normalizes mark-unread membership commands', () => {
    expect(parseMembershipCommandRequest({
      type: 'mark-unread',
      fromMessageId: '  message-9  ',
    })).toEqual({
      type: 'mark-unread',
      fromMessageId: 'message-9',
    });
  });

  test('normalizes update-message requests and preserves explicit reply clearing', () => {
    expect(parseUpdateMessageRequest({
      text: '  edited body  ',
      replyToMessageId: '  message-1  ',
    })).toEqual({
      text: 'edited body',
      replyToMessageId: 'message-1',
    });

    expect(parseUpdateMessageRequest({
      text: '  edited body  ',
      replyToMessageId: null,
    })).toEqual({
      text: 'edited body',
      replyToMessageId: null,
    });

    expect(parseUpdateMessageRequest({
      text: '  edited body  ',
    })).toEqual({
      text: 'edited body',
    });
  });
});
