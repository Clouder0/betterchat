import type { UpstreamSession } from './session';
import { AppError } from './errors';
import { isVisibleInConversationTimeline } from './snapshots';
import { type RocketChatClient, type UpstreamMessage, type UpstreamRoom } from './upstream';

export const replyPreviewParentMessages = async (
  client: RocketChatClient,
  session: UpstreamSession,
  replyParentId: string | undefined,
): Promise<Map<string, UpstreamMessage>> => {
  const parentMessages = new Map<string, UpstreamMessage>();

  if (!replyParentId) {
    return parentMessages;
  }

  const parentMessage = await client.findMessage(session, replyParentId);
  if (parentMessage) {
    parentMessages.set(replyParentId, parentMessage);
  }

  return parentMessages;
};

export const getRoomMessage = async (
  client: RocketChatClient,
  session: UpstreamSession,
  roomId: string,
  messageId: string,
  notFoundMessage = 'Message not found',
): Promise<UpstreamMessage> => {
  const message = await client.findMessage(session, messageId);
  if (!message || message.rid !== roomId) {
    throw new AppError('NOT_FOUND', notFoundMessage, 404, { roomId, messageId });
  }

  return message;
};

const conversationTimelineFailureReasonFrom = (
  message: UpstreamMessage,
  roomId: string,
  options: {
    requireOtherAuthorId?: string;
  } = {},
): string | undefined => {
  if (message.rid !== roomId) {
    return 'wrong-room';
  }

  if (!isVisibleInConversationTimeline(message)) {
    return 'not-visible-in-main-timeline';
  }

  if (message._deletedAt || message.t === 'rm') {
    return 'deleted-or-removed';
  }

  if (options.requireOtherAuthorId && message.u._id === options.requireOtherAuthorId) {
    return 'self-authored';
  }

  return undefined;
};

export const assertValidConversationReplyTargetMessage = (
  message: UpstreamMessage,
  roomId: string,
): void => {
  const failureReason = conversationTimelineFailureReasonFrom(message, roomId);
  if (!failureReason) {
    return;
  }

  throw new AppError(
    failureReason === 'wrong-room' ? 'NOT_FOUND' : 'VALIDATION_ERROR',
    failureReason === 'wrong-room'
      ? 'Reply target not found'
      : 'Reply target must reference a visible main-timeline message',
    failureReason === 'wrong-room' ? 404 : 400,
    {
      roomId,
      messageId: message._id,
      failureReason,
    },
  );
};

export const assertValidUnreadAnchorMessage = (
  message: UpstreamMessage,
  session: UpstreamSession,
  roomId: string,
): void => {
  const failureReason = conversationTimelineFailureReasonFrom(message, roomId, {
    requireOtherAuthorId: session.userId,
  });
  if (!failureReason) {
    return;
  }

  throw new AppError(
    'VALIDATION_ERROR',
    'Unread anchor must reference another participant visible in the main conversation timeline',
    400,
    {
      roomId,
      messageId: message._id,
      failureReason,
    },
  );
};

export const assertValidConversationContextAnchorMessage = (
  message: UpstreamMessage,
  roomId: string,
): void => {
  const failureReason = conversationTimelineFailureReasonFrom(message, roomId);
  if (!failureReason) {
    return;
  }

  throw new AppError('NOT_FOUND', 'Anchor message not found', 404, {
    roomId,
    messageId: message._id,
    failureReason,
  });
};

export const getThreadRootMessage = async (
  client: RocketChatClient,
  session: UpstreamSession,
  roomId: string,
  threadId: string,
): Promise<UpstreamMessage> => {
  const message = await getRoomMessage(client, session, roomId, threadId, 'Thread not found');
  if (message.tmid) {
    throw new AppError('NOT_FOUND', 'Thread not found', 404, {
      roomId,
      threadId,
      parentThreadId: message.tmid,
    });
  }

  return message;
};

export const threadIdFromMessage = (message: UpstreamMessage): string | undefined => {
  if (message.tmid) {
    return message.tmid;
  }

  if (typeof message.tcount === 'number' && message.tcount > 0) {
    return message._id;
  }

  if (typeof message.replies === 'number' && message.replies > 0) {
    return message._id;
  }

  if (Array.isArray(message.replies) && message.replies.length > 0) {
    return message._id;
  }

  return undefined;
};

export const quoteMessageLinkFromMessage = (message: UpstreamMessage): string | undefined =>
  message.attachments?.find((attachment) => typeof attachment.message_link === 'string' && attachment.message_link.length > 0)?.message_link;

export const quoteMessageIdFromLink = (
  messageLink: string,
  upstreamUrl = 'http://betterchat.invalid',
): string | undefined => {
  try {
    const url = new URL(messageLink, upstreamUrl);
    return url.searchParams.get('msg') || undefined;
  } catch {
    return undefined;
  }
};

export const replyParentMessageIdFrom = (message: UpstreamMessage, upstreamUrl?: string): string | undefined =>
  message.tmid || (() => {
    const quoteMessageLink = quoteMessageLinkFromMessage(message);
    return quoteMessageLink ? quoteMessageIdFromLink(quoteMessageLink, upstreamUrl) : undefined;
  })();

export const messagePermalinkFrom = (upstreamUrl: string, room: UpstreamRoom, messageId: string): string => {
  const path =
    room.t === 'c'
      ? room.name
        ? `/channel/${encodeURIComponent(room.name)}`
        : undefined
      : room.t === 'p'
        ? room.name
          ? `/group/${encodeURIComponent(room.name)}`
          : undefined
        : room.t === 'd'
          ? `/direct/${encodeURIComponent(room._id)}`
          : undefined;

  if (!path) {
    throw new AppError('UNSUPPORTED_UPSTREAM_BEHAVIOR', 'Rocket.Chat room permalink data is incomplete', 502, {
      roomId: room._id,
      roomType: room.t,
    });
  }

  const url = new URL(path, upstreamUrl);
  url.searchParams.set('msg', messageId);
  return url.toString();
};
