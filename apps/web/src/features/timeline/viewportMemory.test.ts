import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { loadRoomViewportSnapshot, saveRoomViewportSnapshot } from './viewportMemory';

type SessionStorageShape = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'>;

const VIEWPORT_STORAGE_KEY = 'betterchat.timeline.viewport.v1';

const createSessionStorage = (): SessionStorageShape => {
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
		sessionStorage: createSessionStorage(),
	} as Window;
});

afterEach(() => {
	if (originalWindow) {
		(globalThis as typeof globalThis & { window?: Window }).window = originalWindow;
		return;
	}

	delete (globalThis as typeof globalThis & { window?: Window }).window;
});

describe('viewportMemory', () => {
	it('saves and loads a room viewport snapshot', () => {
		saveRoomViewportSnapshot('ops-handoff', {
			anchorMessageId: 'ops-004',
			anchorOffset: 96,
			updatedAt: 1_710_000_000_000,
		});

		expect(loadRoomViewportSnapshot('ops-handoff')).toEqual({
			anchorMessageId: 'ops-004',
			anchorOffset: 96,
			updatedAt: 1_710_000_000_000,
		});
	});

	it('clamps negative offsets and ignores invalid room ids', () => {
		saveRoomViewportSnapshot('', {
			anchorMessageId: 'ops-001',
			anchorOffset: 24,
			updatedAt: 10,
		});
		saveRoomViewportSnapshot('ops-handoff', {
			anchorMessageId: 'ops-002',
			anchorOffset: -48,
			updatedAt: 11,
		});

		expect(loadRoomViewportSnapshot('')).toBeNull();
		expect(loadRoomViewportSnapshot('ops-handoff')).toEqual({
			anchorMessageId: 'ops-002',
			anchorOffset: 0,
			updatedAt: 11,
		});
	});

	it('drops malformed snapshots from session storage', () => {
		window.sessionStorage.setItem(
			VIEWPORT_STORAGE_KEY,
			JSON.stringify({
				valid: {
					anchorMessageId: 'ops-003',
					anchorOffset: 12,
					updatedAt: 20,
				},
				invalidOffset: {
					anchorMessageId: 'ops-004',
					anchorOffset: '12',
					updatedAt: 21,
				},
				emptyAnchor: {
					anchorMessageId: '',
					anchorOffset: 12,
					updatedAt: 22,
				},
			}),
		);

		expect(loadRoomViewportSnapshot('valid')).toEqual({
			anchorMessageId: 'ops-003',
			anchorOffset: 12,
			updatedAt: 20,
		});
		expect(loadRoomViewportSnapshot('invalidOffset')).toBeNull();
		expect(loadRoomViewportSnapshot('emptyAnchor')).toBeNull();
	});

	it('keeps only the most recently updated room snapshots', () => {
		for (let index = 0; index < 60; index += 1) {
			saveRoomViewportSnapshot(`room-${index}`, {
				anchorMessageId: `message-${index}`,
				anchorOffset: index,
				updatedAt: index,
			});
		}

		expect(loadRoomViewportSnapshot('room-59')?.anchorMessageId).toBe('message-59');
		expect(loadRoomViewportSnapshot('room-12')?.anchorMessageId).toBe('message-12');
		expect(loadRoomViewportSnapshot('room-11')).toBeNull();
		expect(loadRoomViewportSnapshot('room-0')).toBeNull();
	});
});
