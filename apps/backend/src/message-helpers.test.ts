import { describe, expect, test } from 'bun:test';

import { AppError } from './errors';
import { replyParentMessageIdFrom, replyPreviewParentMessages } from './message-helpers';
import type { UpstreamSession } from './session';
import type { RocketChatClient, UpstreamMessage } from './upstream';

const session: UpstreamSession = {
  authToken: 'auth-token',
  createdAt: '2026-03-27T00:00:00.000Z',
  displayName: 'Alice Example',
  expiresAt: '2099-03-27T00:00:00.000Z',
  userId: 'alice-id',
  username: 'alice',
};

describe('message helpers', () => {
  test('extracts canonical reply parent ids from thread replies and quote attachments', () => {
    const upstreamUrl = 'http://127.0.0.1:3100';
    const quotedReply: UpstreamMessage = {
      _id: 'message-1',
      rid: 'room-1',
      msg: '[ ](http://127.0.0.1:3100/channel/general?msg=parent-1)\nReply',
      ts: '2026-03-31T00:00:00.000Z',
      u: {
        _id: 'bob-id',
        username: 'bob',
      },
      attachments: [
        {
          message_link: 'http://127.0.0.1:3100/channel/general?msg=parent-1',
        },
      ],
    };
    const threadReply: UpstreamMessage = {
      ...quotedReply,
      _id: 'message-2',
      tmid: 'thread-root-1',
      tshow: true,
    };

    expect(replyParentMessageIdFrom(quotedReply, upstreamUrl)).toBe('parent-1');
    expect(replyParentMessageIdFrom(threadReply, upstreamUrl)).toBe('thread-root-1');
  });

  test('propagates reply-preview parent lookup failures instead of silently degrading the response', async () => {
    const client = {
      findMessage: async () => {
        throw new AppError('UNAUTHENTICATED', 'Rocket.Chat rejected the reply-preview lookup', 401);
      },
    } as unknown as RocketChatClient;

    await expect(replyPreviewParentMessages(client, session, 'parent-1')).rejects.toEqual(
      new AppError('UNAUTHENTICATED', 'Rocket.Chat rejected the reply-preview lookup', 401),
    );
  });

  test('keeps missing reply-preview parents optional when Rocket.Chat reports no message', async () => {
    const client = {
      findMessage: async () => undefined,
    } as unknown as RocketChatClient;

    await expect(replyPreviewParentMessages(client, session, 'parent-1')).resolves.toEqual(new Map());
  });
});
