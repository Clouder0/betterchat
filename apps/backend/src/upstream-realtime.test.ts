import { describe, expect, test } from 'bun:test';

import type { UpstreamSession } from './session';
import {
  parsePresenceChangedEvent,
  parseStreamCollectionEvent,
  reduceTypingParticipants,
  type UpstreamRealtimeCallbacks,
  UpstreamRealtimeBridge,
} from './upstream-realtime';
import type { RocketChatClient } from './upstream';

const waitForCondition = async (predicate: () => boolean, timeoutMs = 1_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`Condition did not become true within ${timeoutMs}ms`);
};

const createCallbacks = (
  overrides: Partial<UpstreamRealtimeCallbacks> = {},
): UpstreamRealtimeCallbacks => ({
  onCapabilitiesChanged: () => undefined,
  onError: () => undefined,
  onHealthy: () => undefined,
  onMessagesDeleted: () => undefined,
  onPresenceChanged: () => undefined,
  onRoomChanged: () => undefined,
  onSessionInvalidated: () => undefined,
  onSidebarChanged: () => undefined,
  onTypingChanged: () => undefined,
  ...overrides,
});

describe('upstream realtime helpers', () => {
  test('parses DDP stream collection payloads that match BetterChat subscriptions', () => {
    const parsed = parseStreamCollectionEvent({
      collection: 'stream-notify-room',
      fields: {
        args: ['bob', ['user-typing']],
        eventName: 'room-1/user-activity',
      },
      msg: 'changed',
    });

    expect(parsed).toEqual({
      args: ['bob', ['user-typing']],
      collection: 'stream-notify-room',
      eventName: 'room-1/user-activity',
    });
  });

  test('parses notify-all and notify-logged collection payloads for capability invalidation', () => {
    expect(parseStreamCollectionEvent({
      collection: 'stream-notify-all',
      fields: {
        args: ['updated', { _id: 'Threads_enabled', value: false }],
        eventName: 'public-settings-changed',
      },
      msg: 'changed',
    })).toEqual({
      args: ['updated', { _id: 'Threads_enabled', value: false }],
      collection: 'stream-notify-all',
      eventName: 'public-settings-changed',
    });

    expect(parseStreamCollectionEvent({
      collection: 'stream-notify-logged',
      fields: {
        args: [{ _id: 'user-1', roles: ['owner'] }],
        eventName: 'roles-change',
      },
      msg: 'changed',
    })).toEqual({
      args: [{ _id: 'user-1', roles: ['owner'] }],
      collection: 'stream-notify-logged',
      eventName: 'roles-change',
    });
  });

  test('rejects non-stream payloads and malformed collection events', () => {
    expect(parseStreamCollectionEvent({ msg: 'ping' })).toBeUndefined();
    expect(parseStreamCollectionEvent({ collection: 'stream-notify-room', fields: { eventName: 'room-1/user-activity' }, msg: 'changed' })).toBeUndefined();
    expect(parseStreamCollectionEvent({ collection: 'users', fields: { args: [], eventName: 'room-1/user-activity' }, msg: 'changed' })).toBeUndefined();
  });

  test('parses user-presence stream payloads into BetterChat user ids', () => {
    const event = parseStreamCollectionEvent({
      collection: 'stream-user-presence',
      fields: {
        args: [['bob', 3, '']],
        eventName: 'bob-id',
      },
      msg: 'changed',
    });

    expect(event).toBeDefined();
    expect(parsePresenceChangedEvent(event!)).toEqual({
      userId: 'bob-id',
      presence: 'busy',
    });
  });

  test('keeps user-presence events without a status code as fallback lookups', () => {
    const event = parseStreamCollectionEvent({
      collection: 'stream-user-presence',
      fields: {
        args: [['bob']],
        eventName: 'bob-id',
      },
      msg: 'changed',
    });

    expect(event).toBeDefined();
    expect(parsePresenceChangedEvent(event!)).toEqual({
      userId: 'bob-id',
    });
  });

  test('tracks typing participants while ignoring the current user label', () => {
    const started = reduceTypingParticipants({
      actorLabel: 'Bob Example',
      activities: ['user-typing'],
      currentParticipants: [],
      selfLabels: ['alice', 'Alice Example'],
    });
    expect(started).toEqual(['Bob Example']);

    const duplicated = reduceTypingParticipants({
      actorLabel: 'Bob Example',
      activities: ['user-typing'],
      currentParticipants: started,
      selfLabels: ['alice', 'Alice Example'],
    });
    expect(duplicated).toEqual(['Bob Example']);

    const stopped = reduceTypingParticipants({
      actorLabel: 'Bob Example',
      activities: [],
      currentParticipants: duplicated,
      selfLabels: ['alice', 'Alice Example'],
    });
    expect(stopped).toEqual([]);

    const ignoredSelf = reduceTypingParticipants({
      actorLabel: 'Alice Example',
      activities: ['user-typing'],
      currentParticipants: [],
      selfLabels: ['alice', 'Alice Example'],
    });
    expect(ignoredSelf).toEqual([]);
  });

  test('does not report startup ready until upstream login and mandatory subscriptions are acknowledged', async () => {
    const receivedPayloads: unknown[] = [];
    let socketRef: Bun.ServerWebSocket<unknown> | undefined;
    let mandatorySubscriptionIds: string[] = [];
    let sentReady = false;

    const server = Bun.serve({
      port: 0,
      fetch(request, server) {
        if (new URL(request.url).pathname === '/websocket' && server.upgrade(request)) {
          return undefined;
        }

        return new Response('not found', { status: 404 });
      },
      websocket: {
        open(ws) {
          socketRef = ws;
        },
        message(ws, message) {
          const payload = JSON.parse(String(message));
          receivedPayloads.push(payload);

          if (payload.msg === 'connect') {
            ws.send(JSON.stringify({ msg: 'connected', session: 'upstream-ddp-session' }));
            return;
          }

          if (payload.msg === 'method' && payload.method === 'login') {
            ws.send(JSON.stringify({ msg: 'result', id: payload.id, result: { tokenExpires: null } }));
            return;
          }

          if (payload.msg === 'sub') {
            mandatorySubscriptionIds.push(payload.id);

            if (mandatorySubscriptionIds.length === 6 && !sentReady) {
              sentReady = true;
              setTimeout(() => {
                ws.send(JSON.stringify({ msg: 'ready', subs: mandatorySubscriptionIds }));
              }, 40);
            }
          }
        },
      },
    });

    const callbacks = createCallbacks();
    const session: UpstreamSession = {
      userId: 'alice-id',
      authToken: 'auth-token',
      username: 'alice',
      displayName: 'Alice Example',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const bridge = new UpstreamRealtimeBridge(
      `http://127.0.0.1:${server.port}`,
      {
        getMe: async () => ({ _id: 'alice-id', success: true, username: 'alice' }),
      } as unknown as RocketChatClient,
      session,
      callbacks,
    );

    try {
      const startPromise = bridge.start();
      const resolvedBeforeReady = await Promise.race([
        startPromise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
      ]);

      expect(resolvedBeforeReady).toBe(false);

      await startPromise;

      expect(receivedPayloads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ msg: 'connect', version: '1' }),
          expect.objectContaining({ method: 'login', msg: 'method' }),
          expect.objectContaining({ msg: 'sub', name: 'stream-notify-user' }),
          expect.objectContaining({ msg: 'sub', name: 'stream-notify-all' }),
          expect.objectContaining({ msg: 'sub', name: 'stream-notify-logged' }),
        ]),
      );
      expect(mandatorySubscriptionIds).toHaveLength(6);
      expect(socketRef).toBeDefined();
    } finally {
      bridge.stop();
      await server.stop(true);
    }
  });

  test('subscribes room message watches with the Rocket.Chat stream-room-messages parameter shape', async () => {
    const receivedPayloads: Array<Record<string, unknown>> = [];
    let mandatorySubscriptionIds: string[] = [];
    let roomSubscriptionIds: string[] = [];
    let roomWatchStarted = false;

    const server = Bun.serve({
      port: 0,
      fetch(request, server) {
        if (new URL(request.url).pathname === '/websocket' && server.upgrade(request)) {
          return undefined;
        }

        return new Response('not found', { status: 404 });
      },
      websocket: {
        message(ws, message) {
          const payload = JSON.parse(String(message)) as Record<string, unknown>;
          receivedPayloads.push(payload);

          if (payload.msg === 'connect') {
            ws.send(JSON.stringify({ msg: 'connected', session: 'upstream-ddp-session' }));
            return;
          }

          if (payload.msg === 'method' && payload.method === 'login') {
            ws.send(JSON.stringify({ msg: 'result', id: payload.id, result: { tokenExpires: null } }));
            return;
          }

          if (payload.msg === 'sub' && !roomWatchStarted) {
            mandatorySubscriptionIds.push(String(payload.id));
            if (mandatorySubscriptionIds.length === 6) {
              ws.send(JSON.stringify({ msg: 'ready', subs: mandatorySubscriptionIds }));
              setTimeout(() => {
                roomWatchStarted = true;
                bridge.watchRoom('room-1');
              }, 0);
            }
            return;
          }

          if (payload.msg === 'sub' && roomWatchStarted) {
            roomSubscriptionIds.push(String(payload.id));
            if (roomSubscriptionIds.length === 4) {
              ws.send(JSON.stringify({ msg: 'ready', subs: roomSubscriptionIds }));
            }
          }
        },
      },
    });

    const callbacks = createCallbacks();
    const session: UpstreamSession = {
      userId: 'alice-id',
      authToken: 'auth-token',
      username: 'alice',
      displayName: 'Alice Example',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const bridge = new UpstreamRealtimeBridge(
      `http://127.0.0.1:${server.port}`,
      {
        getMe: async () => ({ _id: 'alice-id', success: true, username: 'alice' }),
      } as unknown as RocketChatClient,
      session,
      callbacks,
    );

    try {
      bridge.setTypingRoomWatch('room-1', true);
      await bridge.start();
      await waitForCondition(() => roomSubscriptionIds.length === 4);

      const roomMessagesSubscription = receivedPayloads.find(
        (payload) => payload.msg === 'sub' && payload.name === 'stream-room-messages',
      );
      const bulkDeleteSubscription = receivedPayloads.find(
        (payload) =>
          payload.msg === 'sub'
          && payload.name === 'stream-notify-room'
          && JSON.stringify(payload.params) === JSON.stringify([
            'room-1/deleteMessageBulk',
            {
              args: [undefined],
              useCollection: false,
            },
          ]),
      );

      expect(roomMessagesSubscription).toBeDefined();
      expect(roomMessagesSubscription?.params).toEqual(['room-1', false]);
      expect(bulkDeleteSubscription).toBeDefined();
    } finally {
      bridge.stop();
      await server.stop(true);
    }
  });

  test('treats deleteMessageBulk room events as message invalidations', async () => {
    const roomEvents: Array<{ reason: string; roomId: string }> = [];
    let mandatorySubscriptionIds: string[] = [];
    let roomSubscriptionIds: string[] = [];
    let roomWatchStarted = false;
    let socketRef: Bun.ServerWebSocket<unknown> | undefined;

    const server = Bun.serve({
      port: 0,
      fetch(request, server) {
        if (new URL(request.url).pathname === '/websocket' && server.upgrade(request)) {
          return undefined;
        }

        return new Response('not found', { status: 404 });
      },
      websocket: {
        open(ws) {
          socketRef = ws;
        },
        message(ws, message) {
          const payload = JSON.parse(String(message)) as Record<string, unknown>;

          if (payload.msg === 'connect') {
            ws.send(JSON.stringify({ msg: 'connected', session: 'upstream-ddp-session' }));
            return;
          }

          if (payload.msg === 'method' && payload.method === 'login') {
            ws.send(JSON.stringify({ msg: 'result', id: payload.id, result: { tokenExpires: null } }));
            return;
          }

          if (payload.msg === 'sub' && !roomWatchStarted) {
            mandatorySubscriptionIds.push(String(payload.id));
            if (mandatorySubscriptionIds.length === 6) {
              ws.send(JSON.stringify({ msg: 'ready', subs: mandatorySubscriptionIds }));
              setTimeout(() => {
                roomWatchStarted = true;
                bridge.watchRoom('room-1');
              }, 0);
            }
            return;
          }

          if (payload.msg === 'sub' && roomWatchStarted) {
            roomSubscriptionIds.push(String(payload.id));
            if (roomSubscriptionIds.length === 3) {
              ws.send(JSON.stringify({ msg: 'ready', subs: roomSubscriptionIds }));
            }
          }
        },
      },
    });

    const session: UpstreamSession = {
      userId: 'alice-id',
      authToken: 'auth-token',
      username: 'alice',
      displayName: 'Alice Example',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const bridge = new UpstreamRealtimeBridge(
      `http://127.0.0.1:${server.port}`,
      {
        getMe: async () => ({ _id: 'alice-id', success: true, username: 'alice' }),
      } as unknown as RocketChatClient,
      session,
      createCallbacks({
        onRoomChanged: (roomId, reason) => {
          roomEvents.push({ roomId, reason });
        },
      }),
    );

    try {
      await bridge.start();
      await waitForCondition(() => roomSubscriptionIds.length === 3);

      socketRef?.send(JSON.stringify({
        msg: 'changed',
        collection: 'stream-notify-room',
        fields: {
          eventName: 'room-1/deleteMessageBulk',
          args: [{ _id: 'bulk-1' }],
        },
      }));

      await waitForCondition(() => roomEvents.length === 1);
      expect(roomEvents).toEqual([{ roomId: 'room-1', reason: 'messages-changed' }]);
    } finally {
      bridge.stop();
      await server.stop(true);
    }
  });

  test('emits sidebar invalidations with room ids for notify-user subscription and room changes', async () => {
    const sidebarEvents: Array<{ conversationId?: string }> = [];
    let mandatorySubscriptionIds: string[] = [];
    let socketRef: Bun.ServerWebSocket<unknown> | undefined;

    const server = Bun.serve({
      port: 0,
      fetch(request, server) {
        if (new URL(request.url).pathname === '/websocket' && server.upgrade(request)) {
          return undefined;
        }

        return new Response('not found', { status: 404 });
      },
      websocket: {
        open(ws) {
          socketRef = ws;
        },
        message(ws, message) {
          const payload = JSON.parse(String(message));

          if (payload.msg === 'connect') {
            ws.send(JSON.stringify({ msg: 'connected', session: 'upstream-ddp-session' }));
            return;
          }

          if (payload.msg === 'method' && payload.method === 'login') {
            ws.send(JSON.stringify({ msg: 'result', id: payload.id, result: { tokenExpires: null } }));
            return;
          }

          if (payload.msg === 'sub') {
            mandatorySubscriptionIds.push(String(payload.id));
            if (mandatorySubscriptionIds.length === 6) {
              ws.send(JSON.stringify({ msg: 'ready', subs: mandatorySubscriptionIds }));
            }
          }
        },
      },
    });

    const session: UpstreamSession = {
      userId: 'alice-id',
      authToken: 'auth-token',
      username: 'alice',
      displayName: 'Alice Example',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const bridge = new UpstreamRealtimeBridge(
      `http://127.0.0.1:${server.port}`,
      {
        getMe: async () => ({ _id: 'alice-id', success: true, username: 'alice' }),
      } as unknown as RocketChatClient,
      session,
      createCallbacks({
        onSidebarChanged: (options) => {
          sidebarEvents.push(options ?? {});
        },
      }),
    );

    try {
      await bridge.start();

      socketRef?.send(JSON.stringify({
        msg: 'changed',
        collection: 'stream-notify-user',
        fields: {
          eventName: `${session.userId}/subscriptions-changed`,
          args: ['updated', { rid: 'room-1' }],
        },
      }));
      socketRef?.send(JSON.stringify({
        msg: 'changed',
        collection: 'stream-notify-user',
        fields: {
          eventName: `${session.userId}/rooms-changed`,
          args: ['updated', { _id: 'room-2' }],
        },
      }));

      await waitForCondition(() => sidebarEvents.length === 2);
      expect(sidebarEvents).toEqual([
        { conversationId: 'room-1' },
        { conversationId: 'room-2' },
      ]);
    } finally {
      bridge.stop();
      await server.stop(true);
    }
  });

  test('emits capability invalidations for permissions, roles, and relevant public settings only', async () => {
    const capabilityEvents: string[] = [];
    let mandatorySubscriptionIds: string[] = [];
    let socketRef: Bun.ServerWebSocket<unknown> | undefined;

    const server = Bun.serve({
      port: 0,
      fetch(request, server) {
        if (new URL(request.url).pathname === '/websocket' && server.upgrade(request)) {
          return undefined;
        }

        return new Response('not found', { status: 404 });
      },
      websocket: {
        open(ws) {
          socketRef = ws;
        },
        message(ws, message) {
          const payload = JSON.parse(String(message));

          if (payload.msg === 'connect') {
            ws.send(JSON.stringify({ msg: 'connected', session: 'upstream-ddp-session' }));
            return;
          }

          if (payload.msg === 'method' && payload.method === 'login') {
            ws.send(JSON.stringify({ msg: 'result', id: payload.id, result: { tokenExpires: null } }));
            return;
          }

          if (payload.msg === 'sub') {
            mandatorySubscriptionIds.push(String(payload.id));
            if (mandatorySubscriptionIds.length === 6) {
              ws.send(JSON.stringify({ msg: 'ready', subs: mandatorySubscriptionIds }));
            }
          }
        },
      },
    });

    const session: UpstreamSession = {
      userId: 'alice-id',
      authToken: 'auth-token',
      username: 'alice',
      displayName: 'Alice Example',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const bridge = new UpstreamRealtimeBridge(
      `http://127.0.0.1:${server.port}`,
      {
        getMe: async () => ({ _id: 'alice-id', success: true, username: 'alice' }),
      } as unknown as RocketChatClient,
      session,
      createCallbacks({
        onCapabilitiesChanged: () => {
          capabilityEvents.push('capabilities');
        },
      }),
    );

    try {
      await bridge.start();

      socketRef?.send(JSON.stringify({
        msg: 'changed',
        collection: 'stream-notify-all',
        fields: {
          eventName: 'public-settings-changed',
          args: ['updated', { _id: 'Threads_enabled', value: false }],
        },
      }));
      socketRef?.send(JSON.stringify({
        msg: 'changed',
        collection: 'stream-notify-all',
        fields: {
          eventName: 'public-settings-changed',
          args: ['updated', { _id: 'Site_Url', value: 'https://example.test' }],
        },
      }));
      socketRef?.send(JSON.stringify({
        msg: 'changed',
        collection: 'stream-notify-logged',
        fields: {
          eventName: 'permissions-changed',
          args: ['updated', { _id: 'post-readonly' }],
        },
      }));
      socketRef?.send(JSON.stringify({
        msg: 'changed',
        collection: 'stream-notify-logged',
        fields: {
          eventName: 'roles-change',
          args: [{ _id: 'user-1', roles: ['owner'] }],
        },
      }));

      await waitForCondition(() => capabilityEvents.length === 3);
      expect(capabilityEvents).toEqual(['capabilities', 'capabilities', 'capabilities']);
    } finally {
      bridge.stop();
      await server.stop(true);
    }
  });
});
