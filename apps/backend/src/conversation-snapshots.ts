import type {
  ConversationMessageContextSnapshot,
  ConversationSnapshot,
  ConversationTimelineSnapshot,
  DirectoryEntry,
  DirectorySnapshot,
} from '@betterchat/contracts';

import { conversationCapabilitiesFrom, threadsEnabledFrom } from './capabilities';
import type { BetterChatConfig } from './config';
import { loadConversationAuthorizationContext } from './conversation-authorization';
import {
  isOneToOneDirectConversation,
  normalizeConversationMessageContext,
  normalizeConversationSnapshot,
  normalizeConversationTimeline,
  normalizeDirectoryEntry,
  normalizeDirectorySnapshot,
  normalizeThreadTimeline,
} from './conversation-domain';
import { AppError, toAppError } from './errors';
import { projectMembershipInboxProjection } from './inbox-projector';
import { assertValidConversationContextAnchorMessage, getThreadRootMessage, replyParentMessageIdFrom } from './message-helpers';
import { nextCursorFrom, type PaginationRequest } from './pagination';
import { loadBestEffortPresenceByUserId } from './presence';
import type { SnapshotFactCache } from './snapshot-facts';
import { computeSnapshotVersion } from './snapshot-version';
import type { UpstreamSession } from './session';
import {
  collectInitialRoomTimelineMessagesPage,
  collectRoomTimelineContextPage,
  getRoomSubscription,
} from './snapshots';
import { RocketChatClient, type UpstreamMessage, type UpstreamRoom, type UpstreamSubscription } from './upstream';

type DirectorySnapshotState = {
  counterpartUserIdByConversationId: Map<string, string>;
  snapshot: DirectorySnapshot;
};

type DirectoryEntryState = {
  counterpartUserIdByConversationId: Map<string, string>;
  entry?: DirectoryEntry;
};

type ConversationSnapshotState = {
  counterpartUserId?: string;
  snapshot: ConversationSnapshot;
};

const parentMessageIdsFrom = (messages: UpstreamMessage[], upstreamUrl: string): string[] =>
  [
    ...new Set(
      messages
        .map((message) => replyParentMessageIdFrom(message, upstreamUrl))
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ];

const counterpartUserIdFrom = (
  room: UpstreamRoom | undefined,
  subscription: UpstreamSubscription | undefined,
  session: UpstreamSession,
): string | undefined => {
  if (!isOneToOneDirectConversation(room, subscription)) {
    return undefined;
  }

  return room?.uids?.find((userId) => userId !== session.userId);
};

const counterpartUserIdByConversationIdFrom = (
  rooms: UpstreamRoom[],
  subscriptions: UpstreamSubscription[],
  session: UpstreamSession,
): Map<string, string> => {
  const roomMap = new Map(rooms.map((room) => [room._id, room]));
  const result = new Map<string, string>();

  for (const subscription of subscriptions) {
    const counterpartUserId = counterpartUserIdFrom(roomMap.get(subscription.rid), subscription, session);
    if (counterpartUserId) {
      result.set(subscription.rid, counterpartUserId);
    }
  }

  return result;
};

const supportedDirectoryRoomType = (roomType: string): roomType is 'c' | 'd' | 'p' =>
  roomType === 'c' || roomType === 'd' || roomType === 'p';

const fetchPresenceByUserId = async (
  client: RocketChatClient,
  session: UpstreamSession,
  userIds: string[],
  facts?: SnapshotFactCache,
): Promise<Map<string, string>> => {
  const uniqueUserIds = [...new Set(userIds)];
  const loadedPresenceByUserId = facts
    ? await facts.getUsersPresence(client, session, uniqueUserIds)
    : await loadBestEffortPresenceByUserId(client, session, uniqueUserIds);

  return new Map<string, string>(loadedPresenceByUserId.entries());
};

const presenceByConversationIdFrom = (
  counterpartUserIdByConversationId: ReadonlyMap<string, string>,
  presenceByUserId: ReadonlyMap<string, string>,
): Map<string, string> => {
  const result = new Map<string, string>();

  for (const [conversationId, userId] of counterpartUserIdByConversationId.entries()) {
    result.set(conversationId, presenceByUserId.get(userId) || 'offline');
  }

  return result;
};

const fetchParentMessages = async (
  client: RocketChatClient,
  session: UpstreamSession,
  messageIds: string[],
): Promise<Map<string, UpstreamMessage>> => {
  const parentMessages = new Map<string, UpstreamMessage>();

  await Promise.all(
    messageIds.map(async (messageId) => {
      const message = await client.findMessage(session, messageId);
      if (message) {
        parentMessages.set(messageId, message);
      }
    }),
  );

  return parentMessages;
};

const buildInboxByConversationId = (
  client: RocketChatClient,
  session: UpstreamSession,
  subscriptions: UpstreamSubscription[],
  facts?: SnapshotFactCache,
): Promise<Map<string, Awaited<ReturnType<typeof projectMembershipInboxProjection>>['inbox']>> =>
  Promise.all(
    subscriptions
      .filter((subscription) => subscription.t in { c: true, p: true, d: true })
      .map(async (subscription) => {
        const projection = facts
          ? await facts.getMembershipInboxProjection(client, session, subscription, { mode: 'directory' })
          : await projectMembershipInboxProjection(client, session, subscription, { mode: 'directory' });
        return [subscription.rid, projection.inbox] as const;
      }),
  ).then((entries) => new Map(entries));

export const buildDirectorySnapshotState = async (
  client: RocketChatClient,
  session: UpstreamSession,
  facts?: SnapshotFactCache,
): Promise<DirectorySnapshotState> => {
  const [subscriptionsResponse, roomsResponse, meResponse] = await Promise.all([
    facts ? facts.getSubscriptions(client, session) : client.getSubscriptions(session),
    facts ? facts.getRooms(client, session) : client.getRooms(session),
    facts ? facts.getMe(client, session) : client.getMe(session),
  ]);
  const inboxByConversationId = await buildInboxByConversationId(client, session, subscriptionsResponse.update, facts);
  const counterpartUserIdByConversationId = counterpartUserIdByConversationIdFrom(roomsResponse.update, subscriptionsResponse.update, session);
  const presenceByUserId = await fetchPresenceByUserId(client, session, [...counterpartUserIdByConversationId.values()], facts);
  const normalized = normalizeDirectorySnapshot(
    roomsResponse.update,
    subscriptionsResponse.update,
    meResponse.username,
    inboxByConversationId,
    presenceByConversationIdFrom(counterpartUserIdByConversationId, presenceByUserId),
  );
  const snapshot = {
    ...normalized,
    version: computeSnapshotVersion(normalized),
  };

  return {
    counterpartUserIdByConversationId,
    snapshot,
  };
};

export const buildDirectorySnapshot = async (
  client: RocketChatClient,
  session: UpstreamSession,
  facts?: SnapshotFactCache,
): Promise<DirectorySnapshot> => (await buildDirectorySnapshotState(client, session, facts)).snapshot;

export const buildDirectoryEntryState = async (
  client: RocketChatClient,
  session: UpstreamSession,
  conversationId: string,
  facts?: SnapshotFactCache,
): Promise<DirectoryEntryState> => {
  let subscription: UpstreamSubscription;
  try {
    subscription = await getRoomSubscription(client, session, conversationId, facts);
  } catch (error) {
    if (toAppError(error).status === 404) {
      return {
        counterpartUserIdByConversationId: new Map<string, string>(),
      };
    }

    throw error;
  }

  if (!supportedDirectoryRoomType(subscription.t)) {
    return {
      counterpartUserIdByConversationId: new Map<string, string>(),
    };
  }

  const [roomInfoResponse, meResponse, inboxProjection] = await Promise.all([
    facts ? facts.getRoomInfo(client, session, conversationId) : client.getRoomInfo(session, conversationId),
    facts ? facts.getMe(client, session) : client.getMe(session),
    facts
      ? facts.getMembershipInboxProjection(client, session, subscription, { mode: 'directory' })
      : projectMembershipInboxProjection(client, session, subscription, { mode: 'directory' }),
  ]);

  if (!roomInfoResponse.room) {
    return {
      counterpartUserIdByConversationId: new Map<string, string>(),
    };
  }

  const counterpartUserId = counterpartUserIdFrom(roomInfoResponse.room, subscription, session);
  const presenceByUserId = await fetchPresenceByUserId(client, session, counterpartUserId ? [counterpartUserId] : [], facts);

  return {
    counterpartUserIdByConversationId:
      counterpartUserId ? new Map<string, string>([[conversationId, counterpartUserId]]) : new Map<string, string>(),
    entry: normalizeDirectoryEntry(
      roomInfoResponse.room,
      subscription,
      meResponse.username,
      inboxProjection.inbox,
      counterpartUserId ? presenceByUserId.get(counterpartUserId) : undefined,
    ),
  };
};

export const buildConversationSnapshotState = async (
  client: RocketChatClient,
  session: UpstreamSession,
  conversationId: string,
  facts?: SnapshotFactCache,
): Promise<ConversationSnapshotState> => {
  const context = await loadConversationAuthorizationContext(client, session, conversationId, facts);
  const counterpartUserId = counterpartUserIdFrom(context.room, context.subscription, session);
  const presenceByUserId = await fetchPresenceByUserId(client, session, counterpartUserId ? [counterpartUserId] : [], facts);
  const inboxProjection = facts
    ? await facts.getMembershipInboxProjection(client, session, context.subscription)
    : await projectMembershipInboxProjection(client, session, context.subscription);
  const normalized = normalizeConversationSnapshot(
    context.room,
    context.subscription,
    context.currentUsername,
    inboxProjection.inbox,
    conversationCapabilitiesFrom(context.room, context.settings, {
      authorization: context.authorization,
      currentUserId: context.currentUserId,
      currentUsername: context.currentUsername,
      subscription: context.subscription,
    }),
    counterpartUserId ? presenceByUserId.get(counterpartUserId) : undefined,
  );
  const snapshot = {
    ...normalized,
    version: computeSnapshotVersion(normalized),
  };

  return {
    ...(counterpartUserId ? { counterpartUserId } : {}),
    snapshot,
  };
};

export const buildConversationSnapshot = async (
  client: RocketChatClient,
  session: UpstreamSession,
  conversationId: string,
  facts?: SnapshotFactCache,
): Promise<ConversationSnapshot> => (await buildConversationSnapshotState(client, session, conversationId, facts)).snapshot;

export const buildConversationTimelineSnapshot = async (
  config: BetterChatConfig,
  client: RocketChatClient,
  session: UpstreamSession,
  conversationId: string,
  page: PaginationRequest = {
    offset: 0,
    limit: config.defaultMessagePageSize,
  },
  facts?: SnapshotFactCache,
): Promise<ConversationTimelineSnapshot> => {
  const context = await loadConversationAuthorizationContext(client, session, conversationId, facts);

  const unreadProjection = page.offset === 0
    ? facts
      ? await facts.getMembershipInboxProjection(client, session, context.subscription)
      : await projectMembershipInboxProjection(client, session, context.subscription)
    : undefined;
  const roomTimelinePage = await collectInitialRoomTimelineMessagesPage(
    config,
    client,
    session,
    context.room.t,
    conversationId,
    page,
    unreadProjection?.firstUnreadMessageId,
    unreadProjection?.inbox.unreadMessages,
  );
  const parentMessages = await fetchParentMessages(client, session, parentMessageIdsFrom(roomTimelinePage.messages, config.upstreamUrl));
  const normalized = normalizeConversationTimeline(
    config.upstreamUrl,
    context.room._id,
    roomTimelinePage.messages,
    parentMessages,
    context,
    unreadProjection?.firstUnreadMessageId,
  );

  return {
    ...normalized,
    nextCursor: roomTimelinePage.nextCursor,
    version: computeSnapshotVersion(normalized),
  };
};

export const buildThreadConversationTimelineSnapshot = async (
  config: BetterChatConfig,
  client: RocketChatClient,
  session: UpstreamSession,
  conversationId: string,
  threadId: string,
  page: PaginationRequest = {
    offset: 0,
    limit: config.defaultMessagePageSize,
  },
  facts?: SnapshotFactCache,
): Promise<ConversationTimelineSnapshot> => {
  const context = await loadConversationAuthorizationContext(client, session, conversationId, facts);
  if (!threadsEnabledFrom(context.settings)) {
    throw new AppError('UPSTREAM_REJECTED', 'Threads are disabled', 403, { conversationId, threadId });
  }

  const parentMessage = await getThreadRootMessage(client, session, conversationId, threadId);
  const messagesResponse = await client.getThreadMessages(session, threadId, page.limit, page.offset);
  const normalized = normalizeThreadTimeline(
    config.upstreamUrl,
    context.room._id,
    parentMessage,
    messagesResponse.messages,
    context,
  );

  return {
    ...normalized,
    nextCursor: nextCursorFrom(messagesResponse),
    version: computeSnapshotVersion(normalized),
  };
};

export const buildConversationMessageContextSnapshot = async (
  config: BetterChatConfig,
  client: RocketChatClient,
  session: UpstreamSession,
  conversationId: string,
  messageId: string,
  contextWindow: {
    before: number;
    after: number;
  },
  facts?: SnapshotFactCache,
): Promise<ConversationMessageContextSnapshot> => {
  const [context, anchorMessage] = await Promise.all([
    loadConversationAuthorizationContext(client, session, conversationId, facts),
    client.findMessage(session, messageId),
  ]);

  if (!anchorMessage || anchorMessage.rid !== conversationId) {
    throw new AppError('NOT_FOUND', 'Anchor message not found', 404, { conversationId, messageId });
  }
  assertValidConversationContextAnchorMessage(anchorMessage, conversationId);

  const contextPage = await collectRoomTimelineContextPage(config, client, session, context.room.t, conversationId, messageId, contextWindow);
  const parentMessages = await fetchParentMessages(client, session, parentMessageIdsFrom(contextPage.messages, config.upstreamUrl));
  const normalizedTimeline = normalizeConversationTimeline(
    config.upstreamUrl,
    context.room._id,
    contextPage.messages,
    parentMessages,
    context,
  );
  const normalized = normalizeConversationMessageContext(
    context.room._id,
    messageId,
    contextPage.anchorIndex,
    normalizedTimeline.messages,
    contextPage.hasBefore,
    contextPage.hasAfter,
  );

  return {
    ...normalized,
    version: computeSnapshotVersion(normalized),
  };
};

export type { ConversationSnapshotState, DirectorySnapshotState };
