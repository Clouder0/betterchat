import { describe, expect, test } from 'bun:test';

import { ensureDirectConversation, existingDirectConversationFromUpstreamState, lookupDirectConversation } from './direct-conversations';
import { AppError } from './errors';
import type { UpstreamSession } from './session';
import type { SnapshotService } from './snapshot-service';
import { conversationCapabilitiesFixture, emptyMembershipInbox } from './test-fixtures';
import type { RocketChatClient } from './upstream';

const session: UpstreamSession = {
  authToken: 'auth-token',
  createdAt: '2026-03-28T00:00:00.000Z',
  displayName: 'Alice Example',
  expiresAt: '2099-03-28T00:00:00.000Z',
  userId: 'alice-id',
  username: 'alice',
};

const createClient = (overrides: Record<string, unknown> = {}): RocketChatClient =>
  ({
    getUserInfo: async (_session: UpstreamSession, userId: string) => ({
      success: true,
      user: {
        _id: userId,
        username: 'bob',
        name: 'Bob Example',
      },
    }),
    getUsersPresence: async () => ({
      success: true,
      full: true,
      users: [
        {
          _id: 'bob-id',
          status: 'busy',
        },
      ],
    }),
    getRooms: async () => ({
      success: true,
      update: [],
      remove: [],
    }),
    getSubscriptions: async () => ({
      success: true,
      update: [],
      remove: [],
    }),
    ...overrides,
  }) as unknown as RocketChatClient;

const createSnapshotService = (overrides: Record<string, unknown> = {}): SnapshotService =>
  ({
    directoryState: async () => ({
      counterpartUserIdByConversationId: new Map<string, string>(),
      snapshot: {
        version: 'directory-version-1',
        entries: [],
      },
    }),
    directory: async () => ({
      version: 'directory-version-1',
      entries: [],
    }),
    conversation: async (_session: UpstreamSession, conversationId: string) => ({
      version: `conversation-${conversationId}`,
      conversation: {
        id: conversationId,
        kind: {
          mode: 'direct',
        },
        title: 'Bob Example',
      },
      membership: {
        listing: 'listed',
        starred: false,
        inbox: emptyMembershipInbox,
      },
      live: {
        counterpartPresence: 'busy',
      },
      capabilities: conversationCapabilitiesFixture(),
    }),
    conversationTimeline: async (_session: UpstreamSession, conversationId: string) => ({
      version: `timeline-${conversationId}`,
      scope: {
        kind: 'conversation',
        conversationId,
      },
      messages: [],
    }),
    invalidateConversation: () => undefined,
    invalidateDirectory: () => undefined,
    ...overrides,
  }) as unknown as SnapshotService;

describe('direct conversation helpers', () => {
  test('finds an existing direct conversation from upstream room and subscription facts', () => {
    const existing = existingDirectConversationFromUpstreamState(
      [
        {
          _id: 'dm-bob',
          t: 'd',
          fname: 'Bob Example',
          usernames: ['alice', 'bob'],
          uids: ['alice-id', 'bob-id'],
        },
      ],
      [
        {
          _id: 'subscription-dm-bob',
          rid: 'dm-bob',
          t: 'd',
          name: 'bob',
          fname: 'Bob Example',
          open: false,
          unread: 0,
        },
      ],
      session,
      {
        _id: 'bob-id',
        username: 'bob',
      },
    );

    expect(existing).toEqual({
      conversationId: 'dm-bob',
      listing: 'hidden',
    });
  });

  test('ignores multi-user direct rooms that are not mapped as one-to-one directs', async () => {
    const lookup = await lookupDirectConversation(
      createClient({
        getRooms: async () => ({
          success: true,
          update: [
            {
              _id: 'dm-group',
              t: 'd',
              fname: 'Bob + Charlie',
              usernames: ['alice', 'bob', 'charlie'],
              uids: ['alice-id', 'bob-id', 'charlie-id'],
            },
            {
              _id: 'dm-bob',
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
              _id: 'subscription-dm-group',
              rid: 'dm-group',
              t: 'd',
              name: 'alice,bob,charlie',
              fname: 'Bob + Charlie',
              open: true,
              unread: 0,
            },
            {
              _id: 'subscription-dm-bob',
              rid: 'dm-bob',
              t: 'd',
              name: 'bob',
              fname: 'Bob Example',
              open: true,
              unread: 0,
            },
          ],
          remove: [],
        }),
      }),
      createSnapshotService(),
      session,
      'bob-id',
    );

    expect(lookup.conversation).toEqual({
      state: 'listed',
      conversationId: 'dm-bob',
    });
  });

  test('falls back to the raw user status when optional presence lookup fails', async () => {
    const lookup = await lookupDirectConversation(
      createClient({
        getUserInfo: async () => ({
          success: true,
          user: {
            _id: 'bob-id',
            username: 'bob',
            name: 'Bob Example',
            status: 'away',
          },
        }),
        getUsersPresence: async () => {
          throw new AppError('UPSTREAM_UNAVAILABLE', 'presence failed', 503);
        },
      }),
      createSnapshotService(),
      session,
      'bob-id',
    );

    expect(lookup.user.presence).toBe('away');
  });

  test('does not require directory projection to look up an existing direct conversation', async () => {
    const snapshotService = createSnapshotService({
      directoryState: async () => {
        throw new Error('directory projection should not be used');
      },
    });

    const lookup = await lookupDirectConversation(
      createClient({
        getRooms: async () => ({
          success: true,
          update: [
            {
              _id: 'dm-bob',
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
              _id: 'subscription-dm-bob',
              rid: 'dm-bob',
              t: 'd',
              name: 'bob',
              fname: 'Bob Example',
              open: true,
              unread: 0,
            },
          ],
          remove: [],
        }),
      }),
      snapshotService,
      session,
      'bob-id',
    );

    expect(lookup.conversation).toEqual({
      state: 'listed',
      conversationId: 'dm-bob',
    });
  });

  test('rejects self-targeted direct conversation ensures', async () => {
    const client = createClient({
      getUserInfo: async () => ({
        success: true,
        user: {
          _id: 'alice-id',
          username: 'alice',
          name: 'Alice Example',
        },
      }),
    });

    await expect(ensureDirectConversation(client, createSnapshotService(), session, 'alice-id')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    } satisfies Partial<AppError>);
  });
});
