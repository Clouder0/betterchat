import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
	BROWSER_NOTIFICATION_DELIVERY_STORAGE_KEY,
	DEFAULT_BROWSER_NOTIFICATION_DELIVERY,
	DEFAULT_ROOM_NOTIFICATION_DEFAULTS,
	ROOM_NOTIFICATION_DEFAULTS_STORAGE_KEY,
	ROOM_NOTIFICATION_PREFERENCES_STORAGE_KEY,
	applyRoomNotificationPreferences,
	loadBrowserNotificationDelivery,
	loadRoomNotificationDefaults,
	loadRoomNotificationPreferences,
	resolveDefaultRoomNotificationPreference,
	resolveEffectiveBrowserNotificationDelivery,
	resolveRoomNotificationPreference,
	saveBrowserNotificationDelivery,
	saveRoomNotificationDefaults,
	saveRoomNotificationPreferences,
	updateRoomNotificationPreferences,
} from './notificationPreferences';

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

describe('notificationPreferences', () => {
	it('loads and saves room notification overrides with legacy migration', () => {
		expect(loadRoomNotificationPreferences()).toEqual({});

		saveRoomNotificationPreferences({
			'delivery-room': 'mute',
			'dm-mia': 'all',
		});

		expect(loadRoomNotificationPreferences()).toEqual({
			'delivery-room': 'mute',
			'dm-mia': 'all',
		});

		window.localStorage.setItem(ROOM_NOTIFICATION_PREFERENCES_STORAGE_KEY, JSON.stringify({
			'legacy-normal': 'normal',
			'legacy-subscribed': 'subscribed',
		}));
		expect(loadRoomNotificationPreferences()).toEqual({
			'legacy-normal': 'mute',
			'legacy-subscribed': 'all',
		});
	});

	it('falls back safely for malformed room notification stores', () => {
		window.localStorage.setItem(ROOM_NOTIFICATION_PREFERENCES_STORAGE_KEY, '{"ops-handoff":"loud"}');
		expect(loadRoomNotificationPreferences()).toEqual({});

		window.localStorage.setItem(ROOM_NOTIFICATION_PREFERENCES_STORAGE_KEY, 'not-json');
		expect(loadRoomNotificationPreferences()).toEqual({});
	});

	it('resolves room defaults by room kind and overlays explicit overrides', () => {
		expect(resolveDefaultRoomNotificationPreference({ roomKind: 'dm' })).toBe('all');
		expect(resolveDefaultRoomNotificationPreference({ roomKind: 'channel' })).toBe('personal');

		expect(
			resolveRoomNotificationPreference({
				preferences: {},
				roomId: 'ops-handoff',
				roomKind: 'channel',
			}),
		).toBe('personal');

		expect(
			applyRoomNotificationPreferences(
				[
					{ roomId: 'ops-handoff', title: '运营协调', kind: 'channel' },
					{ roomId: 'dm-mia', title: 'Mia', kind: 'dm' },
				],
				{
					'ops-handoff': 'all',
				},
			),
		).toEqual([
			{ roomId: 'ops-handoff', title: '运营协调', kind: 'channel', notificationPreference: 'all' },
			{ roomId: 'dm-mia', title: 'Mia', kind: 'dm', notificationPreference: 'all' },
		]);
	});

	it('drops room overrides when switching back to the effective default', () => {
		expect(
			updateRoomNotificationPreferences({
				preferences: { 'delivery-room': 'all' },
				roomId: 'delivery-room',
				roomKind: 'channel',
				nextValue: 'personal',
			}),
		).toEqual({});

		expect(
			updateRoomNotificationPreferences({
				preferences: {},
				roomId: 'dm-mia',
				roomKind: 'dm',
				nextValue: 'mute',
			}),
		).toEqual({ 'dm-mia': 'mute' });
	});

	it('loads and saves notification defaults', () => {
		expect(loadRoomNotificationDefaults()).toEqual(DEFAULT_ROOM_NOTIFICATION_DEFAULTS);

		saveRoomNotificationDefaults({
			dms: 'mute',
			rooms: 'all',
		});

		expect(loadRoomNotificationDefaults()).toEqual({
			dms: 'mute',
			rooms: 'all',
		});

		window.localStorage.setItem(ROOM_NOTIFICATION_DEFAULTS_STORAGE_KEY, 'not-json');
		expect(loadRoomNotificationDefaults()).toEqual(DEFAULT_ROOM_NOTIFICATION_DEFAULTS);
	});

	it('loads and saves browser notification delivery preferences', () => {
		expect(loadBrowserNotificationDelivery()).toBe(DEFAULT_BROWSER_NOTIFICATION_DELIVERY);

		saveBrowserNotificationDelivery('off');
		expect(loadBrowserNotificationDelivery()).toBe('off');

		window.localStorage.setItem(BROWSER_NOTIFICATION_DELIVERY_STORAGE_KEY, 'background');
		expect(loadBrowserNotificationDelivery()).toBe('background');
		expect(resolveEffectiveBrowserNotificationDelivery({ delivery: 'background' })).toBe('foreground');
	});
});
