import type { RoomAttentionLevel, RoomSummary } from '@/lib/chatModels';

export type SidebarAttentionDockState = {
	entries: RoomSummary[];
	overflowCount: number;
};

const collator = new Intl.Collator('zh-Hans-CN', {
	numeric: true,
	sensitivity: 'base',
});

const attentionPriority: Record<RoomAttentionLevel, number> = {
	mention: 3,
	unread: 2,
	activity: 1,
	none: 0,
};

const parseActivityTimestamp = (value?: string) => {
	if (!value) {
		return Number.NEGATIVE_INFINITY;
	}

	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

const hasDockAttention = ({
	activeRoomId,
	entry,
}: {
	activeRoomId?: string | null;
	entry: RoomSummary;
}) => entry.visibility === 'visible' && entry.id !== activeRoomId && entry.attention.level !== 'none';

const compareDockEntries = (left: RoomSummary, right: RoomSummary) => {
	const attentionDelta = attentionPriority[right.attention.level] - attentionPriority[left.attention.level];
	if (attentionDelta !== 0) {
		return attentionDelta;
	}

	const activityDelta = parseActivityTimestamp(right.lastActivityAt) - parseActivityTimestamp(left.lastActivityAt);
	if (activityDelta !== 0) {
		return activityDelta;
	}

	return collator.compare(left.title, right.title);
};

export const buildSidebarAttentionDock = (
	entries: RoomSummary[],
	{
		activeRoomId,
		maxVisible = 3,
	}: {
		activeRoomId?: string | null;
		maxVisible?: number;
	} = {},
): SidebarAttentionDockState => {
	const boundedMaxVisible = Math.max(maxVisible, 0);
	const sortedEntries = entries
		.filter((entry) =>
			hasDockAttention({
				activeRoomId,
				entry,
			}),
		)
		.sort(compareDockEntries);

	return {
		entries: sortedEntries.slice(0, boundedMaxVisible),
		overflowCount: Math.max(sortedEntries.length - boundedMaxVisible, 0),
	};
};

export const resolveSidebarAttentionDockLabel = (entry: Pick<RoomSummary, 'attention'>) => {
	if (entry.attention.level === 'mention') {
		return '提及你';
	}

	if (entry.attention.level === 'unread') {
		if ((entry.attention.badgeCount ?? 0) > 0) {
			return `${entry.attention.badgeCount} 条未读`;
		}

		return '有未读消息';
	}

	if (entry.attention.level === 'activity') {
		return '有新动态';
	}

	return null;
};
