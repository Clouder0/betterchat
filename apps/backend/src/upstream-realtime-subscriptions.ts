import { AppError } from './errors';
import { createDeferred, type Deferred } from './deferred';

export type SubscriptionRegistration = {
  collection: string;
  eventName: string;
};

export type RoomStreamSubscriptionIds = {
  deleteMessageBulk?: string;
  deleteMessage?: string;
  messages?: string;
  userActivity?: string;
};

type RegistrationState = {
  pendingPresence: boolean;
  registration: SubscriptionRegistration;
};

export class UpstreamRealtimeSubscriptionState {
  private readonly initialSubscriptionIds = new Set<string>();
  private readonly pendingPresenceSubscriptionIds = new Set<string>();
  private readonly readySubscriptionIds = new Set<string>();
  private readonly registeredSubscriptions = new Map<string, RegistrationState>();
  private readonly roomSubscriptionIds = new Map<string, RoomStreamSubscriptionIds>();
  private readonly roomSubscriptionReady = new Map<string, Deferred<void>>();
  private readonly userSubscriptionIds = new Map<string, string>();
  private userSubscriptionReady?: Deferred<void>;

  clearConnectionState(preserveInitialReady: boolean): void {
    this.registeredSubscriptions.clear();
    this.pendingPresenceSubscriptionIds.clear();
    this.readySubscriptionIds.clear();
    if (!preserveInitialReady) {
      this.initialSubscriptionIds.clear();
    }
    this.roomSubscriptionReady.clear();
    this.userSubscriptionReady = undefined;
    this.userSubscriptionIds.clear();
    this.roomSubscriptionIds.clear();
  }

  clearInitialTracking(): void {
    this.initialSubscriptionIds.clear();
  }

  hasPendingInitialSubscriptions(): boolean {
    return this.initialSubscriptionIds.size > 0;
  }

  registerSubscription(
    id: string,
    registration: SubscriptionRegistration,
    options: {
      pendingPresence?: boolean;
      trackInitialReady?: boolean;
    } = {},
  ): void {
    this.registeredSubscriptions.set(id, {
      pendingPresence: options.pendingPresence === true,
      registration,
    });

    if (options.pendingPresence) {
      this.pendingPresenceSubscriptionIds.add(id);
    }

    if (options.trackInitialReady) {
      this.initialSubscriptionIds.add(id);
    }
  }

  takeRegistration(id: string): { pendingPresence: boolean; registration?: SubscriptionRegistration } {
    const state = this.registeredSubscriptions.get(id);
    this.registeredSubscriptions.delete(id);
    this.pendingPresenceSubscriptionIds.delete(id);
    this.readySubscriptionIds.delete(id);
    this.initialSubscriptionIds.delete(id);

    return {
      pendingPresence: state?.pendingPresence === true,
      registration: state?.registration,
    };
  }

  markReady(subscriptionIds: string[]): void {
    for (const subscriptionId of subscriptionIds) {
      if (this.pendingPresenceSubscriptionIds.delete(subscriptionId)) {
        this.registeredSubscriptions.delete(subscriptionId);
        continue;
      }

      this.readySubscriptionIds.add(subscriptionId);
      this.initialSubscriptionIds.delete(subscriptionId);
    }

    for (const roomId of this.roomSubscriptionIds.keys()) {
      this.updateRoomSubscriptionReadiness(roomId);
    }
    this.updateUserSubscriptionReadiness();
  }

  removeSubscription(id: string): void {
    this.registeredSubscriptions.delete(id);
    this.pendingPresenceSubscriptionIds.delete(id);
    this.readySubscriptionIds.delete(id);
    this.initialSubscriptionIds.delete(id);
  }

  getRoomSubscriptions(roomId: string): RoomStreamSubscriptionIds | undefined {
    return this.roomSubscriptionIds.get(roomId);
  }

  setRoomSubscriptions(roomId: string, subscriptions: RoomStreamSubscriptionIds): void {
    if (!subscriptions.messages && !subscriptions.deleteMessage && !subscriptions.deleteMessageBulk && !subscriptions.userActivity) {
      this.roomSubscriptionIds.delete(roomId);
      this.roomSubscriptionReady.delete(roomId);
      return;
    }

    this.roomSubscriptionIds.set(roomId, subscriptions);
    this.updateRoomSubscriptionReadiness(roomId);
  }

  roomIds(): IterableIterator<string> {
    return this.roomSubscriptionIds.keys();
  }

  removeRoomSubscriptions(roomId: string, unsubscribe: (id: string) => void): void {
    const subscriptions = this.roomSubscriptionIds.get(roomId);
    if (!subscriptions) {
      return;
    }

    for (const subscriptionId of [subscriptions.messages, subscriptions.deleteMessage, subscriptions.deleteMessageBulk, subscriptions.userActivity]) {
      if (!subscriptionId) {
        continue;
      }

      this.registeredSubscriptions.delete(subscriptionId);
      this.readySubscriptionIds.delete(subscriptionId);
      this.initialSubscriptionIds.delete(subscriptionId);
      this.pendingPresenceSubscriptionIds.delete(subscriptionId);
      unsubscribe(subscriptionId);
    }

    this.roomSubscriptionIds.delete(roomId);
    this.roomSubscriptionReady.delete(roomId);
  }

  rejectRoomSubscriptionReady(roomId: string, error: unknown): void {
    this.roomSubscriptionReady.get(roomId)?.reject(error);
    this.roomSubscriptionReady.delete(roomId);
  }

  async waitForRoomSubscriptions(roomId: string, timeoutMs: number): Promise<void> {
    const subscriptions = this.roomSubscriptionIds.get(roomId);
    const subscriptionIds = subscriptions
      ? [subscriptions.messages, subscriptions.deleteMessage, subscriptions.deleteMessageBulk, subscriptions.userActivity].filter(
          (subscriptionId): subscriptionId is string => typeof subscriptionId === 'string',
        )
      : [];

    if (subscriptionIds.length === 0 || subscriptionIds.every((subscriptionId) => this.readySubscriptionIds.has(subscriptionId))) {
      return;
    }

    let deferred = this.roomSubscriptionReady.get(roomId);
    if (!deferred) {
      deferred = createDeferred<void>();
      this.roomSubscriptionReady.set(roomId, deferred);
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime room subscription timed out', 503));
      }, timeoutMs);

      void deferred.promise.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  hasUserSubscription(eventName: string): boolean {
    return this.userSubscriptionIds.has(eventName);
  }

  addUserSubscription(eventName: string, subscriptionId: string): void {
    this.userSubscriptionIds.set(eventName, subscriptionId);
    this.updateUserSubscriptionReadiness();
  }

  userSubscriptionIdsList(): string[] {
    return [...this.userSubscriptionIds.values()].filter((subscriptionId) => typeof subscriptionId === 'string');
  }

  async waitForUserSubscriptions(timeoutMs: number): Promise<void> {
    const subscriptionIds = this.userSubscriptionIdsList();
    if (subscriptionIds.length === 0 || subscriptionIds.every((subscriptionId) => this.readySubscriptionIds.has(subscriptionId))) {
      return;
    }

    if (!this.userSubscriptionReady) {
      this.userSubscriptionReady = createDeferred<void>();
    }

    const deferred = this.userSubscriptionReady;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new AppError('UPSTREAM_UNAVAILABLE', 'Rocket.Chat realtime user subscription timed out', 503));
      }, timeoutMs);

      void deferred.promise.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private updateRoomSubscriptionReadiness(roomId: string): void {
    const subscriptions = this.roomSubscriptionIds.get(roomId);
    if (!subscriptions) {
      return;
    }

    const subscriptionIds = [subscriptions.messages, subscriptions.deleteMessage, subscriptions.deleteMessageBulk, subscriptions.userActivity].filter(
      (subscriptionId): subscriptionId is string => typeof subscriptionId === 'string',
    );
    if (subscriptionIds.length === 0) {
      return;
    }

    if (subscriptionIds.every((subscriptionId) => this.readySubscriptionIds.has(subscriptionId))) {
      this.roomSubscriptionReady.get(roomId)?.resolve();
      this.roomSubscriptionReady.delete(roomId);
      return;
    }

    if (!this.roomSubscriptionReady.has(roomId)) {
      this.roomSubscriptionReady.set(roomId, createDeferred<void>());
    }
  }

  private updateUserSubscriptionReadiness(): void {
    const subscriptionIds = this.userSubscriptionIdsList();
    if (subscriptionIds.length === 0) {
      this.userSubscriptionReady?.resolve();
      this.userSubscriptionReady = undefined;
      return;
    }

    if (subscriptionIds.every((subscriptionId) => this.readySubscriptionIds.has(subscriptionId))) {
      this.userSubscriptionReady?.resolve();
      this.userSubscriptionReady = undefined;
      return;
    }

    if (!this.userSubscriptionReady) {
      this.userSubscriptionReady = createDeferred<void>();
    }
  }
}
