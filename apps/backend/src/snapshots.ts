import type { BetterChatConfig } from './config';
import { AppError } from './errors';
import { encodePaginationCursor, type PaginationRequest } from './pagination';
import type { UpstreamSession } from './session';
import type { SnapshotFactCache } from './snapshot-facts';
import { RocketChatClient, type UpstreamMessage, type UpstreamSubscription } from './upstream';

export const getRoomSubscription = async (
  client: RocketChatClient,
  session: UpstreamSession,
  roomId: string,
  facts?: SnapshotFactCache,
): Promise<UpstreamSubscription> => {
  const subscriptionResponse = facts
    ? await facts.getRoomSubscription(client, session, roomId)
    : await client.getSubscription(session, roomId);
  if (!subscriptionResponse.subscription) {
    throw new AppError('NOT_FOUND', 'Conversation subscription not found', 404, { conversationId: roomId });
  }

  return subscriptionResponse.subscription;
};

export const ensureOpenSubscription = async (
  client: RocketChatClient,
  session: UpstreamSession,
  roomId: string,
  facts?: SnapshotFactCache,
): Promise<UpstreamSubscription> => {
  const initialSubscription = await getRoomSubscription(client, session, roomId, facts);

  if (initialSubscription.open) {
    return initialSubscription;
  }

  await client.openRoom(session, roomId);
  return getRoomSubscription(client, session, roomId, facts);
};

export const isVisibleInConversationTimeline = (message: UpstreamMessage): boolean =>
  message._hidden !== true && (message.tmid === undefined || message.tshow === true);

const findNextVisibleMessageOffset = async (
  client: RocketChatClient,
  session: UpstreamSession,
  roomType: string,
  roomId: string,
  batchSize: number,
  initialOffset: number,
  initialTotal: number,
): Promise<number | undefined> => {
  let lookaheadOffset = initialOffset;
  let total = initialTotal;

  while (lookaheadOffset < total) {
    const response = await client.getRoomMessages(session, roomType, roomId, batchSize, lookaheadOffset);
    total = response.total;

    if (response.messages.length === 0) {
      return undefined;
    }

    const nextVisibleIndex = response.messages.findIndex((message) => isVisibleInConversationTimeline(message));
    if (nextVisibleIndex >= 0) {
      return lookaheadOffset + nextVisibleIndex;
    }

    lookaheadOffset += response.messages.length;
    if (lookaheadOffset >= total || response.messages.length < batchSize) {
      return undefined;
    }
  }

  return undefined;
};

const collectVisibleRoomTimelineMessagesPage = async (
  config: BetterChatConfig,
  client: RocketChatClient,
  session: UpstreamSession,
  roomType: string,
  roomId: string,
  page: PaginationRequest,
  requiredVisibleMessage?: {
    id: string;
    searchVisibleLimit: number;
  },
): Promise<{
  messages: UpstreamMessage[];
  nextCursor?: string;
}> => {
  const batchSize = Math.max(config.defaultMessagePageSize, page.limit);
  const normalPageMessages: UpstreamMessage[] = [];
  const expandedMessages: UpstreamMessage[] = [];
  let scanOffset = page.offset;
  let total = 0;
  let normalPageResumeOffset = page.offset;
  let expandedResumeOffset = page.offset;
  let normalPageFilled = false;
  let requiredVisibleMessageSatisfied = requiredVisibleMessage === undefined;

  while (true) {
    const response = await client.getRoomMessages(session, roomType, roomId, batchSize, scanOffset);
    total = response.total;

    if (response.messages.length === 0) {
      if (!normalPageFilled) {
        normalPageResumeOffset = scanOffset;
      }
      expandedResumeOffset = scanOffset;
      break;
    }

    let pageFilled = false;
    for (const [index, message] of response.messages.entries()) {
      const nextRawOffset = scanOffset + index + 1;

      if (!isVisibleInConversationTimeline(message)) {
        continue;
      }

      expandedMessages.push(message);

      if (!normalPageFilled) {
        normalPageMessages.push(message);
        if (normalPageMessages.length >= page.limit) {
          normalPageFilled = true;
          normalPageResumeOffset = nextRawOffset;
          if (requiredVisibleMessageSatisfied) {
            expandedResumeOffset = nextRawOffset;
            pageFilled = true;
            break;
          }
        }
      }

      if (requiredVisibleMessage && message._id === requiredVisibleMessage.id) {
        requiredVisibleMessageSatisfied = true;
        expandedResumeOffset = nextRawOffset;
        if (normalPageFilled) {
          pageFilled = true;
          break;
        }
      }

      if (
        requiredVisibleMessage
        && !requiredVisibleMessageSatisfied
        && expandedMessages.length >= requiredVisibleMessage.searchVisibleLimit
      ) {
        pageFilled = true;
        break;
      }
    }

    if (pageFilled) {
      break;
    }

    scanOffset += response.messages.length;
    expandedResumeOffset = scanOffset;
    if (!normalPageFilled) {
      normalPageResumeOffset = scanOffset;
    }

    if (scanOffset >= total || response.messages.length < batchSize) {
      break;
    }
  }

  const resultMessages = requiredVisibleMessageSatisfied ? expandedMessages : normalPageMessages;
  const resultResumeOffset = requiredVisibleMessageSatisfied ? expandedResumeOffset : normalPageResumeOffset;
  const nextVisibleOffset = resultMessages.length >= page.limit && resultResumeOffset < total
    ? await findNextVisibleMessageOffset(client, session, roomType, roomId, batchSize, resultResumeOffset, total)
    : undefined;
  const nextCursor = nextVisibleOffset === undefined ? undefined : encodePaginationCursor(nextVisibleOffset);

  return {
    messages: resultMessages,
    ...(nextCursor ? { nextCursor } : {}),
  };
};

export const collectRoomTimelineMessagesPage = async (
  config: BetterChatConfig,
  client: RocketChatClient,
  session: UpstreamSession,
  roomType: string,
  roomId: string,
  page: PaginationRequest,
): Promise<{
  messages: UpstreamMessage[];
  nextCursor?: string;
}> => collectVisibleRoomTimelineMessagesPage(config, client, session, roomType, roomId, page);

export const collectInitialRoomTimelineMessagesPage = async (
  config: BetterChatConfig,
  client: RocketChatClient,
  session: UpstreamSession,
  roomType: string,
  roomId: string,
  page: PaginationRequest,
  firstUnreadMessageId: string | undefined,
  unreadMessages: number | undefined,
): Promise<{
  messages: UpstreamMessage[];
  nextCursor?: string;
}> => {
  const baseVisibleLimit = Math.max(config.defaultMessagePageSize, page.limit);
  const hardVisibleSearchCap = baseVisibleLimit * 5;
  const requiredVisibleMessage =
    page.offset === 0 && firstUnreadMessageId
      ? {
          id: firstUnreadMessageId,
          searchVisibleLimit: Math.max(page.limit, Math.min(Math.max(0, unreadMessages ?? 0), hardVisibleSearchCap)),
        }
      : undefined;

  return collectVisibleRoomTimelineMessagesPage(
    config,
    client,
    session,
    roomType,
    roomId,
    page,
    requiredVisibleMessage,
  );
};

export const collectRoomTimelineContextPage = async (
  config: BetterChatConfig,
  client: RocketChatClient,
  session: UpstreamSession,
  roomType: string,
  roomId: string,
  anchorMessageId: string,
  contextWindow: {
    before: number;
    after: number;
  },
): Promise<{
  anchorIndex: number;
  hasAfter: boolean;
  hasBefore: boolean;
  messages: UpstreamMessage[];
}> => {
  const batchSize = Math.max(config.defaultMessagePageSize, contextWindow.before + contextWindow.after + 1);
  const visibleMessagesDescending: UpstreamMessage[] = [];
  let scanOffset = 0;
  let total = 0;
  let lookaheadOffset: number | undefined;

  while (true) {
    const response = await client.getRoomMessages(session, roomType, roomId, batchSize, scanOffset);
    total = response.total;

    if (response.messages.length === 0) {
      break;
    }

    for (const message of response.messages) {
      if (isVisibleInConversationTimeline(message)) {
        visibleMessagesDescending.push(message);
      }
    }

    const anchorDescendingIndex = visibleMessagesDescending.findIndex((message) => message._id === anchorMessageId);
    const hasMoreRawPages = scanOffset + response.messages.length < total && response.messages.length >= batchSize;

    if (anchorDescendingIndex >= 0) {
      const olderVisibleCount = visibleMessagesDescending.length - anchorDescendingIndex - 1;
      if (olderVisibleCount >= contextWindow.before || !hasMoreRawPages) {
        lookaheadOffset = hasMoreRawPages ? scanOffset + response.messages.length : undefined;
        break;
      }
    }

    if (!hasMoreRawPages) {
      break;
    }

    scanOffset += response.messages.length;
  }

  const visibleMessages = [...visibleMessagesDescending].reverse();
  const anchorIndex = visibleMessages.findIndex((message) => message._id === anchorMessageId);
  if (anchorIndex < 0) {
    throw new AppError('NOT_FOUND', 'Anchor message was not found in the visible conversation timeline', 404, {
      anchorMessageId,
      conversationId: roomId,
    });
  }

  const startIndex = Math.max(0, anchorIndex - contextWindow.before);
  const endIndex = Math.min(visibleMessages.length, anchorIndex + contextWindow.after + 1);
  const olderVisibleCount = anchorIndex;
  const newerVisibleCount = visibleMessages.length - anchorIndex - 1;
  const hasAdditionalOlderVisibleMessage = olderVisibleCount > contextWindow.before
    || (
      olderVisibleCount === contextWindow.before
      && lookaheadOffset !== undefined
      && (await findNextVisibleMessageOffset(client, session, roomType, roomId, batchSize, lookaheadOffset, total)) !== undefined
    );

  return {
    anchorIndex: anchorIndex - startIndex,
    hasBefore: hasAdditionalOlderVisibleMessage,
    hasAfter: newerVisibleCount > contextWindow.after,
    messages: visibleMessages.slice(startIndex, endIndex),
  };
};
