import type { RoomAttentionLevel, RoomSummary } from '@/lib/chatModels';

import type { RoomNotificationDefaults, RoomNotificationPreferenceStore } from '@/features/notifications/notificationPreferences';
import type { SidebarOrderingState } from './sidebarOrdering';
import { DEFAULT_ROOM_NOTIFICATION_DEFAULTS, resolveRoomNotificationPreference } from '@/features/notifications/notificationPreferences';
import {
	resolveSidebarActivityTimestamp,
	resolveSidebarAttentionTimestamp,
	resolveSidebarEffectiveAttentionLevel,
} from './sidebarOrdering';
import { resolveRoomNotificationPreferencePriority } from '@/features/notifications/notificationPolicy';

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

const getNotificationPriority = ({
	defaults,
	entry,
	preferences,
}: {
	defaults: RoomNotificationDefaults;
	entry: RoomSummary;
	preferences: RoomNotificationPreferenceStore;
}) =>
	resolveRoomNotificationPreferencePriority(
		resolveRoomNotificationPreference({
			defaults,
			preferences,
			roomId: entry.id,
			roomKind: entry.kind,
		}),
	);
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
	notificationDefaults,
	notificationPreferences,
	left,
	orderingState,
	right,
}: {
	activeRoomId?: string | null;
	notificationDefaults: RoomNotificationDefaults;
	notificationPreferences: RoomNotificationPreferenceStore;
	left: RoomSummary;
	orderingState?: SidebarOrderingState;
	right: RoomSummary;
}) => {
	const preferenceDelta =
		getNotificationPriority({ defaults: notificationDefaults, entry: right, preferences: notificationPreferences }) -
		getNotificationPriority({ defaults: notificationDefaults, entry: left, preferences: notificationPreferences });
	if (preferenceDelta !== 0) {
		return preferenceDelta;
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
	notificationPreferences: RoomNotificationPreferenceStore = {},
	orderingState: SidebarOrderingState = {},
	activeRoomId?: string | null,
	notificationDefaults: RoomNotificationDefaults = DEFAULT_ROOM_NOTIFICATION_DEFAULTS,
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
					notificationDefaults,
					notificationPreferences,
					left,
					orderingState,
					right,
				}),
			),
		}))
		.filter((group) => group.entries.length > 0);
};

const compareEntriesForDefaultRoom = (left: RoomSummary, right: RoomSummary) => {
	const attentionDelta = attentionPriority[right.attention.level] - attentionPriority[left.attention.level];
	if (attentionDelta !== 0) {
		return attentionDelta;
	}

	const activityDelta = resolveSidebarActivityTimestamp(right) - resolveSidebarActivityTimestamp(left);
	if (activityDelta !== 0) {
		return activityDelta;
	}

	return collator.compare(left.title, right.title);
};

export const getDefaultRoomId = (entries: RoomSummary[]) => {
	const groupedEntries = new Map<SidebarGroupKey, RoomSummary[]>();

	for (const entry of entries) {
		const groupKey = toGroupKey(entry);
		const bucket = groupedEntries.get(groupKey) ?? [];
		bucket.push(entry);
		groupedEntries.set(groupKey, bucket);
	}

	const sortedEntries = sidebarGroupDefinitions.flatMap(({ key }) => [...(groupedEntries.get(key) ?? [])].sort(compareEntriesForDefaultRoom));
	return sortedEntries.find((entry) => entry.visibility === 'visible')?.id ?? sortedEntries[0]?.id;
};
