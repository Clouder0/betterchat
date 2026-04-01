import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { loadRoomMessageExpansion, saveRoomMessageExpansion } from './messageExpansionMemory';

type LocalStorageShape = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'>;

const MESSAGE_EXPANSION_STORAGE_KEY = 'betterchat.timeline.message-expansion.v2';

const createLocalStorage = (): LocalStorageShape => {
	const store = new Map<string, string>();

	return {
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => {
			store.set(key, value);
		},
		removeItem: (key) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
	};
};

const originalWindow = globalThis.window;

beforeEach(() => {
	(globalThis as typeof globalThis & { window?: Window }).window = {
		localStorage: createLocalStorage(),
	} as Window;
});

afterEach(() => {
	if (originalWindow) {
		(globalThis as typeof globalThis & { window?: Window }).window = originalWindow;
		return;
	}

	delete (globalThis as typeof globalThis & { window?: Window }).window;
});

describe('messageExpansionMemory', () => {
	it('saves and loads per-room message expansion state', () => {
		saveRoomMessageExpansion(
			'ops-handoff',
			{
				'ops-002': false,
				'ops-005': true,
			},
			1_710_000_000_000,
		);

		expect(loadRoomMessageExpansion('ops-handoff')).toEqual({
			'ops-002': false,
			'ops-005': true,
		});
	});

	it('removes entries when an override returns to the automatic default', () => {
		saveRoomMessageExpansion(
			'ops-handoff',
			{
				'ops-002': true,
				'ops-005': false,
			},
			1_710_000_000_000,
		);
		saveRoomMessageExpansion(
			'ops-handoff',
			{
				'ops-002': null,
			},
			1_710_000_000_100,
		);

		expect(loadRoomMessageExpansion('ops-handoff')).toEqual({
			'ops-005': false,
		});
	});

	it('drops malformed storage payloads', () => {
		window.localStorage.setItem(
			MESSAGE_EXPANSION_STORAGE_KEY,
			JSON.stringify({
				valid: {
					updatedAt: 20,
					messages: {
						'ops-004': {
							expanded: true,
							updatedAt: 20,
						},
					},
				},
				invalid: {
					updatedAt: 21,
					messages: {
						'ops-005': {
							expanded: 'true',
							updatedAt: 21,
						},
					},
				},
			}),
		);

		expect(loadRoomMessageExpansion('valid')).toEqual({
			'ops-004': true,
		});
		expect(loadRoomMessageExpansion('invalid')).toEqual({});
	});

	it('keeps only the latest rooms and message states', () => {
		const store = Object.fromEntries(
			Array.from({ length: 60 }, (_, roomIndex) => [
				`room-${roomIndex}`,
				{
					updatedAt: roomIndex,
					messages: Object.fromEntries(
						Array.from({ length: 280 }, (_, messageIndex) => [
							`message-${messageIndex}`,
							{
								expanded: messageIndex % 2 === 0,
								updatedAt: roomIndex * 1_000 + messageIndex,
							},
						]),
					),
				},
			]),
		);

		window.localStorage.setItem(MESSAGE_EXPANSION_STORAGE_KEY, JSON.stringify(store));
		saveRoomMessageExpansion(
			'room-12',
			{
				'message-280': true,
			},
			12_999,
		);
		saveRoomMessageExpansion(
			'room-59',
			{
				'message-280': false,
			},
			59_999,
		);

		const newestRoomState = loadRoomMessageExpansion('room-59');
		const trimmedRoomState = loadRoomMessageExpansion('room-12');

		expect(loadRoomMessageExpansion('room-11')).toEqual({});
		expect(loadRoomMessageExpansion('room-0')).toEqual({});
		expect(Object.keys(newestRoomState)).toHaveLength(256);
		expect(Object.keys(trimmedRoomState)).toHaveLength(256);
		expect(newestRoomState['message-280']).toBe(false);
		expect(trimmedRoomState['message-280']).toBe(true);
		expect(trimmedRoomState['message-279']).toBe(false);
		expect(trimmedRoomState['message-26']).toBe(true);
		expect(trimmedRoomState['message-24']).toBeUndefined();
		expect(trimmedRoomState['message-23']).toBeUndefined();
	});
});
