import type { TimelineMessage } from '@/lib/chatModels';

const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

export const shouldVisuallyGroupTimelineMessages = (
	previousMessage: TimelineMessage | undefined,
	nextMessage: TimelineMessage | undefined,
) => {
	if (!previousMessage || !nextMessage) {
		return false;
	}

	if (previousMessage.author.id !== nextMessage.author.id) {
		return false;
	}

	if (previousMessage.flags.deleted || nextMessage.flags.deleted) {
		return false;
	}

	const previousTimestamp = Date.parse(previousMessage.createdAt);
	const nextTimestamp = Date.parse(nextMessage.createdAt);

	if (!Number.isFinite(previousTimestamp) || !Number.isFinite(nextTimestamp)) {
		return false;
	}

	return nextTimestamp - previousTimestamp <= MESSAGE_GROUP_WINDOW_MS;
};

export const collectAuthorNavigableMessageIds = ({
	authorQuickPanelEnabled,
	currentUserId,
	messages,
	unreadAnchorMessageId,
}: {
	authorQuickPanelEnabled: boolean;
	currentUserId?: string | null;
	messages: TimelineMessage[];
	unreadAnchorMessageId?: string;
}) => {
	if (!authorQuickPanelEnabled) {
		return [];
	}

	return messages.flatMap((message, index) => {
		const groupedWithPrevious =
			message.id !== unreadAnchorMessageId && shouldVisuallyGroupTimelineMessages(messages[index - 1], message);
		if (groupedWithPrevious || currentUserId === message.author.id) {
			return [];
		}

		return [message.id];
	});
};

export const resolveAdjacentAuthorNavigableMessageId = ({
	direction,
	messageId,
	navigableMessageIds,
}: {
	direction: 'next' | 'previous';
	messageId: string;
	navigableMessageIds: string[];
}) => {
	const currentIndex = navigableMessageIds.indexOf(messageId);
	if (currentIndex < 0) {
		return null;
	}

	const targetIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
	return navigableMessageIds[targetIndex] ?? null;
};

export const resolveAdjacentTimelineMessageId = ({
	direction,
	messageId,
	messageIds,
}: {
	direction: 'next' | 'previous';
	messageId: string;
	messageIds: string[];
}) => {
	const currentIndex = messageIds.indexOf(messageId);
	if (currentIndex < 0) {
		return null;
	}

	const targetIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
	return messageIds[targetIndex] ?? null;
};
