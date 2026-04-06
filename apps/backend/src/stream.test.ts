import { afterEach, describe, expect, test } from 'bun:test';
import type { ConversationStreamServerEvent, PresenceState } from '@betterchat/contracts';

import type { BetterChatConfig } from './config';
import { AppError } from './errors';
import { computeSnapshotVersion } from './snapshot-version';
import { ConversationStreamConnection, type UpstreamRealtimeController, type UpstreamRealtimeFactory } from './stream';
import type { SnapshotService } from './snapshot-service';
import type { UpstreamRealtimeCallbacks } from './upstream-realtime';
import type { UpstreamSession } from './session';
import { conversationCapabilitiesFixture, emptyMembershipInbox } from './test-fixtures';
import type { RocketChatClient } from './upstream';

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, reject, resolve };
};

const testConfig: BetterChatConfig = {
  host: '127.0.0.1',
  port: 3200,
  stateDir: '/tmp/betterchat-stream-test-state',
  upstreamUrl: 'http://127.0.0.1:3100',
  upstreamRequestTimeoutMs: 15_000,
  upstreamMediaTimeoutMs: 30_000,
  sessionCookieName: 'betterchat_session',
  sessionCookieSecure: false,
  sessionSecret: 'stream-test-secret',
  sessionTtlSeconds: 3600,
  defaultMessagePageSize: 50,
  maxUploadBytes: 10 * 1024 * 1024,
  staticDir: null,
};

const testSession: UpstreamSession = {
  authToken: 'stream-test-auth-token',
  createdAt: '2026-03-27T00:00:00.000Z',
  displayName: 'Alice Example',
  expiresAt: '2099-03-27T01:00:00.000Z',
  userId: 'alice-id',
  username: 'alice',
};

const conversationId = 'conversation-1';
const threadId = 'thread-1';
const peerUserId = 'peer-1';
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const flushTasks = async (cycles = 16): Promise<void> => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
};

const directoryState = (version: string, counterpartPresence: PresenceState = 'away') => ({
  counterpartUserIdByConversationId: new Map([[conversationId, peerUserId]]),
  snapshot: {
    version,
    entries: [
      {
        conversation: {
          id: conversationId,
          kind: { mode: 'direct' as const },
          title: 'Bob Example',
        },
        membership: {
          listing: 'listed' as const,
          starred: false,
          inbox: emptyMembershipInbox,
        },
        live: {
          counterpartPresence,
        },
      },
    ],
  },
});

const directoryEntryState = (
  title = 'Bob Example',
  counterpartPresence: PresenceState = 'away',
) => ({
  counterpartUserIdByConversationId: new Map([[conversationId, peerUserId]]),
  entry: {
    conversation: {
      id: conversationId,
      kind: { mode: 'direct' as const },
      title,
    },
    membership: {
      listing: 'listed' as const,
      starred: false,
      inbox: emptyMembershipInbox,
    },
    live: {
      counterpartPresence,
    },
  },
});

const conversationState = (version: string) => ({
  counterpartUserId: peerUserId,
  snapshot: {
    version,
    conversation: {
      id: conversationId,
      kind: { mode: 'direct' as const },
      title: 'Bob Example',
    },
    membership: {
      listing: 'listed' as const,
      starred: false,
      inbox: emptyMembershipInbox,
    },
    live: {
      counterpartPresence: 'away' as const,
    },
    capabilities: conversationCapabilitiesFixture(),
  },
});

const conversationTimeline = (version: string) => ({
  version,
  scope: {
    kind: 'conversation' as const,
    conversationId,
  },
  messages: [],
});

const threadTimeline = (version: string) => ({
  version,
  scope: {
    kind: 'thread' as const,
    conversationId,
    threadId,
  },
  threadRoot: {
    id: threadId,
    conversationId,
    authoredAt: '2026-03-27T00:00:00.000Z',
    author: {
      id: 'alice-id',
      displayName: 'Alice Example',
      username: 'alice',
    },
    content: {
      format: 'markdown' as const,
      text: 'root',
    },
    state: {
      edited: false,
      deleted: false,
    },
  },
  messages: [],
});

const activeConnections: ConversationStreamConnection[] = [];

afterEach(() => {
  while (activeConnections.length > 0) {
    activeConnections.pop()?.stop();
  }
});

class FakeUpstreamRealtime implements UpstreamRealtimeController {
  private callbacks?: UpstreamRealtimeCallbacks;
  private readonly roomSubscriptionWaiterByRoomId = new Map<string, Deferred<void>>();
  private readonly readyRoomIds = new Set<string>();
  private readyUserSubscriptions = true;
  private userSubscriptionWaiter = createDeferred<void>();

  readonly setPresenceUserIdsCalls: string[][] = [];
  readonly setTypingRoomWatchCalls: Array<{ active: boolean; roomId: string }> = [];
  readonly unwatchRoomCalls: string[] = [];
  readonly waitForRoomSubscriptionsCalls: string[] = [];
  readonly watchRoomCalls: string[] = [];
  waitForUserSubscriptionsCallCount = 0;

  attachCallbacks(callbacks: UpstreamRealtimeCallbacks): void {
    this.callbacks = callbacks;
  }

  markRoomSubscriptionsPending(nextRoomId: string): void {
    this.readyRoomIds.delete(nextRoomId);
    this.roomSubscriptionWaiterByRoomId.set(nextRoomId, createDeferred<void>());
  }

  markRoomSubscriptionsReady(nextRoomId: string): void {
    this.readyRoomIds.add(nextRoomId);
    this.roomSubscriptionWaiterByRoomId.get(nextRoomId)?.resolve();
  }

  markUserSubscriptionsPending(): void {
    this.readyUserSubscriptions = false;
    this.userSubscriptionWaiter = createDeferred<void>();
  }

  markUserSubscriptionsReady(): void {
    this.readyUserSubscriptions = true;
    this.userSubscriptionWaiter.resolve();
  }

  emitRoomChanged(
    nextRoomId: string,
    reason: 'messages-changed' | 'room-state-changed' | 'room-unavailable',
    options?: { forceResync?: boolean },
  ): void {
    this.callbacks?.onRoomChanged(nextRoomId, reason, options);
  }

  emitSidebarChanged(options?: { conversationId?: string; forceResync?: boolean }): void {
    this.callbacks?.onSidebarChanged(options);
  }

  emitCapabilitiesChanged(): void {
    this.callbacks?.onCapabilitiesChanged();
  }

  emitPresenceChanged(userId: string, presence?: PresenceState): void {
    this.callbacks?.onPresenceChanged({
      userId,
      ...(presence !== undefined ? { presence } : {}),
    });
  }

  emitTypingChanged(nextRoomId: string, participants: string[]): void {
    this.callbacks?.onTypingChanged(nextRoomId, participants);
  }

  async publishTyping(): Promise<void> {
    return undefined;
  }

  setPresenceUserIds(userIds: Iterable<string>): void {
    this.setPresenceUserIdsCalls.push([...userIds]);
  }

  setTypingRoomWatch(nextRoomId: string, active: boolean): void {
    this.setTypingRoomWatchCalls.push({
      roomId: nextRoomId,
      active,
    });
  }

  async start(): Promise<void> {
    return undefined;
  }

  stop(): void {
    return undefined;
  }

  unwatchRoom(nextRoomId: string): void {
    this.unwatchRoomCalls.push(nextRoomId);
  }

  waitForRoomSubscriptions(nextRoomId: string): Promise<void> {
    this.waitForRoomSubscriptionsCalls.push(nextRoomId);
    if (this.readyRoomIds.has(nextRoomId)) {
      return Promise.resolve();
    }

    let deferred = this.roomSubscriptionWaiterByRoomId.get(nextRoomId);
    if (!deferred) {
      deferred = createDeferred<void>();
      this.roomSubscriptionWaiterByRoomId.set(nextRoomId, deferred);
    }

    return deferred.promise;
  }

  waitForUserSubscriptions(): Promise<void> {
    this.waitForUserSubscriptionsCallCount += 1;
    if (this.readyUserSubscriptions) {
      return Promise.resolve();
    }

    return this.userSubscriptionWaiter.promise;
  }

  watchRoom(nextRoomId: string): void {
    this.watchRoomCalls.push(nextRoomId);
  }
}

const createSnapshotServiceStub = (overrides: Partial<SnapshotService>): SnapshotService => {
  const stub: Partial<SnapshotService> = {
    clearSession: () => undefined,
    conversation: async () => conversationState('conversation-v0').snapshot,
    conversationState: async () => conversationState('conversation-v0'),
    conversationTimeline: async () => conversationTimeline('timeline-v0'),
    directoryEntryState: async () => directoryEntryState(),
    directory: async () => directoryState('directory-v0').snapshot,
    directoryState: async () => directoryState('directory-v0'),
    invalidateConversation: () => undefined,
    invalidateDirectory: () => undefined,
    invalidateThread: () => undefined,
    refreshConversationStateWithTimeline: async () => {
      stub.invalidateConversation?.(testSession, conversationId);
      const [nextConversationState, nextTimeline] = await Promise.all([
        stub.conversationState!(testSession, conversationId),
        stub.conversationTimeline!(testSession, conversationId),
      ]);

      return {
        conversationState: nextConversationState,
        timeline: nextTimeline,
      };
    },
    refreshDirectoryState: async () => {
      stub.invalidateDirectory?.(testSession);
      return stub.directoryState!(testSession);
    },
    refreshDirectoryEntryState: async (_session: UpstreamSession, nextConversationId: string) => {
      stub.invalidateDirectory?.(testSession);
      return stub.directoryEntryState!(testSession, nextConversationId);
    },
    refreshThreadConversationTimeline: async (_session: UpstreamSession, nextConversationId: string, nextThreadId: string) => {
      stub.invalidateThread?.(testSession, nextConversationId, nextThreadId);
      return stub.threadConversationTimeline!(testSession, nextConversationId, nextThreadId);
    },
    threadConversationTimeline: async () => threadTimeline('thread-v0'),
    ...overrides,
  };

  return stub as SnapshotService;
};

const createConnection = (
  snapshotService: SnapshotService,
  upstreamRealtime: FakeUpstreamRealtime,
  client?: RocketChatClient,
  options: {
    session?: UpstreamSession;
    sessionKey?: string;
  } = {},
): {
  connection: ConversationStreamConnection;
  events: ConversationStreamServerEvent[];
} => {
  const events: ConversationStreamServerEvent[] = [];
  const resolvedClient = client ?? {
    getUsersPresence: async () => ({
      success: true,
      users: [
        {
          _id: peerUserId,
          status: 'busy',
        },
      ],
      full: true,
    }),
  } as unknown as RocketChatClient;
  const session = options.session ?? testSession;
  const sessionKey = options.sessionKey ?? 'stream-test-session-key';
  const createUpstreamRealtime: UpstreamRealtimeFactory = (callbacks) => {
    upstreamRealtime.attachCallbacks(callbacks);
    return upstreamRealtime;
  };
  const connection = new ConversationStreamConnection(
    testConfig,
    resolvedClient,
    snapshotService,
    sessionKey,
    session,
    (payload) => {
      events.push(JSON.parse(payload) as ConversationStreamServerEvent);
    },
    () => undefined,
    { createUpstreamRealtime },
  );

  activeConnections.push(connection);

  return { connection, events };
};

describe('ConversationStreamConnection', () => {
  test('announces the canonical conversation-stream protocol on ready', async () => {
    const { connection, events } = createConnection(createSnapshotServiceStub({}), new FakeUpstreamRealtime());

    connection.start();
    await flushTasks();

    expect(events).toEqual([
      {
        type: 'ready',
        mode: 'push',
        protocol: 'conversation-stream.v1',
      },
    ]);
  });

  test('emits directory snapshots on watch and on forced sidebar refreshes', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markUserSubscriptionsPending();
    const calls: string[] = [];
    let version = 'directory-v1';
    const snapshotService = createSnapshotServiceStub({
      invalidateDirectory: () => {
        calls.push('invalidateDirectory');
      },
      directoryState: async () => {
        calls.push('directoryState');
        return directoryState(version);
      },
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-directory' }));
    await flushTasks();

    expect(calls).toEqual(['invalidateDirectory', 'directoryState']);
    expect(events).toEqual([
      {
        type: 'directory.resynced',
        snapshot: directoryState('directory-v1').snapshot,
      },
    ]);

    calls.length = 0;
    events.length = 0;
    version = 'directory-v2';
    upstreamRealtime.emitSidebarChanged({ forceResync: true });
    await flushTasks();

    expect(upstreamRealtime.waitForUserSubscriptionsCallCount).toBe(1);
    expect(calls).toEqual([]);
    expect(events).toEqual([]);

    upstreamRealtime.markUserSubscriptionsReady();
    await flushTasks();

    expect(calls).toEqual(['invalidateDirectory', 'directoryState']);
    expect(events).toEqual([
      {
        type: 'directory.resynced',
        snapshot: directoryState('directory-v2').snapshot,
      },
    ]);
  });

  test('does not refresh the directory again when an already watched connection replays the latest version hint', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    const calls: string[] = [];
    const snapshotService = createSnapshotServiceStub({
      invalidateDirectory: () => {
        calls.push('invalidateDirectory');
      },
      directoryState: async () => {
        calls.push('directoryState');
        return directoryState('directory-v1');
      },
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-directory' }));
    await flushTasks();

    expect(calls).toEqual(['invalidateDirectory', 'directoryState']);
    expect(events).toEqual([
      {
        type: 'directory.resynced',
        snapshot: directoryState('directory-v1').snapshot,
      },
    ]);

    calls.length = 0;
    events.length = 0;

    connection.handleIncoming(JSON.stringify({
      type: 'watch-directory',
      directoryVersion: 'directory-v1',
    }));
    await flushTasks();

    expect(calls).toEqual([]);
    expect(events).toEqual([]);
  });

  test('coalesces same-user distinct-session directory refreshes across connections', async () => {
    const firstRealtime = new FakeUpstreamRealtime();
    const secondRealtime = new FakeUpstreamRealtime();
    const secondSession: UpstreamSession = {
      ...testSession,
      authToken: 'stream-test-auth-token-2',
    };
    let refreshCount = 0;
    const snapshotService = createSnapshotServiceStub({
      refreshDirectoryState: async () => {
        refreshCount += 1;
        await delay(20);
        return directoryState('directory-v1');
      },
    });
    const { connection: firstConnection, events: firstEvents } = createConnection(
      snapshotService,
      firstRealtime,
      undefined,
      { session: testSession, sessionKey: 'stream-test-session-key-1' },
    );
    const { connection: secondConnection, events: secondEvents } = createConnection(
      snapshotService,
      secondRealtime,
      undefined,
      { session: secondSession, sessionKey: 'stream-test-session-key-2' },
    );

    firstConnection.handleIncoming(JSON.stringify({ type: 'watch-directory' }));
    secondConnection.handleIncoming(JSON.stringify({ type: 'watch-directory' }));
    await delay(30);
    await flushTasks();

    expect(refreshCount).toBe(1);
    expect(firstEvents).toEqual([
      {
        type: 'directory.resynced',
        snapshot: directoryState('directory-v1').snapshot,
      },
    ]);
    expect(secondEvents).toEqual(firstEvents);
  });

  test('stops directory refreshes after unwatch-directory', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    const calls: string[] = [];
    const snapshotService = createSnapshotServiceStub({
      invalidateDirectory: () => {
        calls.push('invalidateDirectory');
      },
      directoryState: async () => {
        calls.push('directoryState');
        return directoryState('directory-v1');
      },
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-directory' }));
    await flushTasks();
    events.length = 0;
    calls.length = 0;

    connection.handleIncoming(JSON.stringify({ type: 'unwatch-directory' }));
    await flushTasks();
    upstreamRealtime.emitSidebarChanged();
    await flushTasks();

    expect(calls).toEqual([]);
    expect(events).toEqual([]);
    expect(upstreamRealtime.setPresenceUserIdsCalls.at(-1)).toEqual([]);
  });

  test('emits conversation and timeline snapshots when a conversation watch starts', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markRoomSubscriptionsPending(conversationId);
    const calls: string[] = [];
    const snapshotService = createSnapshotServiceStub({
      invalidateConversation: () => {
        calls.push('invalidateConversation');
      },
      conversationState: async () => {
        calls.push('conversationState');
        return conversationState('conversation-v1');
      },
      conversationTimeline: async () => {
        calls.push('conversationTimeline');
        return conversationTimeline('timeline-v1');
      },
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    await flushTasks();

    expect(upstreamRealtime.watchRoomCalls).toEqual([conversationId]);
    expect(upstreamRealtime.waitForRoomSubscriptionsCalls).toEqual([conversationId]);
    expect(calls).toEqual([]);
    expect(events).toEqual([]);

    upstreamRealtime.markRoomSubscriptionsReady(conversationId);
    await flushTasks();

    expect(calls).toEqual(['invalidateConversation', 'conversationState', 'conversationTimeline']);
    expect(events).toEqual([
      {
        type: 'conversation.resynced',
        snapshot: conversationState('conversation-v1').snapshot,
      },
      {
        type: 'timeline.resynced',
        snapshot: conversationTimeline('timeline-v1'),
      },
    ]);
  });

  test('does not refresh an already watched conversation when the client replays the latest conversation and timeline versions', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markRoomSubscriptionsReady(conversationId);
    const calls: string[] = [];
    const snapshotService = createSnapshotServiceStub({
      invalidateConversation: () => {
        calls.push('invalidateConversation');
      },
      conversationState: async () => {
        calls.push('conversationState');
        return conversationState('conversation-v1');
      },
      conversationTimeline: async () => {
        calls.push('conversationTimeline');
        return conversationTimeline('timeline-v1');
      },
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    await flushTasks();

    expect(calls).toEqual(['invalidateConversation', 'conversationState', 'conversationTimeline']);
    expect(events).toEqual([
      {
        type: 'conversation.resynced',
        snapshot: conversationState('conversation-v1').snapshot,
      },
      {
        type: 'timeline.resynced',
        snapshot: conversationTimeline('timeline-v1'),
      },
    ]);

    calls.length = 0;
    events.length = 0;

    connection.handleIncoming(JSON.stringify({
      type: 'watch-conversation',
      conversationId,
      conversationVersion: 'conversation-v1',
      timelineVersion: 'timeline-v1',
    }));
    await flushTasks();

    expect(calls).toEqual([]);
    expect(events).toEqual([]);
  });

  test('does not refresh an already watched thread when the client replays the latest thread version', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markRoomSubscriptionsReady(conversationId);
    const calls: string[] = [];
    const snapshotService = createSnapshotServiceStub({
      invalidateThread: () => {
        calls.push('invalidateThread');
      },
      threadConversationTimeline: async () => {
        calls.push('threadConversationTimeline');
        return threadTimeline('thread-v1');
      },
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-thread', conversationId, threadId }));
    await flushTasks();

    expect(calls).toEqual(['invalidateThread', 'threadConversationTimeline']);
    expect(events).toEqual([
      {
        type: 'thread.resynced',
        snapshot: threadTimeline('thread-v1'),
      },
    ]);

    calls.length = 0;
    events.length = 0;

    connection.handleIncoming(JSON.stringify({
      type: 'watch-thread',
      conversationId,
      threadId,
      threadVersion: 'thread-v1',
    }));
    await flushTasks();

    expect(calls).toEqual([]);
    expect(events).toEqual([]);
  });

  test('seeds dedupe signatures when watch version hints already match the latest snapshots', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markRoomSubscriptionsReady(conversationId);
    const calls: string[] = [];
    const snapshotService = createSnapshotServiceStub({
      invalidateConversation: () => {
        calls.push('invalidateConversation');
      },
      invalidateThread: () => {
        calls.push('invalidateThread');
      },
      conversationState: async () => {
        calls.push('conversationState');
        return conversationState('conversation-v1');
      },
      conversationTimeline: async () => {
        calls.push('conversationTimeline');
        return conversationTimeline('timeline-v1');
      },
      threadConversationTimeline: async () => {
        calls.push('threadConversationTimeline');
        return threadTimeline('thread-v1');
      },
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({
      type: 'watch-conversation',
      conversationId,
      conversationVersion: 'conversation-v1',
      timelineVersion: 'timeline-v1',
    }));
    await flushTasks();
    connection.handleIncoming(JSON.stringify({
      type: 'watch-thread',
      conversationId,
      threadId,
      threadVersion: 'thread-v1',
    }));
    await flushTasks();

    expect(events).toEqual([]);
    calls.length = 0;

    upstreamRealtime.emitRoomChanged(conversationId, 'messages-changed');
    await flushTasks();

    expect(calls).toEqual([
      'invalidateConversation',
      'conversationState',
      'conversationTimeline',
      'invalidateThread',
      'threadConversationTimeline',
    ]);
    expect(events).toEqual([]);
  });

  test('refreshes watched conversations on room message changes', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markRoomSubscriptionsReady(conversationId);
    const calls: string[] = [];
    let currentConversationVersion = 'conversation-v1';
    let currentTimelineVersion = 'timeline-v1';
    const snapshotService = createSnapshotServiceStub({
      invalidateConversation: () => {
        calls.push('invalidateConversation');
      },
      conversationState: async () => {
        calls.push('conversationState');
        return conversationState(currentConversationVersion);
      },
      conversationTimeline: async () => {
        calls.push('conversationTimeline');
        return conversationTimeline(currentTimelineVersion);
      },
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    await flushTasks();
    calls.length = 0;
    events.length = 0;
    currentConversationVersion = 'conversation-v2';
    currentTimelineVersion = 'timeline-v2';

    upstreamRealtime.emitRoomChanged(conversationId, 'messages-changed');
    await flushTasks();

    expect(calls).toEqual(['invalidateConversation', 'conversationState', 'conversationTimeline']);
    expect(events).toEqual([
      {
        type: 'conversation.updated',
        snapshot: conversationState(currentConversationVersion).snapshot,
      },
      {
        type: 'timeline.resynced',
        snapshot: conversationTimeline(currentTimelineVersion),
      },
    ]);
  });

  test('coalesces same-user distinct-session watched conversation refreshes across connections', async () => {
    const firstRealtime = new FakeUpstreamRealtime();
    const secondRealtime = new FakeUpstreamRealtime();
    firstRealtime.markRoomSubscriptionsReady(conversationId);
    secondRealtime.markRoomSubscriptionsReady(conversationId);
    const secondSession: UpstreamSession = {
      ...testSession,
      authToken: 'stream-test-auth-token-2',
    };
    let currentConversationVersion = 'conversation-v1';
    let currentTimelineVersion = 'timeline-v1';
    let refreshCount = 0;
    const snapshotService = createSnapshotServiceStub({
      refreshConversationStateWithTimeline: async () => {
        refreshCount += 1;
        await delay(20);
        return {
          conversationState: conversationState(currentConversationVersion),
          timeline: conversationTimeline(currentTimelineVersion),
        };
      },
    });
    const { connection: firstConnection, events: firstEvents } = createConnection(
      snapshotService,
      firstRealtime,
      undefined,
      { session: testSession, sessionKey: 'stream-test-session-key-1' },
    );
    const { connection: secondConnection, events: secondEvents } = createConnection(
      snapshotService,
      secondRealtime,
      undefined,
      { session: secondSession, sessionKey: 'stream-test-session-key-2' },
    );

    firstConnection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    secondConnection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    await delay(30);
    await flushTasks();

    expect(refreshCount).toBe(1);
    firstEvents.length = 0;
    secondEvents.length = 0;
    currentConversationVersion = 'conversation-v2';
    currentTimelineVersion = 'timeline-v2';

    firstRealtime.emitRoomChanged(conversationId, 'messages-changed');
    secondRealtime.emitRoomChanged(conversationId, 'messages-changed');
    await delay(30);
    await flushTasks();

    expect(refreshCount).toBe(2);
    expect(firstEvents).toEqual([
      {
        type: 'conversation.updated',
        snapshot: conversationState('conversation-v2').snapshot,
      },
      {
        type: 'timeline.resynced',
        snapshot: conversationTimeline('timeline-v2'),
      },
    ]);
    expect(secondEvents).toEqual(firstEvents);
  });

  test('keeps distinct-user watched conversation refreshes independent across connections', async () => {
    const firstRealtime = new FakeUpstreamRealtime();
    const secondRealtime = new FakeUpstreamRealtime();
    firstRealtime.markRoomSubscriptionsReady(conversationId);
    secondRealtime.markRoomSubscriptionsReady(conversationId);
    const otherUserSession: UpstreamSession = {
      ...testSession,
      authToken: 'other-user-auth-token',
      displayName: 'Bob Example',
      userId: 'bob-id',
      username: 'bob',
    };
    let refreshCount = 0;
    const snapshotService = createSnapshotServiceStub({
      refreshConversationStateWithTimeline: async () => {
        refreshCount += 1;
        await delay(20);
        return {
          conversationState: conversationState('conversation-v1'),
          timeline: conversationTimeline('timeline-v1'),
        };
      },
    });
    const { connection: firstConnection } = createConnection(
      snapshotService,
      firstRealtime,
      undefined,
      { session: testSession, sessionKey: 'stream-test-session-key-1' },
    );
    const { connection: secondConnection } = createConnection(
      snapshotService,
      secondRealtime,
      undefined,
      { session: otherUserSession, sessionKey: 'stream-test-session-key-2' },
    );

    firstConnection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    secondConnection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    await delay(30);
    await flushTasks();

    expect(refreshCount).toBe(2);
  });

  test('stops conversation refreshes and typing updates after unwatch-conversation', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markRoomSubscriptionsReady(conversationId);
    const calls: string[] = [];
    const snapshotService = createSnapshotServiceStub({
      invalidateConversation: () => {
        calls.push('invalidateConversation');
      },
      conversationState: async () => {
        calls.push('conversationState');
        return conversationState('conversation-v1');
      },
      conversationTimeline: async () => {
        calls.push('conversationTimeline');
        return conversationTimeline('timeline-v1');
      },
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    await flushTasks();
    events.length = 0;
    calls.length = 0;

    connection.handleIncoming(JSON.stringify({ type: 'unwatch-conversation', conversationId }));
    await flushTasks();

    upstreamRealtime.emitRoomChanged(conversationId, 'messages-changed');
    upstreamRealtime.emitTypingChanged(conversationId, ['bob']);
    await flushTasks();

    expect(upstreamRealtime.unwatchRoomCalls.at(-1)).toBe(conversationId);
    expect(calls).toEqual([]);
    expect(events).toEqual([]);
  });

  test('refreshes watched threads on room-state-only changes as well as room message changes', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markRoomSubscriptionsReady(conversationId);
    const calls: string[] = [];
    let currentConversationVersion = 'conversation-v1';
    let currentTimelineVersion = 'timeline-v1';
    let currentThreadVersion = 'thread-v1';
    const snapshotService = createSnapshotServiceStub({
      invalidateConversation: () => {
        calls.push('invalidateConversation');
      },
      invalidateThread: () => {
        calls.push('invalidateThread');
      },
      threadConversationTimeline: async () => {
        calls.push('threadConversationTimeline');
        return threadTimeline(currentThreadVersion);
      },
      conversationState: async () => {
        calls.push('conversationState');
        return conversationState(currentConversationVersion);
      },
      conversationTimeline: async () => {
        calls.push('conversationTimeline');
        return conversationTimeline(currentTimelineVersion);
      },
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    await flushTasks();
    connection.handleIncoming(JSON.stringify({ type: 'watch-thread', conversationId, threadId }));
    await flushTasks();
    calls.length = 0;
    events.length = 0;
    currentConversationVersion = 'conversation-v2';

    upstreamRealtime.emitRoomChanged(conversationId, 'room-state-changed');
    await flushTasks();

    expect(calls).toEqual([
      'invalidateConversation',
      'conversationState',
      'conversationTimeline',
      'invalidateThread',
      'threadConversationTimeline',
    ]);
    expect(events).toEqual([
      {
        type: 'conversation.updated',
        snapshot: conversationState(currentConversationVersion).snapshot,
      },
    ]);

    calls.length = 0;
    events.length = 0;
    currentConversationVersion = 'conversation-v3';
    currentTimelineVersion = 'timeline-v3';
    currentThreadVersion = 'thread-v2';
    upstreamRealtime.emitRoomChanged(conversationId, 'messages-changed');
    await flushTasks();

    expect(calls).toEqual(['invalidateConversation', 'conversationState', 'conversationTimeline', 'invalidateThread', 'threadConversationTimeline']);
    expect(events).toContainEqual({
      type: 'conversation.updated',
      snapshot: conversationState(currentConversationVersion).snapshot,
    });
    expect(events).toContainEqual({
      type: 'timeline.resynced',
      snapshot: conversationTimeline(currentTimelineVersion),
    });
    expect(events).toContainEqual({
      type: 'thread.resynced',
      snapshot: threadTimeline(currentThreadVersion),
    });
  });

  test('force-resyncs watched directory, conversations, and threads when capabilities change', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markUserSubscriptionsPending();
    upstreamRealtime.markRoomSubscriptionsPending(conversationId);
    const calls: string[] = [];
    let currentDirectoryVersion = 'directory-v1';
    let currentConversationVersion = 'conversation-v1';
    let currentTimelineVersion = 'timeline-v1';
    let currentThreadVersion = 'thread-v1';
    const snapshotService = createSnapshotServiceStub({
      invalidateConversation: () => {
        calls.push('invalidateConversation');
      },
      invalidateDirectory: () => {
        calls.push('invalidateDirectory');
      },
      invalidateThread: () => {
        calls.push('invalidateThread');
      },
      directoryState: async () => {
        calls.push('directoryState');
        return directoryState(currentDirectoryVersion);
      },
      threadConversationTimeline: async () => {
        calls.push('threadConversationTimeline');
        return threadTimeline(currentThreadVersion);
      },
      conversationState: async () => {
        calls.push('conversationState');
        return conversationState(currentConversationVersion);
      },
      conversationTimeline: async () => {
        calls.push('conversationTimeline');
        return conversationTimeline(currentTimelineVersion);
      },
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-directory' }));
    await flushTasks();
    connection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    await flushTasks();
    connection.handleIncoming(JSON.stringify({ type: 'watch-thread', conversationId, threadId }));
    await flushTasks();

    upstreamRealtime.markUserSubscriptionsReady();
    upstreamRealtime.markRoomSubscriptionsReady(conversationId);
    await flushTasks();

    calls.length = 0;
    events.length = 0;
    currentDirectoryVersion = 'directory-v2';
    currentConversationVersion = 'conversation-v2';
    currentTimelineVersion = 'timeline-v2';
    currentThreadVersion = 'thread-v2';

    upstreamRealtime.emitCapabilitiesChanged();
    await flushTasks();

    expect(upstreamRealtime.waitForUserSubscriptionsCallCount).toBe(1);
    expect(upstreamRealtime.waitForRoomSubscriptionsCalls).toEqual([conversationId, conversationId, conversationId, conversationId]);
    expect(calls).toEqual([
      'invalidateDirectory',
      'directoryState',
      'invalidateConversation',
      'conversationState',
      'conversationTimeline',
      'invalidateThread',
      'threadConversationTimeline',
    ]);
    expect(events).toHaveLength(4);
    expect(events).toEqual(expect.arrayContaining([
      {
        type: 'directory.resynced',
        snapshot: directoryState(currentDirectoryVersion).snapshot,
      },
      {
        type: 'conversation.updated',
        snapshot: conversationState(currentConversationVersion).snapshot,
      },
      {
        type: 'timeline.resynced',
        snapshot: conversationTimeline(currentTimelineVersion),
      },
      {
        type: 'thread.resynced',
        snapshot: threadTimeline(currentThreadVersion),
      },
    ]));
  });

  test('patches remembered directory presence and watched conversation presence without refetching the directory', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markRoomSubscriptionsReady(conversationId);
    const calls: string[] = [];
    let directoryPresence: 'away' | 'busy' = 'away';
    const snapshotService = createSnapshotServiceStub({
      invalidateDirectory: () => {
        calls.push('invalidateDirectory');
      },
      directoryState: async () => {
        calls.push('directoryState');
        return directoryState('directory-v1', directoryPresence);
      },
      conversationState: async () => conversationState('conversation-v1'),
    });
    let presenceLookupCount = 0;
    const { connection, events } = createConnection(
      snapshotService,
      upstreamRealtime,
      {
        getUsersPresence: async () => {
          presenceLookupCount += 1;
          return {
            success: true,
            users: [{ _id: peerUserId, status: 'busy' }],
            full: true,
          };
        },
      } as unknown as RocketChatClient,
    );

    connection.handleIncoming(JSON.stringify({ type: 'watch-directory' }));
    await flushTasks();
    connection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    await flushTasks();
    calls.length = 0;
    events.length = 0;
    directoryPresence = 'busy';

    upstreamRealtime.emitPresenceChanged(peerUserId, 'busy');
    await flushTasks();

    const expectedEntry = directoryState('directory-v1', 'busy').snapshot.entries[0]!;
    const expectedVersion = computeSnapshotVersion({
      entries: [expectedEntry],
    });

    expect(calls).toEqual([]);
    expect(presenceLookupCount).toBe(0);
    expect(events).toContainEqual({
      type: 'directory.entry.upsert',
      version: expectedVersion,
      entry: expectedEntry,
    });
    expect(events).toContainEqual({
      type: 'presence.updated',
      conversationId,
      presence: 'busy',
    });
  });

  test('falls back to a presence lookup when the upstream presence stream omits the status', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markRoomSubscriptionsReady(conversationId);
    let presenceLookupCount = 0;
    const { connection, events } = createConnection(
      createSnapshotServiceStub({
        conversationState: async () => conversationState('conversation-v1'),
        directoryState: async () => directoryState('directory-v1'),
      }),
      upstreamRealtime,
      {
        getUsersPresence: async () => {
          presenceLookupCount += 1;
          return {
            success: true,
            users: [{ _id: peerUserId, status: 'busy' }],
            full: true,
          };
        },
      } as unknown as RocketChatClient,
    );

    connection.handleIncoming(JSON.stringify({ type: 'watch-directory' }));
    await flushTasks();
    connection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    await flushTasks();
    events.length = 0;

    upstreamRealtime.emitPresenceChanged(peerUserId);
    await flushTasks();

    const expectedEntry = directoryState('directory-v1', 'busy').snapshot.entries[0]!;
    const expectedVersion = computeSnapshotVersion({
      entries: [expectedEntry],
    });

    expect(presenceLookupCount).toBe(1);
    expect(events).toContainEqual({
      type: 'directory.entry.upsert',
      version: expectedVersion,
      entry: expectedEntry,
    });
    expect(events).toContainEqual({
      type: 'presence.updated',
      conversationId,
      presence: 'busy',
    });
  });

  test('ignores missing-status presence events when the fallback lookup is unavailable', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markRoomSubscriptionsReady(conversationId);
    const { connection, events } = createConnection(
      createSnapshotServiceStub({
        conversationState: async () => conversationState('conversation-v1'),
        directoryState: async () => directoryState('directory-v1'),
      }),
      upstreamRealtime,
      {
        getUsersPresence: async () => {
          throw new AppError('UPSTREAM_UNAVAILABLE', 'presence lookup failed', 503);
        },
      } as unknown as RocketChatClient,
    );

    connection.handleIncoming(JSON.stringify({ type: 'watch-directory' }));
    await flushTasks();
    connection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    await flushTasks();
    events.length = 0;

    upstreamRealtime.emitPresenceChanged(peerUserId);
    await flushTasks();

    expect(events).toEqual([]);
  });

  test('emits directory entry removals and updates instead of full resyncs on normal directory changes', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    let version = 'directory-v1';
    let snapshot = directoryState(version);
    const snapshotService = createSnapshotServiceStub({
      directoryState: async () => snapshot,
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-directory' }));
    await flushTasks();
    events.length = 0;

    version = 'directory-v2';
    snapshot = {
      counterpartUserIdByConversationId: new Map<string, string>(),
      snapshot: {
        version,
        entries: [],
      },
    };

    upstreamRealtime.emitSidebarChanged();
    await flushTasks();

    expect(events).toEqual([
      {
        type: 'directory.entry.remove',
        version: 'directory-v2',
        conversationId,
      },
    ]);
  });

  test('uses targeted directory entry refresh when realtime identifies the changed conversation', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    let refreshDirectoryStateCallCount = 0;
    let refreshDirectoryEntryStateCallCount = 0;
    const snapshotService = createSnapshotServiceStub({
      refreshDirectoryState: async () => {
        refreshDirectoryStateCallCount += 1;
        return directoryState('directory-v1');
      },
      refreshDirectoryEntryState: async () => {
        refreshDirectoryEntryStateCallCount += 1;
        return directoryEntryState('Bob Example (updated)');
      },
    });
    const { connection, events } = createConnection(snapshotService, upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-directory' }));
    await flushTasks();
    events.length = 0;

    upstreamRealtime.emitSidebarChanged({ conversationId });
    await flushTasks();

    expect(refreshDirectoryStateCallCount).toBe(1);
    expect(refreshDirectoryEntryStateCallCount).toBe(1);
    expect(events).toEqual([
      {
        type: 'directory.entry.upsert',
        version: computeSnapshotVersion({
          entries: [directoryEntryState('Bob Example (updated)').entry],
        }),
        entry: directoryEntryState('Bob Example (updated)').entry,
      },
    ]);
  });

  test('does not emit typing updates for thread-only watches', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    const { connection, events } = createConnection(createSnapshotServiceStub({}), upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-thread', conversationId, threadId }));
    await flushTasks();

    upstreamRealtime.emitTypingChanged(conversationId, ['bob']);
    await flushTasks();

    expect(events.filter((event) => event.type === 'typing.updated')).toEqual([]);
  });

  test('emits validation errors for malformed and unsupported commands', async () => {
    const { connection, events } = createConnection(createSnapshotServiceStub({}), new FakeUpstreamRealtime());

    connection.handleIncoming('{not-json');
    connection.handleIncoming(JSON.stringify({ type: 'unsupported-command' }));
    connection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId: '   ' }));
    await flushTasks();

    expect(events).toEqual([
      {
        type: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Conversation stream command must be valid JSON',
      },
      {
        type: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Unsupported conversation stream command',
      },
      {
        type: 'error',
        code: 'VALIDATION_ERROR',
        message: '"conversationId" is required for watch-conversation',
      },
    ]);
  });

  test('drops unavailable watches and asks the client to resync', async () => {
    const upstreamRealtime = new FakeUpstreamRealtime();
    upstreamRealtime.markRoomSubscriptionsReady(conversationId);
    const { connection, events } = createConnection(createSnapshotServiceStub({}), upstreamRealtime);

    connection.handleIncoming(JSON.stringify({ type: 'watch-conversation', conversationId }));
    await flushTasks();
    connection.handleIncoming(JSON.stringify({ type: 'watch-thread', conversationId, threadId }));
    await flushTasks();
    events.length = 0;

    upstreamRealtime.emitRoomChanged(conversationId, 'room-unavailable');
    await flushTasks();

    expect(upstreamRealtime.unwatchRoomCalls).toEqual([conversationId]);
    expect(events).toEqual([
      {
        type: 'resync.required',
        scope: 'conversation',
        conversationId,
      },
      {
        type: 'resync.required',
        scope: 'thread',
        conversationId,
        threadId,
      },
    ]);
  });
});
