import type {
  DirectConversationLookup,
  EnsureDirectConversationResponse,
  MembershipListing,
  UserSummary,
} from '@betterchat/contracts';

import { isOneToOneDirectConversation } from './conversation-domain';
import { AppError } from './errors';
import { normalizeUserSummary } from './normalize';
import { loadBestEffortPresenceByUserId } from './presence';
import type { UpstreamSession } from './session';
import type { SnapshotService } from './snapshot-service';
import { buildConversationSnapshotSync, buildFreshConversationSnapshotSync } from './snapshot-sync';
import type { RocketChatClient, UpstreamRoom, UpstreamSubscription, UpstreamUser } from './upstream';

type LoadedTargetUser = {
  rawUser: UpstreamUser;
  user: UserSummary;
};

type ExistingDirectConversation = {
  conversationId: string;
  listing: MembershipListing;
};

const loadTargetUser = async (
  client: RocketChatClient,
  session: UpstreamSession,
  userId: string,
): Promise<LoadedTargetUser> => {
  const userInfoResponse = await client.getUserInfo(session, userId);
  const rawUser = userInfoResponse.user;
  if (!rawUser) {
    throw new AppError('NOT_FOUND', 'User not found', 404, { userId });
  }

  if (rawUser._id === session.userId) {
    throw new AppError('VALIDATION_ERROR', 'Direct conversation target must be another user', 400, { userId });
  }

  const presenceByUserId = await loadBestEffortPresenceByUserId(
    client,
    session,
    [rawUser._id],
    new Map([[rawUser._id, rawUser.status]]),
  );

  return {
    rawUser,
    user: normalizeUserSummary(rawUser, presenceByUserId.get(rawUser._id)),
  };
};

const counterpartMatchesTarget = (
  room: Pick<UpstreamRoom, 'uids' | 'usernames'> | undefined,
  session: UpstreamSession,
  targetUser: Pick<UpstreamUser, '_id' | 'username'>,
): boolean => {
  if (room?.uids?.includes(targetUser._id)) {
    return room.uids.includes(session.userId);
  }

  return room?.usernames?.includes(targetUser.username) ?? false;
};

export const existingDirectConversationFromUpstreamState = (
  rooms: UpstreamRoom[],
  subscriptions: UpstreamSubscription[],
  session: UpstreamSession,
  targetUser: Pick<UpstreamUser, '_id' | 'username'>,
): ExistingDirectConversation | undefined => {
  const roomByConversationId = new Map(rooms.map((room) => [room._id, room]));

  for (const subscription of subscriptions) {
    const room = roomByConversationId.get(subscription.rid);
    if (!isOneToOneDirectConversation(room, subscription)) {
      continue;
    }

    if (!counterpartMatchesTarget(room, session, targetUser)) {
      continue;
    }

    return {
      conversationId: subscription.rid,
      listing: subscription.open ? 'listed' : 'hidden',
    };
  }

  return undefined;
};

export const lookupDirectConversation = async (
  client: RocketChatClient,
  _snapshotService: SnapshotService,
  session: UpstreamSession,
  userId: string,
): Promise<DirectConversationLookup> => {
  const [targetUser, subscriptionsResponse, roomsResponse] = await Promise.all([
    loadTargetUser(client, session, userId),
    client.getSubscriptions(session),
    client.getRooms(session),
  ]);
  const existing = existingDirectConversationFromUpstreamState(roomsResponse.update, subscriptionsResponse.update, session, targetUser.rawUser);

  return {
    user: targetUser.user,
    conversation:
      existing === undefined
        ? {
            state: 'none',
          }
        : {
            state: existing.listing,
            conversationId: existing.conversationId,
          },
  };
};

const syncForEnsuredConversation = (
  snapshotService: SnapshotService,
  session: UpstreamSession,
  conversationId: string,
  refresh: 'fresh' | 'cached',
) => {
  const syncSelection = {
    includeDirectory: true,
    includeConversation: true,
    includeTimeline: true,
  } as const;

  return refresh === 'fresh'
    ? buildFreshConversationSnapshotSync(snapshotService, session, conversationId, syncSelection)
    : buildConversationSnapshotSync(snapshotService, session, conversationId, syncSelection);
};

export const ensureDirectConversation = async (
  client: RocketChatClient,
  snapshotService: SnapshotService,
  session: UpstreamSession,
  userId: string,
): Promise<EnsureDirectConversationResponse> => {
  const [targetUser, subscriptionsResponse, roomsResponse] = await Promise.all([
    loadTargetUser(client, session, userId),
    client.getSubscriptions(session),
    client.getRooms(session),
  ]);
  const existing = existingDirectConversationFromUpstreamState(roomsResponse.update, subscriptionsResponse.update, session, targetUser.rawUser);

  if (existing?.listing === 'listed') {
    return {
      user: targetUser.user,
      conversationId: existing.conversationId,
      disposition: 'existing-listed',
      sync: await syncForEnsuredConversation(snapshotService, session, existing.conversationId, 'cached'),
    };
  }

  if (existing?.listing === 'hidden') {
    await client.openDirectConversation(session, existing.conversationId);

    return {
      user: targetUser.user,
      conversationId: existing.conversationId,
      disposition: 'existing-hidden-opened',
      sync: await syncForEnsuredConversation(snapshotService, session, existing.conversationId, 'fresh'),
    };
  }

  const createdResponse = await client.createDirectConversation(session, targetUser.rawUser.username);
  const conversationId = createdResponse.room?._id || createdResponse.room?.rid;
  if (!conversationId) {
    throw new AppError('UNSUPPORTED_UPSTREAM_BEHAVIOR', 'Rocket.Chat returned no direct conversation id', 502, {
      userId,
      username: targetUser.rawUser.username,
    });
  }

  return {
    user: targetUser.user,
    conversationId,
    disposition: 'created',
    sync: await syncForEnsuredConversation(snapshotService, session, conversationId, 'fresh'),
  };
};
