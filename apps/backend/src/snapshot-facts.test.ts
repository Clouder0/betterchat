import { describe, expect, test } from 'bun:test';

import { buildConversationSnapshotState, buildDirectorySnapshotState } from './conversation-snapshots';
import { SnapshotFactCache } from './snapshot-facts';
import type { UpstreamMessage, UpstreamRoom, UpstreamSubscription } from './upstream';
import type { UpstreamSession } from './session';
import type { RocketChatClient } from './upstream';

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

const subscription: UpstreamSubscription = {
  _id: 'subscription-1',
  rid: 'room-1',
  t: 'c',
  name: 'general',
  fname: 'General',
  open: true,
  ts: '2026-03-27T09:00:00.000Z',
  unread: 1,
  alert: true,
  ls: '2026-03-27T10:00:00.000Z',
};

const unreadMessage: UpstreamMessage = {
  _id: 'message-1',
  rid: 'room-1',
  msg: 'hello',
  ts: '2026-03-27T10:01:00.000Z',
  u: {
    _id: 'bob-id',
    username: 'bob',
    name: 'Bob Example',
  },
};

describe('SnapshotFactCache', () => {
  test('does not widen a single-conversation load into full directory fetches before those facts are needed', async () => {
    const callCount = {
      getMe: 0,
      getPermissionDefinitions: 0,
      getPublicSettings: 0,
      getRoomInfo: 0,
      getRooms: 0,
      getSubscription: 0,
      getSubscriptions: 0,
    };
    const client = {
      getMe: async () => {
        callCount.getMe += 1;
        return {
          success: true,
          _id: session.userId,
          username: session.username,
          name: session.displayName,
          roles: ['user'],
        };
      },
      getPermissionDefinitions: async () => {
        callCount.getPermissionDefinitions += 1;
        return {
          success: true,
          update: [],
          remove: [],
        };
      },
      getPublicSettings: async () => {
        callCount.getPublicSettings += 1;
        return {
          success: true,
          settings: [],
        };
      },
      getRoomInfo: async () => {
        callCount.getRoomInfo += 1;
        return {
          success: true,
          room,
        };
      },
      getRooms: async () => {
        callCount.getRooms += 1;
        return {
          success: true,
          update: [room],
          remove: [],
        };
      },
      getSubscription: async () => {
        callCount.getSubscription += 1;
        return {
          success: true,
          subscription,
        };
      },
      getSubscriptions: async () => {
        callCount.getSubscriptions += 1;
        return {
          success: true,
          update: [subscription],
          remove: [],
        };
      },
      getUsersPresence: async () => ({
        success: true,
        full: true,
        users: [],
      }),
      listUpdatedMessagesSince: async () => [unreadMessage],
    } as unknown as RocketChatClient;
    const facts = new SnapshotFactCache();

    await buildConversationSnapshotState(client, session, 'room-1', facts);

    expect(callCount).toEqual({
      getMe: 1,
      getPermissionDefinitions: 1,
      getPublicSettings: 1,
      getRoomInfo: 1,
      getRooms: 0,
      getSubscription: 1,
      getSubscriptions: 0,
    });
  });

  test('reuses snapshot facts across directory and conversation loads', async () => {
    const callCount = {
      getMe: 0,
      getPermissionDefinitions: 0,
      getPublicSettings: 0,
      getRooms: 0,
      getSubscriptions: 0,
      getUsersPresence: 0,
      syncMessages: 0,
    };
    const client = {
      getMe: async () => {
        callCount.getMe += 1;
        return {
          success: true,
          _id: session.userId,
          username: session.username,
          name: session.displayName,
          roles: ['user'],
        };
      },
      getPermissionDefinitions: async () => {
        callCount.getPermissionDefinitions += 1;
        return {
          success: true,
          update: [],
          remove: [],
        };
      },
      getPublicSettings: async () => {
        callCount.getPublicSettings += 1;
        return {
          success: true,
          settings: [],
        };
      },
      getRooms: async () => {
        callCount.getRooms += 1;
        return {
          success: true,
          update: [room],
          remove: [],
        };
      },
      getSubscriptions: async () => {
        callCount.getSubscriptions += 1;
        return {
          success: true,
          update: [subscription],
          remove: [],
        };
      },
      getUsersPresence: async () => {
        callCount.getUsersPresence += 1;
        return {
          success: true,
          full: true,
          users: [],
        };
      },
      listUpdatedMessagesSince: async () => {
        callCount.syncMessages += 1;
        return [unreadMessage];
      },
    } as unknown as RocketChatClient;
    const facts = new SnapshotFactCache();

    const directoryState = await buildDirectorySnapshotState(client, session, facts);
    const conversationState = await buildConversationSnapshotState(client, session, 'room-1', facts);

    expect(callCount).toEqual({
      getMe: 1,
      getPermissionDefinitions: 1,
      getPublicSettings: 1,
      getRooms: 1,
      getSubscriptions: 1,
      getUsersPresence: 0,
      syncMessages: 1,
    });
    expect(directoryState.snapshot.entries[0]?.membership.inbox).toEqual({
      unreadMessages: 1,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: false,
    });
    expect(conversationState.snapshot.membership.inbox).toEqual({
      unreadMessages: 1,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: false,
    });
  });

  test('reuses alert-only directory reconciliation when an exact conversation read follows inside one shared fact scope', async () => {
    let syncMessages = 0;
    const zeroUnreadSubscription = {
      ...subscription,
      unread: 0,
    };
    const client = {
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
      getPublicSettings: async () => ({
        success: true,
        settings: [],
      }),
      getRooms: async () => ({
        success: true,
        update: [room],
        remove: [],
      }),
      getSubscriptions: async () => ({
        success: true,
        update: [zeroUnreadSubscription],
        remove: [],
      }),
      getUsersPresence: async () => ({
        success: true,
        full: true,
        users: [],
      }),
      listUpdatedMessagesSince: async () => {
        syncMessages += 1;
        return [unreadMessage];
      },
    } as unknown as RocketChatClient;
    const facts = new SnapshotFactCache();

    const directoryState = await buildDirectorySnapshotState(client, session, facts);
    const conversationState = await buildConversationSnapshotState(client, session, 'room-1', facts);

    expect(syncMessages).toBe(1);
    expect(directoryState.snapshot.entries[0]?.membership.inbox).toEqual({
      unreadMessages: 1,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: false,
    });
    expect(conversationState.snapshot.membership.inbox).toEqual({
      unreadMessages: 1,
      mentionCount: 0,
      replyCount: 0,
      hasThreadActivity: false,
      hasUncountedActivity: false,
    });
  });
});
