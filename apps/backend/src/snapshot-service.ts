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
  buildDirectoryEntryState,
  buildDirectorySnapshotState,
  buildThreadConversationTimelineSnapshot,
} from './conversation-snapshots';
import type { PaginationRequest } from './pagination';
import { sessionKeyFrom, type UpstreamSession } from './session';
import { InFlightRequestCache } from './snapshot-cache';
import { SnapshotFactCache } from './snapshot-facts';
import { toAppError } from './errors';
import { type RocketChatClient } from './upstream';

type DirectorySnapshotState = Awaited<ReturnType<typeof buildDirectorySnapshotState>>;
type DirectoryEntryState = Awaited<ReturnType<typeof buildDirectoryEntryState>>;
type ConversationSnapshotState = Awaited<ReturnType<typeof buildConversationSnapshotState>>;
type ConversationRefreshState = {
  conversationState: ConversationSnapshotState;
  timeline: ConversationTimelineSnapshot;
};

type SessionSnapshotGenerations = {
  conversationById: Map<string, number>;
  directory: number;
  expiresAtMs: number;
  threadById: Map<string, number>;
  userId: string;
};

const defaultSnapshotGenerations = (userId: string, expiresAtMs: number): SessionSnapshotGenerations => ({
  conversationById: new Map<string, number>(),
  directory: 0,
  expiresAtMs,
  threadById: new Map<string, number>(),
  userId,
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
  buildDirectoryEntryState: typeof buildDirectoryEntryState;
  buildDirectorySnapshotState: typeof buildDirectorySnapshotState;
  buildThreadConversationTimelineSnapshot: typeof buildThreadConversationTimelineSnapshot;
};

const defaultSnapshotLoaders: SnapshotLoaders = {
  buildConversationMessageContextSnapshot,
  buildConversationSnapshotState,
  buildConversationTimelineSnapshot,
  buildDirectoryEntryState,
  buildDirectorySnapshotState,
  buildThreadConversationTimelineSnapshot,
};

export class SnapshotService {
  private readonly generationsBySessionKey = new Map<string, SessionSnapshotGenerations>();
  private readonly sessionKeysByUserId = new Map<string, Set<string>>();

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

  directoryEntryState(
    session: UpstreamSession,
    conversationId: string,
    scope?: SnapshotReadScope,
  ): Promise<DirectoryEntryState> {
    return this.cache.getOrLoad(this.directoryKeyFor(session, `entry:${conversationId}`), () =>
      this.loaders.buildDirectoryEntryState(this.client, session, conversationId, this.factsFor(scope)),
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

  refreshDirectoryState(session: UpstreamSession): Promise<DirectorySnapshotState> {
    return this.withUserRefreshCoalescing(session, 'directory', async () => {
      this.invalidateDirectoryForUser(session);
      return this.directoryState(session, createSnapshotReadScope());
    });
  }

  refreshDirectoryEntryState(session: UpstreamSession, conversationId: string): Promise<DirectoryEntryState> {
    return this.withUserRefreshCoalescing(session, `directory-entry:${conversationId}`, async () => {
      this.invalidateDirectoryForUser(session);
      return this.directoryEntryState(session, conversationId, createSnapshotReadScope());
    });
  }

  refreshConversationStateWithTimeline(
    session: UpstreamSession,
    conversationId: string,
  ): Promise<ConversationRefreshState> {
    return this.withUserRefreshCoalescing(session, `conversation:${conversationId}`, async () => {
      this.invalidateConversationForUser(session, conversationId);
      const scope = createSnapshotReadScope();
      const [conversationState, timeline] = await Promise.all([
        this.conversationState(session, conversationId, scope),
        this.conversationTimeline(session, conversationId, undefined, scope),
      ]);

      return {
        conversationState,
        timeline,
      };
    });
  }

  refreshThreadConversationTimeline(
    session: UpstreamSession,
    conversationId: string,
    threadId: string,
  ): Promise<ConversationTimelineSnapshot> {
    return this.withUserRefreshCoalescing(session, `conversation:${conversationId}:thread:${threadId}`, async () => {
      this.invalidateThreadForUser(session, conversationId, threadId);
      return this.threadConversationTimeline(session, conversationId, threadId, undefined, createSnapshotReadScope());
    });
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
    const clearedUserId = this.deleteSessionState(sessionKey);
    this.cache.deleteWhere((key) => key.startsWith(`${sessionKey}:`));
    if (clearedUserId) {
      this.cache.deleteWhere((key) => key.startsWith(this.userRefreshPrefixFor(clearedUserId)));
    }
  }

  private pruneExpiredSessions(now = Date.now(), activeSessionKey?: string): void {
    for (const [sessionKey, generations] of this.generationsBySessionKey.entries()) {
      if (sessionKey === activeSessionKey) {
        continue;
      }

      if (Number.isFinite(generations.expiresAtMs) && generations.expiresAtMs <= now) {
        this.deleteSessionState(sessionKey);
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
      if (existing.userId !== session.userId) {
        this.unregisterSessionKey(existing.userId, key);
        existing.userId = session.userId;
        this.registerSessionKey(session.userId, key);
      }
      return existing;
    }

    const created = defaultSnapshotGenerations(session.userId, Date.parse(session.expiresAt));
    this.generationsBySessionKey.set(key, created);
    this.registerSessionKey(session.userId, key);
    return created;
  }

  private registerSessionKey(userId: string, sessionKey: string): void {
    const existing = this.sessionKeysByUserId.get(userId);
    if (existing) {
      existing.add(sessionKey);
      return;
    }

    this.sessionKeysByUserId.set(userId, new Set([sessionKey]));
  }

  private unregisterSessionKey(userId: string, sessionKey: string): void {
    const existing = this.sessionKeysByUserId.get(userId);
    if (!existing) {
      return;
    }

    existing.delete(sessionKey);
    if (existing.size === 0) {
      this.sessionKeysByUserId.delete(userId);
    }
  }

  private deleteSessionState(sessionKey: string): string | undefined {
    const existing = this.generationsBySessionKey.get(sessionKey);
    if (!existing) {
      return undefined;
    }

    this.generationsBySessionKey.delete(sessionKey);
    this.unregisterSessionKey(existing.userId, sessionKey);
    return existing.userId;
  }

  private invalidateAcrossUserSessions(
    session: UpstreamSession,
    invalidate: (generations: SessionSnapshotGenerations) => void,
  ): void {
    const activeSessionKey = sessionKeyFrom(session);
    const activeGenerations = this.generationsFor(session);
    const sessionKeys = this.sessionKeysByUserId.get(session.userId);

    if (!sessionKeys || sessionKeys.size === 0) {
      invalidate(activeGenerations);
      return;
    }

    for (const sessionKey of sessionKeys) {
      if (sessionKey === activeSessionKey) {
        invalidate(activeGenerations);
        continue;
      }

      const generations = this.generationsBySessionKey.get(sessionKey);
      if (generations) {
        invalidate(generations);
      }
    }
  }

  private invalidateDirectoryForUser(session: UpstreamSession): void {
    this.invalidateAcrossUserSessions(session, (generations) => {
      generations.directory += 1;
    });
  }

  private invalidateConversationForUser(session: UpstreamSession, conversationId: string): void {
    this.invalidateAcrossUserSessions(session, (generations) => {
      generations.conversationById.set(
        conversationId,
        this.conversationGenerationFor(generations, conversationId) + 1,
      );
    });
  }

  private invalidateThreadForUser(session: UpstreamSession, conversationId: string, threadId: string): void {
    this.invalidateAcrossUserSessions(session, (generations) => {
      const key = threadGenerationKeyFrom(conversationId, threadId);
      generations.threadById.set(key, this.threadGenerationFor(generations, conversationId, threadId) + 1);
    });
  }

  private async withUserRefreshCoalescing<T>(
    session: UpstreamSession,
    suffix: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const userRefresh = this.cache.getOrLoadEntry(this.userRefreshKeyFor(session, suffix), load);

    try {
      return await userRefresh.promise;
    } catch (error) {
      const appError = toAppError(error);
      if (userRefresh.created || appError.status !== 401) {
        throw error;
      }

      return this.cache.getOrLoad(this.refreshKeyFor(session, suffix), load);
    }
  }

  private conversationGenerationFor(generations: SessionSnapshotGenerations, conversationId: string): number {
    return generations.conversationById.get(conversationId) ?? 0;
  }

  private threadGenerationFor(generations: SessionSnapshotGenerations, conversationId: string, threadId: string): number {
    return generations.threadById.get(threadGenerationKeyFrom(conversationId, threadId)) ?? 0;
  }

  private directoryKeyFor(session: UpstreamSession, suffix = 'snapshot'): string {
    const sessionKey = sessionKeyFrom(session);
    const generations = this.generationsFor(session);
    return `${sessionKey}:directory:g${generations.directory}:${suffix}`;
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

  private refreshKeyFor(session: UpstreamSession, suffix: string): string {
    return `${sessionKeyFrom(session)}:refresh:${suffix}`;
  }

  private userRefreshPrefixFor(userId: string): string {
    return `user:${userId}:refresh:`;
  }

  private userRefreshKeyFor(session: UpstreamSession, suffix: string): string {
    return `${this.userRefreshPrefixFor(session.userId)}${suffix}`;
  }
}

export const createSnapshotService = (
  config: BetterChatConfig,
  client: RocketChatClient,
  cache = new InFlightRequestCache(),
  loaders: SnapshotLoaders = defaultSnapshotLoaders,
): SnapshotService => new SnapshotService(config, client, cache, loaders);

export const createSnapshotReadScope = (): SnapshotReadScope => new SnapshotReadScope();

export type { ConversationRefreshState, ConversationSnapshotState, DirectorySnapshotState };
