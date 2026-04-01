export type RoomViewportSnapshot = {
	anchorMessageId: string;
	anchorOffset: number;
	updatedAt: number;
};

type ViewportStore = Record<string, RoomViewportSnapshot>;

const VIEWPORT_STORAGE_KEY = 'betterchat.timeline.viewport.v1';
const MAX_STORED_ROOMS = 48;

const isRoomViewportSnapshot = (value: unknown): value is RoomViewportSnapshot => {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	return (
		'anchorMessageId' in value &&
		typeof value.anchorMessageId === 'string' &&
		value.anchorMessageId.length > 0 &&
		'anchorOffset' in value &&
		typeof value.anchorOffset === 'number' &&
		Number.isFinite(value.anchorOffset) &&
		value.anchorOffset >= 0 &&
		'updatedAt' in value &&
		typeof value.updatedAt === 'number' &&
		Number.isFinite(value.updatedAt)
	);
};

const readViewportStore = (): ViewportStore => {
	if (typeof window === 'undefined') {
		return {};
	}

	const raw = window.sessionStorage.getItem(VIEWPORT_STORAGE_KEY);
	if (!raw) {
		return {};
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== 'object' || parsed === null) {
			return {};
		}

		return Object.fromEntries(
			Object.entries(parsed).filter(
				([roomId, snapshot]) => typeof roomId === 'string' && roomId.length > 0 && isRoomViewportSnapshot(snapshot),
			),
		);
	} catch {
		return {};
	}
};

const writeViewportStore = (store: ViewportStore) => {
	if (typeof window === 'undefined') {
		return;
	}

	window.sessionStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(store));
};

export const loadRoomViewportSnapshot = (roomId: string): RoomViewportSnapshot | null => {
	const snapshot = readViewportStore()[roomId];
	return snapshot ?? null;
};

export const saveRoomViewportSnapshot = (
	roomId: string,
	snapshot: Omit<RoomViewportSnapshot, 'updatedAt'> & { updatedAt?: number },
) => {
	if (!roomId || !snapshot.anchorMessageId) {
		return;
	}

	const nextSnapshot: RoomViewportSnapshot = {
		anchorMessageId: snapshot.anchorMessageId,
		anchorOffset: Math.max(snapshot.anchorOffset, 0),
		updatedAt: snapshot.updatedAt ?? Date.now(),
	};
	const store = readViewportStore();
	store[roomId] = nextSnapshot;

	const trimmedStore = Object.fromEntries(
		Object.entries(store)
			.sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
			.slice(0, MAX_STORED_ROOMS),
	);

	writeViewportStore(trimmedStore);
};
