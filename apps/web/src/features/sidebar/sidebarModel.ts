import type { RoomAttentionLevel, RoomSummary } from '@/lib/chatModels';

import type { RoomAlertPreferenceStore } from './roomAlertPreferences';
import type { SidebarOrderingState } from './sidebarOrdering';
import { resolveRoomAlertPreference } from './roomAlertPreferences';
import {
	resolveSidebarActivityTimestamp,
	resolveSidebarAttentionTimestamp,
	resolveSidebarEffectiveAttentionLevel,
} from './sidebarOrdering';

export type SidebarGroupKey = 'favorites' | 'rooms' | 'dms';

export type SidebarGroup = {
	key: SidebarGroupKey;
	title: string;
	entries: RoomSummary[];
};

const sidebarGroupDefinitions: Array<{ key: SidebarGroupKey; title: string }> = [
	{ key: 'favorites', title: '收藏' },
	{ key: 'rooms', title: '房间' },
	{ key: 'dms', title: '私信' },
];

const collator = new Intl.Collator('zh-Hans-CN', {
	sensitivity: 'base',
	numeric: true,
});

const normalizeSearchText = (value: string) => value.toLocaleLowerCase('zh-CN').replace(/\s+/g, '');

const getAlertPriority = (entry: RoomSummary, alertPreferences: RoomAlertPreferenceStore) =>
	resolveRoomAlertPreference({
		preferences: alertPreferences,
		roomId: entry.id,
	}) === 'subscribed'
		? 1
		: 0;
const attentionPriority: Record<RoomAttentionLevel, number> = {
	mention: 3,
	unread: 2,
	activity: 1,
	none: 0,
};

const getAttentionPriority = ({
	activeRoomId,
	entry,
	orderingState,
}: {
	activeRoomId?: string | null;
	entry: RoomSummary;
	orderingState?: SidebarOrderingState;
}) => attentionPriority[resolveSidebarEffectiveAttentionLevel({ activeRoomId, entry, orderingState })] ?? 0;

const compareEntries = ({
	activeRoomId,
	alertPreferences,
	left,
	orderingState,
	right,
}: {
	activeRoomId?: string | null;
	alertPreferences: RoomAlertPreferenceStore;
	left: RoomSummary;
	orderingState?: SidebarOrderingState;
	right: RoomSummary;
}) => {
	const alertDelta = getAlertPriority(right, alertPreferences) - getAlertPriority(left, alertPreferences);
	if (alertDelta !== 0) {
		return alertDelta;
	}

	const attentionDelta =
		getAttentionPriority({
			activeRoomId,
			entry: right,
			orderingState,
		})
		- getAttentionPriority({
			activeRoomId,
			entry: left,
			orderingState,
		});
	if (attentionDelta !== 0) {
		return attentionDelta;
	}

	const leftEffectiveAttention = resolveSidebarEffectiveAttentionLevel({
		activeRoomId,
		entry: left,
		orderingState,
	});
	const rightEffectiveAttention = resolveSidebarEffectiveAttentionLevel({
		activeRoomId,
		entry: right,
		orderingState,
	});
	const leftTimestamp =
		leftEffectiveAttention === 'none'
			? resolveSidebarActivityTimestamp(left)
			: resolveSidebarAttentionTimestamp({
					activeRoomId,
					entry: left,
					orderingState,
			  });
	const rightTimestamp =
		rightEffectiveAttention === 'none'
			? resolveSidebarActivityTimestamp(right)
			: resolveSidebarAttentionTimestamp({
					activeRoomId,
					entry: right,
					orderingState,
			  });
	const activityDelta = rightTimestamp - leftTimestamp;
	if (activityDelta !== 0) {
		return activityDelta;
	}

	return collator.compare(left.title, right.title);
};

const filterEntries = (entries: RoomSummary[], query: string) => {
	const normalizedQuery = normalizeSearchText(query);

	if (!normalizedQuery) {
		return entries;
	}

	return entries.filter((entry) => {
		const haystack = normalizeSearchText(`${entry.title}${entry.subtitle ?? ''}`);
		return haystack.includes(normalizedQuery);
	});
};

const toGroupKey = (entry: RoomSummary): SidebarGroupKey => {
	if (entry.favorite) {
		return 'favorites';
	}

	if (entry.kind === 'dm') {
		return 'dms';
	}

	return 'rooms';
};

export const buildSidebarGroups = (
	entries: RoomSummary[],
	query = '',
	alertPreferences: RoomAlertPreferenceStore = {},
	orderingState: SidebarOrderingState = {},
	activeRoomId?: string | null,
): SidebarGroup[] => {
	const filteredEntries = filterEntries(entries, query);
	const groupedEntries = new Map<SidebarGroupKey, RoomSummary[]>();

	for (const entry of filteredEntries) {
		const groupKey = toGroupKey(entry);
		const bucket = groupedEntries.get(groupKey) ?? [];
		bucket.push(entry);
		groupedEntries.set(groupKey, bucket);
	}

	return sidebarGroupDefinitions
		.map(({ key, title }) => ({
			key,
			title,
			entries: [...(groupedEntries.get(key) ?? [])].sort((left, right) =>
				compareEntries({
					activeRoomId,
					alertPreferences,
					left,
					orderingState,
					right,
				}),
			),
		}))
		.filter((group) => group.entries.length > 0);
};

export const getDefaultRoomId = (entries: RoomSummary[], alertPreferences: RoomAlertPreferenceStore = {}) => {
	const sortedEntries = buildSidebarGroups(entries, '', alertPreferences).flatMap((group) => group.entries);
	return sortedEntries.find((entry) => entry.visibility === 'visible')?.id ?? sortedEntries[0]?.id;
};
