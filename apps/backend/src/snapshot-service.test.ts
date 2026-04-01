import { describe, expect, test } from 'bun:test';

import type { BetterChatConfig } from './config';
import { InFlightRequestCache } from './snapshot-cache';
import { createSnapshotReadScope, SnapshotService, type SnapshotLoaders } from './snapshot-service';
import { sessionKeyFrom, type UpstreamSession } from './session';
import { conversationCapabilitiesFixture, emptyMembershipInbox } from './test-fixtures';
import type { RocketChatClient } from './upstream';

const testConfig: BetterChatConfig = {
  host: '127.0.0.1',
  port: 3200,
  upstreamUrl: 'http://127.0.0.1:3100',
  upstreamRequestTimeoutMs: 15_000,
  upstreamMediaTimeoutMs: 30_000,
  sessionCookieName: 'betterchat_session',
  sessionCookieSecure: false,
  sessionSecret: 'snapshot-service-test-secret',
  sessionTtlSeconds: 3600,
  defaultMessagePageSize: 50,
  maxUploadBytes: 10 * 1024 * 1024,
  staticDir: null,
};

const testSession: UpstreamSession = {
  authToken: 'snapshot-service-auth-token',
  createdAt: '2026-03-25T00:00:00.000Z',
  displayName: 'Alice Example',
  expiresAt: '2026-03-25T01:00:00.000Z',
  userId: 'alice-id',
  username: 'alice',
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const createDeferred = <T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
} => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, reject, resolve };
};

const createLoaders = (overrides: Partial<SnapshotLoaders> = {}): SnapshotLoaders => ({
  buildConversationMessageContextSnapshot: async () => ({
    version: 'conversation-context-0',
    conversationId: 'conversation-1',
    anchorMessageId: 'anchor',
    anchorIndex: 0,
    messages: [],
    hasBefore: false,
    hasAfter: false,
  }) as never,
  buildConversationSnapshotState: async () => ({
    snapshot: {
      version: 'conversation-0',
      conversation: {
        id: 'conversation-1',
        kind: { mode: 'group', privacy: 'public' },
        title: 'Conversation 1',
      },
      membership: {
        listing: 'listed',
        starred: false,
        inbox: emptyMembershipInbox,
      },
      capabilities: conversationCapabilitiesFixture(),
    },
  }) as never,
  buildConversationTimelineSnapshot: async () => ({
    version: 'conversation-timeline-0',
    scope: {
      kind: 'conversation',
      conversationId: 'conversation-1',
    },
    messages: [],
  }) as never,
  buildDirectorySnapshotState: async () => ({
    counterpartUserIdByConversationId: new Map<string, string>(),
    snapshot: {
      version: 'directory-0',
      entries: [],
    },
  }) as never,
  buildThreadConversationTimelineSnapshot: async () => ({
    version: 'conversation-thread-0',
    scope: {
      kind: 'thread',
      conversationId: 'conversation-1',
      threadId: 'thread-1',
    },
    messages: [],
    threadRoot: {
      id: 'thread-1',
      conversationId: 'conversation-1',
      authoredAt: '2026-03-25T00:00:00.000Z',
      author: { id: 'alice-id', displayName: 'Alice Example', username: 'alice' },
      content: { format: 'markdown', text: 'root' },
      state: { edited: false, deleted: false },
    },
  }) as never,
  ...overrides,
});

describe('SnapshotService freshness invalidation', () => {
  test('coalesces concurrent conversation timeline reads within the same generation', async () => {
    let loadCount = 0;
    const loaders = createLoaders({
      buildConversationTimelineSnapshot: async () => {
        loadCount += 1;
        await delay(20);
        return {
          version: 'conversation-timeline-0',
          scope: {
            kind: 'conversation',
            conversationId: 'conversation-1',
          },
          messages: [],
        } as never;
      },
    });

    const service = new SnapshotService(testConfig, {} as RocketChatClient, new InFlightRequestCache(), loaders);

    const [left, right] = await Promise.all([
      service.conversationTimeline(testSession, 'conversation-1'),
      service.conversationTimeline(testSession, 'conversation-1'),
    ]);

    expect(left.version).toBe('conversation-timeline-0');
    expect(right.version).toBe('conversation-timeline-0');
    expect(loadCount).toBe(1);
  });

  test('forces a fresh conversation timeline load after conversation invalidation even when an older load is still pending', async () => {
    const state = {
      loadCount: 0,
      timelineVersion: 0,
    };

    const loaders = createLoaders({
      buildConversationTimelineSnapshot: async () => {
        state.loadCount += 1;
        const capturedVersion = state.timelineVersion;
        await delay(30);
        return {
          version: `conversation-timeline-${capturedVersion}`,
          scope: {
            kind: 'conversation',
            conversationId: 'conversation-1',
          },
          messages: [],
        } as never;
      },
    });

    const service = new SnapshotService(testConfig, {} as RocketChatClient, new InFlightRequestCache(), loaders);

    const firstPromise = service.conversationTimeline(testSession, 'conversation-1');
    await delay(5);

    state.timelineVersion = 1;
    service.invalidateConversation(testSession, 'conversation-1');

    const [first, second] = await Promise.all([
      firstPromise,
      service.conversationTimeline(testSession, 'conversation-1'),
    ]);

    expect(first.version).toBe('conversation-timeline-0');
    expect(second.version).toBe('conversation-timeline-1');
    expect(state.loadCount).toBe(2);
  });

  test('prunes expired session generation state when later sessions are accessed', async () => {
    const service = new SnapshotService(testConfig, {} as RocketChatClient, new InFlightRequestCache(), createLoaders());
    const expiredSession: UpstreamSession = {
      ...testSession,
      authToken: 'expired-auth-token',
      expiresAt: '2000-01-01T00:00:00.000Z',
    };
    const freshSession: UpstreamSession = {
      ...testSession,
      authToken: 'fresh-auth-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    const generationsBySessionKey = (service as unknown as { generationsBySessionKey: Map<string, unknown> }).generationsBySessionKey;

    await service.directory(expiredSession);
    expect(generationsBySessionKey.has(sessionKeyFrom(expiredSession))).toBe(true);

    await service.directory(freshSession);
    expect(generationsBySessionKey.has(sessionKeyFrom(expiredSession))).toBe(false);
    expect(generationsBySessionKey.has(sessionKeyFrom(freshSession))).toBe(true);
  });

  test('coalesces concurrent directory reads within the same generation and refreshes after invalidation', async () => {
    let version = 0;
    let loadCount = 0;
    const service = new SnapshotService(
      testConfig,
      {} as RocketChatClient,
      new InFlightRequestCache(),
      createLoaders({
        buildDirectorySnapshotState: async () => {
          loadCount += 1;
          await delay(20);
          return {
            counterpartUserIdByConversationId: new Map<string, string>(),
            snapshot: {
              version: `directory-${version}`,
              entries: [],
            },
          } as never;
        },
      }),
    );

    const [first, second] = await Promise.all([service.directory(testSession), service.directory(testSession)]);

    expect(first.version).toBe('directory-0');
    expect(second.version).toBe('directory-0');
    expect(loadCount).toBe(1);

    version = 1;
    service.invalidateDirectory(testSession);

    const third = await service.directory(testSession);
    expect(third.version).toBe('directory-1');
    expect(loadCount).toBe(2);
  });

  test('does not reuse a cleared session in-flight directory load for the next session read', async () => {
    const pendingLoads = [createDeferred<void>(), createDeferred<void>()];
    let loadCount = 0;
    const service = new SnapshotService(
      testConfig,
      {} as RocketChatClient,
      new InFlightRequestCache(),
      createLoaders({
        buildDirectorySnapshotState: async () => {
          const currentLoad = loadCount;
          loadCount += 1;
          await pendingLoads[currentLoad]!.promise;
          return {
            counterpartUserIdByConversationId: new Map<string, string>(),
            snapshot: {
              version: `directory-${currentLoad}`,
              entries: [],
            },
          } as never;
        },
      }),
    );

    const firstPromise = service.directory(testSession);
    await delay(5);

    service.clearSession(testSession);
    const secondPromise = service.directory(testSession);
    await delay(5);

    expect(loadCount).toBe(2);

    pendingLoads[0]!.resolve();
    pendingLoads[1]!.resolve();

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.version).toBe('directory-0');
    expect(second.version).toBe('directory-1');
  });

  test('uses fresh fact scopes for independent reads', async () => {
    const seenFacts: unknown[] = [];
    const service = new SnapshotService(
      testConfig,
      {} as RocketChatClient,
      new InFlightRequestCache(),
      createLoaders({
        buildDirectorySnapshotState: async (_client, _session, facts) => {
          seenFacts.push(facts);
          return {
            counterpartUserIdByConversationId: new Map<string, string>(),
            snapshot: {
              version: `directory-${seenFacts.length}`,
              entries: [],
            },
          } as never;
        },
      }),
    );

    await service.directory(testSession);
    await service.directory(testSession);

    expect(seenFacts).toHaveLength(2);
    expect(seenFacts[0]).not.toBe(seenFacts[1]);
  });

  test('shares one fact scope across coordinated snapshot loads when requested explicitly', async () => {
    const seenFacts: unknown[] = [];
    const service = new SnapshotService(
      testConfig,
      {} as RocketChatClient,
      new InFlightRequestCache(),
      createLoaders({
        buildConversationSnapshotState: async (_client, _session, _conversationId, facts) => {
          seenFacts.push(facts);
          return {
            snapshot: {
              version: 'conversation-0',
              conversation: {
                id: 'conversation-1',
                kind: { mode: 'group', privacy: 'public' },
                title: 'Conversation 1',
              },
              membership: {
                listing: 'listed',
                starred: false,
                inbox: emptyMembershipInbox,
              },
              capabilities: conversationCapabilitiesFixture(),
            },
          } as never;
        },
        buildConversationTimelineSnapshot: async (_config, _client, _session, _conversationId, _page, facts) => {
          seenFacts.push(facts);
          return {
            version: 'conversation-timeline-0',
            scope: {
              kind: 'conversation',
              conversationId: 'conversation-1',
            },
            messages: [],
          } as never;
        },
      }),
    );

    const scope = createSnapshotReadScope();

    await Promise.all([
      service.conversationState(testSession, 'conversation-1', scope),
      service.conversationTimeline(testSession, 'conversation-1', undefined, scope),
    ]);

    expect(seenFacts).toHaveLength(2);
    expect(seenFacts[0]).toBe(seenFacts[1]);
  });
});
