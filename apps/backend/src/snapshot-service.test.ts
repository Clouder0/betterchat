import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BetterChatConfig } from './config';
import { AppError } from './errors';
import { InFlightRequestCache } from './snapshot-cache';
import { createSnapshotReadScope, createSnapshotService, SnapshotService, type SnapshotLoaders } from './snapshot-service';
import { sessionKeyFrom, type UpstreamSession } from './session';
import { conversationCapabilitiesFixture, emptyMembershipInbox } from './test-fixtures';
import type { RocketChatClient, UpstreamMessage } from './upstream';

const testConfig: BetterChatConfig = {
  host: '127.0.0.1',
  port: 3200,
  stateDir: '/tmp/betterchat-snapshot-service-test-state',
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
  expiresAt: '2099-01-01T01:00:00.000Z',
  userId: 'alice-id',
  username: 'alice',
};

const secondSameUserSession: UpstreamSession = {
  ...testSession,
  authToken: 'snapshot-service-auth-token-2',
  createdAt: '2026-03-25T00:05:00.000Z',
  expiresAt: '2099-01-01T01:05:00.000Z',
};

const otherUserSession: UpstreamSession = {
  ...testSession,
  authToken: 'snapshot-service-bob-auth-token',
  displayName: 'Bob Example',
  createdAt: '2026-03-25T00:10:00.000Z',
  expiresAt: '2099-01-01T01:10:00.000Z',
  userId: 'bob-id',
  username: 'bob',
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
  buildDirectoryEntryState: async () => ({
    counterpartUserIdByConversationId: new Map<string, string>(),
    entry: undefined,
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
  test('reuses the durable canonical message ledger across service recreation', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'betterchat-snapshot-service-'));
    try {
      const persistenceConfig: BetterChatConfig = {
        ...testConfig,
        stateDir,
      };
      const deletedMessage = {
        _id: 'message-1',
        rid: 'room-1',
        msg: 'hello',
        ts: '2026-04-07T08:00:00.000Z',
        u: {
          _id: 'alice-id',
          username: 'alice',
          name: 'Alice Example',
        },
      } satisfies UpstreamMessage;
      const firstService = createSnapshotService(
        persistenceConfig,
        {
          findMessage: async () => deletedMessage,
        } as unknown as RocketChatClient,
      );

      firstService.observeMessage(deletedMessage);
      firstService.rememberDeletedMessage(deletedMessage);
      firstService.close();

      const secondService = createSnapshotService(
        persistenceConfig,
        {
          findMessage: async () => undefined,
        } as unknown as RocketChatClient,
      );

      await expect(secondService.findCanonicalMessage(testSession, 'room-1', 'message-1')).resolves.toMatchObject({
        _id: 'message-1',
        rid: 'room-1',
        t: 'rm',
      });
      secondService.close();
    } finally {
      rmSync(stateDir, { force: true, recursive: true });
    }
  });

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

  test('coalesces concurrent directory refreshes into one invalidation and one load', async () => {
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

    version = 1;
    const [left, right] = await Promise.all([
      service.refreshDirectoryState(testSession),
      service.refreshDirectoryState(testSession),
    ]);

    expect(left.snapshot.version).toBe('directory-1');
    expect(right.snapshot.version).toBe('directory-1');
    expect(loadCount).toBe(1);
  });

  test('coalesces concurrent targeted directory entry refreshes into one invalidation and one load', async () => {
    let loadCount = 0;
    const service = new SnapshotService(
      testConfig,
      {} as RocketChatClient,
      new InFlightRequestCache(),
      createLoaders({
        buildDirectoryEntryState: async () => {
          loadCount += 1;
          await delay(20);
          return {
            counterpartUserIdByConversationId: new Map<string, string>(),
            entry: undefined,
          } as never;
        },
      }),
    );

    const [left, right] = await Promise.all([
      service.refreshDirectoryEntryState(testSession, 'conversation-1'),
      service.refreshDirectoryEntryState(testSession, 'conversation-1'),
    ]);

    expect(left.entry).toBeUndefined();
    expect(right.entry).toBeUndefined();
    expect(loadCount).toBe(1);
  });

  test('coalesces concurrent conversation refreshes into one invalidation and one coordinated load', async () => {
    let version = 0;
    let conversationLoadCount = 0;
    let timelineLoadCount = 0;
    const service = new SnapshotService(
      testConfig,
      {} as RocketChatClient,
      new InFlightRequestCache(),
      createLoaders({
        buildConversationSnapshotState: async () => {
          conversationLoadCount += 1;
          await delay(20);
          return {
            snapshot: {
              version: `conversation-${version}`,
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
        buildConversationTimelineSnapshot: async () => {
          timelineLoadCount += 1;
          await delay(20);
          return {
            version: `conversation-timeline-${version}`,
            scope: {
              kind: 'conversation',
              conversationId: 'conversation-1',
            },
            messages: [],
          } as never;
        },
      }),
    );

    version = 1;
    const [left, right] = await Promise.all([
      service.refreshConversationStateWithTimeline(testSession, 'conversation-1'),
      service.refreshConversationStateWithTimeline(testSession, 'conversation-1'),
    ]);

    expect(left.conversationState.snapshot.version).toBe('conversation-1');
    expect(right.conversationState.snapshot.version).toBe('conversation-1');
    expect(left.timeline.version).toBe('conversation-timeline-1');
    expect(right.timeline.version).toBe('conversation-timeline-1');
    expect(conversationLoadCount).toBe(1);
    expect(timelineLoadCount).toBe(1);
  });

  test('coalesces concurrent conversation refreshes across distinct sessions for the same user', async () => {
    let version = 0;
    let conversationLoadCount = 0;
    let timelineLoadCount = 0;
    const service = new SnapshotService(
      testConfig,
      {} as RocketChatClient,
      new InFlightRequestCache(),
      createLoaders({
        buildConversationSnapshotState: async () => {
          conversationLoadCount += 1;
          await delay(20);
          return {
            snapshot: {
              version: `conversation-${version}`,
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
        buildConversationTimelineSnapshot: async () => {
          timelineLoadCount += 1;
          await delay(20);
          return {
            version: `conversation-timeline-${version}`,
            scope: {
              kind: 'conversation',
              conversationId: 'conversation-1',
            },
            messages: [],
          } as never;
        },
      }),
    );

    version = 1;
    const [left, right] = await Promise.all([
      service.refreshConversationStateWithTimeline(testSession, 'conversation-1'),
      service.refreshConversationStateWithTimeline(secondSameUserSession, 'conversation-1'),
    ]);

    expect(left.conversationState.snapshot.version).toBe('conversation-1');
    expect(right.conversationState.snapshot.version).toBe('conversation-1');
    expect(left.timeline.version).toBe('conversation-timeline-1');
    expect(right.timeline.version).toBe('conversation-timeline-1');
    expect(conversationLoadCount).toBe(1);
    expect(timelineLoadCount).toBe(1);
  });

  test('does not coalesce concurrent conversation refreshes across different users', async () => {
    let version = 0;
    let conversationLoadCount = 0;
    let timelineLoadCount = 0;
    const service = new SnapshotService(
      testConfig,
      {} as RocketChatClient,
      new InFlightRequestCache(),
      createLoaders({
        buildConversationSnapshotState: async () => {
          conversationLoadCount += 1;
          await delay(20);
          return {
            snapshot: {
              version: `conversation-${version}`,
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
        buildConversationTimelineSnapshot: async () => {
          timelineLoadCount += 1;
          await delay(20);
          return {
            version: `conversation-timeline-${version}`,
            scope: {
              kind: 'conversation',
              conversationId: 'conversation-1',
            },
            messages: [],
          } as never;
        },
      }),
    );

    version = 1;
    await Promise.all([
      service.refreshConversationStateWithTimeline(testSession, 'conversation-1'),
      service.refreshConversationStateWithTimeline(otherUserSession, 'conversation-1'),
    ]);

    expect(conversationLoadCount).toBe(2);
    expect(timelineLoadCount).toBe(2);
  });

  test('coalesces concurrent thread refreshes into one invalidation and one load', async () => {
    let version = 0;
    let threadLoadCount = 0;
    const service = new SnapshotService(
      testConfig,
      {} as RocketChatClient,
      new InFlightRequestCache(),
      createLoaders({
        buildThreadConversationTimelineSnapshot: async () => {
          threadLoadCount += 1;
          await delay(20);
          return {
            version: `conversation-thread-${version}`,
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
          } as never;
        },
      }),
    );

    version = 1;
    const [left, right] = await Promise.all([
      service.refreshThreadConversationTimeline(testSession, 'conversation-1', 'thread-1'),
      service.refreshThreadConversationTimeline(testSession, 'conversation-1', 'thread-1'),
    ]);

    expect(left.version).toBe('conversation-thread-1');
    expect(right.version).toBe('conversation-thread-1');
    expect(threadLoadCount).toBe(1);
  });

  test('retries same-user directory refreshes with another session when the leader token is unauthenticated', async () => {
    const invalidSession: UpstreamSession = {
      ...testSession,
      authToken: 'invalid-auth-token',
    };
    const loadTokens: string[] = [];
    const service = new SnapshotService(
      testConfig,
      {} as RocketChatClient,
      new InFlightRequestCache(),
      createLoaders({
        buildDirectorySnapshotState: async (_client, session) => {
          loadTokens.push(session.authToken);
          await delay(20);
          if (session.authToken === invalidSession.authToken) {
            throw new AppError('UNAUTHENTICATED', 'invalid token', 401);
          }

          return {
            counterpartUserIdByConversationId: new Map<string, string>(),
            snapshot: {
              version: 'directory-ok',
              entries: [],
            },
          } as never;
        },
      }),
    );

    const invalidPromise = service.refreshDirectoryState(invalidSession);
    await delay(5);
    const validPromise = service.refreshDirectoryState(secondSameUserSession);

    const [invalidResult, validResult] = await Promise.allSettled([invalidPromise, validPromise]);

    expect(invalidResult).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        code: 'UNAUTHENTICATED',
        status: 401,
      }),
    });
    expect(validResult).toMatchObject({
      status: 'fulfilled',
      value: expect.objectContaining({
        snapshot: expect.objectContaining({
          version: 'directory-ok',
        }),
      }),
    });
    expect(loadTokens).toEqual([invalidSession.authToken, secondSameUserSession.authToken]);
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

  test('clearing one same-user session keeps sibling session generation state registered', async () => {
    const service = new SnapshotService(testConfig, {} as RocketChatClient, new InFlightRequestCache(), createLoaders());
    const state = service as unknown as {
      generationsBySessionKey: Map<string, unknown>;
      sessionKeysByUserId: Map<string, Set<string>>;
    };

    await service.directory(testSession);
    await service.directory(secondSameUserSession);

    service.clearSession(testSession);

    expect(state.generationsBySessionKey.has(sessionKeyFrom(testSession))).toBe(false);
    expect(state.generationsBySessionKey.has(sessionKeyFrom(secondSameUserSession))).toBe(true);
    expect(state.sessionKeysByUserId.get(testSession.userId)).toEqual(new Set([sessionKeyFrom(secondSameUserSession)]));
  });

  test('invalidates tracked same-user session generations together during directory refresh', async () => {
    const service = new SnapshotService(
      testConfig,
      {} as RocketChatClient,
      new InFlightRequestCache(),
      createLoaders(),
    );
    const generationsBySessionKey = (
      service as unknown as { generationsBySessionKey: Map<string, { directory: number }> }
    ).generationsBySessionKey;

    await service.directory(testSession);
    await service.directory(secondSameUserSession);

    expect(generationsBySessionKey.get(sessionKeyFrom(testSession))?.directory).toBe(0);
    expect(generationsBySessionKey.get(sessionKeyFrom(secondSameUserSession))?.directory).toBe(0);

    await service.refreshDirectoryState(testSession);

    expect(generationsBySessionKey.get(sessionKeyFrom(testSession))?.directory).toBe(1);
    expect(generationsBySessionKey.get(sessionKeyFrom(secondSameUserSession))?.directory).toBe(1);
  });

  test('clears only the targeted session state when same-user sessions coexist', async () => {
    const service = new SnapshotService(
      testConfig,
      {} as RocketChatClient,
      new InFlightRequestCache(),
      createLoaders(),
    );
    const generationsBySessionKey = (
      service as unknown as { generationsBySessionKey: Map<string, unknown> }
    ).generationsBySessionKey;

    await service.directory(testSession);
    await service.directory(secondSameUserSession);

    service.clearSession(testSession);

    expect(generationsBySessionKey.has(sessionKeyFrom(testSession))).toBe(false);
    expect(generationsBySessionKey.has(sessionKeyFrom(secondSameUserSession))).toBe(true);
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
