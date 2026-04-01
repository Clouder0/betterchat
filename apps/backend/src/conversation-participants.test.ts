import { describe, expect, test } from 'bun:test';

import {
  buildConversationMentionCandidates,
  buildConversationParticipantsPage,
} from './conversation-participants';
import type { ConversationAuthorizationContext } from './conversation-authorization';
import type { UpstreamSession } from './session';
import type { RocketChatClient, UpstreamConversationMember } from './upstream';

const session: UpstreamSession = {
  authToken: 'auth-token',
  createdAt: '2026-03-31T00:00:00.000Z',
  displayName: 'Alice Example',
  expiresAt: '2099-03-31T00:00:00.000Z',
  userId: 'alice-id',
  username: 'alice',
};

const authorizationContext = (
  overrides: Partial<Pick<ConversationAuthorizationContext, 'currentUserId' | 'room' | 'subscription'>> = {},
): Pick<ConversationAuthorizationContext, 'currentUserId' | 'room' | 'subscription'> => ({
  currentUserId: session.userId,
  room: {
    _id: 'room-1',
    t: 'c',
    name: 'general',
  },
  subscription: {
    _id: 'subscription-1',
    rid: 'room-1',
    t: 'c',
    name: 'general',
    open: true,
    unread: 0,
  },
  ...overrides,
});

const member = (overrides: Partial<UpstreamConversationMember> = {}): UpstreamConversationMember => ({
  _id: 'user-1',
  username: 'user1',
  name: 'User One',
  status: 'online',
  ...overrides,
});

const createClient = (members: UpstreamConversationMember[], total = members.length): RocketChatClient =>
  ({
    getConversationMembers: async () => ({
      success: true,
      members,
      count: members.length,
      offset: 0,
      total,
    }),
  }) as unknown as RocketChatClient;

describe('conversation participants', () => {
  test('builds a normalized participant page with pagination metadata', async () => {
    const page = await buildConversationParticipantsPage(
      createClient([
        member({ _id: 'alice-id', username: 'alice', name: 'Alice Example', status: 'away' }),
        member({ _id: 'bob-id', username: 'bob', name: 'Bob Example', status: 'busy' }),
      ], 3),
      session,
      authorizationContext(),
      {
        offset: 0,
        limit: 2,
      },
    );

    expect(page).toEqual({
      conversationId: 'room-1',
      entries: [
        {
          user: {
            id: 'alice-id',
            username: 'alice',
            displayName: 'Alice Example',
            avatarUrl: '/api/media/avatar/alice',
            presence: 'away',
          },
          self: true,
        },
        {
          user: {
            id: 'bob-id',
            username: 'bob',
            displayName: 'Bob Example',
            avatarUrl: '/api/media/avatar/bob',
            presence: 'busy',
          },
          self: false,
        },
      ],
      nextCursor: Buffer.from(JSON.stringify({ offset: 2 }), 'utf8').toString('base64'),
    });
  });

  test('ranks mention user candidates, excludes self, and appends room-wide specials for group conversations', async () => {
    const candidates = await buildConversationMentionCandidates(
      createClient([
        member({ _id: 'alice-id', username: 'alice', name: 'Alice Example' }),
        member({ _id: 'user-zhou', username: 'zhoulan', name: '周岚' }),
        member({ _id: 'user-observer', username: 'observer', name: 'zh 观察员' }),
        member({ _id: 'user-mia', username: 'mia', name: 'Mia 张' }),
      ]),
      session,
      authorizationContext(),
      'zh',
      6,
    );

    expect(candidates).toEqual({
      conversationId: 'room-1',
      query: 'zh',
      entries: [
        {
          kind: 'user',
          user: {
            id: 'user-zhou',
            username: 'zhoulan',
            displayName: '周岚',
            avatarUrl: '/api/media/avatar/zhoulan',
            presence: 'online',
          },
          insertText: '@zhoulan',
        },
        {
          kind: 'user',
          user: {
            id: 'user-observer',
            username: 'observer',
            displayName: 'zh 观察员',
            avatarUrl: '/api/media/avatar/observer',
            presence: 'online',
          },
          insertText: '@observer',
        },
      ],
    });
  });

  test('uses a mention member-search filter that strips only the leading @ marker', async () => {
    const capturedFilters: Array<string | undefined> = [];
    const client = {
      getConversationMembers: async (
        _session: UpstreamSession,
        input: { filter?: string },
      ) => {
        capturedFilters.push(input.filter);

        return {
          success: true,
          members: [member({ _id: 'user-observer', username: 'observer', name: 'zh 观察员' })],
          count: 1,
          offset: 0,
          total: 1,
        };
      },
    } as unknown as RocketChatClient;

    await buildConversationMentionCandidates(
      client,
      session,
      authorizationContext(),
      '@zh 观',
      4,
    );

    expect(capturedFilters).toEqual(['zh 观']);
  });

  test('returns room-wide special mentions only for non-direct conversations and omits them for one-to-one directs', async () => {
    const groupCandidates = await buildConversationMentionCandidates(
      createClient([
        member({ _id: 'bob-id', username: 'bob', name: 'Bob Example' }),
      ]),
      session,
      authorizationContext(),
      '',
      4,
    );
    const directCandidates = await buildConversationMentionCandidates(
      createClient([
        member({ _id: 'alice-id', username: 'alice', name: 'Alice Example' }),
        member({ _id: 'bob-id', username: 'bob', name: 'Bob Example' }),
      ]),
      session,
      authorizationContext({
        room: {
          _id: 'dm-1',
          t: 'd',
          uids: ['alice-id', 'bob-id'],
          usernames: ['alice', 'bob'],
        },
        subscription: {
          _id: 'subscription-dm-1',
          rid: 'dm-1',
          t: 'd',
          name: 'alice,bob',
          open: true,
          unread: 0,
        },
      }),
      '',
      4,
    );

    expect(groupCandidates.entries.at(-2)).toEqual({
      kind: 'special',
      key: 'all',
      label: 'Notify everyone in this conversation',
      insertText: '@all',
    });
    expect(groupCandidates.entries.at(-1)).toEqual({
      kind: 'special',
      key: 'here',
      label: 'Notify active members in this conversation',
      insertText: '@here',
    });
    expect(directCandidates.entries).toEqual([
      {
        kind: 'user',
        user: {
          id: 'bob-id',
          username: 'bob',
          displayName: 'Bob Example',
          avatarUrl: '/api/media/avatar/bob',
          presence: 'online',
        },
        insertText: '@bob',
      },
    ]);
  });
});
