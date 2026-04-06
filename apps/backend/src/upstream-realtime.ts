import type { PresenceState } from '@betterchat/contracts';

import { CONVERSATION_SETTING_IDS } from './capabilities';
import { AppError, toAppError } from './errors';
import { createDeferred } from './deferred';
import type { UpstreamSession } from './session';
import {
  type RoomStreamSubscriptionIds,
  UpstreamRealtimeSubscriptionState,
} from './upstream-realtime-subscriptions';
import { RocketChatClient } from './upstream';

const SUPPORTED_DDP_VERSIONS = ['1', 'pre2', 'pre1'] as const;
const USER_TYPING_ACTIVITY = 'user-typing';
const RECONNECT_BASE_DELAY_MS = 250;
const RECONNECT_MAX_DELAY_MS = 5_000;
const AUTH_READY_TIMEOUT_MS = 5_000;
const ROOM_READY_TIMEOUT_MS = 5_000;
const DDP_PRESENCE_STATE_BY_STATUS_CODE: readonly PresenceState[] = ['offline', 'online', 'away', 'busy', 'offline'];
const CAPABILITY_RELEVANT_SETTING_IDS = new Set<string>(CONVERSATION_SETTING_IDS);

type StreamCollectionName =
  | 'stream-notify-all'
  | 'stream-notify-logged'
  | 'stream-notify-room'
  | 'stream-notify-user'
  | 'stream-room-messages'
  | 'stream-user-presence';

type DdpError = {
  error?: string | number;
  reason?: string;
  message?: string;
  details?: unknown;
};

type DdpConnectedMessage = {
  msg: 'connected';
  session: string;
};

type DdpPingMessage = {
  msg: 'ping';
  id?: string;
};

type DdpResultMessage = {
  msg: 'result';
  id: string;
  result?: unknown;
  error?: DdpError;
};

type DdpReadyMessage = {
  msg: 'ready';
  subs: string[];
};

type DdpNoSubMessage = {
  msg: 'nosub';
  id: string;
  error?: DdpError;
};

type DdpStreamCollectionMessage = {
  msg: 'changed';
  collection: StreamCollectionName;
  fields?: {
    eventName?: string;
    args?: unknown[];
  };
};

type PendingMethodCall = {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
};

type UpstreamRealtimeInvalidateOptions = {
  conversationId?: string;
  forceResync?: boolean;
};

export type UpstreamRealtimeCallbacks = {
  onCapabilitiesChanged: () => void;
  onError: (error: AppError) => void;
  onHealthy: () => void;
  onMessagesDeleted: (roomId: string, messageIds: string[]) => void;
  onPresenceChanged: (change: UpstreamPresenceChange) => void;
  onRoomChanged: (
    roomId: string,
    reason: 'messages-changed' | 'room-state-changed' | 'room-unavailable',
    options?: UpstreamRealtimeInvalidateOptions,
  ) => void;
  onSessionInvalidated: () => void;
  onSidebarChanged: (options?: UpstreamRealtimeInvalidateOptions) => void;
  onTypingChanged: (roomId: string, participants: string[]) => void;
};

export type ParsedStreamCollectionEvent = {
  args: unknown[];
  collection: StreamCollectionName;
  eventName: string;
};

export type UpstreamPresenceChange = {
  userId: string;
  presence?: PresenceState;
};

const toUpstreamRealtimeUrl = (upstreamUrl: string): string => {
  const url = new URL('/websocket', upstreamUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

const isStreamCollectionName = (value: string): value is StreamCollectionName =>
  value === 'stream-notify-all'
  || value === 'stream-notify-logged'
  || value === 'stream-notify-room'
  || value === 'stream-notify-user'
  || value === 'stream-room-messages'
  || value === 'stream-user-presence';

export const parseStreamCollectionEvent = (payload: unknown): ParsedStreamCollectionEvent | undefined => {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  if (!('msg' in payload) || payload.msg !== 'changed') {
    return undefined;
  }

  if (!('collection' in payload) || typeof payload.collection !== 'string' || !isStreamCollectionName(payload.collection)) {
    return undefined;
  }

  if (
    !('fields' in payload)
    || !payload.fields
    || typeof payload.fields !== 'object'
    || !('eventName' in payload.fields)
    || typeof payload.fields.eventName !== 'string'
    || !('args' in payload.fields)
    || !Array.isArray(payload.fields.args)
  ) {
    return undefined;
  }

  return {
    args: payload.fields.args,
    collection: payload.collection,
    eventName: payload.fields.eventName,
  };
};

export const parsePresenceChangedEvent = (
  event: ParsedStreamCollectionEvent,
): UpstreamPresenceChange | undefined => {
  if (event.collection !== 'stream-user-presence') {
    return undefined;
  }

  const [presenceArgs] = event.args;
  if (!Array.isArray(presenceArgs) || typeof presenceArgs[0] !== 'string' || event.eventName.trim().length === 0) {
    return undefined;
  }

  const nextPresence =
    typeof presenceArgs[1] === 'number'
      ? DDP_PRESENCE_STATE_BY_STATUS_CODE[presenceArgs[1]]
      : undefined;

  return {
    userId: event.eventName,
    ...(nextPresence !== undefined ? { presence: nextPresence } : {}),
  };
};

export const reduceTypingParticipants = ({
  activities,
  actorLabel,
  currentParticipants,
  selfLabels,
}: {
  activities: string[];
  actorLabel: string;
  currentParticipants: Iterable<string>;
  selfLabels: Iterable<string>;
}): string[] => {
  const nextParticipants = new Set(currentParticipants);
  const normalizedActorLabel = actorLabel.trim();

  if (!normalizedActorLabel) {
    return [...nextParticipants];
  }

  if (new Set(selfLabels).has(normalizedActorLabel)) {
    return [...nextParticipants];
  }

  if (activities.includes(USER_TYPING_ACTIVITY)) {
    nextParticipants.add(normalizedActorLabel);
  } else {
    nextParticipants.delete(normalizedActorLabel);
  }

  return [...nextParticipants];
};

const toDdpMethodError = (error: DdpError | undefined): AppError =>
  new AppError('UPSTREAM_REJECTED', error?.reason || error?.message || 'Rocket.Chat realtime method failed', 502, error);

const isSessionInvalidationError = (error: unknown): boolean => {
  const appError = toAppError(error);
  return appError.status === 401 || appError.code === 'UNAUTHENTICATED' || appError.message.toLowerCase().includes('logged out');
};

const roomIdFromEventName = (eventName: string): string => eventName.split('/', 1)[0] || eventName;
const globalSubscriptionKeyFrom = (collection: 'stream-notify-all' | 'stream-notify-logged' | 'stream-notify-user', eventName: string): string =>
  `${collection}:${eventName}`;
const mandatoryGlobalCollection = (
  collection: string,
): collection is 'stream-notify-all' | 'stream-notify-logged' | 'stream-notify-user' =>
  collection === 'stream-notify-all' || collection === 'stream-notify-logged' || collection === 'stream-notify-user';

export class UpstreamRealtimeBridge {
  private authReady = createDeferred<void>();
  private authenticated = false;
  private initialReady = createDeferred<void>();
  private initialReadyResolved = false;
  private readonly pendingMethodCalls = new Map<string, PendingMethodCall>();
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly subscriptions = new UpstreamRealtimeSubscriptionState();
  private socket?: WebSocket;
  private stopped = false;
  private readonly typingParticipantsByRoom = new Map<string, string[]>();
  private readonly typingRoomIds = new Set<string>();
  private readonly watchedPresenceUserIds = new Set<string>();
  private readonly watchedRoomIds = new Set<string>();
  private readonly selfLabels = new Set<string>();
  private hasAuthenticatedOnce = false;
  private nextIdCounter = 0;

  constructor(
    private readonly upstreamUrl: string,
    private readonly client: RocketChatClient,
    private readonly session: UpstreamSession,
    private readonly callbacks: UpstreamRealtimeCallbacks,
  ) {
    this.selfLabels.add(session.username);
    this.selfLabels.add(session.displayName);
  }

  start(): Promise<void> {
    this.openSocket();
    return this.initialReady.promise;
  }

  stop(): void {
    this.stopped = true;
    this.authenticated = false;
    this.authReady.reject(new Error('Upstream realtime bridge stopped'));
    this.initialReady.reject(new Error('Upstream realtime bridge stopped'));

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.rejectPendingMethodCalls(new Error('Upstream realtime bridge stopped'));

    if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
      this.socket.close();
    }

    this.socket = undefined;
  }

  watchRoom(roomId: string): void {
    this.watchedRoomIds.add(roomId);
    this.ensureRoomSubscriptions(roomId);
  }

  unwatchRoom(roomId: string): void {
    this.watchedRoomIds.delete(roomId);
    this.typingRoomIds.delete(roomId);
    this.removeRoomSubscriptions(roomId);
    this.emitTypingChanged(roomId, []);
  }

  setTypingRoomWatch(roomId: string, active: boolean): void {
    if (active) {
      this.typingRoomIds.add(roomId);
      if (this.authenticated && this.watchedRoomIds.has(roomId)) {
        this.ensureRoomSubscriptions(roomId);
      }
      return;
    }

    this.typingRoomIds.delete(roomId);
    if (this.authenticated && this.watchedRoomIds.has(roomId)) {
      this.ensureRoomSubscriptions(roomId);
    }
    this.emitTypingChanged(roomId, []);
  }

  setPresenceUserIds(userIds: Iterable<string>): void {
    const nextUserIds = new Set(
      [...userIds]
        .map((userId) => userId.trim())
        .filter((userId) => userId.length > 0),
    );

    const added = [...nextUserIds].filter((userId) => !this.watchedPresenceUserIds.has(userId));
    const removed = [...this.watchedPresenceUserIds].filter((userId) => !nextUserIds.has(userId));

    this.watchedPresenceUserIds.clear();
    for (const userId of nextUserIds) {
      this.watchedPresenceUserIds.add(userId);
    }

    if (this.authenticated) {
      this.sendPresenceSubscriptionUpdate(added, removed);
    }
  }

  async waitForRoomSubscriptions(roomId: string, timeoutMs = ROOM_READY_TIMEOUT_MS): Promise<void> {
    await this.waitForAuthentication();
    this.ensureRoomSubscriptions(roomId);
    await this.subscriptions.waitForRoomSubscriptions(roomId, timeoutMs);
  }

  async waitForUserSubscriptions(timeoutMs = ROOM_READY_TIMEOUT_MS): Promise<void> {
    await this.waitForAuthentication();
    this.ensureUserSubscriptions(false);
    await this.subscriptions.waitForUserSubscriptions(timeoutMs);
  }

  async publishTyping(roomId: string, typing: boolean): Promise<void> {
    await this.waitForAuthentication();

    const labels = [...new Set([this.session.username, this.session.displayName].filter((value): value is string => value.trim().length > 0))];
    let lastError: unknown;

    for (const label of labels) {
      try {
        await this.callMethod('stream-notify-room', `${roomId}/user-activity`, label, typing ? [USER_TYPING_ACTIVITY] : []);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw toAppError(lastError);
  }

  private openSocket(): void {
    if (this.stopped) {
      return;
    }

    this.authenticated = false;
    this.authReady = createDeferred<void>();
    const socket = new WebSocket(toUpstreamRealtimeUrl(this.upstreamUrl));
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (socket !== this.socket || this.stopped) {
        return;
      }

      this.send({
        msg: 'connect',
        support: [...SUPPORTED_DDP_VERSIONS],
        version: '1',
      });
    });

    socket.addEventListener('message', (event) => {
      if (socket !== this.socket || this.stopped) {
        return;
      }

      this.handleMessage(event.data);
    });

    socket.addEventListener('close', () => {
      if (socket !== this.socket) {
        return;
      }

      this.socket = undefined;
      this.authenticated = false;
      this.authReady.reject(new Error('Upstream realtime bridge disconnected'));
      this.rejectPendingMethodCalls(new Error('Upstream realtime bridge disconnected'));
      this.subscriptions.clearConnectionState(this.initialReadyResolved);

      if (this.stopped) {
        return;
      }

      void this.handleUnexpectedDisconnect();
    });

    socket.addEventListener('error', () => {
      if (socket !== this.socket || this.stopped) {
        return;
      }

      this.callbacks.onError(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime websocket failed', 503));
    });
  }

  private async handleUnexpectedDisconnect(): Promise<void> {
    const sessionStillValid = await this.probeSessionStillValid();
    if (!sessionStillValid) {
      this.stop();
      this.callbacks.onSessionInvalidated();
      return;
    }

    this.scheduleReconnect();
  }

  private async probeSessionStillValid(): Promise<boolean> {
    try {
      await this.client.getMe(this.session);
      return true;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.status === 401) {
        return false;
      }

      this.callbacks.onError(appError);
      return true;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }

    const reconnectDelayMs = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempt += 1;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket();
    }, reconnectDelayMs);
  }

  private handleMessage(rawMessage: string | ArrayBufferLike | Blob | BufferSource): void {
    const payloadText =
      typeof rawMessage === 'string'
        ? rawMessage
        : rawMessage instanceof Blob
          ? undefined
          : new TextDecoder().decode(rawMessage instanceof ArrayBuffer ? new Uint8Array(rawMessage) : rawMessage);

    if (!payloadText) {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      return;
    }

    if (!payload || typeof payload !== 'object' || !('msg' in payload) || typeof payload.msg !== 'string') {
      return;
    }

    switch (payload.msg) {
      case 'connected':
        void this.handleConnected(payload as DdpConnectedMessage);
        return;

      case 'ping':
        this.handlePing(payload as DdpPingMessage);
        return;

      case 'result':
        this.handleResult(payload as DdpResultMessage);
        return;

      case 'ready':
        this.handleReady(payload as DdpReadyMessage);
        return;

      case 'nosub':
        this.handleNoSub(payload as DdpNoSubMessage);
        return;

      case 'changed':
        this.handleCollectionChanged(payload as DdpStreamCollectionMessage);
        return;

      default:
        return;
    }
  }

  private async handleConnected(_payload: DdpConnectedMessage): Promise<void> {
    this.reconnectAttempt = 0;

    try {
      await this.callMethod('login', { resume: this.session.authToken });
    } catch (error) {
      if (isSessionInvalidationError(error)) {
        this.stop();
        this.callbacks.onSessionInvalidated();
        return;
      }

      this.callbacks.onError(toAppError(error));
      if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
        this.socket.close();
      }
      return;
    }

    if (this.stopped) {
      return;
    }

    const didReconnect = this.initialReadyResolved && this.hasAuthenticatedOnce;
    this.hasAuthenticatedOnce = true;
    this.authenticated = true;
    this.authReady.resolve();
    this.callbacks.onHealthy();

    if (!this.initialReadyResolved) {
      this.subscriptions.clearInitialTracking();
    }

    this.ensureUserSubscriptions(!this.initialReadyResolved);
    this.syncPresenceSubscriptions();
    for (const roomId of this.watchedRoomIds) {
      this.ensureRoomSubscriptions(roomId);
    }

    if (!didReconnect && !this.subscriptions.hasPendingInitialSubscriptions() && !this.initialReadyResolved) {
      this.initialReadyResolved = true;
      this.initialReady.resolve();
    }

    if (didReconnect) {
      this.resetTypingParticipants();
      this.callbacks.onSidebarChanged({ forceResync: true });
      for (const roomId of this.watchedRoomIds) {
        this.callbacks.onRoomChanged(roomId, 'room-state-changed', { forceResync: true });
      }
    }
  }

  private handlePing(payload: DdpPingMessage): void {
    this.send({
      msg: 'pong',
      ...(payload.id ? { id: payload.id } : {}),
    });
  }

  private handleResult(payload: DdpResultMessage): void {
    const pendingMethodCall = this.pendingMethodCalls.get(payload.id);
    if (!pendingMethodCall) {
      return;
    }

    this.pendingMethodCalls.delete(payload.id);
    if (payload.error) {
      pendingMethodCall.reject(toDdpMethodError(payload.error));
      return;
    }

    pendingMethodCall.resolve(payload.result);
  }

  private handleReady(payload: DdpReadyMessage): void {
    if (!Array.isArray(payload.subs)) {
      return;
    }

    this.subscriptions.markReady(payload.subs);

    if (
      !this.initialReadyResolved
      && this.authenticated
      && this.hasAuthenticatedOnce
      && !this.subscriptions.hasPendingInitialSubscriptions()
    ) {
      this.initialReadyResolved = true;
      this.initialReady.resolve();
    }
  }

  private handleNoSub(payload: DdpNoSubMessage): void {
    const { pendingPresence, registration } = this.subscriptions.takeRegistration(payload.id);
    if (pendingPresence) {
      if (payload.error) {
        this.callbacks.onError(toDdpMethodError(payload.error));
      }
      return;
    }

    if (!registration) {
      return;
    }

    const roomId = roomIdFromEventName(registration.eventName);

    if (payload.error) {
      if (registration.collection === 'stream-notify-user' && registration.eventName.endsWith('/force_logout')) {
        this.stop();
        this.callbacks.onSessionInvalidated();
        return;
      }

      if (!this.initialReadyResolved && mandatoryGlobalCollection(registration.collection)) {
        this.callbacks.onError(toDdpMethodError(payload.error));
        if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
          this.socket.close();
        }
        return;
      }

      if (this.watchedRoomIds.has(roomId)) {
        this.subscriptions.rejectRoomSubscriptionReady(roomId, toDdpMethodError(payload.error));
        this.callbacks.onRoomChanged(roomId, 'room-unavailable');
      }

      this.callbacks.onError(toDdpMethodError(payload.error));
    }
  }

  private handleCollectionChanged(payload: DdpStreamCollectionMessage): void {
    const event = parseStreamCollectionEvent(payload);
    if (!event) {
      return;
    }

    if (event.collection === 'stream-notify-user') {
      this.handleNotifyUserEvent(event.eventName, event.args);
      return;
    }

    if (event.collection === 'stream-notify-all' || event.collection === 'stream-notify-logged') {
      this.handleCapabilityEvent(event);
      return;
    }

    if (event.collection === 'stream-user-presence') {
      this.handlePresenceEvent(event);
      return;
    }

    if (event.collection === 'stream-room-messages') {
      const roomId = roomIdFromEventName(event.eventName);
      if (this.watchedRoomIds.has(roomId)) {
        this.callbacks.onRoomChanged(roomId, 'messages-changed');
      }
      return;
    }

    this.handleNotifyRoomEvent(event.eventName, event.args);
  }

  private handleCapabilityEvent(event: ParsedStreamCollectionEvent): void {
    if (event.collection === 'stream-notify-logged') {
      if (event.eventName === 'permissions-changed' || event.eventName === 'roles-change') {
        this.callbacks.onCapabilitiesChanged();
      }
      return;
    }

    if (event.eventName !== 'public-settings-changed') {
      return;
    }

    const setting = event.args[1];
    const settingId =
      setting && typeof setting === 'object' && '_id' in setting && typeof setting._id === 'string'
        ? setting._id
        : undefined;

    if (settingId === undefined || CAPABILITY_RELEVANT_SETTING_IDS.has(settingId)) {
      this.callbacks.onCapabilitiesChanged();
    }
  }

  private handlePresenceEvent(event: ParsedStreamCollectionEvent): void {
    const parsed = parsePresenceChangedEvent(event);
    if (!parsed || !this.watchedPresenceUserIds.has(parsed.userId)) {
      return;
    }

    this.callbacks.onPresenceChanged(parsed);
  }

  private handleNotifyUserEvent(eventName: string, args: unknown[]): void {
    if (eventName.endsWith('/force_logout')) {
      this.stop();
      this.callbacks.onSessionInvalidated();
      return;
    }

    if (eventName.endsWith('/subscriptions-changed')) {
      const [action, subscription] = args;
      const roomId = subscription && typeof subscription === 'object' && 'rid' in subscription && typeof subscription.rid === 'string'
        ? subscription.rid
        : undefined;

      if (action === 'removed' && !roomId) {
        this.callbacks.onSidebarChanged();
        for (const watchedRoomId of this.watchedRoomIds) {
          this.callbacks.onRoomChanged(watchedRoomId, 'room-state-changed');
        }
        return;
      }

      this.callbacks.onSidebarChanged(roomId ? { conversationId: roomId } : undefined);

      if (roomId && this.watchedRoomIds.has(roomId)) {
        this.callbacks.onRoomChanged(roomId, 'room-state-changed');
      }

      return;
    }

    if (eventName.endsWith('/rooms-changed')) {
      const [, room] = args;
      const roomId = room && typeof room === 'object' && '_id' in room && typeof room._id === 'string' ? room._id : undefined;
      this.callbacks.onSidebarChanged(roomId ? { conversationId: roomId } : undefined);

      if (roomId && this.watchedRoomIds.has(roomId)) {
        this.callbacks.onRoomChanged(roomId, 'room-state-changed');
        return;
      }

      if (!roomId) {
        for (const watchedRoomId of this.watchedRoomIds) {
          this.callbacks.onRoomChanged(watchedRoomId, 'room-state-changed');
        }
      }
    }
  }

  private handleNotifyRoomEvent(eventName: string, args: unknown[]): void {
    const roomId = roomIdFromEventName(eventName);

    if (!this.watchedRoomIds.has(roomId)) {
      return;
    }

    if (eventName.endsWith('/deleteMessage')) {
      const deletedMessage = args[0];
      const deletedMessageId =
        deletedMessage && typeof deletedMessage === 'object' && '_id' in deletedMessage && typeof deletedMessage._id === 'string'
          ? deletedMessage._id
          : undefined;
      if (deletedMessageId) {
        this.callbacks.onMessagesDeleted(roomId, [deletedMessageId]);
      }
      this.callbacks.onRoomChanged(roomId, 'messages-changed');
      return;
    }

    if (eventName.endsWith('/deleteMessageBulk')) {
      const deletedMessages = args[0];
      const deletedMessageIds =
        deletedMessages
        && typeof deletedMessages === 'object'
        && 'ids' in deletedMessages
        && Array.isArray(deletedMessages.ids)
          ? deletedMessages.ids.filter((value): value is string => typeof value === 'string' && value.length > 0)
          : [];
      if (deletedMessageIds.length > 0) {
        this.callbacks.onMessagesDeleted(roomId, deletedMessageIds);
      }
      this.callbacks.onRoomChanged(roomId, 'messages-changed');
      return;
    }

    if (!eventName.endsWith('/user-activity')) {
      return;
    }

    if (!this.typingRoomIds.has(roomId)) {
      return;
    }

    const [actorLabel, activities] = args;
    if (typeof actorLabel !== 'string' || !Array.isArray(activities) || !activities.every((activity) => typeof activity === 'string')) {
      return;
    }

    const nextParticipants = reduceTypingParticipants({
      actorLabel,
      activities,
      currentParticipants: this.typingParticipantsByRoom.get(roomId) || [],
      selfLabels: this.selfLabels,
    });

    this.emitTypingChanged(roomId, nextParticipants);
  }

  private emitTypingChanged(roomId: string, participants: string[]): void {
    const previousParticipants = this.typingParticipantsByRoom.get(roomId) || [];
    if (previousParticipants.length === participants.length && previousParticipants.every((value, index) => value === participants[index])) {
      return;
    }

    this.typingParticipantsByRoom.set(roomId, participants);
    this.callbacks.onTypingChanged(roomId, participants);
  }

  private resetTypingParticipants(): void {
    for (const roomId of this.typingRoomIds) {
      this.emitTypingChanged(roomId, []);
    }
  }

  private ensureUserSubscriptions(trackInitialReady: boolean): void {
    this.ensureGlobalSubscription('stream-notify-user', `${this.session.userId}/subscriptions-changed`, trackInitialReady);
    this.ensureGlobalSubscription('stream-notify-user', `${this.session.userId}/rooms-changed`, trackInitialReady);
    this.ensureGlobalSubscription('stream-notify-user', `${this.session.userId}/force_logout`, trackInitialReady);
    this.ensureGlobalSubscription('stream-notify-all', 'public-settings-changed', trackInitialReady);
    this.ensureGlobalSubscription('stream-notify-logged', 'permissions-changed', trackInitialReady);
    this.ensureGlobalSubscription('stream-notify-logged', 'roles-change', trackInitialReady);
  }

  private syncPresenceSubscriptions(): void {
    this.sendPresenceSubscriptionUpdate([...this.watchedPresenceUserIds], []);
  }

  private sendPresenceSubscriptionUpdate(added: string[], removed: string[]): void {
    if (!this.authenticated || (!added.length && !removed.length)) {
      return;
    }

    const id = this.nextId();
    this.subscriptions.registerSubscription(id, { collection: 'stream-user-presence', eventName: '' }, { pendingPresence: true });

    this.send({
      id,
      msg: 'sub',
      name: 'stream-user-presence',
      params: [
        '',
        {
          ...(added.length > 0 ? { added } : {}),
          ...(removed.length > 0 ? { removed } : {}),
          useCollection: false,
        },
      ],
    });
  }

  private ensureGlobalSubscription(
    collection: 'stream-notify-all' | 'stream-notify-logged' | 'stream-notify-user',
    eventName: string,
    trackInitialReady: boolean,
  ): void {
    const subscriptionKey = globalSubscriptionKeyFrom(collection, eventName);

    if (!this.authenticated || this.subscriptions.hasUserSubscription(subscriptionKey)) {
      return;
    }

    const subscriptionId = this.subscribe(collection, eventName, { trackInitialReady });
    this.subscriptions.addUserSubscription(subscriptionKey, subscriptionId);
  }

  private ensureRoomSubscriptions(roomId: string): void {
    if (!this.authenticated) {
      return;
    }

    const existing = this.subscriptions.getRoomSubscriptions(roomId) || {};
    const next: RoomStreamSubscriptionIds = { ...existing };

    if (!existing.messages) {
      next.messages = this.subscribe('stream-room-messages', roomId);
    }

    if (!existing.deleteMessage) {
      next.deleteMessage = this.subscribe('stream-notify-room', `${roomId}/deleteMessage`);
    }

    if (!existing.deleteMessageBulk) {
      next.deleteMessageBulk = this.subscribe('stream-notify-room', `${roomId}/deleteMessageBulk`);
    }

    if (this.typingRoomIds.has(roomId) && !existing.userActivity) {
      next.userActivity = this.subscribe('stream-notify-room', `${roomId}/user-activity`);
    }

    if (!this.typingRoomIds.has(roomId) && existing.userActivity) {
      this.dropRoomSubscription(existing.userActivity);
      next.userActivity = undefined;
    }

    this.subscriptions.setRoomSubscriptions(roomId, next);
  }

  private removeRoomSubscriptions(roomId: string): void {
    this.subscriptions.removeRoomSubscriptions(roomId, (subscriptionId) => this.unsubscribe(subscriptionId));
  }

  private dropRoomSubscription(subscriptionId: string): void {
    this.subscriptions.removeSubscription(subscriptionId);
    this.unsubscribe(subscriptionId);
  }

  private subscribe(
    collection: StreamCollectionName,
    eventName: string,
    options: {
      trackInitialReady?: boolean;
    } = {},
  ): string {
    const id = this.nextId();
    this.subscriptions.registerSubscription(id, { collection, eventName }, options);

    this.send({
      id,
      msg: 'sub',
      name: collection,
      params:
        collection === 'stream-room-messages'
          ? [eventName, false]
          : [
              eventName,
              {
                args: [undefined],
                useCollection: false,
              },
            ],
    });

    return id;
  }

  private unsubscribe(id: string): void {
    this.send({
      id,
      msg: 'unsub',
    });
  }

  private async waitForAuthentication(timeoutMs = AUTH_READY_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (!this.authenticated) {
      if (this.stopped) {
        throw new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime bridge is stopped', 503);
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime bridge is not ready', 503);
      }

      try {
        await Promise.race([
          this.authReady.promise,
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Rocket.Chat realtime authentication timed out')), remainingMs);
          }),
        ]);
      } catch {
        if (Date.now() >= deadline) {
          throw new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime bridge is not ready', 503);
        }
      }
    }
  }

  private callMethod(method: string, ...params: unknown[]): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime websocket is not connected', 503));
    }

    const id = this.nextId();

    return new Promise((resolve, reject) => {
      this.pendingMethodCalls.set(id, { reject, resolve });
      try {
        this.send({
          id,
          method,
          msg: 'method',
          params,
        });
      } catch (error) {
        this.pendingMethodCalls.delete(id);
        reject(error);
      }
    });
  }

  private rejectPendingMethodCalls(error: Error): void {
    for (const pendingMethodCall of this.pendingMethodCalls.values()) {
      pendingMethodCall.reject(error);
    }

    this.pendingMethodCalls.clear();
  }

  private nextId(): string {
    this.nextIdCounter += 1;
    return `betterchat-ddp-${this.nextIdCounter}`;
  }

  private send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime websocket is not connected', 503);
    }

    this.socket.send(JSON.stringify(payload));
  }
}
