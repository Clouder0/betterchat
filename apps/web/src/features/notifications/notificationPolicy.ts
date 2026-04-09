import { buildMentionTokens, splitMentionSegments } from '@/lib/mentions';
import type { RoomSummary, TimelineMessage } from '@/lib/chatModels';

import type { BrowserNotificationDelivery, BrowserNotificationPermissionState, RoomNotificationPreference } from './notificationPreferences';

export type RoomNotificationEventClass = 'general' | 'none' | 'personal';

export const resolveRoomNotificationPreferencePriority = (preference: RoomNotificationPreference): number => {
	switch (preference) {
		case 'all':
			return 2;
		case 'personal':
			return 1;
		case 'mute':
		default:
			return 0;
	}
};

export const resolveRoomNotificationEventClass = (
	entry: Pick<RoomSummary, 'attention' | 'kind'>,
): RoomNotificationEventClass => {
	if (entry.attention.level === 'none') {
		return 'none';
	}

	if (entry.attention.level === 'mention' || entry.kind === 'dm') {
		return 'personal';
	}

	return 'general';
};

export const isInterruptiveRoomAttentionAllowed = ({
	entry,
	preference,
}: {
	entry: Pick<RoomSummary, 'attention' | 'kind'>;
	preference: RoomNotificationPreference;
}) => {
	if (preference === 'mute') {
		return false;
	}

	const eventClass = resolveRoomNotificationEventClass(entry);
	if (eventClass === 'none') {
		return false;
	}

	return preference === 'all' || eventClass === 'personal';
};

const messageMentionsCurrentUser = ({
	currentUser,
	message,
}: {
	currentUser?: {
		displayName?: string;
		username?: string;
	} | null;
	message: Pick<TimelineMessage, 'body'>;
}) => {
	const mentionTokens = buildMentionTokens(
		currentUser
			? {
				displayName: currentUser.displayName ?? '',
				username: currentUser.username ?? '',
			  }
			: currentUser,
	);
	if (mentionTokens.length === 0) {
		return false;
	}

	return splitMentionSegments(message.body.rawMarkdown).some(
		(segment) => segment.kind === 'mention' && mentionTokens.includes(segment.value.slice(1).toLocaleLowerCase()),
	);
};

export const isNotificationMessageAllowedForPreference = ({
	currentUser,
	entry,
	message,
	preference,
}: {
	currentUser?: {
		displayName?: string;
		username?: string;
	} | null;
	entry: Pick<RoomSummary, 'kind'>;
	message: Pick<TimelineMessage, 'body'>;
	preference: RoomNotificationPreference;
}) => {
	if (preference === 'mute') {
		return false;
	}

	if (preference === 'all') {
		return true;
	}

	return entry.kind === 'dm' || messageMentionsCurrentUser({ currentUser, message });
};

export const isBrowserNotificationDeliveryEnabled = ({
	delivery,
	permission,
}: {
	delivery: BrowserNotificationDelivery;
	permission: BrowserNotificationPermissionState;
}) => delivery !== 'off' && permission === 'granted';
