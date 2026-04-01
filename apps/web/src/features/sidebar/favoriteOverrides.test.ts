import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
	ROOM_FAVORITE_OVERRIDES_STORAGE_KEY,
	applyFavoriteOverrides,
	loadFavoriteOverrides,
	resolveFavoriteOverride,
	saveFavoriteOverrides,
	updateFavoriteOverrides,
} from './favoriteOverrides';

type LocalStorageShape = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'>;

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

describe('favoriteOverrides', () => {
	it('loads and saves local favorite overrides', () => {
		expect(loadFavoriteOverrides()).toEqual({});

		saveFavoriteOverrides({
			'ops-handoff': false,
			'delivery-room': true,
		});

		expect(loadFavoriteOverrides()).toEqual({
			'ops-handoff': false,
			'delivery-room': true,
		});
	});

	it('falls back to an empty store for malformed storage', () => {
		window.localStorage.setItem(ROOM_FAVORITE_OVERRIDES_STORAGE_KEY, '{"ops-handoff":"yes"}');
		expect(loadFavoriteOverrides()).toEqual({});

		window.localStorage.setItem(ROOM_FAVORITE_OVERRIDES_STORAGE_KEY, 'not-json');
		expect(loadFavoriteOverrides()).toEqual({});
	});

	it('merges local overrides on top of room state', () => {
		const rooms = applyFavoriteOverrides(
			[
				{ roomId: 'ops-handoff', favorite: true, title: '运营协调' },
				{ roomId: 'delivery-room', favorite: false, title: '客户交付' },
			],
			{
				'ops-handoff': false,
				'delivery-room': true,
			},
		);

		expect(rooms.map((room) => [room.roomId, room.favorite])).toEqual([
			['ops-handoff', false],
			['delivery-room', true],
		]);

		expect(
			resolveFavoriteOverride({
				overrides: { 'delivery-room': true },
				roomId: 'delivery-room',
				serverValue: false,
			}),
		).toBe(true);
	});

	it('drops the local override when the next value matches the server value', () => {
		expect(
			updateFavoriteOverrides({
				overrides: { 'ops-handoff': false },
				roomId: 'ops-handoff',
				serverValue: true,
				nextValue: true,
			}),
		).toEqual({});

		expect(
			updateFavoriteOverrides({
				overrides: {},
				roomId: 'delivery-room',
				serverValue: false,
				nextValue: true,
			}),
		).toEqual({ 'delivery-room': true });
	});
});
