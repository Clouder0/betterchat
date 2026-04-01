import type {
  ConversationMessageContextSnapshot,
  ConversationSnapshot,
  ConversationTimelineSnapshot,
  DirectorySnapshot,
} from '@betterchat/contracts';

import type { BetterChatConfig } from './config';
import {
  buildConversationMessageContextSnapshot,
  buildConversationSnapshotState,
  buildConversationTimelineSnapshot,
  buildDirectorySnapshotState,
  buildThreadConversationTimelineSnapshot,
} from './conversation-snapshots';
import type { PaginationRequest } from './pagination';
import { sessionKeyFrom, type UpstreamSession } from './session';
import { InFlightRequestCache } from './snapshot-cache';
import { SnapshotFactCache } from './snapshot-facts';
import { type RocketChatClient } from './upstream';

type DirectorySnapshotState = Awaited<ReturnType<typeof buildDirectorySnapshotState>>;
type ConversationSnapshotState = Awaited<ReturnType<typeof buildConversationSnapshotState>>;

type SessionSnapshotGenerations = {
  conversationById: Map<string, number>;
  directory: number;
  expiresAtMs: number;
  threadById: Map<string, number>;
};

const defaultSnapshotGenerations = (expiresAtMs: number): SessionSnapshotGenerations => ({
  conversationById: new Map<string, number>(),
  directory: 0,
  expiresAtMs,
  threadById: new Map<string, number>(),
});

const pageKeyFrom = (page: PaginationRequest | undefined, defaultLimit: number): string => {
  const normalizedPage = page || { offset: 0, limit: defaultLimit };
  return `${normalizedPage.offset}:${normalizedPage.limit}`;
};

const threadGenerationKeyFrom = (conversationId: string, threadId: string): string => `${conversationId}:${threadId}`;

export class SnapshotReadScope {
  readonly facts = new SnapshotFactCache();
}

export type SnapshotLoaders = {
  buildConversationMessageContextSnapshot: typeof buildConversationMessageContextSnapshot;
  buildConversationSnapshotState: typeof buildConversationSnapshotState;
  buildConversationTimelineSnapshot: typeof buildConversationTimelineSnapshot;
  buildDirectorySnapshotState: typeof buildDirectorySnapshotState;
  buildThreadConversationTimelineSnapshot: typeof buildThreadConversationTimelineSnapshot;
};

const defaultSnapshotLoaders: SnapshotLoaders = {
  buildConversationMessageContextSnapshot,
  buildConversationSnapshotState,
  buildConversationTimelineSnapshot,
  buildDirectorySnapshotState,
  buildThreadConversationTimelineSnapshot,
};

export class SnapshotService {
  private readonly generationsBySessionKey = new Map<string, SessionSnapshotGenerations>();

  constructor(
    private readonly config: BetterChatConfig,
    private readonly client: RocketChatClient,
    private readonly cache = new InFlightRequestCache(),
    private readonly loaders: SnapshotLoaders = defaultSnapshotLoaders,
  ) {}

  directory(session: UpstreamSession, scope?: SnapshotReadScope): Promise<DirectorySnapshot> {
    return this.directoryState(session, scope).then((state) => state.snapshot);
  }

  directoryState(session: UpstreamSession, scope?: SnapshotReadScope): Promise<DirectorySnapshotState> {
    return this.cache.getOrLoad(this.directoryKeyFor(session), () =>
      this.loaders.buildDirectorySnapshotState(this.client, session, this.factsFor(scope)),
    );
  }

  conversation(session: UpstreamSession, conversationId: string, scope?: SnapshotReadScope): Promise<ConversationSnapshot> {
    return this.conversationState(session, conversationId, scope).then((state) => state.snapshot);
  }

  conversationState(session: UpstreamSession, conversationId: string, scope?: SnapshotReadScope): Promise<ConversationSnapshotState> {
    return this.cache.getOrLoad(this.conversationKeyFor(session, conversationId, 'snapshot'), () =>
      this.loaders.buildConversationSnapshotState(this.client, session, conversationId, this.factsFor(scope)),
    );
  }

  conversationTimeline(
    session: UpstreamSession,
    conversationId: string,
    page?: PaginationRequest,
    scope?: SnapshotReadScope,
  ): Promise<ConversationTimelineSnapshot> {
    return this.cache.getOrLoad(
      this.conversationKeyFor(session, conversationId, `timeline:${pageKeyFrom(page, this.config.defaultMessagePageSize)}`),
      () => this.loaders.buildConversationTimelineSnapshot(this.config, this.client, session, conversationId, page, this.factsFor(scope)),
    );
  }

  conversationMessageContext(
    session: UpstreamSession,
    conversationId: string,
    messageId: string,
    contextWindow: {
      before: number;
      after: number;
    },
    scope?: SnapshotReadScope,
  ): Promise<ConversationMessageContextSnapshot> {
    return this.cache.getOrLoad(
      this.conversationKeyFor(session, conversationId, `context:${messageId}:${contextWindow.before}:${contextWindow.after}`),
      () =>
        this.loaders.buildConversationMessageContextSnapshot(
          this.config,
          this.client,
          session,
          conversationId,
          messageId,
          contextWindow,
          this.factsFor(scope),
        ),
    );
  }

  threadConversationTimeline(
    session: UpstreamSession,
    conversationId: string,
    threadId: string,
    page?: PaginationRequest,
    scope?: SnapshotReadScope,
  ): Promise<ConversationTimelineSnapshot> {
    return this.cache.getOrLoad(
      this.threadKeyFor(session, conversationId, threadId, `timeline:${pageKeyFrom(page, this.config.defaultMessagePageSize)}`),
      () =>
        this.loaders.buildThreadConversationTimelineSnapshot(
          this.config,
          this.client,
          session,
          conversationId,
          threadId,
          page,
          this.factsFor(scope),
        ),
    );
  }

  invalidateDirectory(session: UpstreamSession): void {
    const generations = this.generationsFor(session);
    generations.directory += 1;
  }

  invalidateConversation(session: UpstreamSession, conversationId: string): void {
    const generations = this.generationsFor(session);
    generations.conversationById.set(
      conversationId,
      this.conversationGenerationFor(generations, conversationId) + 1,
    );
  }

  invalidateThread(session: UpstreamSession, conversationId: string, threadId: string): void {
    const generations = this.generationsFor(session);
    const key = threadGenerationKeyFrom(conversationId, threadId);
    generations.threadById.set(key, this.threadGenerationFor(generations, conversationId, threadId) + 1);
  }

  clearSession(session: Pick<UpstreamSession, 'authToken'>): void {
    const sessionKey = sessionKeyFrom(session);
    this.generationsBySessionKey.delete(sessionKey);
    this.cache.deleteWhere((key) => key.startsWith(`${sessionKey}:`));
  }

  private pruneExpiredSessions(now = Date.now(), activeSessionKey?: string): void {
    for (const [sessionKey, generations] of this.generationsBySessionKey.entries()) {
      if (sessionKey === activeSessionKey) {
        continue;
      }

      if (Number.isFinite(generations.expiresAtMs) && generations.expiresAtMs <= now) {
        this.generationsBySessionKey.delete(sessionKey);
      }
    }
  }

  private factsFor(scope: SnapshotReadScope | undefined): SnapshotFactCache {
    return scope?.facts ?? new SnapshotFactCache();
  }

  private generationsFor(session: UpstreamSession): SessionSnapshotGenerations {
    const key = sessionKeyFrom(session);
    this.pruneExpiredSessions(Date.now(), key);

    const existing = this.generationsBySessionKey.get(key);
    if (existing) {
      const nextExpiresAtMs = Date.parse(session.expiresAt);
      if (Number.isFinite(nextExpiresAtMs)) {
        existing.expiresAtMs = nextExpiresAtMs;
      }
      return existing;
    }

    const created = defaultSnapshotGenerations(Date.parse(session.expiresAt));
    this.generationsBySessionKey.set(key, created);
    return created;
  }

  private conversationGenerationFor(generations: SessionSnapshotGenerations, conversationId: string): number {
    return generations.conversationById.get(conversationId) ?? 0;
  }

  private threadGenerationFor(generations: SessionSnapshotGenerations, conversationId: string, threadId: string): number {
    return generations.threadById.get(threadGenerationKeyFrom(conversationId, threadId)) ?? 0;
  }

  private directoryKeyFor(session: UpstreamSession): string {
    const sessionKey = sessionKeyFrom(session);
    const generations = this.generationsFor(session);
    return `${sessionKey}:directory:g${generations.directory}`;
  }

  private conversationKeyFor(session: UpstreamSession, conversationId: string, suffix: string): string {
    const sessionKey = sessionKeyFrom(session);
    const generations = this.generationsFor(session);
    return `${sessionKey}:conversation:${conversationId}:g${this.conversationGenerationFor(generations, conversationId)}:${suffix}`;
  }

  private threadKeyFor(session: UpstreamSession, conversationId: string, threadId: string, suffix: string): string {
    const sessionKey = sessionKeyFrom(session);
    const generations = this.generationsFor(session);
    return `${sessionKey}:conversation:${conversationId}:thread:${threadId}:g${this.conversationGenerationFor(generations, conversationId)}:${this.threadGenerationFor(generations, conversationId, threadId)}:${suffix}`;
  }
}

export const createSnapshotService = (
  config: BetterChatConfig,
  client: RocketChatClient,
  cache = new InFlightRequestCache(),
  loaders: SnapshotLoaders = defaultSnapshotLoaders,
): SnapshotService => new SnapshotService(config, client, cache, loaders);

export const createSnapshotReadScope = (): SnapshotReadScope => new SnapshotReadScope();

export type { ConversationSnapshotState, DirectorySnapshotState };
