import { describe, expect, test } from 'bun:test';

import { UpstreamRealtimeSubscriptionState } from './upstream-realtime-subscriptions';

describe('UpstreamRealtimeSubscriptionState', () => {
  test('waits for all room subscriptions before resolving room readiness', async () => {
    const state = new UpstreamRealtimeSubscriptionState();
    state.registerSubscription('messages', { collection: 'stream-room-messages', eventName: 'room-1' });
    state.registerSubscription('delete', { collection: 'stream-notify-room', eventName: 'room-1/deleteMessage' });
    state.registerSubscription('delete-bulk', { collection: 'stream-notify-room', eventName: 'room-1/deleteMessageBulk' });
    state.registerSubscription('typing', { collection: 'stream-notify-room', eventName: 'room-1/user-activity' });
    state.setRoomSubscriptions('room-1', {
      messages: 'messages',
      deleteMessage: 'delete',
      deleteMessageBulk: 'delete-bulk',
      userActivity: 'typing',
    });

    const waitPromise = state.waitForRoomSubscriptions('room-1', 100);
    const pendingBeforeReady = await Promise.race([
      waitPromise.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 10)),
    ]);

    expect(pendingBeforeReady).toBe('pending');

    state.markReady(['messages', 'delete', 'delete-bulk']);
    const stillPending = await Promise.race([
      waitPromise.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 10)),
    ]);

    expect(stillPending).toBe('pending');

    state.markReady(['typing']);
    await expect(waitPromise).resolves.toBeUndefined();
  });

  test('tracks initial-ready user subscriptions separately from pending presence updates', async () => {
    const state = new UpstreamRealtimeSubscriptionState();

    state.registerSubscription(
      'user-subscriptions',
      { collection: 'stream-notify-user', eventName: 'alice/subscriptions-changed' },
      { trackInitialReady: true },
    );
    state.addUserSubscription('alice/subscriptions-changed', 'user-subscriptions');

    state.registerSubscription(
      'presence-update',
      { collection: 'stream-user-presence', eventName: '' },
      { pendingPresence: true },
    );

    expect(state.hasPendingInitialSubscriptions()).toBe(true);

    const waitPromise = state.waitForUserSubscriptions(100);
    state.markReady(['presence-update']);

    const pendingAfterPresenceReady = await Promise.race([
      waitPromise.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 10)),
    ]);

    expect(pendingAfterPresenceReady).toBe('pending');
    expect(state.hasPendingInitialSubscriptions()).toBe(true);

    state.markReady(['user-subscriptions']);

    await expect(waitPromise).resolves.toBeUndefined();
    expect(state.hasPendingInitialSubscriptions()).toBe(false);
  });
});
