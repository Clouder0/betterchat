export type FavoriteOverrideStore = Record<string, boolean>;

type FavoritableRoom = {
	id?: string;
	roomId?: string;
	favorite: boolean;
};

export const ROOM_FAVORITE_OVERRIDES_STORAGE_KEY = 'betterchat.room-favorite-overrides.v1';

const isFavoriteOverrideStore = (value: unknown): value is FavoriteOverrideStore => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}

	return Object.entries(value).every(([roomId, favorite]) => roomId.length > 0 && typeof favorite === 'boolean');
};

export const loadFavoriteOverrides = (): FavoriteOverrideStore => {
	if (typeof window === 'undefined') {
		return {};
	}

	const rawValue = window.localStorage.getItem(ROOM_FAVORITE_OVERRIDES_STORAGE_KEY);
	if (!rawValue) {
		return {};
	}

	try {
		const parsedValue: unknown = JSON.parse(rawValue);
		return isFavoriteOverrideStore(parsedValue) ? parsedValue : {};
	} catch {
		return {};
	}
};

export const saveFavoriteOverrides = (overrides: FavoriteOverrideStore) => {
	if (typeof window === 'undefined') {
		return;
	}

	if (Object.keys(overrides).length === 0) {
		window.localStorage.removeItem(ROOM_FAVORITE_OVERRIDES_STORAGE_KEY);
		return;
	}

	window.localStorage.setItem(ROOM_FAVORITE_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
};

export const resolveFavoriteOverride = ({
	overrides,
	roomId,
	serverValue,
}: {
	overrides: FavoriteOverrideStore;
	roomId: string;
	serverValue: boolean;
}) => overrides[roomId] ?? serverValue;

export const applyFavoriteOverrides = <TRoom extends FavoritableRoom>(rooms: readonly TRoom[], overrides: FavoriteOverrideStore): TRoom[] =>
	rooms.map((room) => ({
		...room,
		favorite: resolveFavoriteOverride({
			overrides,
			roomId: room.id ?? room.roomId ?? '',
			serverValue: room.favorite,
		}),
	}));

export const updateFavoriteOverrides = ({
	nextValue,
	overrides,
	roomId,
	serverValue,
}: {
	nextValue: boolean;
	overrides: FavoriteOverrideStore;
	roomId: string;
	serverValue: boolean;
}) => {
	if (nextValue === serverValue) {
		if (!(roomId in overrides)) {
			return overrides;
		}

		const { [roomId]: _removed, ...restOverrides } = overrides;
		return restOverrides;
	}

	if (overrides[roomId] === nextValue) {
		return overrides;
	}

	return {
		...overrides,
		[roomId]: nextValue,
	};
};
