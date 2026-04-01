export type PersistedMessageExpansionState = {
	expanded: boolean;
	updatedAt: number;
};

type RoomMessageExpansionSnapshot = {
	updatedAt: number;
	messages: Record<string, PersistedMessageExpansionState>;
};

type MessageExpansionStore = Record<string, RoomMessageExpansionSnapshot>;

const MESSAGE_EXPANSION_STORAGE_KEY = 'betterchat.timeline.message-expansion.v2';
const MAX_STORED_ROOMS = 48;
const MAX_STORED_MESSAGES_PER_ROOM = 256;

const isPersistedMessageExpansionState = (value: unknown): value is PersistedMessageExpansionState => {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	return (
		'expanded' in value &&
		typeof value.expanded === 'boolean' &&
		'updatedAt' in value &&
		typeof value.updatedAt === 'number' &&
		Number.isFinite(value.updatedAt)
	);
};

const isRoomMessageExpansionSnapshot = (value: unknown): value is RoomMessageExpansionSnapshot => {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	if (!('updatedAt' in value) || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) {
		return false;
	}

	if (!('messages' in value) || typeof value.messages !== 'object' || value.messages === null) {
		return false;
	}

	return Object.entries(value.messages).every(
		([messageId, snapshot]) => typeof messageId === 'string' && messageId.length > 0 && isPersistedMessageExpansionState(snapshot),
	);
};

const readMessageExpansionStore = (): MessageExpansionStore => {
	if (typeof window === 'undefined') {
		return {};
	}

	const raw = window.localStorage.getItem(MESSAGE_EXPANSION_STORAGE_KEY);
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
				([roomId, snapshot]) => typeof roomId === 'string' && roomId.length > 0 && isRoomMessageExpansionSnapshot(snapshot),
			),
		);
	} catch {
		return {};
	}
};

const writeMessageExpansionStore = (store: MessageExpansionStore) => {
	if (typeof window === 'undefined') {
		return;
	}

	window.localStorage.setItem(MESSAGE_EXPANSION_STORAGE_KEY, JSON.stringify(store));
};

const trimRoomMessageSnapshot = (snapshot: RoomMessageExpansionSnapshot): RoomMessageExpansionSnapshot => ({
	updatedAt: snapshot.updatedAt,
	messages: Object.fromEntries(
		Object.entries(snapshot.messages)
			.sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
			.slice(0, MAX_STORED_MESSAGES_PER_ROOM),
	),
});

export const loadRoomMessageExpansion = (roomId: string) => {
	if (!roomId) {
		return {};
	}

	const snapshot = readMessageExpansionStore()[roomId];
	if (!snapshot) {
		return {};
	}

	return Object.fromEntries(Object.entries(snapshot.messages).map(([messageId, state]) => [messageId, state.expanded]));
};

export const saveRoomMessageExpansion = (
	roomId: string,
	messageStates: Record<string, boolean | null | undefined>,
	updatedAt = Date.now(),
) => {
	if (!roomId) {
		return;
	}

	const nextEntries = Object.entries(messageStates).filter(
		([messageId, expanded]) => messageId.length > 0 && (typeof expanded === 'boolean' || expanded === null || expanded === undefined),
	);
	if (!nextEntries.length) {
		return;
	}

	const store = readMessageExpansionStore();
	const currentSnapshot = store[roomId] ?? {
		updatedAt,
		messages: {},
	};
	const nextSnapshot: RoomMessageExpansionSnapshot = {
		updatedAt,
		messages: {
			...currentSnapshot.messages,
		},
	};

	for (const [messageId, expanded] of nextEntries) {
		if (expanded === null || expanded === undefined) {
			delete nextSnapshot.messages[messageId];
			continue;
		}

		nextSnapshot.messages[messageId] = {
			expanded,
			updatedAt,
		};
	}

	if (Object.keys(nextSnapshot.messages).length === 0) {
		delete store[roomId];
	} else {
		store[roomId] = trimRoomMessageSnapshot(nextSnapshot);
	}

	const trimmedStore = Object.fromEntries(
		Object.entries(store)
			.sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
			.slice(0, MAX_STORED_ROOMS),
	);

	writeMessageExpansionStore(trimmedStore);
};
