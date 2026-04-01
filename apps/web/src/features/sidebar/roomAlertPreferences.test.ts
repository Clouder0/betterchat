import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
	DEFAULT_ROOM_ALERT_PREFERENCE,
	ROOM_ALERT_PREFERENCES_STORAGE_KEY,
	applyRoomAlertPreferences,
	loadRoomAlertPreferences,
	resolveRoomAlertPreference,
	saveRoomAlertPreferences,
	updateRoomAlertPreferences,
} from './roomAlertPreferences';

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

describe('roomAlertPreferences', () => {
	it('loads and saves local normal-priority preferences', () => {
		expect(loadRoomAlertPreferences()).toEqual({});

		saveRoomAlertPreferences({
			'delivery-room': 'normal',
			'dm-mia': 'normal',
		});

		expect(loadRoomAlertPreferences()).toEqual({
			'delivery-room': 'normal',
			'dm-mia': 'normal',
		});
	});

	it('falls back to an empty store for malformed storage', () => {
		window.localStorage.setItem(ROOM_ALERT_PREFERENCES_STORAGE_KEY, '{"ops-handoff":"loud"}');
		expect(loadRoomAlertPreferences()).toEqual({});

		window.localStorage.setItem(ROOM_ALERT_PREFERENCES_STORAGE_KEY, 'not-json');
		expect(loadRoomAlertPreferences()).toEqual({});
	});

	it('resolves subscribed by default and overlays normal preferences', () => {
		expect(
			resolveRoomAlertPreference({
				preferences: {},
				roomId: 'ops-handoff',
			}),
		).toBe(DEFAULT_ROOM_ALERT_PREFERENCE);

		expect(
			applyRoomAlertPreferences(
				[
					{ roomId: 'ops-handoff', title: '运营协调' },
					{ roomId: 'delivery-room', title: '客户交付' },
				],
				{
					'delivery-room': 'normal',
				},
			),
		).toEqual([
			{ roomId: 'ops-handoff', title: '运营协调', alertPreference: 'subscribed' },
			{ roomId: 'delivery-room', title: '客户交付', alertPreference: 'normal' },
		]);
	});

	it('drops the local override when switching back to subscribed', () => {
		expect(
			updateRoomAlertPreferences({
				preferences: { 'delivery-room': 'normal' },
				roomId: 'delivery-room',
				nextValue: 'subscribed',
			}),
		).toEqual({});

		expect(
			updateRoomAlertPreferences({
				preferences: {},
				roomId: 'delivery-room',
				nextValue: 'normal',
			}),
		).toEqual({ 'delivery-room': 'normal' });
	});
});
