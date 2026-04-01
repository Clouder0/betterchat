import { describe, expect, test } from 'bun:test';

import { RealtimeWatchState } from './realtime-watch-state';

describe('RealtimeWatchState', () => {
  test('keeps room watches active while threads in the room remain watched', () => {
    const state = new RealtimeWatchState();

    state.watchRoom('room-1');
    state.watchThread('room-1', 'thread-1');

    expect(state.roomWatchRequired('room-1')).toBe(true);

    state.unwatchRoom('room-1');

    expect(state.hasRoom('room-1')).toBe(false);
    expect(state.roomWatchRequired('room-1')).toBe(true);
    expect(state.threadIdsForRoom('room-1')).toEqual(['thread-1']);

    state.unwatchThread('room-1', 'thread-1');

    expect(state.roomWatchRequired('room-1')).toBe(false);
    expect(state.threadIdsForRoom('room-1')).toEqual([]);
  });

  test('tracks sidebar presence targets and room-presence lookups independently', () => {
    const state = new RealtimeWatchState();

    expect(
      state.setSidebarPresenceTargets(new Map([
        ['room-1', 'user-1'],
        ['room-2', 'user-2'],
      ])),
    ).toEqual(['user-1', 'user-2']);
    expect(state.hasSidebarPresenceUser('user-1')).toBe(true);
    expect(state.hasSidebarPresenceUser('user-3')).toBe(false);

    expect(state.setWatchedRoomPresence('room-1', 'user-1')).toEqual(['user-1', 'user-2']);
    expect(state.setWatchedRoomPresence('room-3', 'user-1')).toEqual(['user-1', 'user-2']);
    expect(state.setWatchedRoomPresence('room-2', 'user-2')).toEqual(['user-1', 'user-2']);

    expect(state.watchedRoomsForPresenceUser('user-1')).toEqual(['room-1', 'room-3']);
    expect(state.watchedRoomsForPresenceUser('user-2')).toEqual(['room-2']);

    state.unwatchRoom('room-1');

    expect(state.watchedRoomsForPresenceUser('user-1')).toEqual(['room-3']);
  });

  test('keeps watched-room presence subscriptions even when sidebar presence targets are cleared', () => {
    const state = new RealtimeWatchState();

    state.setSidebarPresenceTargets(new Map([['room-1', 'user-1']]));
    expect(state.setWatchedRoomPresence('room-9', 'user-9')).toEqual(['user-1', 'user-9']);

    expect(state.setSidebarPresenceTargets(new Map())).toEqual(['user-9']);
    expect(state.presenceUserIds()).toEqual(['user-9']);

    expect(state.setWatchedRoomPresence('room-9', undefined)).toEqual([]);
    expect(state.presenceUserIds()).toEqual([]);
  });
});
