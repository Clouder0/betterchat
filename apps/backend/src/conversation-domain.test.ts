import { describe, expect, test } from 'bun:test';

import { authorizationSnapshotFrom } from './authorization';
import { AppError } from './errors';
import {
  normalizeConversationMessage,
  normalizeConversationSnapshot,
  normalizeConversationTimeline,
  normalizeDirectorySnapshot,
  normalizeThreadTimeline,
} from './conversation-domain';
import { conversationCapabilitiesFixture } from './test-fixtures';
import type { UpstreamMessage, UpstreamPermissionDefinition, UpstreamRoom, UpstreamSetting, UpstreamSubscription } from './upstream';

const upstreamUrl = 'http://127.0.0.1:3100';

const room = (overrides: Partial<UpstreamRoom> = {}): UpstreamRoom => ({
  _id: 'room-1',
  t: 'c',
  name: 'general',
  fname: 'General',
  lm: '2026-03-27T10:00:00.000Z',
  ...overrides,
});

const subscription = (overrides: Partial<UpstreamSubscription> = {}): UpstreamSubscription => ({
  _id: 'subscription-1',
  rid: 'room-1',
  t: 'c',
  name: 'general',
  fname: 'General',
  open: true,
  ts: '2026-03-27T09:58:00.000Z',
  unread: 0,
  ls: '2026-03-27T09:59:00.000Z',
  ...overrides,
});

const message = (overrides: Partial<UpstreamMessage> = {}): UpstreamMessage => ({
  _id: 'message-1',
  rid: 'room-1',
  msg: 'hello',
  ts: '2026-03-27T10:00:00.000Z',
  u: {
    _id: 'alice-id',
    username: 'alice',
    name: 'Alice Example',
  },
  ...overrides,
});

const settings = (values: Record<string, unknown>): UpstreamSetting[] =>
  Object.entries(values).map(([_id, value]) => ({ _id, value }));

const permissions = (values: Record<string, string[]>): UpstreamPermissionDefinition[] =>
  Object.entries(values).map(([_id, roles]) => ({ _id, roles }));

const viewerContext = ({
  currentUserId = 'alice-id',
  currentUsername = 'alice',
  permissionsById = {},
  roomOverrides = {},
  settingsValues = {},
  subscriptionOverrides = {},
}: {
  currentUserId?: string;
  currentUsername?: string;
  permissionsById?: Record<string, string[]>;
  roomOverrides?: Partial<UpstreamRoom>;
  settingsValues?: Record<string, unknown>;
  subscriptionOverrides?: Partial<UpstreamSubscription>;
} = {}) => ({
  authorization: authorizationSnapshotFrom(
    { roles: ['user'] },
    { roles: [] } as never,
    permissions(permissionsById),
  ),
  currentUserId,
  currentUsername,
  room: room(roomOverrides),
  settings: settings(settingsValues),
  subscription: subscription(subscriptionOverrides),
});

describe('conversation-domain normalization', () => {
  test('keeps inbox facts on directory entries without reintroducing attention heuristics', () => {
    const normalized = normalizeDirectorySnapshot(
      [room()],
      [subscription({ alert: true, unread: 0, tunread: [] })],
      'alice',
      new Map([
        [
          'room-1',
          {
            unreadMessages: 0,
            mentionCount: 0,
            replyCount: 0,
            hasThreadActivity: false,
            hasUncountedActivity: true,
          },
        ],
      ]),
    );

    expect(normalized.entries).toEqual([
      expect.objectContaining({
        membership: {
          listing: 'listed',
          starred: false,
          inbox: {
            unreadMessages: 0,
            mentionCount: 0,
            replyCount: 0,
            hasThreadActivity: false,
            hasUncountedActivity: true,
          },
        },
      }),
    ]);
  });

  test('projects lastActivityAt from real room activity timestamps instead of read checkpoints', () => {
    const normalized = normalizeDirectorySnapshot(
      [room({ lm: undefined })],
      [
        subscription({
          ts: '2026-03-27T09:58:00.000Z',
          ls: '2026-03-27T11:30:00.000Z',
          lr: '2026-03-27T10:05:00.000Z',
        }),
      ],
      'alice',
      new Map([
        [
          'room-1',
          {
            unreadMessages: 0,
            mentionCount: 0,
            replyCount: 0,
            hasThreadActivity: true,
            hasUncountedActivity: false,
          },
        ],
      ]),
    );

    expect(normalized.entries[0]?.conversation.lastActivityAt).toBe('2026-03-27T10:05:00.000Z');
  });

  test('uses a stable conversation id tie-breaker when last activity timestamps are equal', () => {
    const roomA = room({ _id: 'room-a', name: 'room-a', fname: 'Room A', lm: '2026-03-27T10:00:00.000Z' });
    const roomB = room({ _id: 'room-b', name: 'room-b', fname: 'Room B', lm: '2026-03-27T10:00:00.000Z' });
    const subscriptionA = subscription({ _id: 'subscription-a', rid: 'room-a', name: 'room-a', fname: 'Room A' });
    const subscriptionB = subscription({ _id: 'subscription-b', rid: 'room-b', name: 'room-b', fname: 'Room B' });
    const inboxByConversationId = new Map([
      ['room-a', { unreadMessages: 0, mentionCount: 0, replyCount: 0, hasThreadActivity: false, hasUncountedActivity: false }],
      ['room-b', { unreadMessages: 0, mentionCount: 0, replyCount: 0, hasThreadActivity: false, hasUncountedActivity: false }],
    ]);

    const left = normalizeDirectorySnapshot([roomA, roomB], [subscriptionA, subscriptionB], 'alice', inboxByConversationId);
    const right = normalizeDirectorySnapshot([roomA, roomB], [subscriptionB, subscriptionA], 'alice', inboxByConversationId);

    expect(left.entries.map((entry) => entry.conversation.id)).toEqual(['room-a', 'room-b']);
    expect(right.entries.map((entry) => entry.conversation.id)).toEqual(['room-a', 'room-b']);
  });

  test('includes DM presence in directory and conversation snapshots', () => {
    const dmRoom = room({
      _id: 'dm-1',
      t: 'd',
      fname: 'Bob Example',
      usernames: ['alice', 'bob'],
      uids: ['alice-id', 'bob-id'],
    });
    const dmSubscription = subscription({
      _id: 'dm-subscription-1',
      rid: 'dm-1',
      t: 'd',
      name: 'bob',
      fname: 'Bob Example',
    });

    const directory = normalizeDirectorySnapshot(
      [dmRoom],
      [dmSubscription],
      'alice',
      new Map([
        [
          'dm-1',
          {
            unreadMessages: 0,
            mentionCount: 0,
            replyCount: 0,
            hasThreadActivity: false,
            hasUncountedActivity: false,
          },
        ],
      ]),
      new Map([['dm-1', 'busy']]),
    );
    expect(directory.entries[0]?.conversation.kind).toEqual({ mode: 'direct' });
    expect(directory.entries[0]?.live).toEqual({ counterpartPresence: 'busy' });

    const conversation = normalizeConversationSnapshot(
      dmRoom,
      dmSubscription,
      'alice',
      {
        unreadMessages: 0,
        mentionCount: 0,
        replyCount: 0,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      },
      {
        ...conversationCapabilitiesFixture(),
      },
      'busy',
    );
    expect(conversation.live).toEqual({ counterpartPresence: 'busy' });
  });

  test('treats multi-user DMs as private groups without counterpart presence', () => {
    const groupDmRoom = room({
      _id: 'dm-group-1',
      t: 'd',
      fname: 'Alice, Bob, Charlie',
      usernames: ['alice', 'bob', 'charlie'],
      uids: ['alice-id', 'bob-id', 'charlie-id'],
    });
    const groupDmSubscription = subscription({
      _id: 'dm-group-subscription-1',
      rid: 'dm-group-1',
      t: 'd',
      name: 'alice,bob,charlie',
      fname: 'Alice, Bob, Charlie',
    });

    const directory = normalizeDirectorySnapshot(
      [groupDmRoom],
      [groupDmSubscription],
      'alice',
      new Map([
        [
          'dm-group-1',
          {
            unreadMessages: 0,
            mentionCount: 0,
            replyCount: 0,
            hasThreadActivity: false,
            hasUncountedActivity: false,
          },
        ],
      ]),
      new Map([['dm-group-1', 'busy']]),
    );

    expect(directory.entries[0]?.conversation.kind).toEqual({ mode: 'group', privacy: 'private' });
    expect(directory.entries[0]?.conversation.avatarUrl).toBe('/api/media/avatar/room/dm-group-1');
    expect(directory.entries[0]?.live).toBeUndefined();

    const conversation = normalizeConversationSnapshot(
      groupDmRoom,
      groupDmSubscription,
      'alice',
      {
        unreadMessages: 0,
        mentionCount: 0,
        replyCount: 0,
        hasThreadActivity: false,
        hasUncountedActivity: false,
      },
      {
        ...conversationCapabilitiesFixture(),
      },
      'busy',
    );

    expect(conversation.conversation.kind).toEqual({ mode: 'group', privacy: 'private' });
    expect(conversation.live).toBeUndefined();
  });

  test('normalizes quoted replies and thread metadata into canonical message shape', () => {
    const parent = message({
      _id: 'parent-1',
      msg: 'Parent body',
    });
    const reply = message({
      _id: 'reply-1',
      msg: '[ ](http://127.0.0.1:3100/channel/general?msg=parent-1)\nReply body',
      attachments: [
        {
          message_link: 'http://127.0.0.1:3100/channel/general?msg=parent-1',
          text: 'Parent body',
          author_name: 'Alice Example',
        },
      ],
      tmid: 'parent-1',
      tcount: 2,
      tlm: '2026-03-27T10:05:00.000Z',
    });

    const normalized = normalizeConversationMessage(upstreamUrl, reply, new Map([['parent-1', parent]]), 'alice');

    expect(normalized.content.text).toBe('Reply body');
    expect(normalized.replyTo).toEqual({
      messageId: 'parent-1',
      authorName: 'Alice Example',
      excerpt: 'Parent body',
      long: false,
    });
    expect(normalized.thread).toEqual({
      rootMessageId: 'reply-1',
      replyCount: 2,
      lastReplyAt: '2026-03-27T10:05:00.000Z',
    });
  });

  test('projects exact per-message edit and delete actions from auth, ownership, and settings', () => {
    const ownMessage = message();
    const othersMessage = message({
      _id: 'message-2',
      u: {
        _id: 'bob-id',
        username: 'bob',
        name: 'Bob Example',
      },
    });

    const normalizedOwn = normalizeConversationMessage(
      upstreamUrl,
      ownMessage,
      new Map(),
      viewerContext({
        settingsValues: {
          Message_AllowEditing: true,
          Message_AllowEditing_BlockEditInMinutes: 0,
          Message_AllowDeleting: true,
          Message_AllowDeleting_BlockDeleteInMinutes: 0,
        },
        permissionsById: {
          'delete-own-message': ['user'],
        },
      }),
    );
    const normalizedOthers = normalizeConversationMessage(
      upstreamUrl,
      othersMessage,
      new Map(),
      viewerContext({
        settingsValues: {
          Message_AllowEditing: true,
          Message_AllowEditing_BlockEditInMinutes: 0,
          Message_AllowDeleting: true,
          Message_AllowDeleting_BlockDeleteInMinutes: 0,
        },
        permissionsById: {
          'delete-own-message': ['user'],
        },
      }),
    );

    expect(normalizedOwn.actions).toEqual({
      edit: true,
      delete: true,
    });
    expect(normalizedOthers.actions).toEqual({
      edit: false,
      delete: false,
    });
  });

  test('disables message actions when readonly send restrictions or time windows block them', () => {
    const oldOwnMessage = message({
      ts: '2026-03-27T09:00:00.000Z',
    });

    const normalized = normalizeConversationMessage(
      upstreamUrl,
      oldOwnMessage,
      new Map(),
      viewerContext({
        roomOverrides: {
          ro: true,
        },
        settingsValues: {
          Message_AllowEditing: true,
          Message_AllowEditing_BlockEditInMinutes: 15,
          Message_AllowDeleting: true,
          Message_AllowDeleting_BlockDeleteInMinutes: 15,
        },
        permissionsById: {
          'delete-own-message': ['user'],
        },
      }),
    );

    expect(normalized.actions).toEqual({
      edit: false,
      delete: false,
    });
  });

  test('keeps external image attachments external while proxying upstream-local media', () => {
    const normalized = normalizeConversationMessage(
      upstreamUrl,
      message({
        attachments: [
          {
            image_url: 'https://cdn.example.com/pixel.png',
            image_type: 'image/png',
            title: 'External image',
          },
          {
            image_url: '/file-upload/file-1/room.png',
            image_type: 'image/png',
            title: 'Room image',
          },
        ],
      }),
      new Map(),
      'alice',
    );

    expect(normalized.attachments).toEqual([
      {
        kind: 'image',
        id: 'message-1-image-0',
        title: 'External image',
        preview: {
          url: 'https://cdn.example.com/pixel.png',
        },
        source: {
          url: 'https://cdn.example.com/pixel.png',
        },
      },
      {
        kind: 'image',
        id: 'message-1-image-1',
        title: 'Room image',
        preview: {
          url: '/api/media/file-upload/file-1/room.png',
        },
        source: {
          url: '/api/media/file-upload/file-1/room.png',
        },
      },
    ]);
  });

  test('splits uploaded image preview and source assets when Rocket.Chat provides both thumbnail and original URLs', () => {
    const normalized = normalizeConversationMessage(
      upstreamUrl,
      message({
        attachments: [
          {
            title: 'Uploaded image',
            title_link: '/file-upload/original-file-1/upload.png',
            image_url: '/file-upload/thumb-file-1/upload.png',
            image_type: 'image/png',
            image_dimensions: {
              width: 360,
              height: 270,
            },
          },
        ],
        file: {
          _id: 'original-file-1',
          name: 'upload.png',
          type: 'image/png',
        },
        files: [
          {
            _id: 'original-file-1',
            name: 'upload.png',
            type: 'image/png',
          },
          {
            _id: 'thumb-file-1',
            name: 'upload.png',
            type: 'image/png',
          },
        ],
      }),
      new Map(),
      'alice',
    );

    expect(normalized.attachments).toEqual([
      {
        kind: 'image',
        id: 'original-file-1',
        title: 'Uploaded image',
        preview: {
          url: '/api/media/file-upload/thumb-file-1/upload.png',
          width: 360,
          height: 270,
        },
        source: {
          url: '/api/media/file-upload/original-file-1/upload.png',
        },
      },
    ]);
  });


  test('does not emit an unread anchor for self-authored post-checkpoint messages', () => {
    const timeline = normalizeConversationTimeline(
      upstreamUrl,
      'room-1',
      [
        message({
          _id: 'self-1',
          ts: '2026-03-27T10:01:00.000Z',
          u: {
            _id: 'alice-id',
            username: 'alice',
            name: 'Alice Example',
          },
        }),
      ],
      new Map(),
      'alice',
    );

    expect(timeline.unreadAnchorMessageId).toBeUndefined();
  });

  test('builds canonical conversation and thread timeline scopes', () => {
    const timeline = normalizeConversationTimeline(
      upstreamUrl,
      'room-1',
      [
        message({ _id: 'message-2', ts: '2026-03-27T10:02:00.000Z' }),
        message({ _id: 'message-1', ts: '2026-03-27T10:01:00.000Z' }),
      ],
      new Map(),
      'alice',
    );

    expect(timeline.scope).toEqual({
      kind: 'conversation',
      conversationId: 'room-1',
    });
    expect(timeline.messages.map((entry) => entry.id)).toEqual(['message-1', 'message-2']);

    const thread = normalizeThreadTimeline(
      upstreamUrl,
      'room-1',
      message({ _id: 'thread-root', msg: 'Thread root' }),
      [message({ _id: 'thread-reply', tmid: 'thread-root', msg: 'Thread reply' })],
      'alice',
    );

    expect(thread.scope).toEqual({
      kind: 'thread',
      conversationId: 'room-1',
      threadId: 'thread-root',
    });
    expect(thread.threadRoot?.id).toBe('thread-root');
    expect(thread.messages.map((entry) => entry.id)).toEqual(['thread-reply']);
  });

  test('state.edited is false for soft-deleted messages even when editedAt is set', () => {
    const softDeleted = message({
      editedAt: '2026-03-27T10:05:00.000Z',
      t: 'rm',
      msg: '',
    });

    const normalized = normalizeConversationMessage(upstreamUrl, softDeleted, new Map(), 'alice');

    expect(normalized.state.edited).toBe(false);
    expect(normalized.state.deleted).toBe(true);
  });

  test('state.edited is false for trash-deleted messages even when editedAt is set', () => {
    const trashDeleted = message({
      editedAt: '2026-03-27T10:05:00.000Z',
      _deletedAt: '2026-03-27T10:06:00.000Z',
    });

    const normalized = normalizeConversationMessage(upstreamUrl, trashDeleted, new Map(), 'alice');

    expect(normalized.state.edited).toBe(false);
    expect(normalized.state.deleted).toBe(true);
  });

  test('state.edited is true for genuinely edited non-deleted messages', () => {
    const edited = message({
      editedAt: '2026-03-27T10:05:00.000Z',
    });

    const normalized = normalizeConversationMessage(upstreamUrl, edited, new Map(), 'alice');

    expect(normalized.state.edited).toBe(true);
    expect(normalized.state.deleted).toBe(false);
  });

  test('replyTo excerpt shows deleted placeholder when parent message is soft-deleted', () => {
    const deletedParent = message({
      _id: 'parent-1',
      msg: '',
      t: 'rm',
    });
    const reply = message({
      _id: 'reply-1',
      msg: '[ ](http://127.0.0.1:3100/channel/general?msg=parent-1)\nReply body',
      attachments: [
        {
          message_link: 'http://127.0.0.1:3100/channel/general?msg=parent-1',
          text: 'Parent body',
          author_name: 'Alice Example',
        },
      ],
    });

    const normalized = normalizeConversationMessage(upstreamUrl, reply, new Map([['parent-1', deletedParent]]), 'alice');

    expect(normalized.replyTo).toEqual({
      messageId: 'parent-1',
      authorName: 'Alice Example',
      excerpt: '该消息已删除。',
      long: false,
    });
  });

  test('replyTo excerpt derives from parent content when parent is not deleted', () => {
    const parent = message({
      _id: 'parent-1',
      msg: 'Parent body here',
    });
    const reply = message({
      _id: 'reply-1',
      msg: '[ ](http://127.0.0.1:3100/channel/general?msg=parent-1)\nReply body',
      attachments: [
        {
          message_link: 'http://127.0.0.1:3100/channel/general?msg=parent-1',
          text: 'Parent body here',
          author_name: 'Alice Example',
        },
      ],
    });

    const normalized = normalizeConversationMessage(upstreamUrl, reply, new Map([['parent-1', parent]]), 'alice');

    expect(normalized.replyTo).toEqual({
      messageId: 'parent-1',
      authorName: 'Alice Example',
      excerpt: 'Parent body here',
      long: false,
    });
  });

  test('fails explicitly on unsupported upstream room kinds', () => {
    expect(() =>
      normalizeConversationSnapshot(
        room({ _id: 'room-livechat', t: 'l' }),
        subscription({ rid: 'room-livechat', t: 'l', name: 'room-livechat' }),
        'alice',
        {
          unreadMessages: 0,
          mentionCount: 0,
          replyCount: 0,
          hasThreadActivity: false,
          hasUncountedActivity: false,
        },
        {
          ...conversationCapabilitiesFixture(),
        },
      )
    ).toThrow(new AppError('UNSUPPORTED_UPSTREAM_BEHAVIOR', 'Unsupported room type: l', 502, {
      roomType: 'l',
    }));
  });
});
