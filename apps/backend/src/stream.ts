import type { ConversationStreamClientCommand, ConversationStreamServerEvent, PresenceState } from '@betterchat/contracts';

import type { BetterChatConfig } from './config';
import { sortDirectoryEntries } from './conversation-domain';
import { AppError, responseFromAppError, toAppError } from './errors';
import { presenceStateFromStatus } from './presence';
import { RealtimeRefreshState } from './realtime-refresh-state';
import { sameUserStreamRefreshCoalescer } from './stream-refresh-coalescing';
import { realtimeSessionRegistry } from './realtime-session-registry';
import { RealtimeWatchState } from './realtime-watch-state';
import { getSessionFromRequest } from './session-auth';
import { sessionKeyFrom, type UpstreamSession } from './session';
import { computeSnapshotVersion } from './snapshot-version';
import { createSnapshotService, type SnapshotService } from './snapshot-service';
import { type UpstreamPresenceChange, type UpstreamRealtimeCallbacks, UpstreamRealtimeBridge } from './upstream-realtime';
import { RocketChatClient } from './upstream';

const STREAM_PATH = '/api/stream';
const STREAM_UNAUTHENTICATED_CLOSE_CODE = 4_401;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const textDecoder = new TextDecoder();

const asMessageText = (value: string | BufferSource): string =>
  typeof value === 'string' ? value : textDecoder.decode(value instanceof ArrayBuffer ? new Uint8Array(value) : value);

export type ConversationStreamSocketData = {
  transport: 'conversation-stream';
  connectionId: string;
  session: UpstreamSession;
  sessionKey: string;
};

export type UpstreamRealtimeController = Pick<
  UpstreamRealtimeBridge,
  | 'publishTyping'
  | 'setPresenceUserIds'
  | 'setTypingRoomWatch'
  | 'start'
  | 'stop'
  | 'unwatchRoom'
  | 'waitForRoomSubscriptions'
  | 'waitForUserSubscriptions'
  | 'watchRoom'
>;

export type UpstreamRealtimeFactory = (callbacks: UpstreamRealtimeCallbacks) => UpstreamRealtimeController;

type DirectoryVersionHint = {
  directoryVersion?: string;
};

type ConversationVersionHint = {
  conversationVersion?: string;
  timelineVersion?: string;
};

type ThreadVersionHint = {
  threadVersion?: string;
};

type StreamRefreshOptions = {
  conversationId?: string;
  forceResync?: boolean;
};

type DirectorySnapshotState = Awaited<ReturnType<SnapshotService['directoryState']>>;
type DirectoryEntryRefreshState = Awaited<ReturnType<SnapshotService['refreshDirectoryEntryState']>>;
type DirectoryEntry = DirectorySnapshotState['snapshot']['entries'][number];
type RememberedDirectoryState = {
  counterpartUserIdByConversationId: Map<string, string>;
  entryByConversationId: Map<string, DirectoryEntry>;
  version: string;
};

export class ConversationStreamConnection {
  private readonly lastEventSignatureByKey = new Map<string, string>();
  private readonly refreshState = new RealtimeRefreshState();
  private readonly removeSessionInvalidateListener: () => void;
  private rememberedDirectoryState?: RememberedDirectoryState;
  private readonly upstreamRealtime: UpstreamRealtimeController;
  private readonly watchState = new RealtimeWatchState();
  private readonly sessionExpiresAtMs: number;
  private sessionExpiryTimer?: ReturnType<typeof setTimeout>;
  private sessionInvalidated = false;
  private stopped = false;
  private upstreamUnavailableReported = false;
  private watchingDirectory = false;

  constructor(
    private readonly config: BetterChatConfig,
    private readonly client: RocketChatClient,
    private readonly snapshotService: SnapshotService,
    private readonly sessionKey: string,
    private readonly session: UpstreamSession,
    private readonly sendRaw: (payload: string) => void,
    private readonly closeSocket: (code?: number, reason?: string) => void,
    dependencies: {
      createUpstreamRealtime?: UpstreamRealtimeFactory;
    } = {},
  ) {
    const callbacks: UpstreamRealtimeCallbacks = {
      onCapabilitiesChanged: () => {
        void this.handleCapabilitiesChanged();
      },
      onError: (error) => this.emitStreamError(error),
      onHealthy: () => this.markUpstreamHealthy(),
      onPresenceChanged: (change) => {
        void this.handlePresenceChanged(change);
      },
      onRoomChanged: (roomId, reason, options) => {
        void this.handleConversationChanged(roomId, reason, options);
      },
      onSessionInvalidated: () => realtimeSessionRegistry.invalidate(this.sessionKey),
      onSidebarChanged: (options) => {
        void this.handleDirectoryChanged(options);
      },
      onTypingChanged: (roomId, participants) => this.emitTypingUpdated(roomId, participants),
    };
    const createUpstreamRealtime = dependencies.createUpstreamRealtime
      ?? ((nextCallbacks) => new UpstreamRealtimeBridge(config.upstreamUrl, client, session, nextCallbacks));

    this.upstreamRealtime = createUpstreamRealtime(callbacks);
    this.sessionExpiresAtMs = Date.parse(session.expiresAt);
    this.removeSessionInvalidateListener = realtimeSessionRegistry.onInvalidate(this.sessionKey, () => this.invalidateSessionAndClose());
    this.scheduleSessionExpiry();
  }

  start(): void {
    void this.upstreamRealtime.start().then(() => {
      if (this.stopped || this.sessionInvalidated) {
        return;
      }

      this.markUpstreamHealthy();
      this.emit({
        type: 'ready',
        mode: 'push',
        protocol: 'conversation-stream.v1',
      });
    }).catch((error) => {
      if (this.stopped || this.sessionInvalidated) {
        return;
      }

      this.emitStreamError(toAppError(error));
    });
  }

  stop(): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    if (this.sessionExpiryTimer) {
      clearTimeout(this.sessionExpiryTimer);
      this.sessionExpiryTimer = undefined;
    }
    this.removeSessionInvalidateListener();
    this.upstreamRealtime.stop();
  }

  handleIncoming(raw: string | BufferSource): void {
    if (this.isSessionExpired()) {
      this.invalidateSessionAndClose();
      return;
    }

    let command: ConversationStreamClientCommand;

    try {
      command = JSON.parse(asMessageText(raw)) as ConversationStreamClientCommand;
    } catch {
      this.emitValidationError('Conversation stream command must be valid JSON');
      return;
    }

    switch (command.type) {
      case 'watch-directory': {
        if (
          command.directoryVersion !== undefined
          && (typeof command.directoryVersion !== 'string' || command.directoryVersion.trim().length === 0)
        ) {
          this.emitValidationError('"directoryVersion" must be a non-empty string when provided');
          return;
        }

        const alreadyWatchingDirectory = this.watchingDirectory;
        this.watchingDirectory = true;
        void this.handleWatchDirectory({
          directoryVersion: command.directoryVersion?.trim(),
        }, alreadyWatchingDirectory);
        return;
      }

      case 'unwatch-directory':
        this.watchingDirectory = false;
        this.clearDirectoryEventState();
        this.syncDirectoryPresenceTargets(new Map());
        return;

      case 'watch-conversation': {
        if (typeof command.conversationId !== 'string' || command.conversationId.trim().length === 0) {
          this.emitValidationError('"conversationId" is required for watch-conversation');
          return;
        }

        if (
          command.conversationVersion !== undefined
          && (typeof command.conversationVersion !== 'string' || command.conversationVersion.trim().length === 0)
        ) {
          this.emitValidationError('"conversationVersion" must be a non-empty string when provided');
          return;
        }

        if (
          command.timelineVersion !== undefined
          && (typeof command.timelineVersion !== 'string' || command.timelineVersion.trim().length === 0)
        ) {
          this.emitValidationError('"timelineVersion" must be a non-empty string when provided');
          return;
        }

        const conversationId = command.conversationId.trim();
        const alreadyWatchingConversation = this.watchState.hasRoom(conversationId);
        this.watchState.watchRoom(conversationId);
        this.syncConversationWatch(conversationId);
        void this.handleWatchConversation(conversationId, {
          conversationVersion: command.conversationVersion?.trim(),
          timelineVersion: command.timelineVersion?.trim(),
        }, alreadyWatchingConversation);
        return;
      }

      case 'unwatch-conversation': {
        if (typeof command.conversationId !== 'string' || command.conversationId.trim().length === 0) {
          this.emitValidationError('"conversationId" is required for unwatch-conversation');
          return;
        }

        const conversationId = command.conversationId.trim();
        this.watchState.unwatchRoom(conversationId);
        this.syncWatchedConversationPresence(conversationId, undefined);
        this.syncConversationWatch(conversationId);
        this.clearConversationEventState(conversationId);
        return;
      }

      case 'watch-thread': {
        if (typeof command.conversationId !== 'string' || command.conversationId.trim().length === 0) {
          this.emitValidationError('"conversationId" is required for watch-thread');
          return;
        }

        if (typeof command.threadId !== 'string' || command.threadId.trim().length === 0) {
          this.emitValidationError('"threadId" is required for watch-thread');
          return;
        }

        if (command.threadVersion !== undefined && (typeof command.threadVersion !== 'string' || command.threadVersion.trim().length === 0)) {
          this.emitValidationError('"threadVersion" must be a non-empty string when provided');
          return;
        }

        const conversationId = command.conversationId.trim();
        const threadId = command.threadId.trim();
        const alreadyWatchingThread = this.watchState.threadRoomId(threadId) === conversationId;
        this.watchState.watchThread(conversationId, threadId);
        this.syncConversationWatch(conversationId);
        void this.handleWatchThread(conversationId, threadId, {
          threadVersion: command.threadVersion?.trim(),
        }, alreadyWatchingThread);
        return;
      }

      case 'unwatch-thread': {
        if (typeof command.conversationId !== 'string' || command.conversationId.trim().length === 0) {
          this.emitValidationError('"conversationId" is required for unwatch-thread');
          return;
        }

        if (typeof command.threadId !== 'string' || command.threadId.trim().length === 0) {
          this.emitValidationError('"threadId" is required for unwatch-thread');
          return;
        }

        const conversationId = command.conversationId.trim();
        const threadId = command.threadId.trim();
        this.watchState.unwatchThread(conversationId, threadId);
        this.syncConversationWatch(conversationId);
        this.clearThreadEventState(threadId);
        return;
      }

      case 'set-typing':
        if (typeof command.conversationId !== 'string' || command.conversationId.trim().length === 0) {
          this.emitValidationError('"conversationId" is required for set-typing');
          return;
        }

        if (typeof command.typing !== 'boolean') {
          this.emitValidationError('"typing" must be a boolean for set-typing');
          return;
        }

        void this.handleTypingCommand(command.conversationId.trim(), command.typing);
        return;

      case 'ping':
        this.emit({ type: 'pong' });
        return;

      default:
        this.emitValidationError('Unsupported conversation stream command');
    }
  }

  private emit(event: ConversationStreamServerEvent): void {
    this.sendRaw(JSON.stringify(event));
  }

  private emitValidationError(message: string): void {
    this.emit({
      type: 'error',
      code: 'VALIDATION_ERROR',
      message,
    });
  }

  private shouldEmit(key: string, signature: string): boolean {
    const previousSignature = this.lastEventSignatureByKey.get(key);
    if (previousSignature === signature) {
      return false;
    }

    this.lastEventSignatureByKey.set(key, signature);
    return true;
  }

  private emitDirectoryResynced(
    directoryState: DirectorySnapshotState,
    options: StreamRefreshOptions = {},
  ): void {
    const snapshot = directoryState.snapshot;
    const signature = snapshot.version;
    if (!options.forceResync && !this.shouldEmit('directory', signature)) {
      return;
    }

    this.lastEventSignatureByKey.set('directory', signature);
    this.rememberDirectoryState(directoryState);
    this.emit({
      type: 'directory.resynced',
      snapshot,
    });
  }

  private emitDirectoryEntryUpsert(
    version: string,
    entry: DirectoryEntry,
  ): void {
    this.emit({
      type: 'directory.entry.upsert',
      version,
      entry,
    });
  }

  private emitDirectoryEntryRemove(version: string, conversationId: string): void {
    this.emit({
      type: 'directory.entry.remove',
      version,
      conversationId,
    });
  }

  private emitConversationResynced(
    snapshot: Awaited<ReturnType<SnapshotService['conversation']>>,
    options: StreamRefreshOptions = {},
  ): void {
    const key = `conversation:${snapshot.conversation.id}`;
    if (!options.forceResync && !this.shouldEmit(key, snapshot.version)) {
      return;
    }

    this.lastEventSignatureByKey.set(key, snapshot.version);
    this.emit({
      type: 'conversation.resynced',
      snapshot,
    });
  }

  private emitConversationUpdated(
    snapshot: Awaited<ReturnType<SnapshotService['conversation']>>,
    options: StreamRefreshOptions = {},
  ): void {
    const key = `conversation:${snapshot.conversation.id}`;
    if (!options.forceResync && !this.shouldEmit(key, snapshot.version)) {
      return;
    }

    this.lastEventSignatureByKey.set(key, snapshot.version);
    this.emit({
      type: 'conversation.updated',
      snapshot,
    });
  }

  private emitTimelineResynced(
    snapshot: Awaited<ReturnType<SnapshotService['conversationTimeline']>>,
    options: StreamRefreshOptions = {},
  ): void {
    if (snapshot.scope.kind !== 'conversation') {
      return;
    }

    const key = `timeline:${snapshot.scope.conversationId}`;
    if (!options.forceResync && !this.shouldEmit(key, snapshot.version)) {
      return;
    }

    this.lastEventSignatureByKey.set(key, snapshot.version);
    this.emit({
      type: 'timeline.resynced',
      snapshot,
    });
  }

  private emitThreadResynced(
    snapshot: Awaited<ReturnType<SnapshotService['threadConversationTimeline']>>,
    options: StreamRefreshOptions = {},
  ): void {
    if (snapshot.scope.kind !== 'thread') {
      return;
    }

    const key = `thread:${snapshot.scope.threadId}`;
    if (!options.forceResync && !this.shouldEmit(key, snapshot.version)) {
      return;
    }

    this.lastEventSignatureByKey.set(key, snapshot.version);
    this.emit({
      type: 'thread.resynced',
      snapshot,
    });
  }

  private emitPresenceUpdated(conversationId: string, presence: PresenceState): void {
    const key = `presence:${conversationId}`;
    if (!this.shouldEmit(key, presence)) {
      return;
    }

    this.emit({
      type: 'presence.updated',
      conversationId,
      presence,
    });
  }

  private emitTypingUpdated(conversationId: string, participants: string[]): void {
    if (!this.watchState.hasRoom(conversationId)) {
      return;
    }

    const signature = participants.join('\u0001');
    const key = `typing:${conversationId}`;
    if (!this.shouldEmit(key, signature)) {
      return;
    }

    this.emit({
      type: 'typing.updated',
      conversationId,
      participants,
    });
  }

  private emitResyncRequired(
    scope: Extract<ConversationStreamServerEvent, { type: 'resync.required' }>['scope'],
    options: {
      conversationId?: string;
      threadId?: string;
    } = {},
  ): void {
    const key =
      scope === 'directory'
        ? 'directory'
        : scope === 'thread'
          ? `thread:${options.threadId || 'unknown'}`
          : `conversation:${options.conversationId || 'unknown'}`;

    this.lastEventSignatureByKey.set(key, 'resync-required');
    this.emit({
      type: 'resync.required',
      scope,
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options.threadId ? { threadId: options.threadId } : {}),
    });
  }

  private clearDirectoryEventState(): void {
    this.lastEventSignatureByKey.delete('directory');
    this.rememberedDirectoryState = undefined;
  }

  private clearConversationEventState(conversationId: string): void {
    this.lastEventSignatureByKey.delete(`conversation:${conversationId}`);
    this.lastEventSignatureByKey.delete(`timeline:${conversationId}`);
    this.lastEventSignatureByKey.delete(`presence:${conversationId}`);
    this.lastEventSignatureByKey.delete(`typing:${conversationId}`);
    this.refreshState.clearRoom(conversationId);
  }

  private clearThreadEventState(threadId: string): void {
    this.lastEventSignatureByKey.delete(`thread:${threadId}`);
    this.refreshState.clearThread(threadId);
  }

  private syncDirectoryPresenceTargets(counterpartUserIdByConversationId: ReadonlyMap<string, string>): void {
    this.upstreamRealtime.setPresenceUserIds(this.watchState.setSidebarPresenceTargets(counterpartUserIdByConversationId));
  }

  private syncWatchedConversationPresence(conversationId: string, counterpartUserId: string | undefined): void {
    this.upstreamRealtime.setPresenceUserIds(this.watchState.setWatchedRoomPresence(conversationId, counterpartUserId));
  }

  private syncConversationWatch(conversationId: string): void {
    this.upstreamRealtime.setTypingRoomWatch(conversationId, this.watchState.hasRoom(conversationId));
    if (this.watchState.roomWatchRequired(conversationId)) {
      this.upstreamRealtime.watchRoom(conversationId);
      return;
    }

    this.upstreamRealtime.unwatchRoom(conversationId);
  }

  private isAlive(): boolean {
    return !this.stopped && !this.sessionInvalidated;
  }

  private beginDirectoryRefresh(): number {
    return this.refreshState.beginSidebarRefresh();
  }

  private isCurrentDirectoryRefresh(refreshId: number): boolean {
    return this.watchingDirectory && this.refreshState.isCurrentSidebarRefresh(refreshId, this.isAlive());
  }

  private beginConversationRefresh(conversationId: string): number {
    return this.refreshState.beginRoomRefresh(conversationId);
  }

  private isCurrentConversationRefresh(conversationId: string, refreshId: number): boolean {
    return this.refreshState.isCurrentRoomRefresh(conversationId, refreshId, this.isAlive(), this.watchState.hasRoom(conversationId));
  }

  private beginThreadRefresh(threadId: string): number {
    return this.refreshState.beginThreadRefresh(threadId);
  }

  private isCurrentThreadRefresh(conversationId: string, threadId: string, refreshId: number): boolean {
    return this.refreshState.isCurrentThreadRefresh(
      conversationId,
      threadId,
      refreshId,
      this.isAlive(),
      this.watchState.threadRoomId(threadId),
    );
  }

  private async fetchPresenceState(userId: string): Promise<PresenceState | undefined> {
    try {
      const response = await this.client.getUsersPresence(this.session, [userId]);
      return presenceStateFromStatus(response.users.find((user) => user._id === userId)?.status);
    } catch (error) {
      const appError = toAppError(error);
      if (appError.status === 401 || appError.code === 'UNAUTHENTICATED') {
        throw appError;
      }

      return undefined;
    }
  }

  private async handlePresenceChanged(change: UpstreamPresenceChange): Promise<void> {
    try {
      const presence = change.presence ?? await this.fetchPresenceState(change.userId);
      if (!presence) {
        return;
      }
      if (!this.isAlive()) {
        return;
      }

      this.markUpstreamHealthy();

      if (this.watchingDirectory && this.watchState.hasSidebarPresenceUser(change.userId)) {
        this.patchRememberedDirectoryPresence(change.userId, presence);
      }

      for (const conversationId of this.watchState.watchedRoomsForPresenceUser(change.userId)) {
        if (this.watchState.hasRoom(conversationId)) {
          this.emitPresenceUpdated(conversationId, presence);
        }
      }
    } catch (error) {
      this.emitStreamError(toAppError(error));
    }
  }

  private invalidateSessionAndClose(): void {
    if (this.sessionInvalidated) {
      return;
    }

    this.sessionInvalidated = true;
    this.snapshotService.clearSession(this.session);
    this.emit({ type: 'session.invalidated' });
    this.closeSocket(STREAM_UNAUTHENTICATED_CLOSE_CODE, 'session-invalidated');
    this.stop();
  }

  private isSessionExpired(now = Date.now()): boolean {
    return Number.isFinite(this.sessionExpiresAtMs) && this.sessionExpiresAtMs <= now;
  }

  private scheduleSessionExpiry(): void {
    if (!Number.isFinite(this.sessionExpiresAtMs)) {
      return;
    }

    const remainingMs = this.sessionExpiresAtMs - Date.now();
    if (remainingMs <= 0) {
      queueMicrotask(() => this.invalidateSessionAndClose());
      return;
    }

    this.sessionExpiryTimer = setTimeout(() => {
      this.sessionExpiryTimer = undefined;
      if (this.isSessionExpired()) {
        this.invalidateSessionAndClose();
        return;
      }

      this.scheduleSessionExpiry();
    }, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
  }

  private markUpstreamHealthy(): void {
    this.upstreamUnavailableReported = false;
  }

  private emitStreamError(error: AppError): void {
    if (error.status === 401) {
      realtimeSessionRegistry.invalidate(this.sessionKey);
      return;
    }

    if (error.status === 503) {
      if (this.upstreamUnavailableReported) {
        return;
      }

      this.upstreamUnavailableReported = true;
    }

    this.emit({
      type: 'error',
      code: error.code === 'UNSUPPORTED_UPSTREAM_BEHAVIOR' ? error.code : 'UPSTREAM_UNAVAILABLE',
      message: error.message,
    });
  }

  private directoryWatchAlreadyCurrent(versionHint: DirectoryVersionHint, alreadyWatchingDirectory: boolean): boolean {
    return alreadyWatchingDirectory
      && versionHint.directoryVersion !== undefined
      && this.lastEventSignatureByKey.get('directory') === versionHint.directoryVersion;
  }

  private conversationWatchAlreadyCurrent(
    conversationId: string,
    versionHint: ConversationVersionHint,
    alreadyWatchingConversation: boolean,
  ): boolean {
    return alreadyWatchingConversation
      && versionHint.conversationVersion !== undefined
      && versionHint.timelineVersion !== undefined
      && this.lastEventSignatureByKey.get(`conversation:${conversationId}`) === versionHint.conversationVersion
      && this.lastEventSignatureByKey.get(`timeline:${conversationId}`) === versionHint.timelineVersion;
  }

  private threadWatchAlreadyCurrent(
    threadId: string,
    versionHint: ThreadVersionHint,
    alreadyWatchingThread: boolean,
  ): boolean {
    return alreadyWatchingThread
      && versionHint.threadVersion !== undefined
      && this.lastEventSignatureByKey.get(`thread:${threadId}`) === versionHint.threadVersion;
  }

  private sameUserRefresh<T>(scope: string, load: () => Promise<T>): Promise<T> {
    return sameUserStreamRefreshCoalescer.run(this.session.userId, scope, load);
  }

  private refreshDirectoryStateForUser(): Promise<DirectorySnapshotState> {
    return this.sameUserRefresh('directory', () => this.snapshotService.refreshDirectoryState(this.session));
  }

  private refreshDirectoryEntryStateForUser(conversationId: string): Promise<DirectoryEntryRefreshState> {
    return this.sameUserRefresh(`directory-entry:${conversationId}`, () =>
      this.snapshotService.refreshDirectoryEntryState(this.session, conversationId)
    );
  }

  private refreshConversationStateWithTimelineForUser(conversationId: string) {
    return this.sameUserRefresh(`conversation:${conversationId}`, () =>
      this.snapshotService.refreshConversationStateWithTimeline(this.session, conversationId)
    );
  }

  private refreshThreadConversationTimelineForUser(conversationId: string, threadId: string) {
    return this.sameUserRefresh(`conversation:${conversationId}:thread:${threadId}`, () =>
      this.snapshotService.refreshThreadConversationTimeline(this.session, conversationId, threadId)
    );
  }

  private async handleWatchDirectory(versionHint: DirectoryVersionHint, alreadyWatchingDirectory = false): Promise<void> {
    if (this.directoryWatchAlreadyCurrent(versionHint, alreadyWatchingDirectory)) {
      return;
    }

    const refreshId = this.beginDirectoryRefresh();

    try {
      const directoryState = await this.refreshDirectoryStateForUser();
      if (!this.isCurrentDirectoryRefresh(refreshId)) {
        return;
      }

      this.syncDirectoryPresenceTargets(directoryState.counterpartUserIdByConversationId);
      this.markUpstreamHealthy();
      if (versionHint.directoryVersion === undefined || versionHint.directoryVersion !== directoryState.snapshot.version) {
        this.emitDirectoryResynced(directoryState);
        return;
      }

      this.lastEventSignatureByKey.set('directory', directoryState.snapshot.version);
      this.rememberDirectoryState(directoryState);
    } catch (error) {
      if (!this.isCurrentDirectoryRefresh(refreshId)) {
        return;
      }

      this.emitStreamError(toAppError(error));
    }
  }

  private async handleDirectoryChanged(options: StreamRefreshOptions = {}): Promise<void> {
    if (!this.watchingDirectory) {
      return;
    }

    const refreshId = this.beginDirectoryRefresh();

    try {
      if (options.forceResync) {
        await this.upstreamRealtime.waitForUserSubscriptions();
      }
      if (!this.isCurrentDirectoryRefresh(refreshId)) {
        return;
      }

      if (!options.forceResync && options.conversationId && this.hasRememberedDirectorySnapshot()) {
        const directoryEntryState = await this.refreshDirectoryEntryStateForUser(options.conversationId);
        if (!this.isCurrentDirectoryRefresh(refreshId)) {
          return;
        }

        this.markUpstreamHealthy();
        this.emitDirectoryEntryDeltaForConversation(options.conversationId, directoryEntryState);
        return;
      }

      const directoryState = await this.refreshDirectoryStateForUser();
      if (!this.isCurrentDirectoryRefresh(refreshId)) {
        return;
      }

      this.syncDirectoryPresenceTargets(directoryState.counterpartUserIdByConversationId);
      this.markUpstreamHealthy();
      if (options.forceResync || !this.hasRememberedDirectorySnapshot()) {
        this.emitDirectoryResynced(directoryState, options);
        return;
      }

      this.emitDirectoryDelta(directoryState);
    } catch (error) {
      if (!this.isCurrentDirectoryRefresh(refreshId)) {
        return;
      }

      this.emitStreamError(toAppError(error));
    }
  }

  private async handleCapabilitiesChanged(): Promise<void> {
    const watchedConversationIds = this.watchState.watchedConversationIds();

    await Promise.allSettled([
      this.handleDirectoryChanged({ forceResync: true }),
      ...watchedConversationIds.flatMap((conversationId) => [
        ...(this.watchState.hasRoom(conversationId)
          ? [this.handleWatchedConversationStateChanged(conversationId, { forceResync: true })]
          : []),
        ...this.watchState.threadIdsForRoom(conversationId).map((threadId) =>
          this.handleThreadChanged(conversationId, threadId, { forceResync: true })
        ),
      ]),
    ]);
  }

  private hasRememberedDirectorySnapshot(): boolean {
    return this.rememberedDirectoryState !== undefined;
  }

  private rememberDirectoryState(directoryState: DirectorySnapshotState): void {
    this.rememberedDirectoryState = {
      counterpartUserIdByConversationId: new Map(directoryState.counterpartUserIdByConversationId),
      entryByConversationId: new Map(directoryState.snapshot.entries.map((entry) => [entry.conversation.id, entry])),
      version: directoryState.snapshot.version,
    };
  }

  private patchRememberedDirectoryPresence(userId: string, presence: PresenceState): void {
    const remembered = this.rememberedDirectoryState;
    if (!remembered) {
      return;
    }

    const nextEntryByConversationId = new Map(remembered.entryByConversationId);
    const changedEntries: DirectoryEntry[] = [];

    for (const [conversationId, counterpartUserId] of remembered.counterpartUserIdByConversationId.entries()) {
      if (counterpartUserId !== userId) {
        continue;
      }

      const currentEntry = remembered.entryByConversationId.get(conversationId);
      if (!currentEntry || currentEntry.live?.counterpartPresence === presence) {
        continue;
      }

      const nextEntry: DirectoryEntry = {
        ...currentEntry,
        live: {
          ...(currentEntry.live || {}),
          counterpartPresence: presence,
        },
      };

      nextEntryByConversationId.set(conversationId, nextEntry);
      changedEntries.push(nextEntry);
    }

    if (changedEntries.length === 0) {
      return;
    }

    const version = computeSnapshotVersion({
      entries: [...nextEntryByConversationId.values()],
    });

    this.lastEventSignatureByKey.set('directory', version);
    this.rememberedDirectoryState = {
      counterpartUserIdByConversationId: new Map(remembered.counterpartUserIdByConversationId),
      entryByConversationId: nextEntryByConversationId,
      version,
    };

    for (const entry of changedEntries) {
      this.emitDirectoryEntryUpsert(version, entry);
    }
  }

  private emitDirectoryEntryDeltaForConversation(
    conversationId: string,
    directoryEntryState: DirectoryEntryRefreshState,
  ): void {
    const previousState = this.rememberedDirectoryState;
    if (!previousState) {
      return;
    }

    const nextCounterpartUserIdByConversationId = new Map(previousState.counterpartUserIdByConversationId);
    const nextEntryByConversationId = new Map(previousState.entryByConversationId);
    const nextEntry = directoryEntryState.entry;

    if (nextEntry) {
      nextEntryByConversationId.set(conversationId, nextEntry);
    } else {
      nextEntryByConversationId.delete(conversationId);
    }

    const nextCounterpartUserId = directoryEntryState.counterpartUserIdByConversationId.get(conversationId);
    if (nextCounterpartUserId) {
      nextCounterpartUserIdByConversationId.set(conversationId, nextCounterpartUserId);
    } else {
      nextCounterpartUserIdByConversationId.delete(conversationId);
    }

    const sortedEntries = sortDirectoryEntries(nextEntryByConversationId.values());
    const version = computeSnapshotVersion({ entries: sortedEntries });
    const previousEntry = previousState.entryByConversationId.get(conversationId);
    const entryChanged = JSON.stringify(previousEntry) !== JSON.stringify(nextEntry);

    this.lastEventSignatureByKey.set('directory', version);
    this.rememberedDirectoryState = {
      counterpartUserIdByConversationId: nextCounterpartUserIdByConversationId,
      entryByConversationId: new Map(sortedEntries.map((entry) => [entry.conversation.id, entry])),
      version,
    };
    this.syncDirectoryPresenceTargets(nextCounterpartUserIdByConversationId);

    if (!entryChanged) {
      return;
    }

    if (!nextEntry) {
      this.emitDirectoryEntryRemove(version, conversationId);
      return;
    }

    this.emitDirectoryEntryUpsert(version, nextEntry);
  }

  private emitDirectoryDelta(directoryState: DirectorySnapshotState): void {
    const previousState = this.rememberedDirectoryState;
    if (!previousState) {
      this.emitDirectoryResynced(directoryState);
      return;
    }

    const snapshot = directoryState.snapshot;
    const previousVersion = this.lastEventSignatureByKey.get('directory');
    if (previousVersion === snapshot.version) {
      this.rememberDirectoryState(directoryState);
      return;
    }

    const nextEntryByConversationId = new Map(snapshot.entries.map((entry) => [entry.conversation.id, entry]));

    for (const conversationId of previousState.entryByConversationId.keys()) {
      if (!nextEntryByConversationId.has(conversationId)) {
        this.emitDirectoryEntryRemove(snapshot.version, conversationId);
      }
    }

    for (const entry of snapshot.entries) {
      const previousEntry = previousState.entryByConversationId.get(entry.conversation.id);
      if (JSON.stringify(previousEntry) !== JSON.stringify(entry)) {
        this.emitDirectoryEntryUpsert(snapshot.version, entry);
      }
    }

    this.lastEventSignatureByKey.set('directory', snapshot.version);
    this.rememberDirectoryState(directoryState);
  }

  private async handleWatchConversation(
    conversationId: string,
    versionHint: ConversationVersionHint,
    alreadyWatchingConversation = false,
  ): Promise<void> {
    if (this.conversationWatchAlreadyCurrent(conversationId, versionHint, alreadyWatchingConversation)) {
      return;
    }

    const refreshId = this.beginConversationRefresh(conversationId);

    try {
      await this.upstreamRealtime.waitForRoomSubscriptions(conversationId);
      if (!this.isCurrentConversationRefresh(conversationId, refreshId)) {
        return;
      }

      const { conversationState, timeline } = await this.refreshConversationStateWithTimelineForUser(conversationId);

      if (!this.isCurrentConversationRefresh(conversationId, refreshId)) {
        return;
      }

      this.syncWatchedConversationPresence(conversationId, conversationState.counterpartUserId);
      this.markUpstreamHealthy();
      if (versionHint.conversationVersion === undefined || versionHint.conversationVersion !== conversationState.snapshot.version) {
        this.emitConversationResynced(conversationState.snapshot);
      } else {
        this.lastEventSignatureByKey.set(`conversation:${conversationId}`, conversationState.snapshot.version);
      }
      if (versionHint.timelineVersion === undefined || versionHint.timelineVersion !== timeline.version) {
        this.emitTimelineResynced(timeline);
      } else {
        this.lastEventSignatureByKey.set(`timeline:${conversationId}`, timeline.version);
      }
    } catch (error) {
      if (!this.isCurrentConversationRefresh(conversationId, refreshId)) {
        return;
      }

      const appError = toAppError(error);
      if (appError.status === 404) {
        this.handleUnavailableConversation(conversationId);
        return;
      }

      this.emitStreamError(appError);
    }
  }

  private async handleWatchThread(
    conversationId: string,
    threadId: string,
    versionHint: ThreadVersionHint,
    alreadyWatchingThread = false,
  ): Promise<void> {
    if (this.threadWatchAlreadyCurrent(threadId, versionHint, alreadyWatchingThread)) {
      return;
    }

    const refreshId = this.beginThreadRefresh(threadId);

    try {
      await this.upstreamRealtime.waitForRoomSubscriptions(conversationId);
      if (!this.isCurrentThreadRefresh(conversationId, threadId, refreshId)) {
        return;
      }

      const thread = await this.refreshThreadConversationTimelineForUser(conversationId, threadId);
      if (!this.isCurrentThreadRefresh(conversationId, threadId, refreshId)) {
        return;
      }

      this.markUpstreamHealthy();
      if (versionHint.threadVersion === undefined || versionHint.threadVersion !== thread.version) {
        this.emitThreadResynced(thread);
      } else {
        this.lastEventSignatureByKey.set(`thread:${threadId}`, thread.version);
      }
    } catch (error) {
      if (!this.isCurrentThreadRefresh(conversationId, threadId, refreshId)) {
        return;
      }

      const appError = toAppError(error);
      if (appError.status === 404) {
        this.watchState.unwatchThread(conversationId, threadId);
        this.syncConversationWatch(conversationId);
        this.clearThreadEventState(threadId);
        this.emitResyncRequired('thread', { conversationId, threadId });
        return;
      }

      this.emitStreamError(appError);
    }
  }

  private dropUnavailableConversationWatch(conversationId: string): string[] {
    const threadIds = this.watchState.dropRoom(conversationId);
    this.syncWatchedConversationPresence(conversationId, undefined);
    this.syncConversationWatch(conversationId);
    this.clearConversationEventState(conversationId);
    for (const threadId of threadIds) {
      this.clearThreadEventState(threadId);
    }

    return threadIds;
  }

  private handleUnavailableConversation(conversationId: string): void {
    const hadConversationWatch = this.watchState.hasRoom(conversationId);
    const threadIds = this.dropUnavailableConversationWatch(conversationId);

    if (this.watchingDirectory) {
      void this.handleDirectoryChanged({ forceResync: true });
    }

    if (hadConversationWatch) {
      this.emitResyncRequired('conversation', { conversationId });
    }

    for (const threadId of threadIds) {
      this.emitResyncRequired('thread', { conversationId, threadId });
    }
  }

  private async handleConversationChanged(
    conversationId: string,
    reason: 'messages-changed' | 'room-state-changed' | 'room-unavailable',
    options: StreamRefreshOptions = {},
  ): Promise<void> {
    const watchedThreadIds = this.watchState.threadIdsForRoom(conversationId);
    if (!this.watchState.hasRoom(conversationId) && watchedThreadIds.length === 0) {
      return;
    }

    if (reason === 'room-unavailable') {
      this.handleUnavailableConversation(conversationId);
      return;
    }

    if (reason === 'room-state-changed') {
      await Promise.allSettled([
        ...(this.watchState.hasRoom(conversationId) ? [this.handleWatchedConversationStateChanged(conversationId, options)] : []),
        ...watchedThreadIds.map((threadId) => this.handleThreadChanged(conversationId, threadId, options)),
      ]);
      return;
    }

    await Promise.allSettled([
      ...(this.watchState.hasRoom(conversationId) ? [this.handleWatchedConversationMessagesChanged(conversationId, options)] : []),
      ...watchedThreadIds.map((threadId) => this.handleThreadChanged(conversationId, threadId, options)),
    ]);
  }

  private async handleWatchedConversationStateChanged(
    conversationId: string,
    options: StreamRefreshOptions = {},
  ): Promise<void> {
    const refreshId = this.beginConversationRefresh(conversationId);

    try {
      if (options.forceResync) {
        await this.upstreamRealtime.waitForRoomSubscriptions(conversationId);
      }
      if (!this.isCurrentConversationRefresh(conversationId, refreshId)) {
        return;
      }

      const { conversationState, timeline } = await this.refreshConversationStateWithTimelineForUser(conversationId);
      if (!this.isCurrentConversationRefresh(conversationId, refreshId)) {
        return;
      }

      this.syncWatchedConversationPresence(conversationId, conversationState.counterpartUserId);
      this.markUpstreamHealthy();
      this.emitConversationUpdated(conversationState.snapshot, options);
      this.emitTimelineResynced(timeline, options);
    } catch (error) {
      if (!this.isCurrentConversationRefresh(conversationId, refreshId)) {
        return;
      }

      const appError = toAppError(error);
      if (appError.status === 404) {
        this.handleUnavailableConversation(conversationId);
        return;
      }

      this.emitStreamError(appError);
    }
  }

  private async handleWatchedConversationMessagesChanged(
    conversationId: string,
    options: StreamRefreshOptions = {},
  ): Promise<void> {
    const refreshId = this.beginConversationRefresh(conversationId);

    try {
      if (options.forceResync) {
        await this.upstreamRealtime.waitForRoomSubscriptions(conversationId);
      }
      if (!this.isCurrentConversationRefresh(conversationId, refreshId)) {
        return;
      }

      const { conversationState, timeline } = await this.refreshConversationStateWithTimelineForUser(conversationId);

      if (!this.isCurrentConversationRefresh(conversationId, refreshId)) {
        return;
      }

      this.syncWatchedConversationPresence(conversationId, conversationState.counterpartUserId);
      this.markUpstreamHealthy();
      this.emitConversationUpdated(conversationState.snapshot, options);
      this.emitTimelineResynced(timeline, options);
    } catch (error) {
      if (!this.isCurrentConversationRefresh(conversationId, refreshId)) {
        return;
      }

      const appError = toAppError(error);
      if (appError.status === 404) {
        this.handleUnavailableConversation(conversationId);
        return;
      }

      this.emitStreamError(appError);
    }
  }

  private async handleThreadChanged(
    conversationId: string,
    threadId: string,
    options: StreamRefreshOptions = {},
  ): Promise<void> {
    const refreshId = this.beginThreadRefresh(threadId);

    try {
      if (options.forceResync) {
        await this.upstreamRealtime.waitForRoomSubscriptions(conversationId);
      }
      if (!this.isCurrentThreadRefresh(conversationId, threadId, refreshId)) {
        return;
      }

      const thread = await this.refreshThreadConversationTimelineForUser(conversationId, threadId);
      if (!this.isCurrentThreadRefresh(conversationId, threadId, refreshId)) {
        return;
      }

      this.markUpstreamHealthy();
      this.emitThreadResynced(thread, options);
    } catch (error) {
      if (!this.isCurrentThreadRefresh(conversationId, threadId, refreshId)) {
        return;
      }

      const appError = toAppError(error);
      if (appError.status === 404) {
        this.watchState.unwatchThread(conversationId, threadId);
        this.syncConversationWatch(conversationId);
        this.clearThreadEventState(threadId);
        this.emitResyncRequired('thread', { conversationId, threadId });
        return;
      }

      this.emitStreamError(appError);
    }
  }

  private async handleTypingCommand(conversationId: string, typing: boolean): Promise<void> {
    try {
      await this.upstreamRealtime.publishTyping(conversationId, typing);
      this.markUpstreamHealthy();
    } catch (error) {
      this.emitStreamError(toAppError(error));
    }
  }
}

export class BetterChatConversationStreamGateway {
  private readonly client: RocketChatClient;
  private readonly snapshotService: SnapshotService;
  private readonly createUpstreamRealtime?: UpstreamRealtimeFactory;
  private readonly connections = new Map<string, ConversationStreamConnection>();

  constructor(
    private readonly config: BetterChatConfig,
    dependencies: {
      client?: RocketChatClient;
      createUpstreamRealtime?: UpstreamRealtimeFactory;
      snapshotService?: SnapshotService;
    } = {},
  ) {
    this.client = dependencies.client ?? new RocketChatClient(config.upstreamUrl, {
      requestTimeoutMs: config.upstreamRequestTimeoutMs,
      mediaTimeoutMs: config.upstreamMediaTimeoutMs,
    });
    this.createUpstreamRealtime = dependencies.createUpstreamRealtime;
    this.snapshotService = dependencies.snapshotService ?? createSnapshotService(config, this.client);
  }

  maybeHandleRequest(request: Request, server: Bun.Server<ConversationStreamSocketData>): Response | undefined {
    if (new URL(request.url).pathname !== STREAM_PATH) {
      return undefined;
    }

    const session = getSessionFromRequest(this.config, request);
    if (!session) {
      return responseFromAppError(new AppError('UNAUTHENTICATED', 'Authentication required', 401));
    }

    const connectionId = crypto.randomUUID();
    if (server.upgrade(request, { data: { transport: 'conversation-stream', connectionId, session, sessionKey: sessionKeyFrom(session) } })) {
      return undefined;
    }

    return responseFromAppError(new AppError('UPSTREAM_UNAVAILABLE', 'Conversation stream upgrade failed', 503));
  }

  open(ws: Bun.ServerWebSocket<ConversationStreamSocketData>): void {
    const { connectionId, session, sessionKey } = ws.data;

    const connection = new ConversationStreamConnection(
      this.config,
      this.client,
      this.snapshotService,
      sessionKey,
      session,
      (payload) => ws.send(payload),
      (code, reason) => ws.close(code, reason),
      {
        ...(this.createUpstreamRealtime ? { createUpstreamRealtime: this.createUpstreamRealtime } : {}),
      },
    );
    this.connections.set(connectionId, connection);
    connection.start();
  }

  message(ws: Bun.ServerWebSocket<ConversationStreamSocketData>, message: string | BufferSource): void {
    const connection = this.connections.get(ws.data.connectionId);
    connection?.handleIncoming(message);
  }

  close(ws: Bun.ServerWebSocket<ConversationStreamSocketData>): void {
    const connection = this.connections.get(ws.data.connectionId);
    connection?.stop();
    this.connections.delete(ws.data.connectionId);
  }

  stop(): void {
    for (const connection of this.connections.values()) {
      connection.stop();
    }

    this.connections.clear();
  }
}
