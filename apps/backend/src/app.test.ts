import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { createApp } from './app';
import type { BetterChatConfig } from './config';
import { AppError } from './errors';
import { uploadTempFilePrefix } from './http-helpers';
import { requestIdHeaderName, type BetterChatLogger } from './observability';
import { serializeSessionCookie, type UpstreamSession } from './session';
import type { SnapshotService } from './snapshot-service';
import { conversationCapabilitiesFixture, emptyMembershipInbox } from './test-fixtures';
import type { RocketChatClient, UpstreamMessage } from './upstream';

const testConfig: BetterChatConfig = {
  host: '127.0.0.1',
  port: 3200,
  stateDir: '/tmp/betterchat-app-test-state',
  upstreamUrl: 'http://127.0.0.1:3100',
  upstreamRequestTimeoutMs: 15_000,
  upstreamMediaTimeoutMs: 30_000,
  sessionCookieName: 'betterchat_session',
  sessionCookieSecure: false,
  sessionSecret: 'test-session-secret',
  sessionTtlSeconds: 60 * 60,
  defaultMessagePageSize: 50,
  maxUploadBytes: 10 * 1024 * 1024,
  staticDir: null,
};

const silentLogger: BetterChatLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

const authenticatedSession: UpstreamSession = {
  authToken: 'test-auth-token',
  createdAt: '2026-03-25T00:00:00.000Z',
  displayName: 'Alice Example',
  expiresAt: '2099-03-26T00:00:00.000Z',
  userId: 'alice-id',
  username: 'alice',
};

const sessionCookie = (session: UpstreamSession = authenticatedSession): string =>
  `${testConfig.sessionCookieName}=${serializeSessionCookie(testConfig, session)}`;

const defaultConversationSettings = [
  { _id: 'FileUpload_Enabled', value: true },
  { _id: 'FileUpload_Enabled_Direct', value: true },
  { _id: 'Threads_enabled', value: true },
  { _id: 'Message_AllowEditing', value: true },
  { _id: 'Message_AllowDeleting', value: true },
];

const defaultPermissionDefinitions = [
  { _id: 'delete-own-message', roles: ['user'] },
];

const createStubClient = (overrides: Record<string, unknown> = {}): RocketChatClient =>
  ({
    getPublicInfo: async () => ({ version: '7.6.0' }),
    getPublicSettings: async () => ({
      success: true,
      settings: defaultConversationSettings,
    }),
    getOauthSettings: async () => ({
      success: true,
      services: [],
    }),
    probeRealtime: async () => undefined,
    getMe: async () => ({
      success: true,
      _id: authenticatedSession.userId,
      username: authenticatedSession.username,
      name: authenticatedSession.displayName,
      roles: ['user'],
    }),
    getPermissionDefinitions: async () => ({
      success: true,
      update: defaultPermissionDefinitions,
      remove: [],
    }),
    getRoomInfo: async () => ({
      success: true,
      room: {
        _id: 'room-1',
        t: 'c',
        name: 'room-1',
        fname: 'Room 1',
      },
    }),
    getSubscription: async () => ({
      success: true,
      subscription: {
        _id: 'subscription-1',
        rid: 'room-1',
        t: 'c',
        name: 'room-1',
        fname: 'Room 1',
        open: true,
        unread: 0,
      },
    }),
    getRooms: async () => ({
      success: true,
      update: [],
      remove: [],
    }),
    getSubscriptions: async () => ({
      success: true,
      update: [],
      remove: [],
    }),
    ...overrides,
  }) as unknown as RocketChatClient;

const createStubSnapshotService = (
  overrides: Record<string, unknown> = {},
): SnapshotService =>
  ({
    clearSession: () => undefined,
    invalidateConversation: () => undefined,
    invalidateDirectory: () => undefined,
    invalidateThread: () => undefined,
    conversation: async () => ({
      version: 'conversation-version-1',
      conversation: {
        id: 'room-1',
        kind: {
          mode: 'group',
          privacy: 'public',
        },
        title: 'Conversation 1',
      },
      membership: {
        listing: 'listed',
        starred: false,
        inbox: emptyMembershipInbox,
      },
      capabilities: conversationCapabilitiesFixture(),
    }),
    conversationMessageContext: async () => ({
      version: 'conversation-context-version-1',
      conversationId: 'room-1',
      anchorMessageId: 'message-1',
      anchorIndex: 0,
      messages: [],
      hasBefore: false,
      hasAfter: false,
    }),
    conversationTimeline: async () => ({
      version: 'conversation-timeline-version-1',
      scope: {
        kind: 'conversation',
        conversationId: 'room-1',
      },
      messages: [],
    }),
    observeMessage: (message: UpstreamMessage) => message,
    observeMessages: () => undefined,
    rememberDeletedMessage: (message: UpstreamMessage) => message,
    rememberExternalDeletedMessageId: () => undefined,
    directory: async () => ({
      version: 'directory-version-1',
      entries: [],
    }),
    directoryState: async () => ({
      counterpartUserIdByConversationId: new Map<string, string>(),
      snapshot: {
        version: 'directory-version-1',
        entries: [],
      },
    }),
    threadConversationTimeline: async () => ({
      version: 'conversation-thread-version-1',
      scope: {
        kind: 'thread',
        conversationId: 'room-1',
        threadId: 'thread-1',
      },
      messages: [],
      threadRoot: {
        id: 'thread-1',
        conversationId: 'room-1',
        authoredAt: '2026-03-25T00:00:00.000Z',
        author: {
          id: 'alice-id',
          displayName: 'Alice Example',
          username: 'alice',
        },
        content: {
          format: 'markdown',
          text: 'root',
        },
        state: {
          edited: false,
          deleted: false,
        },
      },
    }),
    close: () => undefined,
    ...overrides,
  }) as unknown as SnapshotService;

const pngBytes = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};

const createImageUploadFormData = (size: number, extraFields: Record<string, string> = {}): FormData => {
  const formData = new FormData();
  formData.set('file', new File([Buffer.from(pngBytes(size))], 'upload.png', { type: 'image/png' }));
  formData.set('text', 'caption');
  for (const [key, value] of Object.entries(extraFields)) {
    formData.set(key, value);
  }
  return formData;
};

const tempUploadSpoolEntries = (): string[] =>
  readdirSync(tmpdir())
    .filter((entry) => entry.startsWith(uploadTempFilePrefix))
    .sort();

const createStreamingImageUploadRequest = (
  url: string,
  headers: Record<string, string>,
  extraFields: Record<string, string> = {},
): {
  controllerRef: ReadableStreamDefaultController<Uint8Array>;
  fileBytes: Uint8Array;
  headerBytes: Uint8Array;
  request: Request;
  trailerBytes: Uint8Array;
} => {
  const boundary = 'betterchat-streaming-boundary';
  const encoder = new TextEncoder();
  const extraFieldBytes = Object.entries(extraFields)
    .map(
      ([key, value]) =>
        `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="${key}"\r\n\r\n`
        + `${value}\r\n`,
    )
    .join('');
  const headerBytes = encoder.encode(
    `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="file"; filename="upload.png"\r\n'
    + 'Content-Type: image/png\r\n\r\n',
  );
  const trailerBytes = encoder.encode(`\r\n${extraFieldBytes}--${boundary}--\r\n`);
  const fileBytes = new Uint8Array(1300);
  fileBytes.fill(0x61);
  fileBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  let controllerRef!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });

  const requestInit: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
    duplex: 'half',
  };

  return {
    get controllerRef() {
      return controllerRef;
    },
    fileBytes,
    headerBytes,
    request: new Request(url, requestInit),
    trailerBytes,
  };
};

describe('createApp operational endpoints', () => {
  test('returns healthz with a generated request id', async () => {
    const app = createApp(testConfig, {
      client: createStubClient(),
      logger: silentLogger,
    });

    const response = await app.request('http://betterchat.test/healthz');

    expect(response.status).toBe(200);
    expect(response.headers.get(requestIdHeaderName)).toBeString();
    const payload = await response.json();
    expect(payload).toEqual({
      ok: true,
      data: {
        status: 'ok',
      },
    });
  });

  test('echoes inbound request ids on success responses', async () => {
    const app = createApp(testConfig, {
      client: createStubClient(),
      logger: silentLogger,
    });
    const requestId = 'test-request-id-success';

    const response = await app.request('http://betterchat.test/healthz', {
      headers: {
        [requestIdHeaderName]: requestId,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get(requestIdHeaderName)).toBe(requestId);
  });

  test('returns readyz when upstream public info is reachable', async () => {
    let publicInfoCalls = 0;
    let realtimeProbeCalls = 0;
    const app = createApp(testConfig, {
      client: createStubClient({
        getPublicInfo: async () => {
          publicInfoCalls += 1;
          return { version: '7.6.0' };
        },
        probeRealtime: async () => {
          realtimeProbeCalls += 1;
        },
      }),
      logger: silentLogger,
    });

    const response = await app.request('http://betterchat.test/readyz');

    expect(response.status).toBe(200);
    expect(publicInfoCalls).toBe(1);
    expect(realtimeProbeCalls).toBe(1);
    const payload = await response.json();
    expect(payload).toEqual({
      ok: true,
      data: {
        status: 'ready',
      },
    });
  });

  test('derives public bootstrap password login support from upstream public settings', async () => {
    const app = createApp(testConfig, {
      client: createStubClient({
        getOauthSettings: async () => ({
          success: true,
          services: [{ name: 'google', buttonLabelText: 'Continue with Google' }],
        }),
        getPublicSettings: async () => ({
          success: true,
          settings: [
            { _id: 'Site_Name', value: 'BetterChat Test Workspace' },
            { _id: 'Accounts_RegistrationForm', value: 'Public' },
            { _id: 'Accounts_ShowFormLogin', value: false },
          ],
        }),
      }),
      logger: silentLogger,
    });

    const response = await app.request('http://betterchat.test/api/public/bootstrap');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        server: {
          version: '7.6.0',
          siteName: 'BetterChat Test Workspace',
        },
        login: {
          passwordEnabled: false,
          registeredProviders: [
            {
              name: 'google',
              label: 'Continue with Google',
            },
          ],
        },
        features: {
          registerEnabled: true,
        },
      },
    });
  });

  test('fails public bootstrap when oauth discovery fails upstream', async () => {
    const app = createApp(testConfig, {
      client: createStubClient({
        getOauthSettings: async () => {
          throw new AppError('UPSTREAM_UNAVAILABLE', 'oauth lookup failed', 503);
        },
        getPublicSettings: async () => ({
          success: true,
          settings: [
            { _id: 'Site_Name', value: 'BetterChat Test Workspace' },
            { _id: 'Accounts_RegistrationForm', value: 'Public' },
            { _id: 'Accounts_ShowFormLogin', value: true },
          ],
        }),
      }),
      logger: silentLogger,
    });

    const response = await app.request('http://betterchat.test/api/public/bootstrap');

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'oauth lookup failed',
      },
    });
  });

  test('returns request ids on protected-route auth errors', async () => {
    const app = createApp(testConfig, {
      client: createStubClient(),
      logger: silentLogger,
    });
    const requestId = 'test-request-id-auth-error';

    const response = await app.request('http://betterchat.test/api/workspace', {
      headers: {
        [requestIdHeaderName]: requestId,
      },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get(requestIdHeaderName)).toBe(requestId);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
      },
    });
  });

  test('returns 503 readyz errors with request ids when upstream is unavailable', async () => {
    const app = createApp(testConfig, {
      client: createStubClient({
        getPublicInfo: async () => {
          throw new Error('upstream unavailable');
        },
      }),
      logger: silentLogger,
    });
    const requestId = 'test-request-id-readyz-error';

    const response = await app.request('http://betterchat.test/readyz', {
      headers: {
        [requestIdHeaderName]: requestId,
      },
    });

    expect(response.status).toBe(503);
    expect(response.headers.get(requestIdHeaderName)).toBe(requestId);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'upstream unavailable',
      },
    });
  });

  test('returns canonical BetterChat JSON for unknown routes', async () => {
    const app = createApp(testConfig, {
      client: createStubClient(),
      logger: silentLogger,
    });
    const requestId = 'test-request-id-not-found';

    const response = await app.request('http://betterchat.test/does-not-exist', {
      headers: {
        [requestIdHeaderName]: requestId,
      },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get(requestIdHeaderName)).toBe(requestId);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        details: {
          path: '/does-not-exist',
        },
      },
    });
  });

  test('clears the BetterChat session when media auth fails upstream', async () => {
    const app = createApp(testConfig, {
      client: createStubClient({
        fetchMedia: async () => {
          throw new AppError('UNAUTHENTICATED', 'Rocket.Chat rejected the media request', 401);
        },
      }),
      logger: silentLogger,
    });

    const response = await app.request('http://betterchat.test/api/media/file-upload/protected.png', {
      headers: {
        cookie: sessionCookie(),
      },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('betterchat_session=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'BetterChat session is no longer valid',
      },
    });
  });

  test('does not clear the BetterChat session when upstream media access is forbidden', async () => {
    const app = createApp(testConfig, {
      client: createStubClient({
        fetchMedia: async () => {
          throw new AppError('UPSTREAM_REJECTED', 'Rocket.Chat rejected the media request', 403);
        },
      }),
      logger: silentLogger,
    });

    const response = await app.request('http://betterchat.test/api/media/file-upload/protected.png', {
      headers: {
        cookie: sessionCookie(),
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UPSTREAM_REJECTED',
        message: 'Rocket.Chat rejected the media request',
      },
    });
  });

  test('forwards media validator headers and preserves partial-content response headers', async () => {
    let observedRequestHeaders: Headers | undefined;
    const app = createApp(testConfig, {
      client: createStubClient({
        fetchMedia: async (_path: string, _session: UpstreamSession, requestHeaders: Headers) => {
          observedRequestHeaders = requestHeaders;
          return new Response(Buffer.from('abc'), {
            status: 206,
            headers: {
              'accept-ranges': 'bytes',
              'cache-control': 'private, max-age=60',
              'content-length': '3',
              'content-range': 'bytes 0-2/10',
              'content-type': 'image/png',
              etag: '"etag-1"',
              'last-modified': 'Thu, 27 Mar 2026 01:02:03 GMT',
            },
          });
        },
      }),
      logger: silentLogger,
    });

    const response = await app.request('http://betterchat.test/api/media/file-upload/range.png', {
      headers: {
        cookie: sessionCookie(),
        'if-modified-since': 'Thu, 27 Mar 2026 01:02:03 GMT',
        'if-none-match': '"etag-1"',
        'if-range': '"etag-1"',
        range: 'bytes=0-2',
      },
    });

    expect(response.status).toBe(206);
    expect(observedRequestHeaders?.get('if-modified-since')).toBe('Thu, 27 Mar 2026 01:02:03 GMT');
    expect(observedRequestHeaders?.get('if-none-match')).toBe('"etag-1"');
    expect(observedRequestHeaders?.get('if-range')).toBe('"etag-1"');
    expect(observedRequestHeaders?.get('range')).toBe('bytes=0-2');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('cache-control')).toBe('private, max-age=60');
    expect(response.headers.get('content-range')).toBe('bytes 0-2/10');
    expect(response.headers.get('etag')).toBe('"etag-1"');
    expect(await response.text()).toBe('abc');
  });

  test('proxies media HEAD requests upstream without forcing GET semantics', async () => {
    let observedMethod: string | undefined;
    const app = createApp(testConfig, {
      client: createStubClient({
        fetchMedia: async (_path: string, _session: UpstreamSession, _requestHeaders: Headers, method: string) => {
          observedMethod = method;
          return new Response(null, {
            status: 200,
            headers: {
              'content-length': '3',
              'content-type': 'image/png',
            },
          });
        },
      }),
      logger: silentLogger,
    });

    const response = await app.request('http://betterchat.test/api/media/file-upload/head.png', {
      method: 'HEAD',
      headers: {
        cookie: sessionCookie(),
      },
    });

    expect(observedMethod).toBe('HEAD');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('3');
    expect(await response.text()).toBe('');
  });

  test('preserves media not-modified responses and validators', async () => {
    const app = createApp(testConfig, {
      client: createStubClient({
        fetchMedia: async () => new Response(null, {
          status: 304,
          headers: {
            'cache-control': 'private, max-age=60',
            etag: '"etag-1"',
            'last-modified': 'Thu, 27 Mar 2026 01:02:03 GMT',
          },
        }),
      }),
      logger: silentLogger,
    });

    const response = await app.request('http://betterchat.test/api/media/file-upload/range.png', {
      headers: {
        cookie: sessionCookie(),
        'if-none-match': '"etag-1"',
      },
    });

    expect(response.status).toBe(304);
    expect(response.headers.get('cache-control')).toBe('private, max-age=60');
    expect(response.headers.get('etag')).toBe('"etag-1"');
    expect(response.headers.get('last-modified')).toBe('Thu, 27 Mar 2026 01:02:03 GMT');
    expect(await response.text()).toBe('');
  });
});

describe('createApp image upload validation', () => {
  test('rejects oversized content-length uploads before consuming the full body', async () => {
    let bodyCancelled = false;

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('--betterchat-test-boundary\r\n'));
      },
      cancel() {
        bodyCancelled = true;
      },
    });

    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const responseOrTimeout = await Promise.race([
      app.fetch(new Request('http://betterchat.test/api/conversations/room-1/media', {
        method: 'POST',
        headers: {
          cookie: sessionCookie(),
          'content-length': String(testConfig.maxUploadBytes + 512 * 1024),
          'content-type': 'multipart/form-data; boundary=betterchat-test-boundary',
        },
        body,
      })),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), 250);
      }),
    ]);

    expect(responseOrTimeout).not.toBe('timeout');
    const response = responseOrTimeout as Response;
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
      },
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(bodyCancelled).toBe(true);
  });

  test('accepts an exact-limit image file even when multipart content-length is slightly larger', async () => {
    let uploadedFileSize = 0;
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
        uploadRoomMedia: async (_session: UpstreamSession, _roomId: string, file: File) => {
          uploadedFileSize = file.size;
          return {
            success: true,
            file: {
              _id: 'file-1',
              url: '/file-upload/file-1/upload.png',
            },
          };
        },
        confirmRoomMedia: async () => ({
          success: true,
          message: {
            _id: 'message-1',
            rid: 'room-1',
            msg: 'caption',
            ts: '2026-03-25T00:00:00.000Z',
            u: {
              _id: 'alice-id',
              username: 'alice',
              name: 'Alice Example',
            },
            attachments: [
              {
                image_url: '/file-upload/file-1/upload.png',
                image_type: 'image/png',
                title: 'upload.png',
              },
            ],
            file: {
              _id: 'file-1',
              name: 'upload.png',
              type: 'image/png',
            },
            files: [
              {
                _id: 'file-1',
                name: 'upload.png',
                type: 'image/png',
              },
            ],
          },
        }),
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
        'content-length': String(testConfig.maxUploadBytes + 128),
      },
      body: createImageUploadFormData(testConfig.maxUploadBytes),
    }));

    expect(response.status).toBe(200);
    expect(uploadedFileSize).toBe(testConfig.maxUploadBytes);
  });

  test('returns canonical preview and source image assets after a successful room image upload', async () => {
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
        uploadRoomMedia: async () => ({
          success: true,
          file: {
            _id: 'file-1',
            url: '/file-upload/file-1/upload.png',
          },
        }),
        confirmRoomMedia: async () => ({
          success: true,
          message: {
            _id: 'message-1',
            rid: 'room-1',
            msg: 'caption',
            ts: '2026-03-25T00:00:00.000Z',
            u: {
              _id: 'alice-id',
              username: 'alice',
              name: 'Alice Example',
            },
            attachments: [
              {
                title: 'upload.png',
                title_link: '/file-upload/file-1/upload.png',
                image_url: '/file-upload/thumb-1/upload.png',
                image_type: 'image/png',
                image_dimensions: {
                  width: 360,
                  height: 270,
                },
              },
            ],
            file: {
              _id: 'file-1',
              name: 'upload.png',
              type: 'image/png',
            },
            files: [
              {
                _id: 'file-1',
                name: 'upload.png',
                type: 'image/png',
              },
              {
                _id: 'thumb-1',
                name: 'upload.png',
                type: 'image/png',
              },
            ],
          },
        }),
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
      },
      body: createImageUploadFormData(1024),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        message: {
          attachments: [
            {
              kind: 'image',
              id: 'file-1',
              title: 'upload.png',
              preview: {
                url: '/api/media/file-upload/thumb-1/upload.png',
                width: 360,
                height: 270,
              },
              source: {
                url: '/api/media/file-upload/file-1/upload.png',
              },
            },
          ],
        },
      },
    });
  });

  test('accepts image uploads without an explicit content-length header', async () => {
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
        uploadRoomMedia: async () => ({
          success: true,
          file: {
            _id: 'file-1',
            url: '/file-upload/file-1/upload.png',
          },
        }),
        confirmRoomMedia: async () => ({
          success: true,
          message: {
            _id: 'message-1',
            rid: 'room-1',
            msg: 'caption',
            ts: '2026-03-25T00:00:00.000Z',
            u: {
              _id: 'alice-id',
              username: 'alice',
              name: 'Alice Example',
            },
          },
        }),
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
      },
      body: createImageUploadFormData(1024),
    }));

    expect(response.status).toBe(200);
  });

  test('cleans up spooled temp files after successful room image uploads', async () => {
    const before = tempUploadSpoolEntries();
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
        uploadRoomMedia: async () => ({
          success: true,
          file: {
            _id: 'file-1',
            url: '/file-upload/file-1/upload.png',
          },
        }),
        confirmRoomMedia: async () => ({
          success: true,
          message: {
            _id: 'message-1',
            rid: 'room-1',
            msg: 'caption',
            ts: '2026-03-25T00:00:00.000Z',
            u: {
              _id: 'alice-id',
              username: 'alice',
              name: 'Alice Example',
            },
          },
        }),
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
      },
      body: createImageUploadFormData(1024),
    }));

    expect(response.status).toBe(200);
    expect(tempUploadSpoolEntries()).toEqual(before);
  });

  test('cleans up spooled temp files when upstream room image upload fails after parsing', async () => {
    const before = tempUploadSpoolEntries();
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
        uploadRoomMedia: async () => {
          throw new AppError('UPSTREAM_REJECTED', 'Rocket.Chat rejected upload', 502);
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
      },
      body: createImageUploadFormData(1024),
    }));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UPSTREAM_REJECTED',
      },
    });
    expect(tempUploadSpoolEntries()).toEqual(before);
  });

  test('rejects oversized headerless uploads before the multipart body finishes streaming', async () => {
    const tinyConfig: BetterChatConfig = {
      ...testConfig,
      maxUploadBytes: 1024,
      stateDir: '/tmp/betterchat-app-test-state-tiny',
    };
    let uploadCalled = false;

    const app = createApp(tinyConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
        uploadRoomMedia: async () => {
          uploadCalled = true;
          return {
            success: true,
            file: {
              _id: 'file-1',
              url: '/file-upload/file-1/upload.png',
            },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const boundary = 'betterchat-streaming-boundary';
    const encoder = new TextEncoder();
    const header = encoder.encode(
      `--${boundary}\r\n`
      + 'Content-Disposition: form-data; name="file"; filename="upload.png"\r\n'
      + 'Content-Type: image/png\r\n\r\n',
    );
    const fileBytes = new Uint8Array(1300);
    fileBytes.fill(0x61);
    fileBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    let controllerRef!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
      },
    });

    const requestInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      duplex: 'half',
    };
    const request = new Request('http://betterchat.test/api/conversations/room-1/media', requestInit);

    const responsePromise = Promise.resolve(app.fetch(request));

    controllerRef.enqueue(header);
    controllerRef.enqueue(fileBytes.subarray(0, 1100));
    const responseOrTimeout = await Promise.race([
      responsePromise,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 250)),
    ]);

    expect(responseOrTimeout).not.toBe('timeout');
    const response = responseOrTimeout as Response;
    expect(response.status).toBe(413);
    expect(uploadCalled).toBe(false);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
      },
    });

    try {
      controllerRef.enqueue(fileBytes.subarray(1100));
      controllerRef.close();
    } catch {
      // The request reader may already have cancelled the body.
    }
  });

  test('rejects missing room image uploads before the multipart body finishes streaming', async () => {
    let uploadCalled = false;
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({ success: true }),
        uploadRoomMedia: async () => {
          uploadCalled = true;
          return {
            success: true,
            file: {
              _id: 'file-1',
              url: '/file-upload/file-1/upload.png',
            },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const streamingUpload = createStreamingImageUploadRequest('http://betterchat.test/api/conversations/missing-room/media', {
      cookie: sessionCookie(),
    });
    const responsePromise = Promise.resolve(app.fetch(streamingUpload.request));

    streamingUpload.controllerRef.enqueue(streamingUpload.headerBytes);
    streamingUpload.controllerRef.enqueue(streamingUpload.fileBytes.subarray(0, 128));
    const responseOrTimeout = await Promise.race([
      responsePromise,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 250)),
    ]);

    expect(responseOrTimeout).not.toBe('timeout');
    const response = responseOrTimeout as Response;
    expect(response.status).toBe(404);
    expect(uploadCalled).toBe(false);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_FOUND',
      },
    });

    try {
      streamingUpload.controllerRef.enqueue(streamingUpload.trailerBytes);
      streamingUpload.controllerRef.close();
    } catch {
      // The request reader may already have cancelled the body.
    }
  });

  test('rejects files whose actual byte size exceeds the configured limit', async () => {
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
      },
      body: createImageUploadFormData(testConfig.maxUploadBytes + 1),
    }));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
  });

  test('uploads conversation media replies with canonical quote semantics', async () => {
    let uploadCalls = 0;
    let confirmInput: unknown;
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
        getRoomInfo: async () => ({
          success: true,
          room: { _id: 'room-1', t: 'c', name: 'room-1' },
        }),
        findMessage: async () => ({
          _id: 'message-1',
          rid: 'room-1',
          msg: 'parent',
          ts: '2026-03-25T00:00:00.000Z',
          u: { _id: 'bob-id', username: 'bob', name: 'Bob Example' },
        }),
        uploadRoomMedia: async () => {
          uploadCalls += 1;
          return {
            success: true,
            file: { _id: 'file-1', url: '/file-upload/file-1/upload.png' },
          };
        },
        confirmRoomMedia: async (_session: UpstreamSession, input: unknown) => {
          confirmInput = input;
          return {
            success: true,
            message: {
              _id: 'message-2',
              rid: 'room-1',
              msg: '[ ](http://127.0.0.1:3100/channel/room-1?msg=message-1)\ncaption',
              ts: '2026-03-25T00:00:00.000Z',
              u: { _id: 'alice-id', username: 'alice', name: 'Alice Example' },
              attachments: [
                {
                  title: 'upload.png',
                  title_link: '/file-upload/file-1/upload.png',
                  image_url: '/file-upload/file-1/upload.png',
                  image_type: 'image/png',
                  message_link: 'http://127.0.0.1:3100/channel/room-1?msg=message-1',
                  text: 'parent',
                  author_name: 'Bob Example',
                },
              ],
              file: { _id: 'file-1', name: 'upload.png', type: 'image/png' },
              files: [{ _id: 'file-1', name: 'upload.png', type: 'image/png' }],
            },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      headers: { cookie: sessionCookie() },
      body: createImageUploadFormData(1024, { replyToMessageId: 'message-1' }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        message: {
          replyTo: {
            messageId: 'message-1',
          },
        },
      },
    });
    expect(uploadCalls).toBe(1);
    expect(confirmInput).toEqual({
      roomId: 'room-1',
      fileId: 'file-1',
      text: 'caption',
      quoteMessageLink: 'http://127.0.0.1:3100/channel/room-1?msg=message-1',
    });
  });

  test('rejects thread media uploads that request unsupported conversation echo semantics', async () => {
    let uploadCalls = 0;
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
        findMessage: async () => ({
          _id: 'thread-1',
          rid: 'room-1',
          msg: 'thread root',
          ts: '2026-03-25T00:00:00.000Z',
          u: { _id: 'bob-id', username: 'bob', name: 'Bob Example' },
        }),
        uploadRoomMedia: async () => {
          uploadCalls += 1;
          return {
            success: true,
            file: { _id: 'file-1', url: '/file-upload/file-1/upload.png' },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      headers: { cookie: sessionCookie() },
      body: createImageUploadFormData(1024, {
        targetKind: 'thread',
        threadId: 'thread-1',
        echoToConversation: 'true',
      }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UPSTREAM_REJECTED',
      },
    });
    expect(uploadCalls).toBe(0);
  });
});

describe('createApp canonical conversation routes', () => {
  test('serves canonical directory and conversation snapshots', async () => {
    const app = createApp(testConfig, {
      client: createStubClient(),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const directoryResponse = await app.request('http://betterchat.test/api/directory', {
      headers: {
        cookie: sessionCookie(),
      },
    });
    expect(directoryResponse.status).toBe(200);
    expect(await directoryResponse.json()).toEqual({
      ok: true,
      data: {
        version: 'directory-version-1',
        entries: [],
      },
    });

    const conversationResponse = await app.request('http://betterchat.test/api/conversations/room-1', {
      headers: {
        cookie: sessionCookie(),
      },
    });
    expect(conversationResponse.status).toBe(200);
    expect(await conversationResponse.json()).toEqual({
      ok: true,
      data: {
        version: 'conversation-version-1',
        conversation: {
          id: 'room-1',
          kind: {
            mode: 'group',
            privacy: 'public',
          },
          title: 'Conversation 1',
        },
        membership: {
          listing: 'listed',
          starred: false,
          inbox: emptyMembershipInbox,
        },
        capabilities: conversationCapabilitiesFixture(),
      },
    });
  });

  test('creates canonical conversation messages without forcing snapshot sync materialization', async () => {
    const snapshotCalls: string[] = [];
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
        sendRoomMessage: async (_session: UpstreamSession, input: { roomId: string; text: string }) => ({
          success: true,
          message: {
            _id: 'message-1',
            rid: input.roomId,
            msg: input.text,
            ts: '2026-03-25T00:00:00.000Z',
            u: {
              _id: 'alice-id',
              username: 'alice',
              name: 'Alice Example',
            },
          },
        }),
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService({
        conversation: async () => {
          snapshotCalls.push('conversation');
          return {
            version: 'conversation-version-1',
            conversation: {
              id: 'room-1',
              kind: {
                mode: 'group',
                privacy: 'public',
              },
              title: 'Conversation 1',
            },
            membership: {
              listing: 'listed',
              starred: false,
              inbox: emptyMembershipInbox,
            },
            capabilities: conversationCapabilitiesFixture(),
          };
        },
        conversationTimeline: async () => {
          snapshotCalls.push('conversationTimeline');
          return {
            version: 'conversation-timeline-version-1',
            scope: {
              kind: 'conversation',
              conversationId: 'room-1',
            },
            messages: [],
          };
        },
        directory: async () => {
          snapshotCalls.push('directory');
          return {
            version: 'directory-version-1',
            entries: [],
          };
        },
      }),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/messages', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        target: {
          kind: 'conversation',
        },
        content: {
          format: 'markdown',
          text: 'canonical hello',
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        message: {
          id: 'message-1',
          conversationId: 'room-1',
          authoredAt: '2026-03-25T00:00:00.000Z',
          author: {
            id: 'alice-id',
            displayName: 'Alice Example',
            username: 'alice',
            avatarUrl: '/api/media/avatar/alice',
          },
          content: {
            format: 'markdown',
            text: 'canonical hello',
          },
          state: {
            edited: false,
            deleted: false,
          },
          actions: {
            edit: true,
            delete: true,
          },
        },
      },
    });
    expect(snapshotCalls).toEqual([]);
  });

  test('propagates submission ids into the upstream text send and echoes them in the canonical response', async () => {
    let observedInput:
      | {
          messageId?: string;
          roomId: string;
          text: string;
        }
      | undefined;
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
        sendRoomMessage: async (
          _session: UpstreamSession,
          input: {
            messageId?: string;
            roomId: string;
            text: string;
          },
        ) => {
          observedInput = input;
          return {
            success: true,
            message: {
              _id: input.messageId ?? 'message-1',
              rid: input.roomId,
              msg: input.text,
              ts: '2026-03-25T00:00:00.000Z',
              u: {
                _id: 'alice-id',
                username: 'alice',
                name: 'Alice Example',
              },
            },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/messages', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        submissionId: 'submission-1',
        target: {
          kind: 'conversation',
        },
        content: {
          format: 'markdown',
          text: 'canonical hello',
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(observedInput).toEqual({
      messageId: 'submission-1',
      roomId: 'room-1',
      text: 'canonical hello',
    });
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        message: {
          id: 'submission-1',
          submissionId: 'submission-1',
          conversationId: 'room-1',
          content: {
            text: 'canonical hello',
          },
        },
      },
    });
  });

  test('serves canonical conversation participants with pagination and filtering', async () => {
    const requestedInputs: Array<{
      roomId: string;
      roomType: string;
      count: number;
      offset: number;
      filter?: string;
    }> = [];
    const cursor = Buffer.from(JSON.stringify({ offset: 1 }), 'utf8').toString('base64');
    const app = createApp(testConfig, {
      client: createStubClient({
        getConversationMembers: async (
          _session: UpstreamSession,
          input: {
            roomId: string;
            roomType: string;
            count: number;
            offset?: number;
            filter?: string;
          },
        ) => {
          requestedInputs.push({
            roomId: input.roomId,
            roomType: input.roomType,
            count: input.count,
            offset: input.offset ?? 0,
            filter: input.filter,
          });

          return {
            success: true,
            members: [
              {
                _id: 'bob-id',
                username: 'bob',
                name: 'Bob Example',
                status: 'busy',
              },
            ],
            count: 1,
            offset: input.offset ?? 0,
            total: 2,
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.request(`http://betterchat.test/api/conversations/room-1/participants?limit=1&cursor=${encodeURIComponent(cursor)}&q=bo`, {
      headers: {
        cookie: sessionCookie(),
      },
    });

    expect(response.status).toBe(200);
    expect(requestedInputs).toEqual([
      {
        roomId: 'room-1',
        roomType: 'c',
        count: 1,
        offset: 1,
        filter: 'bo',
      },
    ]);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        conversationId: 'room-1',
        entries: [
          {
            user: {
              id: 'bob-id',
              username: 'bob',
              displayName: 'Bob Example',
              avatarUrl: '/api/media/avatar/bob',
              presence: 'busy',
            },
            self: false,
          },
        ],
      },
    });
  });

  test('serves canonical mention candidates with backend-owned insert text', async () => {
    const requestedFilters: Array<string | undefined> = [];
    const app = createApp(testConfig, {
      client: createStubClient({
        getConversationMembers: async (
          _session: UpstreamSession,
          input: {
            filter?: string;
          },
        ) => {
          requestedFilters.push(input.filter);

          return {
            success: true,
            members: [
              {
                _id: 'alice-id',
                username: 'alice',
                name: 'Alice Example',
                status: 'online',
              },
              {
                _id: 'bob-id',
                username: 'bob',
                name: 'Bob Example',
                status: 'busy',
              },
            ],
            count: 2,
            offset: 0,
            total: 2,
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.request('http://betterchat.test/api/conversations/room-1/mention-candidates?q=@bo&limit=4', {
      headers: {
        cookie: sessionCookie(),
      },
    });

    expect(response.status).toBe(200);
    expect(requestedFilters).toEqual(['bo']);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        conversationId: 'room-1',
        query: 'bo',
        entries: [
          {
            kind: 'user',
            user: {
              id: 'bob-id',
              username: 'bob',
              displayName: 'Bob Example',
              avatarUrl: '/api/media/avatar/bob',
              presence: 'busy',
            },
            insertText: '@bob',
          },
        ],
      },
    });
  });
});

describe('createApp direct conversation routes', () => {
  test('looks up an existing hidden direct conversation by user id', async () => {
    const app = createApp(testConfig, {
      client: createStubClient({
        getUserInfo: async () => ({
          success: true,
          user: {
            _id: 'bob-id',
            username: 'bob',
            name: 'Bob Example',
          },
        }),
        getUsersPresence: async () => ({
          success: true,
          full: true,
          users: [
            {
              _id: 'bob-id',
              status: 'busy',
            },
          ],
        }),
        getRooms: async () => ({
          success: true,
          update: [
            {
              _id: 'dm-bob',
              t: 'd',
              fname: 'Bob Example',
              usernames: ['alice', 'bob'],
              uids: ['alice-id', 'bob-id'],
            },
          ],
          remove: [],
        }),
        getSubscriptions: async () => ({
          success: true,
          update: [
            {
              _id: 'subscription-dm-bob',
              rid: 'dm-bob',
              t: 'd',
              name: 'bob',
              fname: 'Bob Example',
              open: false,
              unread: 0,
            },
          ],
          remove: [],
        }),
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.request('http://betterchat.test/api/users/bob-id/direct-conversation', {
      headers: {
        cookie: sessionCookie(),
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        user: {
          id: 'bob-id',
          username: 'bob',
          displayName: 'Bob Example',
          avatarUrl: '/api/media/avatar/bob',
          presence: 'busy',
        },
        conversation: {
          state: 'hidden',
          conversationId: 'dm-bob',
        },
      },
    });
  });

  test('creates a new direct conversation when none exists', async () => {
    let createdUsername: string | undefined;
    const app = createApp(testConfig, {
      client: createStubClient({
        getUserInfo: async () => ({
          success: true,
          user: {
            _id: 'charlie-id',
            username: 'charlie',
            name: 'Charlie Example',
          },
        }),
        getUsersPresence: async () => ({
          success: true,
          full: true,
          users: [
            {
              _id: 'charlie-id',
              status: 'online',
            },
          ],
        }),
        createDirectConversation: async (_session: UpstreamSession, username: string) => {
          createdUsername = username;
          return {
            success: true,
            room: {
              _id: 'dm-charlie',
            },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService({
        conversation: async () => ({
          version: 'conversation-version-dm-charlie',
          conversation: {
            id: 'dm-charlie',
            kind: {
              mode: 'direct',
            },
            title: 'Charlie Example',
          },
          membership: {
            listing: 'listed',
            starred: false,
            inbox: emptyMembershipInbox,
          },
          live: {
            counterpartPresence: 'online',
          },
          capabilities: conversationCapabilitiesFixture(),
        }),
        conversationTimeline: async () => ({
          version: 'conversation-timeline-version-dm-charlie',
          scope: {
            kind: 'conversation',
            conversationId: 'dm-charlie',
          },
          messages: [],
        }),
      }),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/users/charlie-id/direct-conversation', {
      method: 'PUT',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(200);
    expect(createdUsername).toBe('charlie');
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        user: {
          id: 'charlie-id',
          username: 'charlie',
          displayName: 'Charlie Example',
          avatarUrl: '/api/media/avatar/charlie',
          presence: 'online',
        },
        conversationId: 'dm-charlie',
        disposition: 'created',
        sync: {
          directoryVersion: 'directory-version-1',
          conversationVersion: 'conversation-version-dm-charlie',
          timelineVersion: 'conversation-timeline-version-dm-charlie',
        },
      },
    });
  });
});

describe('createApp mutation normalization', () => {
  test('returns BetterChat NOT_FOUND for missing favorite room mutations before calling upstream', async () => {
    let upstreamFavoriteCalls = 0;
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({ success: true }),
        setRoomFavorite: async () => {
          upstreamFavoriteCalls += 1;
          return { success: true };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/membership/commands', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'set-starred', value: true }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_FOUND',
      },
    });
    expect(upstreamFavoriteCalls).toBe(0);
  });

  test('returns BetterChat NOT_FOUND for wrong-room message patches before calling upstream', async () => {
    let upstreamPatchCalls = 0;
    const app = createApp(testConfig, {
      client: createStubClient({
        findMessage: async () => ({
          _id: 'message-1',
          rid: 'room-2',
          msg: 'original',
          ts: '2026-03-25T00:00:00.000Z',
          u: {
            _id: 'alice-id',
            username: 'alice',
            name: 'Alice Example',
          },
        }),
        updateMessage: async () => {
          upstreamPatchCalls += 1;
          return {
            success: true,
            message: {
              _id: 'message-1',
              rid: 'room-1',
              msg: 'edited',
              ts: '2026-03-25T00:00:00.000Z',
              u: {
                _id: 'alice-id',
                username: 'alice',
                name: 'Alice Example',
              },
            },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/messages/message-1', {
      method: 'PATCH',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'edited' }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_FOUND',
      },
    });
    expect(upstreamPatchCalls).toBe(0);
  });

  test('preserves an existing conversation reply when message edits omit replyToMessageId', async () => {
    let observedUpdateInput: unknown;
    const existingQuoteLink = 'http://127.0.0.1:3100/channel/room-1?msg=parent-1';
    const app = createApp(testConfig, {
      client: createStubClient({
        findMessage: async (_session: UpstreamSession, messageId: string) => {
          if (messageId === 'message-1') {
            return {
              _id: 'message-1',
              rid: 'room-1',
              msg: `[ ](${existingQuoteLink})\noriginal`,
              ts: '2026-03-25T00:00:00.000Z',
              u: {
                _id: 'alice-id',
                username: 'alice',
                name: 'Alice Example',
              },
              attachments: [
                {
                  message_link: existingQuoteLink,
                  text: 'parent',
                  author_name: 'Bob Example',
                },
              ],
            };
          }

          if (messageId === 'parent-1') {
            return {
              _id: 'parent-1',
              rid: 'room-1',
              msg: 'parent',
              ts: '2026-03-25T00:00:00.000Z',
              u: {
                _id: 'bob-id',
                username: 'bob',
                name: 'Bob Example',
              },
            };
          }

          return undefined;
        },
        updateMessage: async (_session: UpstreamSession, input: unknown) => {
          observedUpdateInput = input;
          return {
            success: true,
            message: {
              _id: 'message-1',
              rid: 'room-1',
              msg: `[ ](${existingQuoteLink})\nedited`,
              ts: '2026-03-25T00:00:00.000Z',
              editedAt: '2026-03-25T00:01:00.000Z',
              u: {
                _id: 'alice-id',
                username: 'alice',
                name: 'Alice Example',
              },
              attachments: [
                {
                  message_link: existingQuoteLink,
                  text: 'parent',
                  author_name: 'Bob Example',
                },
              ],
            },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/messages/message-1', {
      method: 'PATCH',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'edited' }),
    }));

    expect(response.status).toBe(200);
    expect(observedUpdateInput).toEqual({
      roomId: 'room-1',
      messageId: 'message-1',
      text: 'edited',
      quoteMessageLink: existingQuoteLink,
    });
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        message: {
          replyTo: {
            messageId: 'parent-1',
          },
        },
      },
    });
  });

  test('replaces and clears conversation replies explicitly during message edits', async () => {
    const observedUpdateInputs: unknown[] = [];
    const currentQuoteLink = 'http://127.0.0.1:3100/channel/room-1?msg=parent-1';
    const replacementQuoteLink = 'http://127.0.0.1:3100/channel/room-1?msg=parent-2';
    const app = createApp(testConfig, {
      client: createStubClient({
        findMessage: async (_session: UpstreamSession, messageId: string) => {
          if (messageId === 'message-1') {
            return {
              _id: 'message-1',
              rid: 'room-1',
              msg: `[ ](${currentQuoteLink})\noriginal`,
              ts: '2026-03-25T00:00:00.000Z',
              u: {
                _id: 'alice-id',
                username: 'alice',
                name: 'Alice Example',
              },
              attachments: [
                {
                  message_link: currentQuoteLink,
                  text: 'parent',
                  author_name: 'Bob Example',
                },
              ],
            };
          }

          if (messageId === 'parent-2') {
            return {
              _id: 'parent-2',
              rid: 'room-1',
              msg: 'replacement parent',
              ts: '2026-03-25T00:00:00.000Z',
              u: {
                _id: 'charlie-id',
                username: 'charlie',
                name: 'Charlie Example',
              },
            };
          }

          return undefined;
        },
        updateMessage: async (_session: UpstreamSession, input: unknown) => {
          observedUpdateInputs.push(input);
          const hasReplacementReply = typeof input === 'object' && input !== null && 'quoteMessageLink' in input
            && (input as { quoteMessageLink?: string }).quoteMessageLink === replacementQuoteLink;

          return {
            success: true,
            message: {
              _id: 'message-1',
              rid: 'room-1',
              msg: hasReplacementReply ? `[ ](${replacementQuoteLink})\nedited replacement` : 'edited cleared',
              ts: '2026-03-25T00:00:00.000Z',
              editedAt: '2026-03-25T00:01:00.000Z',
              u: {
                _id: 'alice-id',
                username: 'alice',
                name: 'Alice Example',
              },
              ...(hasReplacementReply
                ? {
                    attachments: [
                      {
                        message_link: replacementQuoteLink,
                        text: 'replacement parent',
                        author_name: 'Charlie Example',
                      },
                    ],
                  }
                : {}),
            },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const replaced = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/messages/message-1', {
      method: 'PATCH',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'edited replacement', replyToMessageId: 'parent-2' }),
    }));
    const cleared = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/messages/message-1', {
      method: 'PATCH',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'edited cleared', replyToMessageId: null }),
    }));

    expect(replaced.status).toBe(200);
    expect(cleared.status).toBe(200);
    expect(observedUpdateInputs).toEqual([
      {
        roomId: 'room-1',
        messageId: 'message-1',
        text: 'edited replacement',
        quoteMessageLink: replacementQuoteLink,
      },
      {
        roomId: 'room-1',
        messageId: 'message-1',
        text: 'edited cleared',
      },
    ]);
    expect(await replaced.json()).toMatchObject({
      ok: true,
      data: {
        message: {
          replyTo: {
            messageId: 'parent-2',
          },
        },
      },
    });
    const clearedPayload = await cleared.json();
    expect(clearedPayload).toMatchObject({
      ok: true,
      data: {
        message: {
          content: {
            text: 'edited cleared',
          },
        },
      },
    });
    expect(clearedPayload.data.message.replyTo).toBeUndefined();
  });

  test('rejects replyToMessageId when editing thread replies', async () => {
    let upstreamPatchCalls = 0;
    const app = createApp(testConfig, {
      client: createStubClient({
        findMessage: async () => ({
          _id: 'message-1',
          rid: 'room-1',
          msg: 'thread reply',
          ts: '2026-03-25T00:00:00.000Z',
          tmid: 'thread-1',
          u: {
            _id: 'alice-id',
            username: 'alice',
            name: 'Alice Example',
          },
        }),
        updateMessage: async () => {
          upstreamPatchCalls += 1;
          throw new Error('unreachable');
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/messages/message-1', {
      method: 'PATCH',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'edited', replyToMessageId: 'parent-1' }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
    expect(upstreamPatchCalls).toBe(0);
  });

  test('rejects mark-unread anchors that are not visible in the main conversation timeline', async () => {
    let upstreamUnreadCalls = 0;
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'general',
            open: true,
            unread: 0,
          },
        }),
        findMessage: async () => ({
          _id: 'message-thread-hidden',
          rid: 'room-1',
          msg: 'hidden thread reply',
          ts: '2026-03-25T00:00:00.000Z',
          tmid: 'thread-1',
          u: {
            _id: 'bob-id',
            username: 'bob',
            name: 'Bob Example',
          },
        }),
        markRoomUnread: async () => {
          upstreamUnreadCalls += 1;
          return { success: true };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/membership/commands', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'mark-unread', fromMessageId: 'message-thread-hidden' }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
    expect(upstreamUnreadCalls).toBe(0);
  });

  test('returns BetterChat NOT_FOUND for non-root thread sends before calling upstream', async () => {
    let upstreamSendCalls = 0;
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
        findMessage: async () => ({
          _id: 'reply-1',
          rid: 'room-1',
          tmid: 'parent-1',
          msg: 'reply',
          ts: '2026-03-25T00:00:00.000Z',
          u: {
            _id: 'alice-id',
            username: 'alice',
            name: 'Alice Example',
          },
        }),
        sendThreadMessage: async () => {
          upstreamSendCalls += 1;
          return {
            success: true,
            message: {
              _id: 'message-1',
              rid: 'room-1',
              msg: 'reply',
              ts: '2026-03-25T00:00:00.000Z',
              u: {
                _id: 'alice-id',
                username: 'alice',
                name: 'Alice Example',
              },
            },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/messages', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        target: {
          kind: 'thread',
          threadId: 'reply-1',
          echoToConversation: false,
        },
        content: {
          format: 'markdown',
          text: 'reply',
        },
      }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_FOUND',
      },
    });
    expect(upstreamSendCalls).toBe(0);
  });

  test('returns BetterChat NOT_FOUND for non-root thread image uploads before calling upstream', async () => {
    let upstreamUploadCalls = 0;
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: true,
            unread: 0,
          },
        }),
        findMessage: async () => ({
          _id: 'reply-1',
          rid: 'room-1',
          tmid: 'parent-1',
          msg: 'reply',
          ts: '2026-03-25T00:00:00.000Z',
          u: {
            _id: 'alice-id',
            username: 'alice',
            name: 'Alice Example',
          },
        }),
        uploadRoomMedia: async () => {
          upstreamUploadCalls += 1;
          return {
            success: true,
            file: {
              _id: 'file-1',
              url: '/file-upload/file-1/upload.png',
            },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
      },
      body: createImageUploadFormData(1024, {
        targetKind: 'thread',
        threadId: 'reply-1',
      }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_FOUND',
      },
    });
    expect(upstreamUploadCalls).toBe(0);
  });

  test('does not open hidden conversations when message creation fails before mutation success', async () => {
    let openRoomCalls = 0;
    let sendRoomMessageCalls = 0;
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: false,
            unread: 0,
          },
        }),
        findMessage: async () => ({
          _id: 'foreign-message',
          rid: 'room-2',
          msg: 'wrong room',
          ts: '2026-03-25T00:00:00.000Z',
          u: {
            _id: 'bob-id',
            username: 'bob',
            name: 'Bob Example',
          },
        }),
        openRoom: async () => {
          openRoomCalls += 1;
          return { success: true };
        },
        sendRoomMessage: async () => {
          sendRoomMessageCalls += 1;
          return {
            success: true,
            message: {
              _id: 'message-1',
              rid: 'room-1',
              msg: 'unexpected',
              ts: '2026-03-25T00:00:00.000Z',
              u: {
                _id: 'alice-id',
                username: 'alice',
                name: 'Alice Example',
              },
            },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/messages', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        target: {
          kind: 'conversation',
          replyToMessageId: 'foreign-message',
        },
        content: {
          format: 'markdown',
          text: 'reply',
        },
      }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_FOUND',
      },
    });
    expect(openRoomCalls).toBe(0);
    expect(sendRoomMessageCalls).toBe(0);
  });

  test('does not open hidden conversations or upload media when media validation fails locally', async () => {
    let openRoomCalls = 0;
    let uploadRoomMediaCalls = 0;
    const app = createApp(testConfig, {
      client: createStubClient({
        getSubscription: async () => ({
          success: true,
          subscription: {
            _id: 'subscription-1',
            rid: 'room-1',
            t: 'c',
            name: 'room-1',
            open: false,
            unread: 0,
          },
        }),
        openRoom: async () => {
          openRoomCalls += 1;
          return { success: true };
        },
        findMessage: async () => undefined,
        uploadRoomMedia: async () => {
          uploadRoomMediaCalls += 1;
          return {
            success: true,
            file: {
              _id: 'file-1',
              url: '/file-upload/file-1/upload.png',
            },
          };
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
      },
      body: createImageUploadFormData(1024, {
        replyToMessageId: 'foreign-message',
      }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_FOUND',
      },
    });
    expect(openRoomCalls).toBe(0);
    expect(uploadRoomMediaCalls).toBe(0);
  });

  test('cleans up temporary uploads when upstream media confirmation fails after upload succeeds', async () => {
    const deletedFileIds: string[] = [];
    const app = createApp(testConfig, {
      client: createStubClient({
        uploadRoomMedia: async () => ({
          success: true,
          file: {
            _id: 'file-temp-1',
            url: '/file-upload/file-temp-1/upload.png',
          },
        }),
        confirmRoomMedia: async () => {
          throw new AppError('UPSTREAM_REJECTED', 'confirm failed', 400);
        },
        deleteTemporaryUpload: async (_session: UpstreamSession, fileId: string) => {
          deletedFileIds.push(fileId);
        },
      }),
      logger: silentLogger,
      snapshotService: createStubSnapshotService(),
    });

    const response = await app.fetch(new Request('http://betterchat.test/api/conversations/room-1/media', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(),
      },
      body: createImageUploadFormData(1024),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UPSTREAM_REJECTED',
        message: 'confirm failed',
      },
    });
    expect(deletedFileIds).toEqual(['file-temp-1']);
  });
});
