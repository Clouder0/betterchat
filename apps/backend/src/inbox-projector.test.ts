import { describe, expect, test } from 'bun:test';

import { projectMembershipInbox, projectMembershipInboxProjection } from './inbox-projector';
import type { UpstreamSession } from './session';
import type { RocketChatClient, UpstreamMessage, UpstreamSubscription } from './upstream';

const subscription = (overrides: Partial<UpstreamSubscription> = {}): UpstreamSubscription => ({
  _id: 'sub-1',
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

const session: UpstreamSession = {
  authToken: 'auth-token',
  createdAt: '2026-03-27T00:00:00.000Z',
  displayName: 'Alice Example',
  expiresAt: '2099-03-27T01:00:00.000Z',
  userId: 'alice-id',
  username: 'alice',
};

const message = (overrides: Partial<UpstreamMessage>): UpstreamMessage => ({
  _id: overrides._id || crypto.randomUUID(),
  rid: 'room-1',
  ts: '2026-03-27T10:05:00.000Z',
  msg: 'message body',
  u: {
    _id: 'bob-id',
    username: 'bob',
    name: 'Bob Example',
  },
  ...overrides,
});

const createClient = (
  updated: UpstreamMessage[],
  options: {
    onFindMessage?: (messageId: string) => void;
    onListUpdatedMessagesSince?: () => void;
    parentMessagesById?: Record<string, UpstreamMessage | undefined>;
  } = {},
): RocketChatClient =>
  ({
    listUpdatedMessagesSince: async () => {
      options.onListUpdatedMessagesSince?.();
      return updated;
    },
    findMessage: async (_session: UpstreamSession, messageId: string) => {
      options.onFindMessage?.(messageId);
      return options.parentMessagesById?.[messageId];
    },
  }) as unknown as RocketChatClient;

describe('inbox projector', () => {
  test('reconciles exact main-timeline unread count from syncMessages when Rocket.Chat only raises alert', async () => {
    const projection = await projectMembershipInboxProjection(
      createClient([
        message({ _id: 'visible-main' }),
        message({ _id: 'thread-only', tmid: 'thread-root' }),
        message({ _id: 'self-message', u: { _id: 'alice-id', username: 'alice', name: 'Alice Example' } }),
        message({ _id: 'updated-old-parent', ts: '2026-03-27T09:59:00.000Z' }),
      ]),
      session,
      subscription({ alert: true }),
    );

    expect(projection).toEqual({
      inbox: {
        unreadMessages: 1,
        mentionCount: 0,
        replyCount: 0,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      },
      firstUnreadMessageId: 'visible-main',
    });
  });

  test('keeps quiet activity explicit when no visible main-timeline unread messages exist after ls', async () => {
    const inbox = await projectMembershipInbox(
      createClient([
        message({ _id: 'thread-only', tmid: 'thread-root' }),
        message({ _id: 'updated-old-parent', ts: '2026-03-27T09:59:00.000Z' }),
      ]),
      session,
      subscription({ alert: true }),
    );

    expect(inbox).toEqual({
      unreadMessages: 0,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: true,
    });
  });

  test('preserves mention and thread signals from subscription fields while reconciling main-timeline unread', async () => {
    const inbox = await projectMembershipInbox(
      createClient([]),
      session,
      subscription({
        userMentions: 1,
        groupMentions: 2,
        tunread: ['thread-root'],
        tunreadUser: ['thread-mention'],
        tunreadGroup: ['thread-group'],
      }),
    );

    expect(inbox).toEqual({
      unreadMessages: 0,
      mentionCount: 5,
      replyCount: 0,
      hasThreadActivity: true,
      hasUncountedActivity: false,
    });
  });

  test('falls back to the subscription unread count when no history reconciliation is needed', async () => {
    let listUpdatedMessagesSinceCallCount = 0;

    const inbox = await projectMembershipInbox(
      createClient([], {
        onListUpdatedMessagesSince: () => {
          listUpdatedMessagesSinceCallCount += 1;
        },
      }),
      session,
      subscription({
        ls: undefined,
        ts: undefined,
        unread: 3,
      }),
    );

    expect(listUpdatedMessagesSinceCallCount).toBe(0);
    expect(inbox).toEqual({
      unreadMessages: 3,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: false,
    });
  });

  test('reconciles unread from subscription ts when ls is absent', async () => {
    const projection = await projectMembershipInboxProjection(
      createClient([
        message({ _id: 'first-unread', ts: '2026-03-27T09:00:01.000Z' }),
      ]),
      session,
      subscription({
        ls: undefined,
        ts: '2026-03-27T09:00:00.000Z',
        alert: true,
      }),
    );

    expect(projection).toEqual({
      inbox: {
        unreadMessages: 1,
        mentionCount: 0,
        replyCount: 0,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      },
      firstUnreadMessageId: 'first-unread',
    });
  });

  test('does not fabricate quiet activity when explicit mention or thread facts already exist', async () => {
    const unreadFromMention = await projectMembershipInbox(createClient([]), session, subscription({ alert: true, userMentions: 1 }));
    const unreadFromThread = await projectMembershipInbox(createClient([]), session, subscription({ alert: true, tunread: ['thread-root'] }));

    expect(unreadFromMention.hasUncountedActivity).toBe(false);
    expect(unreadFromThread.hasUncountedActivity).toBe(false);
  });

  test('does not expose an unread anchor for self-authored post-checkpoint activity', async () => {
    const projection = await projectMembershipInboxProjection(
      createClient([
        message({
          _id: 'self-1',
          u: {
            _id: 'alice-id',
            username: 'alice',
            name: 'Alice Example',
          },
        }),
      ]),
      session,
      subscription({ alert: true }),
    );

    expect(projection.firstUnreadMessageId).toBeUndefined();
    expect(projection.inbox).toEqual({
      unreadMessages: 0,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: true,
    });
  });

  test('counts unseen quoted main-timeline replies to the current user messages', async () => {
    const parent = message({
      _id: 'parent-1',
      msg: 'Parent from Alice',
      u: {
        _id: 'alice-id',
        username: 'alice',
        name: 'Alice Example',
      },
    });

    const projection = await projectMembershipInboxProjection(
      createClient(
        [
          message({
            _id: 'reply-1',
            msg: '[ ](http://127.0.0.1:3100/channel/general?msg=parent-1)\nQuoted reply',
            attachments: [
              {
                message_link: 'http://127.0.0.1:3100/channel/general?msg=parent-1',
                author_name: 'Alice Example',
                text: 'Parent from Alice',
              },
            ],
          }),
        ],
        {
          parentMessagesById: {
            'parent-1': parent,
          },
        },
      ),
      session,
      subscription({ alert: true }),
    );

    expect(projection).toEqual({
      inbox: {
        unreadMessages: 1,
        mentionCount: 0,
        replyCount: 1,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      },
      firstUnreadMessageId: 'reply-1',
    });
  });

  test('does not count thread-only replies, self-authored replies, or replies to another participant', async () => {
    const lookedUpParentIds: string[] = [];
    const projection = await projectMembershipInboxProjection(
      createClient(
        [
          message({
            _id: 'thread-only-reply',
            tmid: 'parent-self',
          }),
          message({
            _id: 'self-authored-reply',
            msg: '[ ](http://127.0.0.1:3100/channel/general?msg=parent-self)\nMy own reply',
            u: {
              _id: 'alice-id',
              username: 'alice',
              name: 'Alice Example',
            },
            attachments: [
              {
                message_link: 'http://127.0.0.1:3100/channel/general?msg=parent-self',
                author_name: 'Alice Example',
                text: 'Parent from Alice',
              },
            ],
          }),
          message({
            _id: 'reply-to-bob',
            msg: '[ ](http://127.0.0.1:3100/channel/general?msg=parent-bob)\nReply to Bob',
            attachments: [
              {
                message_link: 'http://127.0.0.1:3100/channel/general?msg=parent-bob',
                author_name: 'Bob Example',
                text: 'Parent from Bob',
              },
            ],
          }),
        ],
        {
          onFindMessage: (messageId) => {
            lookedUpParentIds.push(messageId);
          },
          parentMessagesById: {
            'parent-self': message({
              _id: 'parent-self',
              u: {
                _id: 'alice-id',
                username: 'alice',
                name: 'Alice Example',
              },
            }),
            'parent-bob': message({
              _id: 'parent-bob',
              u: {
                _id: 'bob-id',
                username: 'bob',
                name: 'Bob Example',
              },
            }),
          },
        },
      ),
      session,
      subscription({ alert: true }),
    );

    expect(lookedUpParentIds).toEqual(['parent-bob']);
    expect(projection.inbox).toEqual({
      unreadMessages: 1,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: false,
    });
  });

  test('counts broadcast thread replies to my thread root and derives replyCount in directory mode', async () => {
    const lookedUpParentIds: string[] = [];
    const projection = await projectMembershipInboxProjection(
      createClient(
        [
          message({
            _id: 'broadcast-thread-reply',
            tmid: 'thread-root-1',
            tshow: true,
          }),
          message({
            _id: 'ordinary-main-message',
            msg: 'ordinary main message',
          }),
        ],
        {
          onFindMessage: (messageId) => {
            lookedUpParentIds.push(messageId);
          },
          parentMessagesById: {
            'thread-root-1': message({
              _id: 'thread-root-1',
              msg: 'Thread root from Alice',
              u: {
                _id: 'alice-id',
                username: 'alice',
                name: 'Alice Example',
              },
            }),
          },
        },
      ),
      session,
      subscription({
        alert: false,
        unread: 2,
      }),
      { mode: 'directory' },
    );

    expect(lookedUpParentIds).toEqual(['thread-root-1']);
    expect(projection).toEqual({
      inbox: {
        unreadMessages: 2,
        mentionCount: 0,
        replyCount: 1,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      },
      firstUnreadMessageId: 'broadcast-thread-reply',
    });
  });
});
