import { Database, type Statement } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { BetterChatConfig } from './config';
import type { UpstreamMessage } from './upstream';

export type ConversationMessageDeletedSource =
  | 'betterchat-delete'
  | 'upstream-native'
  | 'upstream-realtime';

export type ConversationMessageLedgerEnvelope = {
  authoredAt: string;
  authorId: string;
  authorName?: string;
  authorUsername?: string;
  conversationId: string;
  deletedAt?: string;
  deletedObservedAt?: string;
  deletedSource?: ConversationMessageDeletedSource;
  messageId: string;
  observedAt: string;
  threadLastReplyAt?: string;
  threadParentId?: string;
  threadReplyCount?: number;
  threadShowInConversation?: boolean;
};

export interface ConversationMessageLedger {
  close(): void;
  getDeletedEnvelope(conversationId: string, messageId: string): ConversationMessageLedgerEnvelope | undefined;
  listDeletedEnvelopesByConversation(
    conversationId: string,
    options?: {
      authoredAtOnOrAfter?: string;
    },
  ): ConversationMessageLedgerEnvelope[];
  markDeleted(message: UpstreamMessage, options?: {
    deletedAt?: string;
    source?: ConversationMessageDeletedSource;
  }): ConversationMessageLedgerEnvelope;
  markDeletedById(
    conversationId: string,
    messageId: string,
    options?: {
      deletedAt?: string;
      source?: ConversationMessageDeletedSource;
    },
  ): ConversationMessageLedgerEnvelope | undefined;
  observe(message: UpstreamMessage, observedAt?: string): ConversationMessageLedgerEnvelope;
  observeMany(messages: Iterable<UpstreamMessage>, observedAt?: string): void;
}

const schemaSql = `
  create table if not exists conversation_message_ledger (
    conversation_id text not null,
    message_id text not null,
    authored_at text not null,
    author_id text not null,
    author_username text,
    author_name text,
    thread_parent_id text,
    thread_show_in_conversation integer,
    thread_reply_count integer,
    thread_last_reply_at text,
    observed_at text not null,
    deleted_at text,
    deleted_source text,
    deleted_observed_at text,
    primary key (conversation_id, message_id)
  );

  create index if not exists conversation_message_ledger_deleted_conversation_authored_idx
    on conversation_message_ledger (conversation_id, deleted_at, authored_at desc, message_id asc);
`;

const iso = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : undefined;
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

const deletedMetadataFromMessage = (
  message: UpstreamMessage,
  observedAt: string,
): Pick<ConversationMessageLedgerEnvelope, 'deletedAt' | 'deletedObservedAt' | 'deletedSource'> => {
  if (message._deletedAt) {
    return {
      deletedAt: iso(message._deletedAt) ?? observedAt,
      deletedObservedAt: observedAt,
      deletedSource: 'upstream-native',
    };
  }

  if (message.t === 'rm') {
    return {
      deletedAt: observedAt,
      deletedObservedAt: observedAt,
      deletedSource: 'upstream-native',
    };
  }

  return {};
};

export const envelopeFromUpstreamMessage = (
  message: UpstreamMessage,
  observedAt = new Date().toISOString(),
): ConversationMessageLedgerEnvelope => ({
  authoredAt: iso(message.ts) ?? new Date(message.ts).toISOString(),
  authorId: message.u._id,
  authorName: message.u.name,
  authorUsername: message.u.username,
  conversationId: message.rid,
  messageId: message._id,
  observedAt,
  threadLastReplyAt: iso(message.tlm),
  threadParentId: message.tmid,
  ...(message.tshow !== undefined ? { threadShowInConversation: message.tshow } : {}),
  ...(threadReplyCountFrom(message) !== undefined ? { threadReplyCount: threadReplyCountFrom(message) } : {}),
  ...deletedMetadataFromMessage(message, observedAt),
});

const compareEnvelopesByAuthoredAtDescending = (
  left: ConversationMessageLedgerEnvelope,
  right: ConversationMessageLedgerEnvelope,
): number => {
  const timestampDelta = Date.parse(right.authoredAt) - Date.parse(left.authoredAt);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return left.messageId.localeCompare(right.messageId);
};

type SqliteEnvelopeRow = {
  authored_at: string;
  author_id: string;
  author_name: string | null;
  author_username: string | null;
  conversation_id: string;
  deleted_at: string | null;
  deleted_observed_at: string | null;
  deleted_source: string | null;
  message_id: string;
  observed_at: string;
  thread_last_reply_at: string | null;
  thread_parent_id: string | null;
  thread_reply_count: number | null;
  thread_show_in_conversation: number | null;
};

const envelopeFromRow = (row: SqliteEnvelopeRow): ConversationMessageLedgerEnvelope => ({
  authoredAt: row.authored_at,
  authorId: row.author_id,
  ...(row.author_name ? { authorName: row.author_name } : {}),
  ...(row.author_username ? { authorUsername: row.author_username } : {}),
  conversationId: row.conversation_id,
  ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  ...(row.deleted_observed_at ? { deletedObservedAt: row.deleted_observed_at } : {}),
  ...(row.deleted_source ? { deletedSource: row.deleted_source as ConversationMessageDeletedSource } : {}),
  messageId: row.message_id,
  observedAt: row.observed_at,
  ...(row.thread_last_reply_at ? { threadLastReplyAt: row.thread_last_reply_at } : {}),
  ...(row.thread_parent_id ? { threadParentId: row.thread_parent_id } : {}),
  ...(row.thread_reply_count !== null ? { threadReplyCount: row.thread_reply_count } : {}),
  ...(row.thread_show_in_conversation !== null ? { threadShowInConversation: row.thread_show_in_conversation === 1 } : {}),
});

const sqlitePathFromConfig = (config: BetterChatConfig): string =>
  join(config.stateDir, 'betterchat-canonical-message-ledger.sqlite');

class SqliteConversationMessageLedger implements ConversationMessageLedger {
  private readonly insertOrUpdateEnvelope: Statement;
  private readonly markEnvelopeDeleted: Statement;
  private readonly selectDeletedEnvelopeById: Statement<SqliteEnvelopeRow>;
  private readonly selectDeletedEnvelopesByConversation: Statement<SqliteEnvelopeRow>;

  constructor(private readonly database: Database) {
    this.database.exec(schemaSql);
    this.insertOrUpdateEnvelope = this.database.query(`
      insert into conversation_message_ledger (
        conversation_id,
        message_id,
        authored_at,
        author_id,
        author_username,
        author_name,
        thread_parent_id,
        thread_show_in_conversation,
        thread_reply_count,
        thread_last_reply_at,
        observed_at,
        deleted_at,
        deleted_source,
        deleted_observed_at
      ) values (
        $conversationId,
        $messageId,
        $authoredAt,
        $authorId,
        $authorUsername,
        $authorName,
        $threadParentId,
        $threadShowInConversation,
        $threadReplyCount,
        $threadLastReplyAt,
        $observedAt,
        $deletedAt,
        $deletedSource,
        $deletedObservedAt
      )
      on conflict (conversation_id, message_id) do update set
        authored_at = excluded.authored_at,
        author_id = excluded.author_id,
        author_username = excluded.author_username,
        author_name = excluded.author_name,
        thread_parent_id = excluded.thread_parent_id,
        thread_show_in_conversation = excluded.thread_show_in_conversation,
        thread_reply_count = excluded.thread_reply_count,
        thread_last_reply_at = excluded.thread_last_reply_at,
        observed_at = excluded.observed_at,
        deleted_at = coalesce(excluded.deleted_at, conversation_message_ledger.deleted_at),
        deleted_source = coalesce(excluded.deleted_source, conversation_message_ledger.deleted_source),
        deleted_observed_at = coalesce(excluded.deleted_observed_at, conversation_message_ledger.deleted_observed_at)
    `);
    this.markEnvelopeDeleted = this.database.query(`
      update conversation_message_ledger
      set
        deleted_at = coalesce(deleted_at, $deletedAt),
        deleted_source = coalesce(deleted_source, $deletedSource),
        deleted_observed_at = $deletedObservedAt
      where conversation_id = $conversationId
        and message_id = $messageId
    `);
    this.selectDeletedEnvelopeById = this.database.query(`
      select *
      from conversation_message_ledger
      where conversation_id = $conversationId
        and message_id = $messageId
        and deleted_at is not null
    `);
    this.selectDeletedEnvelopesByConversation = this.database.query(`
      select *
      from conversation_message_ledger
      where conversation_id = $conversationId
        and deleted_at is not null
        and ($authoredAtOnOrAfter is null or authored_at >= $authoredAtOnOrAfter)
      order by authored_at desc, message_id asc
    `);
  }

  close(): void {
    this.database.close();
  }

  getDeletedEnvelope(conversationId: string, messageId: string): ConversationMessageLedgerEnvelope | undefined {
    const row = this.selectDeletedEnvelopeById.get({
      conversationId,
      messageId,
    }) as SqliteEnvelopeRow | null;
    return row ? envelopeFromRow(row) : undefined;
  }

  listDeletedEnvelopesByConversation(
    conversationId: string,
    options: {
      authoredAtOnOrAfter?: string;
    } = {},
  ): ConversationMessageLedgerEnvelope[] {
    return (this.selectDeletedEnvelopesByConversation
      .all({
        authoredAtOnOrAfter: options.authoredAtOnOrAfter ?? null,
        conversationId,
      })
      .map((row) => envelopeFromRow(row as SqliteEnvelopeRow)));
  }

  markDeleted(
    message: UpstreamMessage,
    options: {
      deletedAt?: string;
      source?: ConversationMessageDeletedSource;
    } = {},
  ): ConversationMessageLedgerEnvelope {
    this.observe(message);
    const envelope = this.markDeletedById(message.rid, message._id, options);
    if (!envelope) {
      throw new Error(`Expected observed message envelope for ${message.rid}/${message._id}`);
    }

    return envelope;
  }

  markDeletedById(
    conversationId: string,
    messageId: string,
    options: {
      deletedAt?: string;
      source?: ConversationMessageDeletedSource;
    } = {},
  ): ConversationMessageLedgerEnvelope | undefined {
    const deletedAt = options.deletedAt ?? new Date().toISOString();
    this.markEnvelopeDeleted.run({
      conversationId,
      deletedAt,
      deletedObservedAt: deletedAt,
      deletedSource: options.source ?? 'betterchat-delete',
      messageId,
    });

    return this.getDeletedEnvelope(conversationId, messageId);
  }

  observe(message: UpstreamMessage, observedAt = new Date().toISOString()): ConversationMessageLedgerEnvelope {
    const envelope = envelopeFromUpstreamMessage(message, observedAt);
    this.insertOrUpdateEnvelope.run({
      authoredAt: envelope.authoredAt,
      authorId: envelope.authorId,
      authorName: envelope.authorName ?? null,
      authorUsername: envelope.authorUsername ?? null,
      conversationId: envelope.conversationId,
      deletedAt: envelope.deletedAt ?? null,
      deletedObservedAt: envelope.deletedObservedAt ?? null,
      deletedSource: envelope.deletedSource ?? null,
      messageId: envelope.messageId,
      observedAt: envelope.observedAt,
      threadLastReplyAt: envelope.threadLastReplyAt ?? null,
      threadParentId: envelope.threadParentId ?? null,
      threadReplyCount: envelope.threadReplyCount ?? null,
      threadShowInConversation:
        envelope.threadShowInConversation === undefined ? null : envelope.threadShowInConversation ? 1 : 0,
    });
    return envelope;
  }

  observeMany(messages: Iterable<UpstreamMessage>, observedAt = new Date().toISOString()): void {
    for (const message of messages) {
      this.observe(message, observedAt);
    }
  }
}

export class InMemoryConversationMessageLedger implements ConversationMessageLedger {
  private readonly envelopesByConversationId = new Map<string, Map<string, ConversationMessageLedgerEnvelope>>();

  close(): void {
    // noop
  }

  getDeletedEnvelope(conversationId: string, messageId: string): ConversationMessageLedgerEnvelope | undefined {
    const envelope = this.envelopesByConversationId.get(conversationId)?.get(messageId);
    return envelope?.deletedAt ? envelope : undefined;
  }

  listDeletedEnvelopesByConversation(
    conversationId: string,
    options: {
      authoredAtOnOrAfter?: string;
    } = {},
  ): ConversationMessageLedgerEnvelope[] {
    const authoredAtLowerBoundMs = options.authoredAtOnOrAfter ? Date.parse(options.authoredAtOnOrAfter) : Number.NEGATIVE_INFINITY;

    return [...(this.envelopesByConversationId.get(conversationId)?.values() ?? [])]
      .filter((envelope) => Boolean(envelope.deletedAt))
      .filter((envelope) => Date.parse(envelope.authoredAt) >= authoredAtLowerBoundMs)
      .sort(compareEnvelopesByAuthoredAtDescending);
  }

  markDeleted(
    message: UpstreamMessage,
    options: {
      deletedAt?: string;
      source?: ConversationMessageDeletedSource;
    } = {},
  ): ConversationMessageLedgerEnvelope {
    this.observe(message);
    const envelope = this.markDeletedById(message.rid, message._id, options);
    if (!envelope) {
      throw new Error(`Expected observed message envelope for ${message.rid}/${message._id}`);
    }

    return envelope;
  }

  markDeletedById(
    conversationId: string,
    messageId: string,
    options: {
      deletedAt?: string;
      source?: ConversationMessageDeletedSource;
    } = {},
  ): ConversationMessageLedgerEnvelope | undefined {
    const existing = this.envelopesByConversationId.get(conversationId)?.get(messageId);
    if (!existing) {
      return undefined;
    }

    const deletedAt = options.deletedAt ?? new Date().toISOString();
    const updated = {
      ...existing,
      deletedAt: existing.deletedAt ?? deletedAt,
      deletedObservedAt: deletedAt,
      deletedSource: existing.deletedSource ?? options.source ?? 'betterchat-delete',
    } satisfies ConversationMessageLedgerEnvelope;
    this.envelopesByConversationId.get(conversationId)!.set(messageId, updated);
    return updated;
  }

  observe(message: UpstreamMessage, observedAt = new Date().toISOString()): ConversationMessageLedgerEnvelope {
    const envelope = envelopeFromUpstreamMessage(message, observedAt);
    const conversationEnvelopes = this.envelopesByConversationId.get(envelope.conversationId);
    const existing = conversationEnvelopes?.get(envelope.messageId);
    const next = {
      ...(existing ?? {}),
      ...envelope,
      deletedAt: envelope.deletedAt ?? existing?.deletedAt,
      deletedObservedAt: envelope.deletedObservedAt ?? existing?.deletedObservedAt,
      deletedSource: envelope.deletedSource ?? existing?.deletedSource,
    } satisfies ConversationMessageLedgerEnvelope;

    if (conversationEnvelopes) {
      conversationEnvelopes.set(envelope.messageId, next);
      return next;
    }

    this.envelopesByConversationId.set(envelope.conversationId, new Map([[envelope.messageId, next]]));
    return next;
  }

  observeMany(messages: Iterable<UpstreamMessage>, observedAt = new Date().toISOString()): void {
    for (const message of messages) {
      this.observe(message, observedAt);
    }
  }
}

export const createSqliteConversationMessageLedger = (
  input: {
    path: string;
  } | BetterChatConfig,
): ConversationMessageLedger => {
  const path = 'path' in input ? input.path : sqlitePathFromConfig(input);
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  return new SqliteConversationMessageLedger(new Database(path, { create: true, strict: true }));
};
