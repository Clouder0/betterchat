import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSqliteConversationMessageLedger, InMemoryConversationMessageLedger } from './conversation-message-ledger';
import type { UpstreamMessage } from './upstream';

const tempDirectories: string[] = [];

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});

const createTempDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'betterchat-ledger-'));
  tempDirectories.push(directory);
  return directory;
};

const message = ({
  id,
  text,
  ts,
}: {
  id: string;
  text: string;
  ts: string;
}): UpstreamMessage => ({
  _id: id,
  rid: 'room-1',
  msg: text,
  ts,
  tcount: 2,
  tlm: '2026-04-07T08:05:00.000Z',
  u: {
    _id: 'alice-id',
    username: 'alice',
    name: 'Alice Example',
  },
});

describe('conversation message ledger', () => {
  test('marks observed messages as deleted while preserving the minimal canonical envelope', () => {
    const ledger = new InMemoryConversationMessageLedger();
    ledger.observe(
      message({
        id: 'message-1',
        text: 'hello',
        ts: '2026-04-07T08:00:00.000Z',
      }),
      '2026-04-07T08:01:00.000Z',
    );

    const deleted = ledger.markDeletedById('room-1', 'message-1', {
      deletedAt: '2026-04-07T08:10:00.000Z',
      source: 'betterchat-delete',
    });

    expect(deleted).toEqual({
      authoredAt: '2026-04-07T08:00:00.000Z',
      authorId: 'alice-id',
      authorName: 'Alice Example',
      authorUsername: 'alice',
      conversationId: 'room-1',
      deletedAt: '2026-04-07T08:10:00.000Z',
      deletedObservedAt: '2026-04-07T08:10:00.000Z',
      deletedSource: 'betterchat-delete',
      messageId: 'message-1',
      observedAt: '2026-04-07T08:01:00.000Z',
      threadLastReplyAt: '2026-04-07T08:05:00.000Z',
      threadReplyCount: 2,
    });
  });

  test('returns undefined when an external delete arrives for an unseen message id', () => {
    const ledger = new InMemoryConversationMessageLedger();

    expect(ledger.markDeletedById('room-1', 'missing-message', {
      deletedAt: '2026-04-07T08:10:00.000Z',
      source: 'upstream-realtime',
    })).toBeUndefined();
  });

  test('persists deleted envelopes across ledger recreation when backed by sqlite', () => {
    const stateDir = createTempDirectory();
    const firstLedger = createSqliteConversationMessageLedger({
      path: join(stateDir, 'canonical-message-ledger.sqlite'),
    });
    firstLedger.observe(
      message({
        id: 'message-1',
        text: 'hello',
        ts: '2026-04-07T08:00:00.000Z',
      }),
      '2026-04-07T08:01:00.000Z',
    );
    firstLedger.markDeletedById('room-1', 'message-1', {
      deletedAt: '2026-04-07T08:10:00.000Z',
      source: 'betterchat-delete',
    });
    firstLedger.close();

    const secondLedger = createSqliteConversationMessageLedger({
      path: join(stateDir, 'canonical-message-ledger.sqlite'),
    });

    expect(secondLedger.getDeletedEnvelope('room-1', 'message-1')).toEqual({
      authoredAt: '2026-04-07T08:00:00.000Z',
      authorId: 'alice-id',
      authorName: 'Alice Example',
      authorUsername: 'alice',
      conversationId: 'room-1',
      deletedAt: '2026-04-07T08:10:00.000Z',
      deletedObservedAt: '2026-04-07T08:10:00.000Z',
      deletedSource: 'betterchat-delete',
      messageId: 'message-1',
      observedAt: '2026-04-07T08:01:00.000Z',
      threadLastReplyAt: '2026-04-07T08:05:00.000Z',
      threadReplyCount: 2,
    });

    secondLedger.close();
  });
});
