import type { ConversationMessageLedger, ConversationMessageLedgerEnvelope } from './conversation-message-ledger';
import { isVisibleInConversationTimeline } from './snapshots';
import type { UpstreamSession } from './session';
import type { RocketChatClient, UpstreamMessage } from './upstream';

const messageTimestampMs = (message: Pick<UpstreamMessage, 'ts'>): number => {
  const timestampMs = Date.parse(message.ts);
  return Number.isFinite(timestampMs) ? timestampMs : Number.NEGATIVE_INFINITY;
};

const compareMessagesByAuthoredAtDescending = (left: UpstreamMessage, right: UpstreamMessage): number => {
  const timestampDelta = messageTimestampMs(right) - messageTimestampMs(left);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return left._id.localeCompare(right._id);
};

export const toDeletedTombstoneMessageFromEnvelope = (
  envelope: ConversationMessageLedgerEnvelope,
  deletedAt = envelope.deletedAt ?? new Date().toISOString(),
): UpstreamMessage => ({
  _id: envelope.messageId,
  rid: envelope.conversationId,
  msg: '',
  ts: envelope.authoredAt,
  _updatedAt: deletedAt,
  _deletedAt: deletedAt,
  editedAt: deletedAt,
  t: 'rm',
  ...(envelope.threadParentId ? { tmid: envelope.threadParentId } : {}),
  ...(envelope.threadShowInConversation !== undefined ? { tshow: envelope.threadShowInConversation } : {}),
  ...(envelope.threadReplyCount !== undefined ? { tcount: envelope.threadReplyCount } : {}),
  ...(envelope.threadLastReplyAt ? { tlm: envelope.threadLastReplyAt } : {}),
  u: {
    _id: envelope.authorId,
    username: envelope.authorUsername,
    name: envelope.authorName,
  },
});

export const toDeletedTombstoneMessage = (
  message: UpstreamMessage,
  deletedAt = new Date().toISOString(),
): UpstreamMessage => ({
  ...message,
  msg: '',
  _deletedAt: deletedAt,
  _updatedAt: deletedAt,
  editedAt: deletedAt,
  t: 'rm',
  attachments: undefined,
  file: undefined,
  files: undefined,
  reactions: undefined,
});

export const findCanonicalConversationMessage = async (
  client: RocketChatClient,
  session: UpstreamSession,
  conversationId: string,
  messageId: string,
  ledger?: ConversationMessageLedger,
): Promise<UpstreamMessage | undefined> => {
  const message = await client.findMessage(session, messageId);
  if (message) {
    ledger?.observe(message);
    return message.rid === conversationId ? message : undefined;
  }

  const deletedEnvelope = ledger?.getDeletedEnvelope(conversationId, messageId);
  return deletedEnvelope ? toDeletedTombstoneMessageFromEnvelope(deletedEnvelope) : undefined;
};

export const findCanonicalConversationMessages = async (
  client: RocketChatClient,
  session: UpstreamSession,
  conversationId: string,
  messageIds: string[],
  ledger?: ConversationMessageLedger,
): Promise<Map<string, UpstreamMessage>> => {
  const parentMessages = new Map<string, UpstreamMessage>();

  await Promise.all(
    messageIds.map(async (messageId) => {
      const message = await findCanonicalConversationMessage(client, session, conversationId, messageId, ledger);
      if (message) {
        parentMessages.set(messageId, message);
      }
    }),
  );

  return parentMessages;
};

export const mergeInitialConversationTimelineTombstones = ({
  conversationId,
  hasMoreUpstream,
  ledger,
  messages,
  pageOffset,
}: {
  conversationId: string;
  hasMoreUpstream: boolean;
  ledger?: ConversationMessageLedger;
  messages: UpstreamMessage[];
  pageOffset: number;
}): UpstreamMessage[] => {
  if (!ledger || pageOffset !== 0) {
    return messages;
  }

  const existingMessageIds = new Set(messages.map((message) => message._id));
  const oldestVisibleMessageTimestamp = hasMoreUpstream && messages.length > 0
    ? new Date(Math.min(...messages.map(messageTimestampMs))).toISOString()
    : undefined;
  const missingConversationTombstones = ledger
    .listDeletedEnvelopesByConversation(conversationId, {
      authoredAtOnOrAfter: oldestVisibleMessageTimestamp,
    })
    .map((envelope) => toDeletedTombstoneMessageFromEnvelope(envelope))
    .filter((message) => isVisibleInConversationTimeline(message))
    .filter((message) => !existingMessageIds.has(message._id));

  if (missingConversationTombstones.length === 0) {
    return messages;
  }

  if (messages.length === 0 || !hasMoreUpstream) {
    return [...messages, ...missingConversationTombstones].sort(compareMessagesByAuthoredAtDescending);
  }

  const oldestVisibleMessageTimestampMs = Math.min(...messages.map(messageTimestampMs));
  const tombstonesWithinInitialPage = missingConversationTombstones.filter(
    (message) => messageTimestampMs(message) >= oldestVisibleMessageTimestampMs,
  );

  if (tombstonesWithinInitialPage.length === 0) {
    return messages;
  }

  return [...messages, ...tombstonesWithinInitialPage].sort(compareMessagesByAuthoredAtDescending);
};
