import type {
  ConversationStreamClientCommand,
  ConversationStreamServerEvent,
} from '@betterchat/contracts';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { MongoClient } from 'mongodb';

export type FixtureUser = {
  username: string;
  password: string;
  email: string;
  displayName: string;
};

export const adminFixture = {
  username: 'admin',
  password: 'AdminPass123!',
  email: 'admin@example.com',
} as const;

export const fixtureUsers = {
  alice: {
    username: 'alice',
    password: 'AlicePass123!',
    email: 'alice@example.com',
    displayName: 'Alice Example',
  },
  bob: {
    username: 'bob',
    password: 'BobPass123!',
    email: 'bob@example.com',
    displayName: 'Bob Example',
  },
  charlie: {
    username: 'charlie',
    password: 'CharliePass123!',
    email: 'charlie@example.com',
    displayName: 'Charlie Example',
  },
  dana: {
    username: 'dana',
    password: 'DanaPass123!',
    email: 'dana@example.com',
    displayName: 'Dana Example',
  },
} satisfies Record<string, FixtureUser>;

export const fixturePresence = {
  alice: 'away',
  bob: 'busy',
  charlie: 'online',
} as const;

export const fixtureRooms = {
  publicMain: {
    kind: 'channel',
    name: 'betterchat-public',
    members: ['alice', 'bob', 'charlie'],
    topic: 'Seeded public workspace updates',
    description: 'Primary seeded public room with unread state, replies, and media coverage.',
    announcement: 'Seeded public announcement for BetterChat integration coverage.',
    favoriteForAlice: true,
  },
  publicQuiet: {
    kind: 'channel',
    name: 'betterchat-quiet',
    members: ['alice', 'bob', 'charlie'],
    topic: 'Quiet room topic',
    description: 'Seeded public room with existing content but no unread messages.',
    announcement: 'Quiet room announcement for metadata coverage.',
    favoriteForAlice: false,
  },
  publicEmpty: {
    kind: 'channel',
    name: 'betterchat-empty',
    members: ['alice', 'bob', 'charlie'],
    favoriteForAlice: false,
  },
  publicReadonly: {
    kind: 'channel',
    name: 'betterchat-readonly',
    members: ['alice', 'bob', 'charlie'],
    topic: 'Readonly room topic',
    description: 'Seeded readonly public room for capability projection coverage.',
    announcement: 'Readonly room announcement for BetterChat integration coverage.',
    favoriteForAlice: false,
    readOnly: true,
  },
  privateMain: {
    kind: 'group',
    name: 'betterchat-private',
    members: ['alice', 'bob'],
    topic: 'Private planning topic',
    description: 'Seeded private group for room metadata and read-state coverage.',
    announcement: 'Seeded private announcement for BetterChat integration coverage.',
    favoriteForAlice: false,
  },
  privateHidden: {
    kind: 'group',
    name: 'betterchat-hidden',
    members: ['alice', 'charlie'],
    topic: 'Hidden room topic',
    description: 'Seeded hidden private group for open=false sidebar coverage.',
    announcement: 'Hidden room announcement for BetterChat integration coverage.',
    favoriteForAlice: false,
    hiddenForAlice: true,
  },
} as const;

export const fixtureMessages = {
  publicWelcome: '[betterchat] seeded public welcome',
  publicEditedOriginal: '[betterchat] seeded public message before edit',
  publicEditedFinal: '[betterchat] seeded public message after edit',
  publicThreadParent:
    '[betterchat] seeded thread parent with enough detail to exercise reply preview truncation across the BetterChat compatibility timeline baseline.',
  publicThreadReply: '[betterchat] seeded visible thread reply from bob',
  publicThreadReplyHidden: '[betterchat] seeded thread-only reply from charlie',
  publicQuietRead: '[betterchat] seeded quiet room read marker',
  publicReadonlyNote: '[betterchat] seeded readonly room note',
  privateNote: '[betterchat] seeded private planning note',
  hiddenPrivateNote: '[betterchat] seeded hidden room note',
  dmBobRead: '[betterchat] seeded dm baseline with bob',
  dmCharlieRead: '[betterchat] seeded dm baseline with charlie',
} as const;

export const fixtureHistoryMessages = {
  publicQuiet: [
    '[betterchat] seeded quiet history 01',
    '[betterchat] seeded quiet history 02',
    '[betterchat] seeded quiet history 03',
    '[betterchat] seeded quiet history 04',
    '[betterchat] seeded quiet history 05',
    '[betterchat] seeded quiet history 06',
  ],
} as const;

export const fixtureReactions = {
  publicWelcome: ':smile:',
} as const;

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let shift = 0; shift < 8; shift += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

const crc32 = (input: Uint8Array): number => {
  let value = 0xffffffff;

  for (const byte of input) {
    value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: 'IHDR' | 'IDAT' | 'IEND', data: Uint8Array): Buffer => {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.from(data);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.byteLength, 0);

  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 0);

  return Buffer.concat([length, typeBytes, payload, checksum]);
};

const createPatternPng = ({ width, height }: { width: number; height: number }): Uint8Array => {
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0;

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const blockX = x >> 3;
      const blockY = y >> 3;

      raw[pixelOffset] = (blockX * 47 + blockY * 29) % 256;
      raw[pixelOffset + 1] = (blockX * 13 + blockY * 71) % 256;
      raw[pixelOffset + 2] = ((blockX ^ blockY) * 37) % 256;
      raw[pixelOffset + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', new Uint8Array()),
  ]);
};

export const imageFixture = {
  fileName: 'betterchat-seed-image.png',
  contentType: 'image/png',
  width: 640,
  height: 480,
  bytes: createPatternPng({ width: 640, height: 480 }),
} as const;

const ROCKET_CHAT_QUOTE_PLACEHOLDER_LINE_PATTERN = /^\[ \]\([^)]+\)$/;

export const stripLeadingRocketChatQuotePlaceholders = (
  rawText: string,
  maxLeadingPlaceholders = Number.POSITIVE_INFINITY,
): string => {
  const lines = rawText.split('\n');
  let index = 0;

  while (
    index < lines.length
    && index < maxLeadingPlaceholders
    && ROCKET_CHAT_QUOTE_PLACEHOLDER_LINE_PATTERN.test(lines[index]?.trim() || '')
  ) {
    index += 1;
  }

  return lines.slice(index).join('\n').replace(/^\n+/, '');
};

export const rocketChatMessagePermalinkFrom = (
  upstreamUrl: string,
  room: {
    kind: 'channel' | 'group' | 'dm';
    roomId: string;
    name?: string;
  },
  messageId: string,
): string => {
  const path =
    room.kind === 'channel'
      ? room.name
        ? `/channel/${encodeURIComponent(room.name)}`
        : undefined
      : room.kind === 'group'
        ? room.name
          ? `/group/${encodeURIComponent(room.name)}`
          : undefined
        : `/direct/${encodeURIComponent(room.roomId)}`;

  if (!path) {
    throw new Error(`Rocket.Chat permalink room data is incomplete for ${room.kind}:${room.roomId}`);
  }

  const url = new URL(path, upstreamUrl);
  url.searchParams.set('msg', messageId);
  return url.toString();
};

export type IntegrationEnv = {
  upstreamUrl: string;
  backendUrl: string;
  mongoUrl: string;
  seedManifestPath: string;
  sessionSecret: string;
};

export type SeedManifestRoom = {
  roomId: string;
  kind: 'channel' | 'group' | 'dm';
  name?: string;
  title: string;
  topic?: string;
  description?: string;
  announcement?: string;
  favoriteForAlice?: boolean;
  hiddenForAlice?: boolean;
};

export type SeedManifestMessage = {
  roomKey: string;
  messageId?: string;
  text?: string;
  parentMessageId?: string;
  attachmentTitle?: string;
};

export type SeedManifest = {
  version: 1;
  seedRunTag: string;
  workspace: {
    siteName: string;
  };
  users: Record<string, Pick<FixtureUser, 'username' | 'displayName'> & { userId: string }>;
  rooms: Record<string, SeedManifestRoom>;
  messages: Record<string, SeedManifestMessage>;
};

export const defaultSeedManifestPath = '/tmp/betterchat-seed-manifest.json';
export const defaultSessionSecret = 'betterchat-integration-session-secret';

export const getIntegrationEnv = (env: NodeJS.ProcessEnv = process.env): IntegrationEnv => ({
  upstreamUrl: env.BETTERCHAT_TEST_UPSTREAM_URL || 'http://127.0.0.1:3100',
  backendUrl: env.BETTERCHAT_TEST_BACKEND_URL || 'http://127.0.0.1:3200',
  mongoUrl: env.BETTERCHAT_TEST_MONGO_URL || 'mongodb://127.0.0.1:37017/rocketchat?replicaSet=rs0',
  seedManifestPath: env.BETTERCHAT_TEST_SEED_MANIFEST_PATH || defaultSeedManifestPath,
  sessionSecret: env.BETTERCHAT_TEST_SESSION_SECRET || defaultSessionSecret,
});

export const createMongoClient = (mongoUrl: string): MongoClient => new MongoClient(mongoUrl);
export const readSeedManifest = (path: string = getIntegrationEnv().seedManifestPath): SeedManifest =>
  JSON.parse(readFileSync(path, 'utf8')) as SeedManifest;

export const clearSeedManifest = async (path: string = getIntegrationEnv().seedManifestPath): Promise<void> => {
  await rm(path, { force: true });
};

export const writeSeedManifestAtomically = async (
  manifest: SeedManifest,
  path: string = getIntegrationEnv().seedManifestPath,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.betterchat-seed-manifest.${process.pid}.${randomUUID()}.tmp`);

  try {
    await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const waitFor = async (
  description: string,
  action: () => Promise<void>,
  timeoutMs = 90_000,
  intervalMs = 1_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await action();
      return;
    } catch (error) {
      lastError = error;
      await sleep(intervalMs);
    }
  }

  throw new Error(`${description} did not become ready in ${timeoutMs}ms: ${String(lastError)}`);
};

export const waitForRocketChat = async (upstreamUrl: string): Promise<void> => {
  await waitFor('Rocket.Chat', async () => {
    const response = await fetch(new URL('/api/info', upstreamUrl));
    if (!response.ok) {
      throw new Error(`unexpected status ${response.status}`);
    }
  });
};

export const waitForBetterChat = async (backendUrl: string): Promise<void> => {
  await waitFor('BetterChat backend', async () => {
    const response = await fetch(new URL('/api/public/bootstrap', backendUrl));
    if (!response.ok) {
      throw new Error(`unexpected status ${response.status}`);
    }

    const payload = (await response.json()) as { ok?: boolean };
    if (!payload.ok) {
      throw new Error('BetterChat bootstrap was not successful');
    }
  });
};

const defaultHeaders = {
  accept: 'application/json',
} as const;

const withJsonHeaders = (headers: HeadersInit | undefined): Headers => {
  const result = new Headers(defaultHeaders);
  if (headers) {
    new Headers(headers).forEach((value, key) => result.set(key, value));
  }
  result.set('content-type', 'application/json');
  return result;
};

const ensureOk = async (response: Response, context: string): Promise<void> => {
  if (response.ok) {
    return;
  }

  const body = await response.text();
  throw new Error(`${context} failed with ${response.status}: ${body}`);
};

export const parseCookie = (response: Response): string | undefined => {
  const header = response.headers.get('set-cookie');
  if (!header) {
    return undefined;
  }

  const firstSegment = header.split(';', 1)[0];
  return firstSegment || undefined;
};

export const expectBetterChatSuccess = async <T>(response: Response): Promise<T> => {
  await ensureOk(response, 'BetterChat request');
  const payload = (await response.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!payload.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'BetterChat response was not successful');
  }

  return payload.data;
};

export class BetterChatClient {
  private cookie?: string;

  constructor(private readonly baseUrl: string) {}

  private updateCookie(response: Response): void {
    const setCookie = parseCookie(response);
    if (setCookie === undefined) {
      return;
    }

    this.cookie = setCookie.includes('=') && !setCookie.endsWith('=') ? setCookie : undefined;
  }

  cookieHeader(): string | undefined {
    return this.cookie;
  }

  async loginRaw(username: string, password: string): Promise<Response> {
    const response = await fetch(new URL('/api/session/login', this.baseUrl), {
      method: 'POST',
      headers: withJsonHeaders(undefined),
      body: JSON.stringify({ login: username, password }),
    });

    this.updateCookie(response);
    return response;
  }

  async login(username: string, password: string): Promise<unknown> {
    const response = await this.loginRaw(username, password);
    return expectBetterChatSuccess(response);
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.getRaw(path);

    return expectBetterChatSuccess<T>(response);
  }

  async postRaw(path: string, body?: unknown): Promise<Response> {
    return this.requestRaw('POST', path, body);
  }

  async putRaw(path: string, body: unknown): Promise<Response> {
    return this.requestRaw('PUT', path, body);
  }

  async patchRaw(path: string, body: unknown): Promise<Response> {
    return this.requestRaw('PATCH', path, body);
  }

  async deleteRaw(path: string): Promise<Response> {
    return this.requestRaw('DELETE', path);
  }

  private async requestRaw(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<Response> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers:
        body === undefined
          ? this.cookie
            ? { cookie: this.cookie, ...defaultHeaders }
            : defaultHeaders
          : this.cookie
            ? { cookie: this.cookie, ...Object.fromEntries(withJsonHeaders(undefined)) }
            : withJsonHeaders(undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    this.updateCookie(response);

    return response;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.postRaw(path, body);
    return expectBetterChatSuccess<T>(response);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const response = await this.putRaw(path, body);
    return expectBetterChatSuccess<T>(response);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    const response = await this.patchRaw(path, body);
    return expectBetterChatSuccess<T>(response);
  }

  async delete<T>(path: string): Promise<T> {
    const response = await this.deleteRaw(path);
    return expectBetterChatSuccess<T>(response);
  }

  async postFormRaw(path: string, formData: FormData): Promise<Response> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: this.cookie ? { cookie: this.cookie, ...defaultHeaders } : defaultHeaders,
      body: formData,
    });

    this.updateCookie(response);
    return response;
  }

  async postForm<T>(path: string, formData: FormData): Promise<T> {
    const response = await this.postFormRaw(path, formData);
    return expectBetterChatSuccess<T>(response);
  }

  async getRaw(path: string): Promise<Response> {
    return fetch(new URL(path, this.baseUrl), {
      headers: this.cookie ? { cookie: this.cookie } : undefined,
    });
  }

  async logout(): Promise<unknown> {
    const response = await this.postRaw('/api/session/logout');
    return expectBetterChatSuccess(response);
  }
}

const toConversationStreamUrl = (baseUrl: string): string => {
  const url = new URL('/api/stream', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

export type BetterChatConversationStreamCommand = ConversationStreamClientCommand;
export type BetterChatConversationStreamEvent = ConversationStreamServerEvent;

type ConversationStreamWaiter = {
  predicate: (event: ConversationStreamServerEvent) => boolean;
  resolve: (event: ConversationStreamServerEvent) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class BetterChatConversationStreamClient {
  private socket?: WebSocket;
  private readonly queuedEvents: ConversationStreamServerEvent[] = [];
  private readonly waiters = new Set<ConversationStreamWaiter>();

  constructor(private readonly baseUrl: string) {}

  async connect(cookieHeader: string | undefined): Promise<void> {
    if (!cookieHeader) {
      throw new Error('Conversation stream connection requires a BetterChat session cookie');
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        toConversationStreamUrl(this.baseUrl),
        {
          headers: {
            cookie: cookieHeader,
          },
        } as never,
      );

      let settled = false;
      const onOpen = () => {
        settled = true;
        resolve();
      };
      const onError = () => {
        if (!settled) {
          reject(new Error('Conversation stream socket failed to open'));
        }
      };
      const onClose = (event: CloseEvent) => {
        if (!settled) {
          reject(new Error(`Conversation stream socket closed during connect (${event.code})`));
          return;
        }

        this.rejectWaiters(new Error(`Conversation stream socket closed (${event.code})`));
      };
      const onMessage = (event: MessageEvent<string>) => {
        const payload = JSON.parse(event.data) as ConversationStreamServerEvent;
        this.pushEvent(payload);
      };

      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
      socket.addEventListener('close', onClose);
      socket.addEventListener('message', onMessage as EventListener);
      this.socket = socket;
    });
  }

  send(command: BetterChatConversationStreamCommand): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Conversation stream socket is not open');
    }

    this.socket.send(JSON.stringify(command));
  }

  async nextEvent<TEvent extends ConversationStreamServerEvent>(
    predicate: (event: ConversationStreamServerEvent) => event is TEvent,
    timeoutMs = 15_000,
  ): Promise<TEvent> {
    const queuedIndex = this.queuedEvents.findIndex(predicate);
    if (queuedIndex >= 0) {
      const [event] = this.queuedEvents.splice(queuedIndex, 1);
      return event as TEvent;
    }

    return new Promise<TEvent>((resolve, reject) => {
      const waiter: ConversationStreamWaiter = {
        predicate,
        resolve: (event) => {
          clearTimeout(waiter.timeout);
          this.waiters.delete(waiter);
          resolve(event as TEvent);
        },
        reject: (error) => {
          clearTimeout(waiter.timeout);
          this.waiters.delete(waiter);
          reject(error);
        },
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for conversation stream event`));
        }, timeoutMs),
      };

      this.waiters.add(waiter);
    });
  }

  close(code?: number, reason?: string): void {
    this.socket?.close(code, reason);
  }

  private pushEvent(event: ConversationStreamServerEvent): void {
    for (const waiter of this.waiters) {
      if (waiter.predicate(event)) {
        waiter.resolve(event);
        return;
      }
    }

    this.queuedEvents.push(event);
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters) {
      waiter.reject(error);
    }
  }
}

export class RocketChatRestClient {
  private authHeaders?: { 'X-Auth-Token': string; 'X-User-Id': string };

  constructor(private readonly baseUrl: string) {}

  async login(username: string, password: string): Promise<void> {
    const response = await fetch(new URL('/api/v1/login', this.baseUrl), {
      method: 'POST',
      headers: withJsonHeaders(undefined),
      body: JSON.stringify({ user: username, password }),
    });
    await ensureOk(response, 'Rocket.Chat login');
    const payload = (await response.json()) as {
      data?: { authToken: string; userId: string };
    };

    if (!payload.data) {
      throw new Error('Rocket.Chat login returned no auth data');
    }

    this.authHeaders = {
      'X-Auth-Token': payload.data.authToken,
      'X-User-Id': payload.data.userId,
    };
  }

  private headers(extra?: HeadersInit): Headers {
    const headers = new Headers(defaultHeaders);

    if (this.authHeaders) {
      Object.entries(this.authHeaders).forEach(([key, value]) => headers.set(key, value));
    }

    if (extra) {
      new Headers(extra).forEach((value, key) => headers.set(key, value));
    }

    return headers;
  }

  async getJson<T>(path: string): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      headers: this.headers(),
    });
    await ensureOk(response, `Rocket.Chat GET ${path}`);
    return (await response.json()) as T;
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    await ensureOk(response, `Rocket.Chat POST ${path}`);
    return (await response.json()) as T;
  }

  async postForm<T>(path: string, formData: FormData): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: this.headers(),
      body: formData,
    });
    await ensureOk(response, `Rocket.Chat form POST ${path}`);
    return (await response.json()) as T;
  }
}
