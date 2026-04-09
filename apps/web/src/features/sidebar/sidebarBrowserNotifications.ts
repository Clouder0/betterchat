import { createMessageExcerpt } from '@/features/messages/messageCompose';
import type { RoomSummary, TimelineMessage } from '@/lib/chatModels';

import type { RoomNotificationPreference } from '@/features/notifications/notificationPreferences';
import {
	isInterruptiveRoomAttentionAllowed,
	isNotificationMessageAllowedForPreference,
} from '@/features/notifications/notificationPolicy';

const notificationAttentionPriority: Record<RoomSummary['attention']['level'], number> = {
	mention: 3,
	unread: 2,
	activity: 1,
	none: 0,
};
const parseSidebarActivityTimestamp = (value?: string) => {
	if (!value) {
		return Number.NEGATIVE_INFINITY;
	}

	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

export const didSidebarEntryActivityAdvance = ({
	nextEntry,
	previousEntry,
}: {
	nextEntry: RoomSummary;
	previousEntry?: RoomSummary | null;
}) => parseSidebarActivityTimestamp(nextEntry.lastActivityAt) > parseSidebarActivityTimestamp(previousEntry?.lastActivityAt);

export const shouldNotifyForSidebarEntry = ({
	currentRoomId,
	pageFocused = true,
	pageVisible = true,
	nextEntry,
	previousEntry,
	preference,
}: {
	currentRoomId: string | null | undefined;
	pageFocused?: boolean;
	pageVisible?: boolean;
	nextEntry: RoomSummary;
	previousEntry?: RoomSummary | null;
	preference: RoomNotificationPreference;
}) => {
	if (preference === 'mute') {
		return false;
	}

	if (currentRoomId === nextEntry.id) {
		return false;
	}

	if (
		!isInterruptiveRoomAttentionAllowed({
			entry: nextEntry,
			preference,
		})
	) {
		return false;
	}

	const previousAttentionLevel = previousEntry?.attention.level ?? 'none';
	const previousBadgeCount = previousEntry?.attention.badgeCount ?? 0;
	const nextBadgeCount = nextEntry.attention.badgeCount ?? 0;
	const escalatedAttention =
		notificationAttentionPriority[nextEntry.attention.level] > notificationAttentionPriority[previousAttentionLevel];
	const unreadIncreased = nextBadgeCount > previousBadgeCount;

	return escalatedAttention || unreadIncreased;
};

export const shouldFallbackNotifyForSidebarEntry = ({
	currentRoomId,
	pageFocused = true,
	pageVisible = true,
	nextEntry,
	previousEntry,
	preference,
}: {
	currentRoomId: string | null | undefined;
	pageFocused?: boolean;
	pageVisible?: boolean;
	nextEntry: RoomSummary;
	previousEntry?: RoomSummary | null;
	preference: RoomNotificationPreference;
}) => {
	if (preference === 'mute') {
		return false;
	}

	if (currentRoomId === nextEntry.id) {
		return false;
	}

	return isInterruptiveRoomAttentionAllowed({
		entry: nextEntry,
		preference,
	});
};

export const resolveSidebarBrowserNotificationBody = (entry: RoomSummary) => {
	if (entry.attention.level === 'mention') {
		return `有人提及你${entry.subtitle ? ` · ${entry.subtitle}` : ''}`;
	}

	if ((entry.attention.badgeCount ?? 0) > 0) {
		return entry.subtitle ? `${entry.attention.badgeCount} 条未读 · ${entry.subtitle}` : `${entry.attention.badgeCount} 条未读消息`;
	}

	if (entry.attention.level === 'activity') {
		return entry.subtitle ? `有新动态 · ${entry.subtitle}` : '有新动态';
	}

	return entry.subtitle ?? '有新消息';
};

export const resolveSidebarNotificationFetchCount = ({
	nextEntry,
	previousEntry,
}: {
	nextEntry: RoomSummary;
	previousEntry?: RoomSummary | null;
}) => {
	const previousBadgeCount = previousEntry?.attention.badgeCount ?? 0;
	const nextBadgeCount = nextEntry.attention.badgeCount ?? 0;
	const unreadIncrease = Math.max(nextBadgeCount - previousBadgeCount, 0);
	if (unreadIncrease > 0) {
		return unreadIncrease;
	}

	const previousAttentionLevel = previousEntry?.attention.level ?? 'none';
	return notificationAttentionPriority[nextEntry.attention.level] > notificationAttentionPriority[previousAttentionLevel] ? 1 : 0;
};

export type SidebarNotificationMessageCandidate = Pick<TimelineMessage, 'attachments' | 'author' | 'body' | 'id'>;

export const resolveSidebarBrowserNotificationMessageBody = (message: SidebarNotificationMessageCandidate) =>
	`${message.author.displayName} · ${createMessageExcerpt(message as TimelineMessage)}`;

export const resolveSidebarNotificationMessages = ({
	currentUser,
	lastNotifiedMessageId,
	limit,
	messages,
	entry,
	preference,
}: {
	currentUser?: {
		id?: string;
		displayName?: string;
		username?: string;
	} | null;
	lastNotifiedMessageId?: string | null;
	limit: number;
	messages: readonly SidebarNotificationMessageCandidate[];
	entry: Pick<RoomSummary, 'kind'>;
	preference: RoomNotificationPreference;
}) => {
	if (limit <= 0) {
		return [];
	}

	const authoredByOthers = messages.filter((message) => message.author.id !== currentUser?.id);
	const eligibleMessages = authoredByOthers.filter((message) =>
		isNotificationMessageAllowedForPreference({
			currentUser,
			entry,
			message,
			preference,
		}),
	);
	const startIndex =
		lastNotifiedMessageId === null || lastNotifiedMessageId === undefined
			? -1
			: eligibleMessages.findIndex((message) => message.id === lastNotifiedMessageId);
	const unseenMessages = startIndex >= 0 ? eligibleMessages.slice(startIndex + 1) : eligibleMessages;
	if (unseenMessages.length === 0) {
		return [];
	}

	if (startIndex >= 0) {
		return unseenMessages;
	}

	return unseenMessages.slice(-limit);
};
