import type { MembershipInbox } from '@betterchat/contracts';

import { replyParentMessageIdFrom } from './message-helpers';
import { isVisibleInConversationTimeline } from './snapshots';
import type { UpstreamSession } from './session';
import type { UpstreamSubscription } from './upstream';
import type { RocketChatClient, UpstreamMessage } from './upstream';

export type MembershipInboxProjection = {
  inbox: MembershipInbox;
  firstUnreadMessageId?: string;
};

export type MembershipInboxProjectionMode = 'directory' | 'exact';

export type MembershipInboxProjectionOptions = {
  mode?: MembershipInboxProjectionMode;
};

const nonEmptyStringCount = (values: string[] | undefined): number =>
  values?.filter((value) => typeof value === 'string' && value.length > 0).length ?? 0;

const mentionCountFrom = (subscription: UpstreamSubscription): number =>
  Math.max(0, subscription.userMentions || 0)
  + Math.max(0, subscription.groupMentions || 0)
  + nonEmptyStringCount(subscription.tunreadUser)
  + nonEmptyStringCount(subscription.tunreadGroup);

const defaultUnreadMessagesFrom = (subscription: UpstreamSubscription): number => Math.max(0, subscription.unread || 0);

const readCheckpointFrom = (subscription: UpstreamSubscription): string | undefined => {
  const lastSeenAt = subscription.ls?.trim();
  if (lastSeenAt) {
    return lastSeenAt;
  }

  const subscribedAt = subscription.ts?.trim();
  if (subscribedAt) {
    return subscribedAt;
  }

  return undefined;
};

const shouldReconcileUnreadFromHistory = (subscription: UpstreamSubscription): boolean =>
  readCheckpointFrom(subscription) !== undefined
  && (Boolean(subscription.alert) || defaultUnreadMessagesFrom(subscription) > 0);

const visibleUnreadMainTimelineMessages = (
  messages: UpstreamMessage[],
  session: UpstreamSession,
  lastSeenAt: string,
): UpstreamMessage[] => {
  const lastSeenAtMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenAtMs)) {
    return [];
  }

  return messages
    .filter((message) => {
      const messageTsMs = Date.parse(message.ts);
      return Number.isFinite(messageTsMs)
        && messageTsMs > lastSeenAtMs
        && message.u._id !== session.userId
        && isVisibleInConversationTimeline(message);
    })
    .sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts));
};

const unreadProjectionFrom = async (
  client: RocketChatClient,
  session: UpstreamSession,
  subscription: UpstreamSubscription,
  _mode: MembershipInboxProjectionMode,
): Promise<{
  visibleUnreadMainTimelineMessages?: UpstreamMessage[];
  unreadMessages: number;
  firstUnreadMessageId?: string;
}> => {
  if (!shouldReconcileUnreadFromHistory(subscription)) {
    return {
      unreadMessages: defaultUnreadMessagesFrom(subscription),
    };
  }

  const lastSeenAt = readCheckpointFrom(subscription);
  if (!lastSeenAt) {
    return {
      unreadMessages: defaultUnreadMessagesFrom(subscription),
    };
  }

  const updatedMessages = await client.listUpdatedMessagesSince(session, subscription.rid, lastSeenAt);
  const unreadMessages = visibleUnreadMainTimelineMessages(updatedMessages, session, lastSeenAt);

  return {
    visibleUnreadMainTimelineMessages: unreadMessages,
    unreadMessages: unreadMessages.length,
    ...(unreadMessages[0]?._id ? { firstUnreadMessageId: unreadMessages[0]._id } : {}),
  };
};

const replyCountFromVisibleUnreadMessages = async (
  client: RocketChatClient,
  session: UpstreamSession,
  messages: UpstreamMessage[] | undefined,
): Promise<number> => {
  if (!messages || messages.length === 0) {
    return 0;
  }

  const replyParentIds = [...new Set(
    messages
      .map((message) => replyParentMessageIdFrom(message))
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )];

  if (replyParentIds.length === 0) {
    return 0;
  }

  const parentAuthorIdByMessageId = new Map<string, string>();

  await Promise.all(
    replyParentIds.map(async (messageId) => {
      const parentMessage = await client.findMessage(session, messageId);
      if (parentMessage?.u._id) {
        parentAuthorIdByMessageId.set(messageId, parentMessage.u._id);
      }
    }),
  );

  return messages.reduce((count, message) => {
    const replyParentId = replyParentMessageIdFrom(message);
    return replyParentId && parentAuthorIdByMessageId.get(replyParentId) === session.userId ? count + 1 : count;
  }, 0);
};

export const projectMembershipInboxProjection = async (
  client: RocketChatClient,
  session: UpstreamSession,
  subscription: UpstreamSubscription,
  options: MembershipInboxProjectionOptions = {},
): Promise<MembershipInboxProjection> => {
  const unreadProjection = await unreadProjectionFrom(client, session, subscription, options.mode ?? 'exact');
  const mentionCount = mentionCountFrom(subscription);
  const replyCount = await replyCountFromVisibleUnreadMessages(client, session, unreadProjection.visibleUnreadMainTimelineMessages);
  const hasThreadActivity = nonEmptyStringCount(subscription.tunread) > 0
    || nonEmptyStringCount(subscription.tunreadUser) > 0
    || nonEmptyStringCount(subscription.tunreadGroup) > 0;

  return {
    inbox: {
      unreadMessages: unreadProjection.unreadMessages,
      mentionCount,
      replyCount,
      hasThreadActivity,
      hasUncountedActivity:
        Boolean(subscription.alert)
        && unreadProjection.unreadMessages === 0
        && mentionCount === 0
        && !hasThreadActivity,
    },
    ...(unreadProjection.firstUnreadMessageId ? { firstUnreadMessageId: unreadProjection.firstUnreadMessageId } : {}),
  };
};

export const projectMembershipInbox = async (
  client: RocketChatClient,
  session: UpstreamSession,
  subscription: UpstreamSubscription,
  options: MembershipInboxProjectionOptions = {},
): Promise<MembershipInbox> => (await projectMembershipInboxProjection(client, session, subscription, options)).inbox;
