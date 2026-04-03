import type { LoginRequest } from '@betterchat/contracts';

import { AppError, toAppError, type AppErrorStatus } from './errors';
import type { UpstreamSession } from './session';

export type UpstreamInfoResponse = {
  success?: boolean;
  version: string;
  info?: {
    version: string;
  };
};

export type UpstreamSetting = {
  _id: string;
  value?: unknown;
};

export type UpstreamSettingsResponse = {
  success: boolean;
  settings: UpstreamSetting[];
};

export type UpstreamPermissionDefinition = {
  _id: string;
  roles?: string[];
  _updatedAt?: string;
};

export type UpstreamPermissionsResponse = {
  success: boolean;
  update: UpstreamPermissionDefinition[];
  remove: UpstreamPermissionDefinition[];
};

export type UpstreamOauthService = {
  _id?: string;
  name?: string;
  service?: string;
  buttonLabelText?: string;
};

export type UpstreamOauthResponse = {
  success: boolean;
  services: UpstreamOauthService[];
};

export type UpstreamUser = {
  _id: string;
  username: string;
  name?: string;
  status?: string;
  avatarUrl?: string;
  roles?: string[];
};

export type UpstreamPresenceUser = {
  _id: string;
  username?: string;
  name?: string;
  status?: string;
  statusText?: string;
  avatarETag?: string;
};

export type UpstreamConversationMember = {
  _id: string;
  username?: string;
  name?: string;
  status?: string;
  avatarETag?: string;
  roles?: string[];
};

export type UpstreamLoginResponse = {
  status: 'success';
  data: {
    userId: string;
    authToken: string;
    me: UpstreamUser;
  };
};

export type UpstreamMeResponse = UpstreamUser & {
  success: boolean;
};

export type UpstreamUserInfoResponse = {
  success: boolean;
  user?: UpstreamUser;
};

export type UpstreamUsersPresenceResponse = {
  success: boolean;
  users: UpstreamPresenceUser[];
  full: boolean;
};

export type UpstreamSubscription = {
  _id: string;
  rid: string;
  t: string;
  name: string;
  fname?: string;
  open: boolean;
  ts?: string;
  unread: number;
  alert?: boolean;
  archived?: boolean;
  blocked?: boolean;
  blocker?: boolean;
  userMentions?: number;
  groupMentions?: number;
  tunread?: string[];
  tunreadUser?: string[];
  tunreadGroup?: string[];
  f?: boolean;
  ls?: string;
  lr?: string;
  _updatedAt?: string;
  roles?: string[];
};

export type UpstreamSubscriptionsResponse = {
  success: boolean;
  update: UpstreamSubscription[];
  remove: Array<{ _id: string }>;
};

export type UpstreamSubscriptionResponse = {
  success: boolean;
  subscription?: UpstreamSubscription;
};

export type UpstreamConversationMembersResponse = {
  success: boolean;
  members: UpstreamConversationMember[];
  count: number;
  offset: number;
  total: number;
};

export type UpstreamRoom = {
  _id: string;
  t: string;
  name?: string;
  fname?: string;
  archived?: boolean;
  broadcast?: boolean;
  topic?: string;
  description?: string;
  announcement?: string;
  usersCount?: number;
  avatarETag?: string;
  lm?: string;
  muted?: string[];
  reactWhenReadOnly?: boolean;
  ro?: boolean;
  unmuted?: string[];
  uids?: string[];
  usernames?: string[];
  _updatedAt?: string;
};

export type UpstreamRoomsResponse = {
  success: boolean;
  update: UpstreamRoom[];
  remove: Array<{ _id: string }>;
};

export type UpstreamRoomInfoResponse = {
  success: boolean;
  room?: UpstreamRoom;
};

export type UpstreamCreateDirectConversationResponse = {
  success: boolean;
  room?: Pick<UpstreamRoom, '_id'> & {
    rid?: string;
  };
};

export type UpstreamMessageAttachment = {
  title?: string;
  title_link?: string;
  image_url?: string;
  image_type?: string;
  message_link?: string;
  text?: string;
  author_name?: string;
  author_icon?: string;
  attachments?: UpstreamMessageAttachment[];
  image_dimensions?: {
    width?: number;
    height?: number;
  };
};

export type UpstreamMessageFile = {
  _id: string;
  name?: string;
  type?: string;
};

export type UpstreamMessageReaction = {
  names?: Array<string | undefined>;
  usernames: string[];
  federationReactionEventIds?: Record<string, string>;
};

export type UpstreamMessage = {
  _id: string;
  rid: string;
  msg?: string;
  ts: string;
  _updatedAt?: string;
  _deletedAt?: string;
  _hidden?: boolean;
  editedAt?: string;
  t?: string;
  tmid?: string;
  tshow?: boolean;
  replies?: number | string[];
  tcount?: number;
  tlm?: string;
  u: {
    _id: string;
    username?: string;
    name?: string;
  };
  attachments?: UpstreamMessageAttachment[];
  files?: UpstreamMessageFile[];
  file?: UpstreamMessageFile;
  reactions?: Record<string, UpstreamMessageReaction>;
};

export type UpstreamMessagesResponse = {
  success: boolean;
  messages: UpstreamMessage[];
  count: number;
  offset: number;
  total: number;
};

export type UpstreamGetMessageResponse = {
  success: boolean;
  message?: UpstreamMessage;
};

export type UpstreamSendMessageResponse = {
  success: boolean;
  message: UpstreamMessage;
};

export type UpstreamRoomMediaUploadResponse = {
  success: boolean;
  file: {
    _id: string;
    url: string;
  };
};

export type UpstreamRoomMediaConfirmResponse = {
  success: boolean;
  message: UpstreamMessage;
};

export type UpstreamMethodCallResponse = {
  success: boolean;
  message: string;
};

export type UpstreamDeleteMessageResponse = {
  success: boolean;
  _id?: string;
  ts?: string;
  message?: UpstreamMessage;
};

export type UpstreamSyncMessagesResponse = {
  success: boolean;
  result: {
    updated: UpstreamMessage[];
    deleted: UpstreamMessage[];
    cursor?: {
      next: string | null;
      previous: string | null;
    };
  };
};

export type UpstreamSendRoomMessageInput = {
  messageId?: string;
  roomId: string;
  text: string;
  quoteMessageLink?: string;
};

export type UpstreamSendThreadMessageInput = {
  messageId?: string;
  roomId: string;
  threadId: string;
  text: string;
  broadcastToRoom: boolean;
};

export type UpstreamUpdateMessageInput = {
  roomId: string;
  messageId: string;
  text: string;
  quoteMessageLink?: string | null;
};

export type UpstreamDeleteMessageInput = {
  roomId: string;
  messageId: string;
};

export type UpstreamSetReactionInput = {
  messageId: string;
  emoji: string;
  shouldReact?: boolean;
};

export type UpstreamSetRoomReadInput = {
  roomId: string;
  readThreads?: boolean;
};

export type UpstreamSetRoomUnreadInput = {
  roomId: string;
  firstUnreadMessageId?: string;
};

export type UpstreamConfirmRoomMediaInput = {
  roomId: string;
  fileId: string;
  text?: string;
  quoteMessageLink?: string;
  threadId?: string;
  broadcastToRoom?: boolean;
};

export type UpstreamConversationMembersInput = {
  roomId: string;
  roomType: string;
  count: number;
  offset?: number;
  filter?: string;
};

type JsonRequestOptions = {
  method?: 'GET' | 'POST';
  path: string;
  auth?: UpstreamSession;
  body?: unknown;
  rejectCode?: 'NOT_FOUND' | 'UNAUTHENTICATED' | 'UPSTREAM_REJECTED';
  rejectStatus?: AppErrorStatus;
};

type FormRequestOptions = Omit<JsonRequestOptions, 'body'> & {
  formData: FormData;
};

type RocketChatClientOptions = {
  metadataCacheTtlMs?: number;
  mediaTimeoutMs?: number;
  requestTimeoutMs?: number;
};

const SUPPORTED_DDP_VERSIONS = ['1', 'pre2', 'pre1'] as const;
const DEFAULT_METADATA_CACHE_TTL_MS = 1_000;

const withAuthHeaders = (headers: Headers, auth: UpstreamSession | undefined): Headers => {
  if (auth) {
    headers.set('X-Auth-Token', auth.authToken);
    headers.set('X-User-Id', auth.userId);
  }

  return headers;
};

const readErrorMessage = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  if ('error' in payload && typeof payload.error === 'string' && payload.error.length > 0) {
    return payload.error;
  }

  if ('message' in payload && typeof payload.message === 'string' && payload.message.length > 0) {
    return payload.message;
  }

  if ('reason' in payload && typeof payload.reason === 'string' && payload.reason.length > 0) {
    return payload.reason;
  }

  return fallback;
};

type ParsedResponsePayload = {
  hasBody: boolean;
  payload?: unknown;
  validJson: boolean;
};

const toUpstreamRealtimeUrl = (upstreamUrl: string): string => {
  const url = new URL('/websocket', upstreamUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

const parseRealtimePayloadText = (raw: MessageEvent['data']): string | undefined =>
  typeof raw === 'string'
    ? raw
    : raw instanceof Blob
      ? undefined
      : new TextDecoder().decode(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw);

const parseResponsePayload = async (response: Response): Promise<ParsedResponsePayload> => {
  const rawText = await response.text();
  if (!rawText) {
    return {
      hasBody: false,
      validJson: false,
    };
  }

  try {
    return {
      hasBody: true,
      payload: JSON.parse(rawText),
      validJson: true,
    };
  } catch {
    return {
      hasBody: true,
      validJson: false,
    };
  }
};

const assertSuccessfulUpstreamResponse = (
  response: Response,
  payload: unknown,
  rejectCode: NonNullable<JsonRequestOptions['rejectCode']>,
  rejectStatus: AppErrorStatus,
  authenticatedRequest: boolean,
): void => {
  const reportedFailure = typeof payload === 'object' && payload !== null && 'success' in payload && payload.success === false;

  if (!response.ok || reportedFailure) {
    if (response.status === 404) {
      throw new AppError('NOT_FOUND', readErrorMessage(payload, 'Rocket.Chat resource not found'), 404);
    }

    if (authenticatedRequest && response.status === 401) {
      throw new AppError('UNAUTHENTICATED', readErrorMessage(payload, 'Rocket.Chat rejected the request'), 401);
    }

    if (authenticatedRequest && response.status === 403) {
      throw new AppError('UPSTREAM_REJECTED', readErrorMessage(payload, 'Rocket.Chat rejected the request'), 403);
    }

    if (response.status >= 500) {
      throw new AppError('UPSTREAM_UNAVAILABLE', readErrorMessage(payload, 'Rocket.Chat is unavailable'), 503);
    }

    throw new AppError(rejectCode, readErrorMessage(payload, 'Rocket.Chat rejected the request'), rejectStatus);
  }
};

const requireSuccessfulPayload = <T>(payload: ParsedResponsePayload, details: Record<string, unknown>): T => {
  if (!payload.hasBody) {
    throw new AppError('UNSUPPORTED_UPSTREAM_BEHAVIOR', 'Rocket.Chat returned an empty response payload', 502, details);
  }

  if (!payload.validJson) {
    throw new AppError('UNSUPPORTED_UPSTREAM_BEHAVIOR', 'Rocket.Chat returned an invalid JSON response payload', 502, details);
  }

  return payload.payload as T;
};

export class RocketChatClient {
  private readonly metadataCache = new Map<string, { expiresAtMs: number; promise: Promise<unknown> }>();

  constructor(
    private readonly upstreamUrl: string,
    private readonly options: RocketChatClientOptions = {},
  ) {}

  private composeQuotedMessageText(
    text: string | undefined,
    quoteMessageLink: string | undefined | null,
  ): string | undefined {
    if (!quoteMessageLink) {
      return text;
    }

    return text ? `[ ](${quoteMessageLink})\n${text}` : `[ ](${quoteMessageLink})`;
  }

  private createUrl(path: string): URL {
    return new URL(path, this.upstreamUrl);
  }

  private metadataCacheTtlMs(): number {
    return this.options.metadataCacheTtlMs ?? DEFAULT_METADATA_CACHE_TTL_MS;
  }

  private pruneExpiredMetadataCache(now = Date.now()): void {
    for (const [key, entry] of this.metadataCache.entries()) {
      if (entry.expiresAtMs <= now) {
        this.metadataCache.delete(key);
      }
    }
  }

  private getCachedMetadata<T>(key: string, load: () => Promise<T>): Promise<T> {
    const ttlMs = this.metadataCacheTtlMs();
    if (ttlMs <= 0) {
      return load();
    }

    const now = Date.now();
    this.pruneExpiredMetadataCache(now);
    const cached = this.metadataCache.get(key);
    if (cached && cached.expiresAtMs > now) {
      return cached.promise as Promise<T>;
    }

    const promise = load().catch((error) => {
      const current = this.metadataCache.get(key);
      if (current?.promise === promise) {
        this.metadataCache.delete(key);
      }
      throw error;
    });

    this.metadataCache.set(key, {
      expiresAtMs: now + ttlMs,
      promise,
    });
    return promise;
  }

  private async fetchWithTimeout(
    path: string,
    init: RequestInit,
    options: {
      timeoutMs: number | undefined;
      timeoutMessage: string;
      unavailableMessage: string;
    },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs;
    const timer =
      timeoutMs !== undefined
        ? setTimeout(() => {
            controller.abort();
          }, timeoutMs)
        : undefined;

    try {
      return await fetch(this.createUrl(path), {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AppError('UPSTREAM_UNAVAILABLE', options.timeoutMessage, 503);
      }

      throw new AppError('UPSTREAM_UNAVAILABLE', options.unavailableMessage, 503);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async requestJson<T>({ method = 'GET', path, auth, body, rejectCode = 'UPSTREAM_REJECTED', rejectStatus = 502 }: JsonRequestOptions): Promise<T> {
    const headers = withAuthHeaders(new Headers(), auth);

    if (body !== undefined) {
      headers.set('content-type', 'application/json');
    }

    const response = await this.fetchWithTimeout(
      path,
      {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      {
        timeoutMs: this.options.requestTimeoutMs,
        timeoutMessage: 'Rocket.Chat request timed out',
        unavailableMessage: 'Rocket.Chat is unavailable',
      },
    );

    const payload = await parseResponsePayload(response);
    assertSuccessfulUpstreamResponse(response, payload.payload, rejectCode, rejectStatus, auth !== undefined);

    return requireSuccessfulPayload<T>(payload, {
      method,
      path,
      status: response.status,
    });
  }

  async requestForm<T>({ method = 'POST', path, auth, formData, rejectCode = 'UPSTREAM_REJECTED', rejectStatus = 502 }: FormRequestOptions): Promise<T> {
    const response = await this.fetchWithTimeout(
      path,
      {
        method,
        headers: withAuthHeaders(new Headers(), auth),
        body: formData,
      },
      {
        timeoutMs: this.options.requestTimeoutMs,
        timeoutMessage: 'Rocket.Chat request timed out',
        unavailableMessage: 'Rocket.Chat is unavailable',
      },
    );

    const payload = await parseResponsePayload(response);
    assertSuccessfulUpstreamResponse(response, payload.payload, rejectCode, rejectStatus, auth !== undefined);

    return requireSuccessfulPayload<T>(payload, {
      method,
      path,
      status: response.status,
    });
  }

  async fetchMedia(path: string, auth?: UpstreamSession, requestHeaders?: HeadersInit, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
    const response = await this.fetchWithTimeout(
      path,
      {
        method,
        headers: withAuthHeaders(new Headers(requestHeaders), auth),
      },
      {
        timeoutMs: this.options.mediaTimeoutMs,
        timeoutMessage: 'Rocket.Chat media request timed out',
        unavailableMessage: 'Rocket.Chat media is unavailable',
      },
    );

    if (auth && response.status === 401) {
      throw new AppError('UNAUTHENTICATED', 'Rocket.Chat rejected the media request', 401);
    }

    if (auth && response.status === 403) {
      throw new AppError('UPSTREAM_REJECTED', 'Rocket.Chat rejected the media request', 403);
    }

    return response;
  }

  getPublicInfo(auth?: UpstreamSession): Promise<UpstreamInfoResponse> {
    return this.requestJson({ path: '/api/info', auth, rejectCode: 'UNAUTHENTICATED', rejectStatus: 401 });
  }

  async probeRealtime(): Promise<void> {
    const realtimeUrl = toUpstreamRealtimeUrl(this.upstreamUrl);
    const timeoutMs = this.options.requestTimeoutMs;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket | undefined;
      const timer =
        timeoutMs !== undefined
          ? setTimeout(() => {
              finish(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime request timed out', 503));
            }, timeoutMs)
          : undefined;

      const finish = (error?: AppError): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (timer) {
          clearTimeout(timer);
        }

        if (socket && socket.readyState < WebSocket.CLOSING) {
          socket.close();
        }

        if (error) {
          reject(error);
          return;
        }

        resolve();
      };

      try {
        socket = new WebSocket(realtimeUrl);
      } catch {
        finish(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime is unavailable', 503));
        return;
      }

      socket.addEventListener('open', () => {
        try {
          socket?.send(JSON.stringify({
            msg: 'connect',
            support: [...SUPPORTED_DDP_VERSIONS],
            version: '1',
          }));
        } catch {
          finish(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime is unavailable', 503));
        }
      });

      socket.addEventListener('error', () => {
        finish(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime is unavailable', 503));
      });

      socket.addEventListener('close', () => {
        finish(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime closed before the DDP handshake completed', 503));
      });

      socket.addEventListener('message', (event) => {
        const payloadText = parseRealtimePayloadText(event.data);
        if (!payloadText) {
          finish(new AppError('UNSUPPORTED_UPSTREAM_BEHAVIOR', 'Rocket.Chat realtime returned an invalid handshake payload', 502));
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(payloadText);
        } catch {
          finish(new AppError('UNSUPPORTED_UPSTREAM_BEHAVIOR', 'Rocket.Chat realtime returned an invalid handshake payload', 502));
          return;
        }

        if (!payload || typeof payload !== 'object' || !('msg' in payload) || typeof payload.msg !== 'string') {
          finish(new AppError('UNSUPPORTED_UPSTREAM_BEHAVIOR', 'Rocket.Chat realtime returned an invalid handshake payload', 502));
          return;
        }

        if (payload.msg === 'connected') {
          finish();
          return;
        }

        if (payload.msg === 'failed') {
          finish(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime rejected the DDP handshake', 503, payload));
          return;
        }

        if (payload.msg === 'ping') {
          try {
            socket?.send(JSON.stringify({
              msg: 'pong',
              ...('id' in payload && typeof payload.id === 'string' ? { id: payload.id } : {}),
            }));
          } catch {
            finish(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime is unavailable', 503));
          }
        }
      });
    });
  }

  getPublicSettings(settingIds: string[]): Promise<UpstreamSettingsResponse> {
    const normalizedSettingIds = [...new Set(settingIds)].sort();
    const query = new URLSearchParams({ _id: normalizedSettingIds.join(',') }).toString();
    return this.getCachedMetadata(
      `public-settings:${normalizedSettingIds.join(',')}`,
      () => this.requestJson({ path: `/api/v1/settings.public?${query}` }),
    );
  }

  getOauthSettings(): Promise<UpstreamOauthResponse> {
    return this.requestJson({ path: '/api/v1/settings.oauth' });
  }

  login(input: LoginRequest): Promise<UpstreamLoginResponse> {
    return this.requestJson({
      method: 'POST',
      path: '/api/v1/login',
      body: {
        user: input.login,
        password: input.password,
        ...(input.code ? { code: input.code } : {}),
      },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 401,
    });
  }

  logout(session: UpstreamSession): Promise<{ status: string }> {
    return this.requestJson({
      method: 'POST',
      path: '/api/v1/logout',
      auth: session,
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 401,
    });
  }

  getMe(session: UpstreamSession): Promise<UpstreamMeResponse> {
    return this.getCachedMetadata(
      `user:${session.userId}:me`,
      () => this.requestJson({ path: '/api/v1/me', auth: session, rejectCode: 'UNAUTHENTICATED', rejectStatus: 401 }),
    );
  }

  getPermissionDefinitions(session: UpstreamSession): Promise<UpstreamPermissionsResponse> {
    return this.getCachedMetadata(
      'global:permissions',
      () => this.requestJson({
        path: '/api/v1/permissions.listAll',
        auth: session,
        rejectCode: 'UNAUTHENTICATED',
        rejectStatus: 401,
      }),
    );
  }

  getUserInfo(session: UpstreamSession, userId: string): Promise<UpstreamUserInfoResponse> {
    return this.requestJson({
      path: `/api/v1/users.info?${new URLSearchParams({ userId }).toString()}`,
      auth: session,
      rejectCode: 'NOT_FOUND',
      rejectStatus: 404,
    });
  }

  getUsersPresence(session: UpstreamSession, userIds: string[]): Promise<UpstreamUsersPresenceResponse> {
    if (userIds.length === 0) {
      return Promise.resolve({
        success: true,
        users: [],
        full: false,
      });
    }

    return this.requestJson({
      path: `/api/v1/users.presence?${new URLSearchParams({ ids: userIds.join(',') }).toString()}`,
      auth: session,
      rejectCode: 'UNAUTHENTICATED',
      rejectStatus: 401,
    });
  }

  getSubscriptions(session: UpstreamSession): Promise<UpstreamSubscriptionsResponse> {
    return this.requestJson({
      path: '/api/v1/subscriptions.get',
      auth: session,
      rejectCode: 'UNAUTHENTICATED',
      rejectStatus: 401,
    });
  }

  getSubscriptionsSince(session: UpstreamSession, updatedSince: string): Promise<UpstreamSubscriptionsResponse> {
    return this.requestJson({
      path: `/api/v1/subscriptions.get?${new URLSearchParams({ updatedSince }).toString()}`,
      auth: session,
      rejectCode: 'UNAUTHENTICATED',
      rejectStatus: 401,
    });
  }

  getSubscription(session: UpstreamSession, roomId: string): Promise<UpstreamSubscriptionResponse> {
    return this.requestJson({
      path: `/api/v1/subscriptions.getOne?${new URLSearchParams({ roomId }).toString()}`,
      auth: session,
      rejectCode: 'UNAUTHENTICATED',
      rejectStatus: 401,
    });
  }

  getRooms(session: UpstreamSession): Promise<UpstreamRoomsResponse> {
    return this.requestJson({ path: '/api/v1/rooms.get', auth: session, rejectCode: 'UNAUTHENTICATED', rejectStatus: 401 });
  }

  getRoomsSince(session: UpstreamSession, updatedSince: string): Promise<UpstreamRoomsResponse> {
    return this.requestJson({
      path: `/api/v1/rooms.get?${new URLSearchParams({ updatedSince }).toString()}`,
      auth: session,
      rejectCode: 'UNAUTHENTICATED',
      rejectStatus: 401,
    });
  }

  getRoomInfo(session: UpstreamSession, roomId: string): Promise<UpstreamRoomInfoResponse> {
    return this.requestJson({
      path: `/api/v1/rooms.info?${new URLSearchParams({ roomId }).toString()}`,
      auth: session,
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 404,
    });
  }

  openRoom(session: UpstreamSession, roomId: string): Promise<{ success: boolean }> {
    return this.requestJson({
      method: 'POST',
      path: '/api/v1/rooms.open',
      auth: session,
      body: { roomId },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 409,
    });
  }

  createDirectConversation(session: UpstreamSession, username: string): Promise<UpstreamCreateDirectConversationResponse> {
    return this.requestJson({
      method: 'POST',
      path: '/api/v1/im.create',
      auth: session,
      body: { username },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 400,
    });
  }

  openDirectConversation(session: UpstreamSession, roomId: string): Promise<{ success: boolean }> {
    return this.requestJson({
      method: 'POST',
      path: '/api/v1/im.open',
      auth: session,
      body: { roomId },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 409,
    });
  }

  getConversationMembers(
    session: UpstreamSession,
    input: UpstreamConversationMembersInput,
  ): Promise<UpstreamConversationMembersResponse> {
    const endpoint =
      input.roomType === 'c' || input.roomType === 'p'
        ? '/api/v1/rooms.membersOrderedByRole'
        : '/api/v1/im.members';

    const params = new URLSearchParams({
      roomId: input.roomId,
      count: String(input.count),
      offset: String(input.offset ?? 0),
      ...(input.filter ? { filter: input.filter } : {}),
    });

    return this.requestJson({
      path: `${endpoint}?${params.toString()}`,
      auth: session,
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 404,
    });
  }

  hideRoom(session: UpstreamSession, roomId: string): Promise<{ success: boolean }> {
    return this.requestJson({
      method: 'POST',
      path: '/api/v1/rooms.hide',
      auth: session,
      body: { roomId },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 409,
    });
  }

  getRoomMessages(
    session: UpstreamSession,
    roomType: string,
    roomId: string,
    count: number,
    offset = 0,
  ): Promise<UpstreamMessagesResponse> {
    const endpoint =
      roomType === 'c' ? '/api/v1/channels.messages' : roomType === 'p' ? '/api/v1/groups.messages' : '/api/v1/im.messages';

    const params = new URLSearchParams({
      roomId,
      count: String(count),
      offset: String(offset),
      sort: JSON.stringify({ ts: -1 }),
    });

    return this.requestJson({
      path: `${endpoint}?${params.toString()}`,
      auth: session,
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 404,
    });
  }

  getThreadMessages(session: UpstreamSession, threadId: string, count: number, offset = 0): Promise<UpstreamMessagesResponse> {
    const params = new URLSearchParams({
      tmid: threadId,
      count: String(count),
      offset: String(offset),
      sort: JSON.stringify({ ts: 1 }),
    });

    return this.requestJson({
      path: `/api/v1/chat.getThreadMessages?${params.toString()}`,
      auth: session,
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 404,
    });
  }

  getMessage(session: UpstreamSession, messageId: string): Promise<UpstreamGetMessageResponse> {
    return this.requestJson({
      path: `/api/v1/chat.getMessage?${new URLSearchParams({ msgId: messageId }).toString()}`,
      auth: session,
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 404,
    });
  }

  async findMessage(session: UpstreamSession, messageId: string): Promise<UpstreamMessage | undefined> {
    try {
      return (await this.getMessage(session, messageId)).message;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.status === 401 || appError.code === 'UNAUTHENTICATED') {
        throw appError;
      }

      if (appError.status === 404 || (appError.code === 'UPSTREAM_REJECTED' && appError.status === 400)) {
        return undefined;
      }

      throw appError;
    }
  }

  syncMessages(session: UpstreamSession, roomId: string, lastUpdate: string): Promise<UpstreamSyncMessagesResponse> {
    return this.requestJson({
      path: `/api/v1/chat.syncMessages?${new URLSearchParams({ roomId, lastUpdate }).toString()}`,
      auth: session,
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 404,
    });
  }

  async listUpdatedMessagesSince(session: UpstreamSession, roomId: string, lastUpdate: string): Promise<UpstreamMessage[]> {
    return (await this.syncMessages(session, roomId, lastUpdate)).result.updated;
  }

  sendRoomMessage(session: UpstreamSession, input: UpstreamSendRoomMessageInput): Promise<UpstreamSendMessageResponse> {
    const msg = this.composeQuotedMessageText(input.text, input.quoteMessageLink) || input.text;

    return this.requestJson({
      method: 'POST',
      path: '/api/v1/chat.sendMessage',
      auth: session,
      body: {
        message: {
          ...(input.messageId ? { _id: input.messageId } : {}),
          rid: input.roomId,
          msg,
        },
      },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 400,
    });
  }

  sendThreadMessage(session: UpstreamSession, input: UpstreamSendThreadMessageInput): Promise<UpstreamSendMessageResponse> {
    return this.requestJson({
      method: 'POST',
      path: '/api/v1/chat.sendMessage',
      auth: session,
      body: {
        message: {
          ...(input.messageId ? { _id: input.messageId } : {}),
          rid: input.roomId,
          msg: input.text,
          tmid: input.threadId,
          ...(input.broadcastToRoom ? { tshow: true } : {}),
        },
      },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 400,
    });
  }

  updateMessage(session: UpstreamSession, input: UpstreamUpdateMessageInput): Promise<UpstreamSendMessageResponse> {
    const text = this.composeQuotedMessageText(input.text, input.quoteMessageLink) || input.text;

    return this.requestJson({
      method: 'POST',
      path: '/api/v1/chat.update',
      auth: session,
      body: {
        roomId: input.roomId,
        msgId: input.messageId,
        text,
      },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 400,
    });
  }

  deleteMessage(session: UpstreamSession, input: UpstreamDeleteMessageInput): Promise<UpstreamDeleteMessageResponse> {
    return this.requestJson({
      method: 'POST',
      path: '/api/v1/chat.delete',
      auth: session,
      body: {
        roomId: input.roomId,
        msgId: input.messageId,
      },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 400,
    });
  }

  setReaction(session: UpstreamSession, input: UpstreamSetReactionInput): Promise<{ success: boolean }> {
    return this.requestJson({
      method: 'POST',
      path: '/api/v1/chat.react',
      auth: session,
      body: {
        messageId: input.messageId,
        emoji: input.emoji,
        ...(input.shouldReact !== undefined ? { shouldReact: input.shouldReact } : {}),
      },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 400,
    });
  }

  setRoomFavorite(session: UpstreamSession, roomId: string, favorite: boolean): Promise<{ success: boolean }> {
    return this.requestJson({
      method: 'POST',
      path: '/api/v1/rooms.favorite',
      auth: session,
      body: {
        roomId,
        favorite,
      },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 400,
    });
  }

  markRoomRead(session: UpstreamSession, input: UpstreamSetRoomReadInput): Promise<{ success: boolean }> {
    return this.requestJson({
      method: 'POST',
      path: '/api/v1/subscriptions.read',
      auth: session,
      body: {
        roomId: input.roomId,
        ...(input.readThreads !== undefined ? { readThreads: input.readThreads } : {}),
      },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 400,
    });
  }

  markRoomUnread(session: UpstreamSession, input: UpstreamSetRoomUnreadInput): Promise<{ success: boolean }> {
    return this.requestJson({
      method: 'POST',
      path: '/api/v1/subscriptions.unread',
      auth: session,
      body:
        input.firstUnreadMessageId !== undefined
          ? {
              firstUnreadMessage: {
                _id: input.firstUnreadMessageId,
              },
            }
          : {
              roomId: input.roomId,
            },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 400,
    });
  }

  uploadRoomMedia(session: UpstreamSession, roomId: string, file: File): Promise<UpstreamRoomMediaUploadResponse> {
    const formData = new FormData();
    formData.set('file', file, file.name);

    return this.requestForm({
      method: 'POST',
      path: `/api/v1/rooms.media/${encodeURIComponent(roomId)}`,
      auth: session,
      formData,
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 400,
    });
  }

  confirmRoomMedia(session: UpstreamSession, input: UpstreamConfirmRoomMediaInput): Promise<UpstreamRoomMediaConfirmResponse> {
    const msg = this.composeQuotedMessageText(input.text, input.quoteMessageLink);

    return this.requestJson({
      method: 'POST',
      path: `/api/v1/rooms.mediaConfirm/${encodeURIComponent(input.roomId)}/${encodeURIComponent(input.fileId)}`,
      auth: session,
      body: {
        ...(msg ? { msg } : {}),
        ...(input.threadId ? { tmid: input.threadId } : {}),
        ...(input.broadcastToRoom ? { tshow: true } : {}),
      },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 400,
    });
  }

  async deleteTemporaryUpload(session: UpstreamSession, fileId: string): Promise<void> {
    const response = await this.requestJson<UpstreamMethodCallResponse>({
      method: 'POST',
      path: '/api/v1/method.call/deleteFileMessage',
      auth: session,
      body: {
        message: JSON.stringify({
          msg: 'method',
          id: `betterchat-delete-file-${fileId}`,
          method: 'deleteFileMessage',
          params: [fileId],
        }),
      },
      rejectCode: 'UPSTREAM_REJECTED',
      rejectStatus: 400,
    });

    let methodResult: {
      error?: unknown;
      result?: unknown;
    };

    try {
      methodResult = JSON.parse(response.message) as { error?: unknown; result?: unknown };
    } catch {
      throw new AppError('UNSUPPORTED_UPSTREAM_BEHAVIOR', 'Rocket.Chat returned an invalid method.call payload', 502, {
        method: 'deleteFileMessage',
      });
    }

    if (methodResult.error) {
      throw new AppError(
        'UPSTREAM_REJECTED',
        readErrorMessage(methodResult.error, 'Rocket.Chat rejected temporary upload cleanup'),
        400,
        {
          method: 'deleteFileMessage',
          fileId,
        },
      );
    }
  }
}
