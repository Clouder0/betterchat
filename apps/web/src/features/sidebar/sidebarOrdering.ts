import type { RoomAttentionLevel, RoomSummary } from '@/lib/chatModels';

export type SidebarOrderingStateEntry = {
	heldAttentionAt?: number;
	heldAttentionLevel?: Exclude<RoomAttentionLevel, 'none'>;
	lastAttentionAt?: number;
};

export type SidebarOrderingState = Record<string, SidebarOrderingStateEntry>;

const attentionLevelsWithPriority = {
	mention: true,
	unread: true,
	activity: true,
} as const satisfies Record<Exclude<RoomAttentionLevel, 'none'>, true>;

const hasPriorityAttention = (level: RoomAttentionLevel): level is Exclude<RoomAttentionLevel, 'none'> =>
	level in attentionLevelsWithPriority;

const getRoomActivityTimestamp = (entry: Pick<RoomSummary, 'lastActivityAt'>) => {
	if (!entry.lastActivityAt) {
		return undefined;
	}

	const timestamp = Date.parse(entry.lastActivityAt);
	return Number.isNaN(timestamp) ? undefined : timestamp;
};

const compactOrderingStateEntry = (entry: SidebarOrderingStateEntry): SidebarOrderingStateEntry | null => {
	const hasFields =
		entry.lastAttentionAt !== undefined || entry.heldAttentionAt !== undefined || entry.heldAttentionLevel !== undefined;

	return hasFields ? entry : null;
};

export const deriveSidebarOrderingState = ({
	activeRoomId,
	nextEntries,
	now = () => Date.now(),
	previousEntries,
	previousState = {},
}: {
	activeRoomId?: string | null;
	nextEntries: RoomSummary[];
	now?: () => number;
	previousEntries: RoomSummary[];
	previousState?: SidebarOrderingState;
}): SidebarOrderingState => {
	const previousEntriesById = new Map(previousEntries.map((entry) => [entry.id, entry]));
	const nextStateEntries = nextEntries.flatMap((entry) => {
		const previousEntry = previousEntriesById.get(entry.id);
		const previousStateEntry = previousState[entry.id];
		const nextActivityTimestamp = getRoomActivityTimestamp(entry);
		const nextAttentionLevel = entry.attention.level;
		const nextStateEntry: SidebarOrderingStateEntry = {
			...previousStateEntry,
		};

		if (hasPriorityAttention(nextAttentionLevel)) {
			nextStateEntry.lastAttentionAt = nextActivityTimestamp ?? previousStateEntry?.lastAttentionAt ?? now();
			delete nextStateEntry.heldAttentionLevel;
			delete nextStateEntry.heldAttentionAt;
			return compactOrderingStateEntry(nextStateEntry) ? [[entry.id, nextStateEntry] as const] : [];
		}

		if (entry.id === activeRoomId) {
			const previousAttentionLevel = previousEntry?.attention.level;
			if (previousAttentionLevel && hasPriorityAttention(previousAttentionLevel)) {
				nextStateEntry.heldAttentionLevel = previousAttentionLevel;
				nextStateEntry.heldAttentionAt =
					previousStateEntry?.lastAttentionAt ?? getRoomActivityTimestamp(previousEntry) ?? nextActivityTimestamp ?? now();
				nextStateEntry.lastAttentionAt ??= nextStateEntry.heldAttentionAt;
			}
		} else {
			delete nextStateEntry.heldAttentionLevel;
			delete nextStateEntry.heldAttentionAt;
		}

		const compactEntry = compactOrderingStateEntry(nextStateEntry);
		return compactEntry ? [[entry.id, compactEntry] as const] : [];
	});

	return Object.fromEntries(nextStateEntries);
};

export const resolveSidebarEffectiveAttentionLevel = ({
	activeRoomId,
	entry,
	orderingState,
}: {
	activeRoomId?: string | null;
	entry: RoomSummary;
	orderingState?: SidebarOrderingState;
}): RoomAttentionLevel => {
	const stateEntry = orderingState?.[entry.id];
	if (entry.id === activeRoomId && entry.attention.level === 'none' && stateEntry?.heldAttentionLevel) {
		return stateEntry.heldAttentionLevel;
	}

	return entry.attention.level;
};

export const resolveSidebarAttentionTimestamp = ({
	activeRoomId,
	entry,
	orderingState,
}: {
	activeRoomId?: string | null;
	entry: RoomSummary;
	orderingState?: SidebarOrderingState;
}) => {
	const stateEntry = orderingState?.[entry.id];
	if (entry.id === activeRoomId && entry.attention.level === 'none' && stateEntry?.heldAttentionAt !== undefined) {
		return stateEntry.heldAttentionAt;
	}

	return stateEntry?.lastAttentionAt ?? getRoomActivityTimestamp(entry) ?? Number.NEGATIVE_INFINITY;
};

export const resolveSidebarActivityTimestamp = (entry: RoomSummary) => getRoomActivityTimestamp(entry) ?? Number.NEGATIVE_INFINITY;
