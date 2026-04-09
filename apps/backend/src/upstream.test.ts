import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { AppError } from './errors';
import type { UpstreamSession } from './session';
import { RocketChatClient } from './upstream';

const servers: Array<ReturnType<typeof createServer>> = [];
const firstHeaderValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const listen = async (
  handler: (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => void,
): Promise<{ close: () => Promise<void>; url: string }> => {
  const server = createServer(handler);
  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to obtain test server address');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) {
            resolve();
            return;
          }

          server.close(() => resolve());
        }),
    ),
  );
});

const readRequestBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
};

const delay = (timeoutMs: number) => new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));

describe('RocketChat upstream transport', () => {
  const session: UpstreamSession = {
    authToken: 'auth-token',
    createdAt: '2026-03-25T00:00:00.000Z',
    displayName: 'Alice Example',
    expiresAt: '2026-03-26T00:00:00.000Z',
    userId: 'alice-id',
    username: 'alice',
  };

  test('times out stalled JSON requests explicitly', async () => {
    const server = await listen((_request, _response) => {
      // Keep the socket open without responding.
    });
    const client = new RocketChatClient(server.url, {
      requestTimeoutMs: 50,
      mediaTimeoutMs: 50,
    });

    await expect(
      client.requestJson({
        path: '/api/v1/hang',
      }),
    ).rejects.toEqual(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat request timed out', 503));
  });

  test('times out stalled multipart requests explicitly', async () => {
    const server = await listen((_request, _response) => {
      // Keep the socket open without responding.
    });
    const client = new RocketChatClient(server.url, {
      requestTimeoutMs: 50,
      mediaTimeoutMs: 50,
    });
    const formData = new FormData();
    formData.set('file', new File([Buffer.from('abc')], 'pixel.png', { type: 'image/png' }));

    await expect(
      client.requestForm({
        path: '/api/v1/hang-form',
        formData,
      }),
    ).rejects.toEqual(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat request timed out', 503));
  });

  test('times out stalled media reads explicitly', async () => {
    const server = await listen((_request, _response) => {
      // Keep the socket open without responding.
    });
    const client = new RocketChatClient(server.url, {
      requestTimeoutMs: 50,
      mediaTimeoutMs: 50,
    });

    await expect(client.fetchMedia('/file-upload/hang.png')).rejects.toEqual(
      new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat media request timed out', 503),
    );
  });

  test('issues HEAD media requests explicitly when requested', async () => {
    let observedMethod: string | undefined;
    const server = await listen((request, response) => {
      observedMethod = request.method;
      response.statusCode = 200;
      response.setHeader('content-type', 'image/png');
      response.setHeader('content-length', '3');
      response.end();
    });
    const client = new RocketChatClient(server.url);

    const response = await client.fetchMedia('/file-upload/pixel.png', session, undefined, 'HEAD');

    expect(observedMethod).toBe('HEAD');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  test('rejects successful responses with malformed JSON payloads explicitly', async () => {
    const server = await listen((_request, response) => {
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end('{');
    });
    const client = new RocketChatClient(server.url);

    await expect(client.getPublicInfo()).rejects.toEqual(
      new AppError('UNSUPPORTED_UPSTREAM_BEHAVIOR', 'Rocket.Chat returned an invalid JSON response payload', 502, {
        method: 'GET',
        path: '/api/info',
        status: 200,
      }),
    );
  });

  test('rejects successful responses with empty payloads explicitly', async () => {
    const server = await listen((_request, response) => {
      response.statusCode = 200;
      response.end('');
    });
    const client = new RocketChatClient(server.url);

    await expect(client.getPublicInfo()).rejects.toEqual(
      new AppError('UNSUPPORTED_UPSTREAM_BEHAVIOR', 'Rocket.Chat returned an empty response payload', 502, {
        method: 'GET',
        path: '/api/info',
        status: 200,
      }),
    );
  });

  test('probes the upstream realtime websocket with a DDP handshake', async () => {
    const receivedPayloads: unknown[] = [];
    let socketOpened = false;

    const server = Bun.serve({
      port: 0,
      fetch(request, server) {
        if (new URL(request.url).pathname === '/websocket' && server.upgrade(request)) {
          return undefined;
        }

        return new Response('not found', { status: 404 });
      },
      websocket: {
        open() {
          socketOpened = true;
        },
        message(ws, message) {
          const payload = JSON.parse(String(message));
          receivedPayloads.push(payload);

          if (payload.msg === 'connect') {
            ws.send(JSON.stringify({ msg: 'connected', session: 'realtime-session' }));
          }
        },
      },
    });

    const client = new RocketChatClient(`http://127.0.0.1:${server.port}`, {
      requestTimeoutMs: 250,
    });

    try {
      await expect(client.probeRealtime()).resolves.toBeUndefined();
      expect(socketOpened).toBe(true);
      expect(receivedPayloads).toContainEqual({
        msg: 'connect',
        support: ['1', 'pre2', 'pre1'],
        version: '1',
      });
    } finally {
      await server.stop(true);
    }
  });

  test('keeps server-error fallback handling when unsuccessful responses are not JSON', async () => {
    const server = await listen((_request, response) => {
      response.statusCode = 500;
      response.setHeader('content-type', 'text/html');
      response.end('<html>fail</html>');
    });
    const client = new RocketChatClient(server.url);

    await expect(client.getPublicInfo()).rejects.toEqual(
      new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat is unavailable', 503),
    );
  });

  test('keeps unauthenticated login failures as upstream rejections', async () => {
    const server = await listen((_request, response) => {
      response.statusCode = 401;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ status: 'error', message: 'Unauthorized' }));
    });
    const client = new RocketChatClient(server.url);

    await expect(client.login({ login: 'alice', password: 'wrong-password' })).rejects.toEqual(
      new AppError('UPSTREAM_REJECTED', 'Unauthorized', 401),
    );
  });

  test('preserves authenticated upstream permission failures as upstream rejections', async () => {
    const server = await listen((_request, response) => {
      response.statusCode = 403;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ success: false, message: 'You must be logged in to do this.' }));
    });
    const client = new RocketChatClient(server.url);

    await expect(client.getRoomInfo(session, 'room-1')).rejects.toEqual(
      new AppError('UPSTREAM_REJECTED', 'You must be logged in to do this.', 403),
    );
  });

  test('does not swallow authenticated auth failures as missing messages', async () => {
    const server = await listen((_request, response) => {
      response.statusCode = 401;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ success: false, error: 'You must be logged in to do this.' }));
    });
    const client = new RocketChatClient(server.url);

    await expect(client.findMessage(session, 'message-1')).rejects.toEqual(
      new AppError('UNAUTHENTICATED', 'You must be logged in to do this.', 401),
    );
  });

  test('still treats real missing messages as missing', async () => {
    const server = await listen((_request, response) => {
      response.statusCode = 404;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ success: false, error: 'Message not found' }));
    });
    const client = new RocketChatClient(server.url);

    await expect(client.findMessage(session, 'missing-message')).resolves.toBeUndefined();
  });

  test('preserves authenticated media permission failures as upstream rejections', async () => {
    const server = await listen((_request, response) => {
      response.statusCode = 403;
      response.end('');
    });
    const client = new RocketChatClient(server.url);

    await expect(client.fetchMedia('/file-upload/protected.png', session)).rejects.toEqual(
      new AppError('UPSTREAM_REJECTED', 'Rocket.Chat rejected the media request', 403),
    );
  });

  test('forwards media range and cache validator headers upstream', async () => {
    let observedHeaders: Record<string, string | undefined> | undefined;

    const server = await listen((request, response) => {
      observedHeaders = {
        'if-modified-since': firstHeaderValue(request.headers['if-modified-since']),
        'if-none-match': firstHeaderValue(request.headers['if-none-match']),
        'if-range': firstHeaderValue(request.headers['if-range']),
        range: firstHeaderValue(request.headers.range),
        'x-auth-token': firstHeaderValue(request.headers['x-auth-token']),
        'x-user-id': firstHeaderValue(request.headers['x-user-id']),
      };
      response.statusCode = 206;
      response.setHeader('accept-ranges', 'bytes');
      response.setHeader('content-range', 'bytes 0-2/9');
      response.end('abc');
    });
    const client = new RocketChatClient(server.url);

    const response = await client.fetchMedia(
      '/file-upload/range.png',
      session,
      new Headers({
        'if-modified-since': 'Thu, 27 Mar 2026 01:02:03 GMT',
        'if-none-match': '"etag-1"',
        'if-range': '"etag-1"',
        range: 'bytes=0-2',
      }),
    );

    expect(response.status).toBe(206);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-range')).toBe('bytes 0-2/9');
    expect(observedHeaders).toEqual({
      'if-modified-since': 'Thu, 27 Mar 2026 01:02:03 GMT',
      'if-none-match': '"etag-1"',
      'if-range': '"etag-1"',
      range: 'bytes=0-2',
      'x-auth-token': 'auth-token',
      'x-user-id': 'alice-id',
    });
  });

  test('reuses short-lived session and public metadata reads within the cache TTL', async () => {
    const requestCountByPath = new Map<string, number>();

    const server = await listen((request, response) => {
      const path = request.url ?? '';
      requestCountByPath.set(path, (requestCountByPath.get(path) ?? 0) + 1);
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');

      if (path === '/api/v1/me') {
        response.end(JSON.stringify({
          success: true,
          _id: 'alice-id',
          username: 'alice',
          name: 'Alice Example',
          roles: ['user'],
        }));
        return;
      }

      if (path === '/api/v1/permissions.listAll') {
        response.end(JSON.stringify({
          success: true,
          update: [{ _id: 'view-room-administration', roles: ['admin'] }],
          remove: [],
        }));
        return;
      }

      if (path.startsWith('/api/v1/settings.public?')) {
        response.end(JSON.stringify({
          success: true,
          settings: [
            { _id: 'Message_AllowDeleting', value: true },
            { _id: 'Threads_enabled', value: true },
          ],
        }));
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ success: false, error: 'not found' }));
    });
    const client = new RocketChatClient(server.url, {
      metadataCacheTtlMs: 1_000,
    });

    await client.getMe(session);
    await client.getMe(session);
    await client.getPermissionDefinitions(session);
    await client.getPermissionDefinitions(session);
    await client.getPublicSettings(['Threads_enabled', 'Message_AllowDeleting']);
    await client.getPublicSettings(['Message_AllowDeleting', 'Threads_enabled']);

    expect(requestCountByPath.get('/api/v1/me')).toBe(1);
    expect(requestCountByPath.get('/api/v1/permissions.listAll')).toBe(1);
    expect(
      [...requestCountByPath.entries()].find(([path]) => path.startsWith('/api/v1/settings.public?')),
    ).toEqual([
      expect.stringContaining('/api/v1/settings.public?'),
      1,
    ]);
  });

  test('refreshes short-lived metadata after the cache TTL expires', async () => {
    const requestCountByPath = new Map<string, number>();

    const server = await listen((request, response) => {
      const path = request.url ?? '';
      requestCountByPath.set(path, (requestCountByPath.get(path) ?? 0) + 1);
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');

      if (path === '/api/v1/permissions.listAll') {
        response.end(JSON.stringify({
          success: true,
          update: [{ _id: 'view-room-administration', roles: ['admin'] }],
          remove: [],
        }));
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ success: false, error: 'not found' }));
    });
    const client = new RocketChatClient(server.url, {
      metadataCacheTtlMs: 10,
    });

    await client.getPermissionDefinitions(session);
    await delay(25);
    await client.getPermissionDefinitions(session);

    expect(requestCountByPath.get('/api/v1/permissions.listAll')).toBe(2);
  });

  test('reuses stable metadata across distinct session tokens when the scope is global or the user identity matches', async () => {
    const requestCountByPath = new Map<string, number>();
    const secondSession: UpstreamSession = {
      ...session,
      authToken: 'auth-token-2',
    };

    const server = await listen((request, response) => {
      const path = request.url ?? '';
      requestCountByPath.set(path, (requestCountByPath.get(path) ?? 0) + 1);
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');

      if (path === '/api/v1/me') {
        response.end(JSON.stringify({
          success: true,
          _id: 'alice-id',
          username: 'alice',
          name: 'Alice Example',
          roles: ['user'],
        }));
        return;
      }

      if (path === '/api/v1/permissions.listAll') {
        response.end(JSON.stringify({
          success: true,
          update: [{ _id: 'view-room-administration', roles: ['admin'] }],
          remove: [],
        }));
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ success: false, error: 'not found' }));
    });
    const client = new RocketChatClient(server.url, {
      metadataCacheTtlMs: 1_000,
    });

    await client.getMe(session);
    await client.getMe(secondSession);
    await client.getPermissionDefinitions(session);
    await client.getPermissionDefinitions(secondSession);

    expect(requestCountByPath.get('/api/v1/me')).toBe(1);
    expect(requestCountByPath.get('/api/v1/permissions.listAll')).toBe(1);
  });

  test('does not reuse user-scoped metadata across different users', async () => {
    const requestCountByPath = new Map<string, number>();
    const otherUserSession: UpstreamSession = {
      ...session,
      authToken: 'other-auth-token',
      userId: 'bob-id',
      username: 'bob',
      displayName: 'Bob Example',
    };

    const server = await listen((request, response) => {
      const path = request.url ?? '';
      requestCountByPath.set(path, (requestCountByPath.get(path) ?? 0) + 1);
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');

      if (path === '/api/v1/me') {
        const userId = firstHeaderValue(request.headers['x-user-id']);
        response.end(JSON.stringify({
          success: true,
          _id: userId,
          username: userId === 'alice-id' ? 'alice' : 'bob',
          name: userId === 'alice-id' ? 'Alice Example' : 'Bob Example',
          roles: ['user'],
        }));
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ success: false, error: 'not found' }));
    });
    const client = new RocketChatClient(server.url, {
      metadataCacheTtlMs: 1_000,
    });

    const [alice, bob] = await Promise.all([
      client.getMe(session),
      client.getMe(otherUserSession),
    ]);

    expect(alice._id).toBe('alice-id');
    expect(bob._id).toBe('bob-id');
    expect(requestCountByPath.get('/api/v1/me')).toBe(2);
  });

  test('serializes room sends with quote placeholders on the public send path', async () => {
    let requestBody: unknown;

    const server = await listen(async (request, response) => {
      requestBody = JSON.parse(await readRequestBody(request));
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          success: true,
          message: {
            _id: 'message-1',
            rid: 'room-1',
            msg: 'normalized',
            ts: '2026-03-25T00:00:00.000Z',
            u: {
              _id: 'alice-id',
              username: 'alice',
              name: 'Alice Example',
            },
          },
        }),
      );
    });
    const client = new RocketChatClient(server.url);

    await client.sendRoomMessage(session, {
      messageId: 'submission-1',
      roomId: 'room-1',
      text: 'hello',
      quoteMessageLink: 'http://127.0.0.1:3100/channel/general?msg=parent-1',
    });

    expect(requestBody).toEqual({
      message: {
        _id: 'submission-1',
        rid: 'room-1',
        msg: '[ ](http://127.0.0.1:3100/channel/general?msg=parent-1)\nhello',
      },
    });
  });

  test('serializes explicit thread sends with broadcast control', async () => {
    const requestBodies: unknown[] = [];

    const server = await listen(async (request, response) => {
      requestBodies.push(JSON.parse(await readRequestBody(request)));
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          success: true,
          message: {
            _id: 'message-1',
            rid: 'room-1',
            msg: 'normalized',
            ts: '2026-03-25T00:00:00.000Z',
            tmid: 'thread-1',
            u: {
              _id: 'alice-id',
              username: 'alice',
              name: 'Alice Example',
            },
          },
        }),
      );
    });
    const client = new RocketChatClient(server.url);

    await client.sendThreadMessage(session, {
      messageId: 'submission-thread-1',
      roomId: 'room-1',
      threadId: 'thread-1',
      text: 'thread only',
      broadcastToRoom: false,
    });
    await client.sendThreadMessage(session, {
      messageId: 'submission-thread-2',
      roomId: 'room-1',
      threadId: 'thread-1',
      text: 'broadcast',
      broadcastToRoom: true,
    });

    expect(requestBodies).toEqual([
      {
        message: {
          _id: 'submission-thread-1',
          rid: 'room-1',
          msg: 'thread only',
          tmid: 'thread-1',
        },
      },
      {
        message: {
          _id: 'submission-thread-2',
          rid: 'room-1',
          msg: 'broadcast',
          tmid: 'thread-1',
          tshow: true,
        },
      },
    ]);
  });

  test('serializes message updates with explicit quote preservation and removal semantics', async () => {
    const requestBodies: unknown[] = [];

    const server = await listen(async (request, response) => {
      requestBodies.push(JSON.parse(await readRequestBody(request)));
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          success: true,
          message: {
            _id: 'message-1',
            rid: 'room-1',
            msg: 'normalized',
            ts: '2026-03-25T00:00:00.000Z',
            u: {
              _id: 'alice-id',
              username: 'alice',
              name: 'Alice Example',
            },
          },
        }),
      );
    });
    const client = new RocketChatClient(server.url);

    await client.updateMessage(session, {
      roomId: 'room-1',
      messageId: 'message-1',
      text: 'edited with quote',
      quoteMessageLink: 'http://127.0.0.1:3100/channel/general?msg=parent-1',
    });
    await client.updateMessage(session, {
      roomId: 'room-1',
      messageId: 'message-1',
      text: 'edited without quote',
      quoteMessageLink: null,
    });

    expect(requestBodies).toEqual([
      {
        roomId: 'room-1',
        msgId: 'message-1',
        text: '[ ](http://127.0.0.1:3100/channel/general?msg=parent-1)\nedited with quote',
      },
      {
        roomId: 'room-1',
        msgId: 'message-1',
        text: 'edited without quote',
      },
    ]);
  });

  test('loads permission definitions through the authenticated permissions.listAll endpoint', async () => {
    let observedHeaders: Record<string, string | undefined> | undefined;

    const server = await listen((request, response) => {
      observedHeaders = {
        'x-auth-token': firstHeaderValue(request.headers['x-auth-token']),
        'x-user-id': firstHeaderValue(request.headers['x-user-id']),
      };
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          success: true,
          update: [
            {
              _id: 'post-readonly',
              roles: ['admin', 'owner'],
            },
          ],
          remove: [],
        }),
      );
    });
    const client = new RocketChatClient(server.url);

    await expect(client.getPermissionDefinitions(session)).resolves.toEqual({
      success: true,
      update: [
        {
          _id: 'post-readonly',
          roles: ['admin', 'owner'],
        },
      ],
      remove: [],
    });
    expect(observedHeaders).toEqual({
      'x-auth-token': 'auth-token',
      'x-user-id': 'alice-id',
    });
  });

  test('loads channel and private-group participants through rooms.membersOrderedByRole', async () => {
    let observedPath = '';

    const server = await listen((request, response) => {
      observedPath = request.url || '';
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        success: true,
        members: [],
        count: 0,
        offset: 5,
        total: 0,
      }));
    });
    const client = new RocketChatClient(server.url);

    await expect(client.getConversationMembers(session, {
      roomId: 'room-1',
      roomType: 'c',
      count: 20,
      offset: 5,
      filter: 'ali',
    })).resolves.toEqual({
      success: true,
      members: [],
      count: 0,
      offset: 5,
      total: 0,
    });

    expect(observedPath).toBe('/api/v1/rooms.membersOrderedByRole?roomId=room-1&count=20&offset=5&filter=ali');
  });

  test('loads direct-conversation participants through im.members', async () => {
    let observedPath = '';

    const server = await listen((request, response) => {
      observedPath = request.url || '';
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        success: true,
        members: [],
        count: 0,
        offset: 0,
        total: 0,
      }));
    });
    const client = new RocketChatClient(server.url);

    await client.getConversationMembers(session, {
      roomId: 'dm-1',
      roomType: 'd',
      count: 10,
    });

    expect(observedPath).toBe('/api/v1/im.members?roomId=dm-1&count=10&offset=0');
  });

  test('serializes room media confirmation with optional submission id, quote, thread targeting, and broadcast control', async () => {
    const requestBodies: unknown[] = [];

    const server = await listen(async (request, response) => {
      requestBodies.push(JSON.parse(await readRequestBody(request)));
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          success: true,
          message: {
            _id: 'message-1',
            rid: 'room-1',
            msg: 'normalized',
            ts: '2026-03-25T00:00:00.000Z',
            tmid: 'thread-1',
            u: {
              _id: 'alice-id',
              username: 'alice',
              name: 'Alice Example',
            },
          },
        }),
      );
    });
    const client = new RocketChatClient(server.url);

    await client.confirmRoomMedia(session, {
      roomId: 'room-1',
      fileId: 'file-1',
      text: 'caption',
      quoteMessageLink: 'http://127.0.0.1:3100/channel/general?msg=parent-1',
    });
    await client.confirmRoomMedia(session, {
      roomId: 'room-1',
      fileId: 'file-2',
      text: 'thread caption',
      threadId: 'thread-1',
    });
    await client.confirmRoomMedia(session, {
      roomId: 'room-1',
      fileId: 'file-3',
      text: 'thread broadcast caption',
      threadId: 'thread-1',
      broadcastToRoom: true,
    });

    expect(requestBodies).toEqual([
      {
        msg: '[ ](http://127.0.0.1:3100/channel/general?msg=parent-1)\ncaption',
      },
      {
        msg: 'thread caption',
        tmid: 'thread-1',
      },
      {
        msg: 'thread broadcast caption',
        tmid: 'thread-1',
        tshow: true,
      },
    ]);
  });

  test('serializes temporary upload cleanup through method.call/deleteFileMessage', async () => {
    let requestBody: unknown;

    const server = await listen(async (request, response) => {
      requestBody = JSON.parse(await readRequestBody(request));
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          success: true,
          message: JSON.stringify({
            msg: 'result',
            id: 'betterchat-delete-file-file-1',
            result: {},
          }),
        }),
      );
    });
    const client = new RocketChatClient(server.url);

    await expect(client.deleteTemporaryUpload(session, 'file-1')).resolves.toBeUndefined();
    expect(requestBody).toEqual({
      message: JSON.stringify({
        msg: 'method',
        id: 'betterchat-delete-file-file-1',
        method: 'deleteFileMessage',
        params: ['file-1'],
      }),
    });
  });
});
