import { describe, expect, test } from 'bun:test';

import type { BetterChatConfig } from './config';
import {
  buildConversationMessageContextSnapshot,
  buildConversationSnapshotState,
  buildConversationTimelineSnapshot,
  buildDirectorySnapshotState,
} from './conversation-snapshots';
import { AppError } from './errors';
import type { UpstreamMessage, UpstreamRoom, UpstreamSubscription } from './upstream';
import type { UpstreamSession } from './session';
import type { RocketChatClient } from './upstream';

const testConfig: BetterChatConfig = {
  host: '127.0.0.1',
  port: 3200,
  upstreamUrl: 'http://127.0.0.1:3100',
  upstreamRequestTimeoutMs: 15_000,
  upstreamMediaTimeoutMs: 30_000,
  sessionCookieName: 'betterchat_session',
  sessionCookieSecure: false,
  sessionSecret: 'conversation-snapshots-test-secret',
  sessionTtlSeconds: 3600,
  defaultMessagePageSize: 50,
  maxUploadBytes: 50 * 1024 * 1024,
  staticDir: null,
};

const session: UpstreamSession = {
  authToken: 'auth-token',
  createdAt: '2026-03-27T00:00:00.000Z',
  displayName: 'Alice Example',
  expiresAt: '2099-03-27T00:00:00.000Z',
  userId: 'alice-id',
  username: 'alice',
};

const room: UpstreamRoom = {
  _id: 'room-1',
  t: 'c',
  name: 'general',
  fname: 'General',
  lm: '2026-03-27T12:00:00.000Z',
};

const subscription = (overrides: Partial<UpstreamSubscription> = {}): UpstreamSubscription => ({
  _id: 'subscription-1',
  rid: 'room-1',
  t: 'c',
  name: 'general',
  fname: 'General',
  open: true,
  ts: '2026-03-27T09:00:00.000Z',
  unread: 0,
  ls: '2026-03-27T10:00:00.000Z',
  ...overrides,
});

const message = (index: number, authorId = 'bob-id', authorUsername = 'bob'): UpstreamMessage => ({
  _id: `message-${index}`,
  rid: 'room-1',
  msg: `message ${index}`,
  ts: new Date(Date.UTC(2026, 2, 27, 10, index, 0)).toISOString(),
  u: {
    _id: authorId,
    username: authorUsername,
    name: authorUsername,
  },
});

const descendingPageFrom = (messagesAscending: UpstreamMessage[], count: number, offset: number): UpstreamMessage[] => {
  const descending = [...messagesAscending].sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts));
  return descending.slice(offset, offset + count);
};

const authorizationAwareClient = (
  overrides: Record<string, unknown> = {},
): RocketChatClient =>
  ({
    getPublicSettings: async () => ({
      success: true,
      settings: [],
    }),
    getMe: async () => ({
      success: true,
      _id: session.userId,
      username: session.username,
      name: session.displayName,
      roles: ['user'],
    }),
    getPermissionDefinitions: async () => ({
      success: true,
      update: [],
      remove: [],
    }),
    ...overrides,
  }) as unknown as RocketChatClient;

describe('conversation snapshot timeline building', () => {
  test('expands the first timeline page until it includes the exact unread anchor', async () => {
    const messages = Array.from({ length: 60 }, (_, index) => message(index + 1));
    const client = authorizationAwareClient({
      getSubscription: async () => ({ success: true, subscription: subscription({ unread: 55, ls: messages[4]!.ts }) }),
      getRoomInfo: async () => ({ success: true, room }),
      getRoomMessages: async (_session: UpstreamSession, _roomType: string, _roomId: string, count: number, offset = 0) => ({
        success: true,
        messages: descendingPageFrom(messages, count, offset),
        count: Math.min(count, Math.max(messages.length - offset, 0)),
        offset,
        total: messages.length,
      }),
      listUpdatedMessagesSince: async () => messages.filter((entry) => Date.parse(entry.ts) > Date.parse(messages[4]!.ts)),
      findMessage: async () => undefined,
    });

    const timeline = await buildConversationTimelineSnapshot(testConfig, client, session, 'room-1');

    expect(timeline.messages).toHaveLength(55);
    expect(timeline.unreadAnchorMessageId).toBe('message-6');
    expect(timeline.messages[0]?.id).toBe('message-6');
    expect(timeline.messages.at(-1)?.id).toBe('message-60');
    expect(timeline.nextCursor).toBeDefined();
    expect(JSON.parse(Buffer.from(timeline.nextCursor!, 'base64').toString('utf8'))).toEqual({ offset: 55 });
  });

  test('keeps the unread anchor when it already fits inside the bounded first timeline page', async () => {
    const messages = Array.from({ length: 20 }, (_, index) => message(index + 1));
    const client = authorizationAwareClient({
      getSubscription: async () => ({ success: true, subscription: subscription({ unread: 4, ls: messages[15]!.ts }) }),
      getRoomInfo: async () => ({ success: true, room }),
      getRoomMessages: async (_session: UpstreamSession, _roomType: string, _roomId: string, count: number, offset = 0) => ({
        success: true,
        messages: descendingPageFrom(messages, count, offset),
        count: Math.min(count, Math.max(messages.length - offset, 0)),
        offset,
        total: messages.length,
      }),
      listUpdatedMessagesSince: async () => messages.filter((entry) => Date.parse(entry.ts) > Date.parse(messages[15]!.ts)),
      findMessage: async () => undefined,
    });

    const timeline = await buildConversationTimelineSnapshot(
      {
        ...testConfig,
        defaultMessagePageSize: 5,
      },
      client,
      session,
      'room-1',
    );

    expect(timeline.messages).toHaveLength(5);
    expect(timeline.unreadAnchorMessageId).toBe('message-17');
    expect(timeline.messages[0]?.id).toBe('message-16');
    expect(timeline.messages.at(-1)?.id).toBe('message-20');
    expect(timeline.nextCursor).toBeDefined();
  });

  test('falls back to the normal latest page when the unread anchor lies beyond the bounded search window', async () => {
    const messages = Array.from({ length: 300 }, (_, index) => message(index + 1));
    const client = authorizationAwareClient({
      getSubscription: async () => ({ success: true, subscription: subscription({ unread: 296, ls: messages[3]!.ts }) }),
      getRoomInfo: async () => ({ success: true, room }),
      getRoomMessages: async (_session: UpstreamSession, _roomType: string, _roomId: string, count: number, offset = 0) => ({
        success: true,
        messages: descendingPageFrom(messages, count, offset),
        count: Math.min(count, Math.max(messages.length - offset, 0)),
        offset,
        total: messages.length,
      }),
      listUpdatedMessagesSince: async () => messages.filter((entry) => Date.parse(entry.ts) > Date.parse(messages[3]!.ts)),
      findMessage: async () => undefined,
    });

    const timeline = await buildConversationTimelineSnapshot(testConfig, client, session, 'room-1');

    expect(timeline.messages).toHaveLength(50);
    expect(timeline.unreadAnchorMessageId).toBeUndefined();
    expect(timeline.messages[0]?.id).toBe('message-251');
    expect(timeline.messages.at(-1)?.id).toBe('message-300');
    expect(JSON.parse(Buffer.from(timeline.nextCursor!, 'base64').toString('utf8'))).toEqual({ offset: 50 });
  });

  test('reconciles directory unread state from room history when unread activity exists', async () => {
    let syncMessagesCalls = 0;
    const client = {
      getMe: async () => ({
        success: true,
        _id: session.userId,
        username: session.username,
        name: session.displayName,
        roles: ['user'],
      }),
      getRooms: async () => ({
        success: true,
        update: [room],
        remove: [],
      }),
      getSubscriptions: async () => ({
        success: true,
        update: [subscription({ unread: 3 })],
        remove: [],
      }),
      getUsersPresence: async () => ({
        success: true,
        full: true,
        users: [],
      }),
      listUpdatedMessagesSince: async () => {
        syncMessagesCalls += 1;
        return [message(1)];
      },
    } as unknown as RocketChatClient;

    const directoryState = await buildDirectorySnapshotState(client, session);

    expect(syncMessagesCalls).toBe(1);
    expect(directoryState.snapshot.entries[0]?.membership.inbox).toEqual({
      unreadMessages: 1,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: false,
    });
  });

  test('rejects hidden thread replies as message-context anchors before scanning room history', async () => {
    let roomMessagesCalls = 0;
    const client = authorizationAwareClient({
      getSubscription: async () => ({ success: true, subscription: subscription() }),
      getRoomInfo: async () => ({ success: true, room }),
      findMessage: async () => ({
        ...message(10),
        _id: 'thread-reply-1',
        tmid: 'thread-root-1',
      }),
      getRoomMessages: async () => {
        roomMessagesCalls += 1;
        return {
          success: true,
          messages: [],
          count: 0,
          offset: 0,
          total: 0,
        };
      },
    });

    await expect(
      buildConversationMessageContextSnapshot(testConfig, client, session, 'room-1', 'thread-reply-1', { before: 5, after: 5 }),
    ).rejects.toEqual(
      new AppError('NOT_FOUND', 'Anchor message not found', 404, {
        roomId: 'room-1',
        messageId: 'thread-reply-1',
        failureReason: 'not-visible-in-main-timeline',
      }),
    );
    expect(roomMessagesCalls).toBe(0);
  });

  test('propagates reply-parent lookup failures when timeline reply enrichment cannot be completed safely', async () => {
    const client = authorizationAwareClient({
      getSubscription: async () => ({ success: true, subscription: subscription() }),
      getRoomInfo: async () => ({ success: true, room }),
      getRoomMessages: async () => ({
        success: true,
        messages: [
          {
            ...message(1),
            _id: 'reply-1',
            tmid: 'parent-1',
            tshow: true,
          },
        ],
        count: 1,
        offset: 0,
        total: 1,
      }),
      findMessage: async (_session: UpstreamSession, messageId: string) => {
        if (messageId === 'parent-1') {
          throw new AppError('UNAUTHENTICATED', 'Rocket.Chat rejected the parent lookup', 401);
        }

        return undefined;
      },
      listUpdatedMessagesSince: async () => [],
    });

    await expect(
      buildConversationTimelineSnapshot(testConfig, client, session, 'room-1'),
    ).rejects.toEqual(new AppError('UNAUTHENTICATED', 'Rocket.Chat rejected the parent lookup', 401));
  });

  test('keeps conversation snapshot reads available when optional presence lookup fails', async () => {
    const client = authorizationAwareClient({
      getRoomInfo: async () => ({
        success: true,
        room: {
          ...room,
          _id: 'dm-1',
          t: 'd',
          fname: 'Bob Example',
          usernames: ['alice', 'bob'],
          uids: ['alice-id', 'bob-id'],
        },
      }),
      getSubscription: async () => ({
        success: true,
        subscription: {
          ...subscription(),
          rid: 'dm-1',
          t: 'd',
          name: 'bob',
          fname: 'Bob Example',
        },
      }),
      getUsersPresence: async () => {
        throw new Error('presence failed');
      },
      listUpdatedMessagesSince: async () => [],
    });

    const snapshotState = await buildConversationSnapshotState(client, session, 'dm-1');

    expect(snapshotState.snapshot.live?.counterpartPresence).toBe('offline');
  });

  test('keeps directory snapshot reads available when optional presence lookup fails', async () => {
    const client = {
      getMe: async () => ({
        success: true,
        _id: session.userId,
        username: session.username,
        name: session.displayName,
        roles: ['user'],
      }),
      getRooms: async () => ({
        success: true,
        update: [
          {
            ...room,
            _id: 'dm-1',
            t: 'd',
            fname: 'Bob Example',
            usernames: ['alice', 'bob'],
            uids: ['alice-id', 'bob-id'],
          },
        ],
        remove: [],
      }),
      getSubscriptions: async () => ({
        success: true,
        update: [
          {
            ...subscription(),
            rid: 'dm-1',
            t: 'd',
            name: 'bob',
            fname: 'Bob Example',
          },
        ],
        remove: [],
      }),
      getUsersPresence: async () => {
        throw new Error('presence failed');
      },
      listUpdatedMessagesSince: async () => [],
    } as unknown as RocketChatClient;

    const directoryState = await buildDirectorySnapshotState(client, session);

    expect(directoryState.snapshot.entries[0]?.live?.counterpartPresence).toBe('offline');
  });
});
