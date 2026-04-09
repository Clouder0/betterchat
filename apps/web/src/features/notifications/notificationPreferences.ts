import type { RoomKind } from '@/lib/chatModels';

export type RoomNotificationPreference = 'all' | 'personal' | 'mute';
export type RoomNotificationPreferenceStore = Record<string, RoomNotificationPreference>;
export type RoomNotificationDefaults = {
	dms: RoomNotificationPreference;
	rooms: RoomNotificationPreference;
};
export type BrowserNotificationDelivery = 'off' | 'foreground' | 'background';
export type BrowserNotificationPermissionState = NotificationPermission | 'unsupported';

export const ROOM_NOTIFICATION_PREFERENCES_STORAGE_KEY = 'betterchat.room-notification-preferences.v2';
export const ROOM_NOTIFICATION_DEFAULTS_STORAGE_KEY = 'betterchat.room-notification-defaults.v1';
export const BROWSER_NOTIFICATION_DELIVERY_STORAGE_KEY = 'betterchat.browser-notification-delivery.v1';

export const DEFAULT_ROOM_NOTIFICATION_DEFAULTS: RoomNotificationDefaults = {
	dms: 'all',
	rooms: 'personal',
};
export const DEFAULT_BROWSER_NOTIFICATION_DELIVERY: BrowserNotificationDelivery = 'foreground';

const roomNotificationPreferenceValues: RoomNotificationPreference[] = ['all', 'personal', 'mute'];
const browserNotificationDeliveryValues: BrowserNotificationDelivery[] = ['off', 'foreground', 'background'];
const legacyRoomAlertPreferenceValues = {
	notification: 'all',
	quiet: 'mute',
	normal: 'mute',
	subscribed: 'all',
} as const satisfies Record<string, RoomNotificationPreference>;

type AlertableRoom = {
	id?: string;
	kind: RoomKind;
	roomId?: string;
};

const isRoomNotificationPreference = (value: unknown): value is RoomNotificationPreference =>
	typeof value === 'string' && roomNotificationPreferenceValues.includes(value as RoomNotificationPreference);

const resolveStoredRoomNotificationPreference = (value: unknown): RoomNotificationPreference | null => {
	if (isRoomNotificationPreference(value)) {
		return value;
	}

	if (typeof value === 'string' && value in legacyRoomAlertPreferenceValues) {
		return legacyRoomAlertPreferenceValues[value as keyof typeof legacyRoomAlertPreferenceValues];
	}

	return null;
};

const isRoomNotificationPreferenceStore = (value: unknown): value is RoomNotificationPreferenceStore => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}

	return Object.entries(value).every(([roomId, preference]) => roomId.length > 0 && resolveStoredRoomNotificationPreference(preference) !== null);
};

const isBrowserNotificationDelivery = (value: unknown): value is BrowserNotificationDelivery =>
	typeof value === 'string' && browserNotificationDeliveryValues.includes(value as BrowserNotificationDelivery);

const isRoomNotificationDefaults = (value: unknown): value is Partial<RoomNotificationDefaults> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}

	const candidate = value as Partial<Record<keyof RoomNotificationDefaults, unknown>>;
	return (
		(candidate.dms === undefined || resolveStoredRoomNotificationPreference(candidate.dms) !== null) &&
		(candidate.rooms === undefined || resolveStoredRoomNotificationPreference(candidate.rooms) !== null)
	);
};

const parseStoredJson = (key: string) => {
	if (typeof window === 'undefined') {
		return null;
	}

	const rawValue = window.localStorage.getItem(key);
	if (!rawValue) {
		return null;
	}

	try {
		return JSON.parse(rawValue) as unknown;
	} catch {
		return null;
	}
};

export const resolveDefaultRoomNotificationPreference = ({
	defaults = DEFAULT_ROOM_NOTIFICATION_DEFAULTS,
	roomKind,
}: {
	defaults?: RoomNotificationDefaults;
	roomKind: RoomKind;
}): RoomNotificationPreference => (roomKind === 'dm' ? defaults.dms : defaults.rooms);

export const loadRoomNotificationPreferences = (): RoomNotificationPreferenceStore => {
	const parsedValue = parseStoredJson(ROOM_NOTIFICATION_PREFERENCES_STORAGE_KEY);
	if (!isRoomNotificationPreferenceStore(parsedValue)) {
		return {};
	}

	return Object.fromEntries(
		Object.entries(parsedValue).flatMap(([roomId, preference]) => {
			const resolvedPreference = resolveStoredRoomNotificationPreference(preference);
			return resolvedPreference ? [[roomId, resolvedPreference]] : [];
		}),
	);
};

export const saveRoomNotificationPreferences = (preferences: RoomNotificationPreferenceStore) => {
	if (typeof window === 'undefined') {
		return;
	}

	if (Object.keys(preferences).length === 0) {
		window.localStorage.removeItem(ROOM_NOTIFICATION_PREFERENCES_STORAGE_KEY);
		return;
	}

	window.localStorage.setItem(ROOM_NOTIFICATION_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
};

export const loadRoomNotificationDefaults = (): RoomNotificationDefaults => {
	const parsedValue = parseStoredJson(ROOM_NOTIFICATION_DEFAULTS_STORAGE_KEY);
	if (!isRoomNotificationDefaults(parsedValue)) {
		return DEFAULT_ROOM_NOTIFICATION_DEFAULTS;
	}

	return {
		dms: resolveStoredRoomNotificationPreference(parsedValue.dms) ?? DEFAULT_ROOM_NOTIFICATION_DEFAULTS.dms,
		rooms: resolveStoredRoomNotificationPreference(parsedValue.rooms) ?? DEFAULT_ROOM_NOTIFICATION_DEFAULTS.rooms,
	};
};

export const saveRoomNotificationDefaults = (defaults: RoomNotificationDefaults) => {
	if (typeof window === 'undefined') {
		return;
	}

	window.localStorage.setItem(ROOM_NOTIFICATION_DEFAULTS_STORAGE_KEY, JSON.stringify(defaults));
};

export const loadBrowserNotificationDelivery = (): BrowserNotificationDelivery => {
	if (typeof window === 'undefined') {
		return DEFAULT_BROWSER_NOTIFICATION_DELIVERY;
	}

	const rawValue = window.localStorage.getItem(BROWSER_NOTIFICATION_DELIVERY_STORAGE_KEY);
	return isBrowserNotificationDelivery(rawValue) ? rawValue : DEFAULT_BROWSER_NOTIFICATION_DELIVERY;
};

export const saveBrowserNotificationDelivery = (delivery: BrowserNotificationDelivery) => {
	if (typeof window === 'undefined') {
		return;
	}

	window.localStorage.setItem(BROWSER_NOTIFICATION_DELIVERY_STORAGE_KEY, delivery);
};

export const resolveBrowserNotificationPermissionState = (): BrowserNotificationPermissionState => {
	if (typeof window === 'undefined' || !('Notification' in window)) {
		return 'unsupported';
	}

	return window.Notification.permission;
};

export const browserNotificationBackgroundSupported = (): boolean => false;

export const resolveEffectiveBrowserNotificationDelivery = ({
	delivery,
}: {
	delivery: BrowserNotificationDelivery;
}): Exclude<BrowserNotificationDelivery, 'background'> => {
	if (delivery === 'background' && !browserNotificationBackgroundSupported()) {
		return 'foreground';
	}

	return delivery === 'background' ? 'foreground' : delivery;
};

export const resolveRoomNotificationPreference = ({
	defaults = DEFAULT_ROOM_NOTIFICATION_DEFAULTS,
	preferences,
	roomId,
	roomKind,
}: {
	defaults?: RoomNotificationDefaults;
	preferences: RoomNotificationPreferenceStore;
	roomId: string;
	roomKind: RoomKind;
}) => preferences[roomId] ?? resolveDefaultRoomNotificationPreference({ defaults, roomKind });

export const roomNotificationPreferenceUsesDefault = ({
	preferences,
	roomId,
}: {
	preferences: RoomNotificationPreferenceStore;
	roomId: string;
}) => !(roomId in preferences);

export const applyRoomNotificationPreferences = <TRoom extends AlertableRoom>(
	rooms: readonly TRoom[],
	preferences: RoomNotificationPreferenceStore,
	defaults: RoomNotificationDefaults = DEFAULT_ROOM_NOTIFICATION_DEFAULTS,
) =>
	rooms.map((room) => ({
		...room,
		notificationPreference: resolveRoomNotificationPreference({
			defaults,
			preferences,
			roomId: room.id ?? room.roomId ?? '',
			roomKind: room.kind,
		}),
	}));

export const updateRoomNotificationPreferences = ({
	defaults = DEFAULT_ROOM_NOTIFICATION_DEFAULTS,
	nextValue,
	preferences,
	roomId,
	roomKind,
}: {
	defaults?: RoomNotificationDefaults;
	nextValue: RoomNotificationPreference;
	preferences: RoomNotificationPreferenceStore;
	roomId: string;
	roomKind: RoomKind;
}) => {
	const defaultPreference = resolveDefaultRoomNotificationPreference({
		defaults,
		roomKind,
	});
	if (nextValue === defaultPreference) {
		if (!(roomId in preferences)) {
			return preferences;
		}

		const { [roomId]: _removed, ...restPreferences } = preferences;
		return restPreferences;
	}

	if (preferences[roomId] === nextValue) {
		return preferences;
	}

	return {
		...preferences,
		[roomId]: nextValue,
	};
};
