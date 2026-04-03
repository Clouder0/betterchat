import type {
  ConversationAttachment,
  ConversationCapabilities,
  ConversationKind,
  ConversationMessage,
  ConversationMessageContextSnapshot,
  ConversationReaction,
  ConversationSnapshot,
  ConversationTimelineSnapshot,
  DirectoryEntry,
  DirectorySnapshot,
  MembershipInbox,
  MembershipSummary,
  PresenceState,
} from '@betterchat/contracts';

import { conversationMessageActionsFrom } from './capabilities';
import type { ConversationAuthorizationContext } from './conversation-authorization';
import {
  toMediaProxyUrl,
  toRoomAvatarProxyUrl,
  toUserAvatarProxyUrl,
} from './normalize';
import { AppError } from './errors';
import { quoteMessageIdFromLink, replyParentMessageIdFrom } from './message-helpers';
import type { UpstreamMessage, UpstreamRoom, UpstreamSetting, UpstreamSubscription } from './upstream';

type DirectorySnapshotPayload = Omit<DirectorySnapshot, 'version'>;
type ConversationSnapshotPayload = Omit<ConversationSnapshot, 'version'>;
type ConversationTimelineSnapshotPayload = Omit<ConversationTimelineSnapshot, 'version'>;
type ConversationMessageContextSnapshotPayload = Omit<ConversationMessageContextSnapshot, 'version'>;

type MessageViewerContext =
  | string
  | Pick<
      ConversationAuthorizationContext,
      'authorization' | 'currentUserId' | 'currentUsername' | 'room' | 'settings' | 'subscription'
    >;

const SUPPORTED_ROOM_TYPES = { c: true, d: true, p: true } as const;

const ROOM_KIND_MAP: Record<string, ConversationKind> = {
  c: { mode: 'group', privacy: 'public' },
  p: { mode: 'group', privacy: 'private' },
};

const iso = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  return new Date(value).toISOString();
};

const latestTimestampFrom = (...values: Array<string | undefined>): string | undefined => {
  let latestTimestampMs = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (!value) {
      continue;
    }

    const timestampMs = Date.parse(value);
    if (!Number.isFinite(timestampMs) || timestampMs <= latestTimestampMs) {
      continue;
    }

    latestTimestampMs = timestampMs;
  }

  return Number.isFinite(latestTimestampMs) ? new Date(latestTimestampMs).toISOString() : undefined;
};

const participantCountFrom = (room: Pick<UpstreamRoom, 'uids' | 'usernames'> | undefined): number | undefined => {
  if (Array.isArray(room?.uids) && room.uids.length > 0) {
    return room.uids.length;
  }

  if (Array.isArray(room?.usernames) && room.usernames.length > 0) {
    return room.usernames.length;
  }

  return undefined;
};

const roomTypeFrom = (
  room: Pick<UpstreamRoom, 't'> | undefined,
  subscription: Pick<UpstreamSubscription, 't'> | undefined,
): string => subscription?.t || room?.t || 'c';

export const conversationKindFromRoom = (
  room: Pick<UpstreamRoom, 't' | 'uids' | 'usernames'> | undefined,
  subscription: Pick<UpstreamSubscription, 't'> | undefined,
): ConversationKind => {
  const roomType = roomTypeFrom(room, subscription);

  if (roomType === 'd') {
    return (participantCountFrom(room) ?? 0) > 2
      ? { mode: 'group', privacy: 'private' }
      : { mode: 'direct' };
  }

  const kind = ROOM_KIND_MAP[roomType];

  if (!kind) {
    throw new AppError('UNSUPPORTED_UPSTREAM_BEHAVIOR', `Unsupported room type: ${roomType}`, 502, {
      roomType,
    });
  }

  return kind;
};

const presenceFrom = (status: string | undefined): PresenceState => {
  switch (status) {
    case 'online':
    case 'away':
    case 'busy':
      return status;
    default:
      return 'offline';
  }
};

export const isOneToOneDirectConversation = (
  room: Pick<UpstreamRoom, 't' | 'uids' | 'usernames'> | undefined,
  subscription: Pick<UpstreamSubscription, 't'> | undefined,
): boolean => conversationKindFromRoom(room, subscription).mode === 'direct';

const titleFrom = (room: UpstreamRoom | undefined, subscription: UpstreamSubscription | undefined, currentUsername?: string): string => {
  const kind = conversationKindFromRoom(room, subscription);

  if (kind.mode === 'direct') {
    const dmTitle = subscription?.fname || room?.fname || subscription?.name;
    if (dmTitle) {
      return dmTitle;
    }

    const candidate = room?.usernames?.find((username) => username !== currentUsername);
    if (candidate) {
      return candidate;
    }
  }

  return room?.fname || subscription?.fname || room?.name || subscription?.name || room?._id || subscription?.rid || 'Unknown conversation';
};

const handleFrom = (
  room: UpstreamRoom | undefined,
  subscription: UpstreamSubscription | undefined,
  currentUsername?: string,
): string | undefined => {
  const kind = conversationKindFromRoom(room, subscription);

  if (kind.mode === 'direct') {
    return subscription?.name || room?.usernames?.find((username) => username !== currentUsername);
  }

  return room?.name || subscription?.name;
};

const membershipFrom = (subscription: UpstreamSubscription, inbox: MembershipInbox): MembershipSummary => ({
  listing: subscription.open ? 'listed' : 'hidden',
  starred: Boolean(subscription.f),
  inbox,
});

const previewFrom = (
  room: UpstreamRoom | undefined,
  subscription: UpstreamSubscription,
  currentUsername: string,
): DirectoryEntry['conversation'] => {
  const kind = conversationKindFromRoom(room, subscription);
  const conversationId = room?._id || subscription.rid;
  const handle = handleFrom(room, subscription, currentUsername);

  return {
    id: conversationId,
    kind,
    title: titleFrom(room, subscription, currentUsername),
    handle,
    avatarUrl: kind.mode === 'direct' ? toUserAvatarProxyUrl(handle) : toRoomAvatarProxyUrl(conversationId),
    lastActivityAt: latestTimestampFrom(room?.lm, subscription.lr, subscription.ts),
  };
};

export const normalizeDirectoryEntry = (
  room: UpstreamRoom | undefined,
  subscription: UpstreamSubscription,
  currentUsername: string,
  inbox: MembershipInbox,
  presence?: string,
): DirectoryEntry => ({
  conversation: previewFrom(room, subscription, currentUsername),
  membership: membershipFrom(subscription, inbox),
  live:
    isOneToOneDirectConversation(room, subscription)
      ? {
          counterpartPresence: presenceFrom(presence),
        }
      : undefined,
});

export const compareDirectoryEntries = (left: DirectoryEntry, right: DirectoryEntry): number => {
  const leftTime = left.conversation.lastActivityAt ? Date.parse(left.conversation.lastActivityAt) : 0;
  const rightTime = right.conversation.lastActivityAt ? Date.parse(right.conversation.lastActivityAt) : 0;
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return left.conversation.id.localeCompare(right.conversation.id);
};

export const sortDirectoryEntries = (entries: Iterable<DirectoryEntry>): DirectoryEntry[] =>
  [...entries].sort(compareDirectoryEntries);

export const normalizeDirectorySnapshot = (
  rooms: UpstreamRoom[],
  subscriptions: UpstreamSubscription[],
  currentUsername: string,
  inboxByConversationId: ReadonlyMap<string, MembershipInbox>,
  presenceByConversationId: ReadonlyMap<string, string | undefined> = new Map(),
): DirectorySnapshotPayload => {
  const roomMap = new Map(rooms.map((room) => [room._id, room]));

  const entries = sortDirectoryEntries(
    subscriptions
      .filter((subscription) => subscription.t in SUPPORTED_ROOM_TYPES)
      .map((subscription) =>
        normalizeDirectoryEntry(
          roomMap.get(subscription.rid),
          subscription,
          currentUsername,
          inboxByConversationId.get(subscription.rid) || {
            unreadMessages: 0,
            mentionCount: 0,
            replyCount: 0,
            hasThreadActivity: false,
            hasUncountedActivity: false,
          },
          presenceByConversationId.get(subscription.rid),
        )),
  );

  return { entries };
};

export const normalizeConversationSnapshot = (
  room: UpstreamRoom,
  subscription: UpstreamSubscription,
  currentUsername: string,
  inbox: MembershipInbox,
  capabilities: ConversationCapabilities,
  presence?: string,
): ConversationSnapshotPayload => ({
  conversation: {
    ...previewFrom(room, subscription, currentUsername),
    topic: room.topic,
    description: room.description,
    announcement: room.announcement,
    memberCount: room.usersCount || room.uids?.length,
  },
  membership: membershipFrom(subscription, inbox),
  live:
    isOneToOneDirectConversation(room, subscription)
      ? {
          counterpartPresence: presenceFrom(presence),
        }
      : undefined,
  capabilities,
});

const imageAttachmentIdFrom = (
  message: UpstreamMessage,
  attachmentIndex: number,
  attachmentCount: number,
): string => {
  const indexedFileId = message.files?.[attachmentIndex]?._id;
  if (indexedFileId) {
    return indexedFileId;
  }

  if (message.file?._id && (attachmentCount === 1 || attachmentIndex === 0)) {
    return message.file._id;
  }

  return `${message._id}-image-${attachmentIndex}`;
};

const imageAssetFrom = (
  upstreamUrl: string,
  rawUrl: string | undefined,
  dimensions?: {
    width?: number;
    height?: number;
  },
): ConversationAttachment['preview'] | undefined => {
  const url = toMediaProxyUrl(upstreamUrl, rawUrl);
  if (!url) {
    return undefined;
  }

  return {
    url,
    width: dimensions?.width,
    height: dimensions?.height,
  };
};

const normalizeAttachments = (upstreamUrl: string, message: UpstreamMessage): ConversationAttachment[] | undefined => {
  const imageSourceAttachments = (message.attachments || [])
    .filter((attachment) => attachment.message_link === undefined)
    .filter((attachment) => attachment.image_url || attachment.image_type?.startsWith('image/'));
  const imageAttachments = imageSourceAttachments
    .map<ConversationAttachment | undefined>((attachment, index) => {
      const preview = imageAssetFrom(upstreamUrl, attachment.image_url || attachment.title_link, attachment.image_dimensions);
      if (!preview) {
        return undefined;
      }

      const sourceCandidate = imageAssetFrom(upstreamUrl, attachment.title_link || attachment.image_url);
      const source =
        sourceCandidate && sourceCandidate.url === preview.url
          ? {
              ...sourceCandidate,
              width: sourceCandidate.width ?? preview.width,
              height: sourceCandidate.height ?? preview.height,
            }
          : sourceCandidate || preview;

      return {
        kind: 'image',
        id: imageAttachmentIdFrom(message, index, imageSourceAttachments.length),
        title: attachment.title,
        preview,
        source,
      };
    })
    .filter((attachment): attachment is ConversationAttachment => attachment !== undefined);

  return imageAttachments.length > 0 ? imageAttachments : undefined;
};

const excerptFromText = (raw: string): { excerpt: string; long: boolean } => {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  const maxLength = 140;

  if (normalized.length <= maxLength) {
    return { excerpt: normalized, long: false };
  }

  return {
    excerpt: `${normalized.slice(0, maxLength - 1)}…`,
    long: true,
  };
};

const excerptFrom = (message: UpstreamMessage): { excerpt: string; long: boolean } =>
  excerptFromText(message.msg?.trim() || message.attachments?.[0]?.title || 'Original message');

const quoteAttachmentFrom = (message: UpstreamMessage): NonNullable<UpstreamMessage['attachments']>[number] | undefined =>
  message.attachments?.find(
    (attachment): attachment is NonNullable<UpstreamMessage['attachments']>[number] =>
      typeof attachment.message_link === 'string' && attachment.message_link.length > 0,
  );

const stripLeadingQuotePlaceholders = (message: UpstreamMessage): string => {
  const raw = message.msg || '';
  const quoteAttachments = message.attachments?.filter((attachment) => typeof attachment.message_link === 'string') || [];
  if (quoteAttachments.length === 0) {
    return raw;
  }

  const lines = raw.split('\n');
  let index = 0;

  while (index < lines.length && index < quoteAttachments.length && /^\[ \]\([^)]+\)$/.test(lines[index]?.trim() || '')) {
    index += 1;
  }

  return lines.slice(index).join('\n').replace(/^\n+/, '');
};

const threadReplyCountFrom = (message: UpstreamMessage): number | undefined => {
  if (typeof message.tcount === 'number' && message.tcount > 0) {
    return message.tcount;
  }

  if (typeof message.replies === 'number' && message.replies > 0) {
    return message.replies;
  }

  if (Array.isArray(message.replies) && message.replies.length > 0) {
    return message.replies.length;
  }

  return undefined;
};

const normalizeReactions = (message: UpstreamMessage, currentUsername: string): ConversationReaction[] | undefined => {
  if (!message.reactions) {
    return undefined;
  }

  const reactions = Object.entries(message.reactions)
    .map<ConversationReaction>(([emoji, reaction]) => ({
      emoji,
      count: reaction.usernames.length,
      reacted: reaction.usernames.includes(currentUsername),
    }))
    .filter((reaction) => reaction.count > 0)
    .sort((left, right) => left.emoji.localeCompare(right.emoji));

  return reactions.length > 0 ? reactions : undefined;
};

const currentUsernameFromViewerContext = (viewerContext: MessageViewerContext): string =>
  typeof viewerContext === 'string' ? viewerContext : viewerContext.currentUsername;

const messageActionsFromViewerContext = (
  message: UpstreamMessage,
  viewerContext: MessageViewerContext,
): ConversationMessage['actions'] => {
  if (typeof viewerContext === 'string') {
    return undefined;
  }

  return conversationMessageActionsFrom(message, viewerContext.room, viewerContext.settings, {
    authorization: viewerContext.authorization,
    currentUserId: viewerContext.currentUserId,
    currentUsername: viewerContext.currentUsername,
    subscription: viewerContext.subscription,
  });
};

export const normalizeConversationMessage = (
  upstreamUrl: string,
  message: UpstreamMessage,
  parentMessages: Map<string, UpstreamMessage>,
  viewerContext: MessageViewerContext,
): ConversationMessage => {
  const currentUsername = currentUsernameFromViewerContext(viewerContext);
  const replyParentMessageId = replyParentMessageIdFrom(message, upstreamUrl);
  const replyParent = replyParentMessageId ? parentMessages.get(replyParentMessageId) : undefined;
  const isReplyParentDeleted = replyParent && (replyParent.t === 'rm' || Boolean(replyParent._deletedAt));
  const replyExcerpt = replyParent
    ? isReplyParentDeleted
      ? { excerpt: '该消息已删除。', long: false }
      : excerptFrom(replyParent)
    : undefined;
  const quoteAttachment = quoteAttachmentFrom(message);
  const quotePreview =
    !replyParent && quoteAttachment && quoteAttachment.message_link
      ? (() => {
          const messageId = quoteMessageIdFromLink(quoteAttachment.message_link, upstreamUrl);
          if (!messageId) {
            return undefined;
          }

          const { excerpt, long } = excerptFromText(quoteAttachment.text?.trim() || 'Original message');
          return {
            messageId,
            authorName: quoteAttachment.author_name || 'Unknown author',
            excerpt,
            long,
          };
        })()
      : undefined;
  const threadReplyCount = threadReplyCountFrom(message);

  return {
    id: message._id,
    conversationId: message.rid,
    authoredAt: new Date(message.ts).toISOString(),
    updatedAt: iso(message._updatedAt),
    author: {
      id: message.u._id,
      displayName: message.u.name || message.u.username || message.u._id,
      username: message.u.username,
      avatarUrl: toUserAvatarProxyUrl(message.u.username),
    },
    content: {
      format: 'markdown',
      text: stripLeadingQuotePlaceholders(message),
    },
    state: {
      edited: Boolean(message.editedAt) && message.t !== 'rm' && !message._deletedAt,
      deleted: Boolean(message._deletedAt) || message.t === 'rm',
    },
    replyTo:
      replyParent && replyExcerpt
        ? {
            messageId: replyParent._id,
            authorName: replyParent.u.name || replyParent.u.username || replyParent.u._id,
            excerpt: replyExcerpt.excerpt,
            long: replyExcerpt.long,
          }
        : quotePreview,
    thread:
      threadReplyCount !== undefined
        ? {
            rootMessageId: message._id,
            replyCount: threadReplyCount,
            lastReplyAt: iso(message.tlm),
          }
        : undefined,
    attachments: normalizeAttachments(upstreamUrl, message),
    reactions: normalizeReactions(message, currentUsername),
    actions: messageActionsFromViewerContext(message, viewerContext),
  };
};

export const normalizeConversationTimeline = (
  upstreamUrl: string,
  conversationId: string,
  messages: UpstreamMessage[],
  parentMessages: Map<string, UpstreamMessage>,
  viewerContext: MessageViewerContext,
  unreadAnchorMessageId?: string,
): ConversationTimelineSnapshotPayload => {
  const orderedMessages = [...messages].sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts));
  const normalizedMessages = orderedMessages.map((message) =>
    normalizeConversationMessage(upstreamUrl, message, parentMessages, viewerContext)
  );

  return {
    scope: {
      kind: 'conversation',
      conversationId,
    },
    messages: normalizedMessages,
    unreadAnchorMessageId:
      unreadAnchorMessageId && normalizedMessages.some((message) => message.id === unreadAnchorMessageId)
        ? unreadAnchorMessageId
        : undefined,
  };
};

export const normalizeThreadTimeline = (
  upstreamUrl: string,
  conversationId: string,
  parentMessage: UpstreamMessage,
  messages: UpstreamMessage[],
  viewerContext: MessageViewerContext,
): ConversationTimelineSnapshotPayload => {
  const parentMessages = new Map([[parentMessage._id, parentMessage]]);
  const orderedMessages = [...messages].sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts));

  return {
    scope: {
      kind: 'thread',
      conversationId,
      threadId: parentMessage._id,
    },
    threadRoot: normalizeConversationMessage(upstreamUrl, parentMessage, new Map(), viewerContext),
    messages: orderedMessages.map((message) => normalizeConversationMessage(upstreamUrl, message, parentMessages, viewerContext)),
  };
};

export const normalizeConversationMessageContext = (
  conversationId: string,
  anchorMessageId: string,
  anchorIndex: number,
  messages: ConversationMessage[],
  hasBefore: boolean,
  hasAfter: boolean,
): ConversationMessageContextSnapshotPayload => ({
  conversationId,
  anchorMessageId,
  anchorIndex,
  messages,
  hasBefore,
  hasAfter,
});
