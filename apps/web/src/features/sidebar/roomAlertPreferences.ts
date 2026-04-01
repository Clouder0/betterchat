export type RoomAlertPreference = 'subscribed' | 'normal';
export type RoomAlertPreferenceStore = Record<string, RoomAlertPreference>;

type AlertableRoom = {
	id?: string;
	roomId?: string;
};

export const DEFAULT_ROOM_ALERT_PREFERENCE: RoomAlertPreference = 'subscribed';
export const ROOM_ALERT_PREFERENCES_STORAGE_KEY = 'betterchat.room-alert-preferences.v1';

const roomAlertPreferenceValues: RoomAlertPreference[] = ['subscribed', 'normal'];
const legacyRoomAlertPreferenceValues = {
	notification: 'subscribed',
	quiet: 'normal',
} as const;

const isRoomAlertPreference = (value: unknown): value is RoomAlertPreference =>
	typeof value === 'string' && roomAlertPreferenceValues.includes(value as RoomAlertPreference);

const resolveStoredRoomAlertPreference = (value: unknown): RoomAlertPreference | null => {
	if (isRoomAlertPreference(value)) {
		return value;
	}

	if (typeof value === 'string' && value in legacyRoomAlertPreferenceValues) {
		return legacyRoomAlertPreferenceValues[value as keyof typeof legacyRoomAlertPreferenceValues];
	}

	return null;
};

const isRoomAlertPreferenceStore = (value: unknown): value is RoomAlertPreferenceStore => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}

	return Object.entries(value).every(([roomId, preference]) => roomId.length > 0 && resolveStoredRoomAlertPreference(preference) !== null);
};

export const loadRoomAlertPreferences = (): RoomAlertPreferenceStore => {
	if (typeof window === 'undefined') {
		return {};
	}

	const rawValue = window.localStorage.getItem(ROOM_ALERT_PREFERENCES_STORAGE_KEY);
	if (!rawValue) {
		return {};
	}

	try {
		const parsedValue: unknown = JSON.parse(rawValue);
		if (!isRoomAlertPreferenceStore(parsedValue)) {
			return {};
		}

		return Object.fromEntries(
			Object.entries(parsedValue).flatMap(([roomId, preference]) => {
				const resolvedPreference = resolveStoredRoomAlertPreference(preference);
				return resolvedPreference ? [[roomId, resolvedPreference]] : [];
			}),
		);
	} catch {
		return {};
	}
};

export const saveRoomAlertPreferences = (preferences: RoomAlertPreferenceStore) => {
	if (typeof window === 'undefined') {
		return;
	}

	if (Object.keys(preferences).length === 0) {
		window.localStorage.removeItem(ROOM_ALERT_PREFERENCES_STORAGE_KEY);
		return;
	}

	window.localStorage.setItem(ROOM_ALERT_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
};

export const resolveRoomAlertPreference = ({
	preferences,
	roomId,
}: {
	preferences: RoomAlertPreferenceStore;
	roomId: string;
}) => preferences[roomId] ?? DEFAULT_ROOM_ALERT_PREFERENCE;

export const applyRoomAlertPreferences = <TRoom extends AlertableRoom>(
	rooms: readonly TRoom[],
	preferences: RoomAlertPreferenceStore,
) =>
	rooms.map((room) => ({
		...room,
		alertPreference: resolveRoomAlertPreference({
			preferences,
			roomId: room.id ?? room.roomId ?? '',
		}),
	}));

export const updateRoomAlertPreferences = ({
	nextValue,
	preferences,
	roomId,
}: {
	nextValue: RoomAlertPreference;
	preferences: RoomAlertPreferenceStore;
	roomId: string;
}) => {
	if (nextValue === DEFAULT_ROOM_ALERT_PREFERENCE) {
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
