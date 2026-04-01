export type TimelineUnreadDividerSnapshot = {
	label: string;
	messageId: string;
	roomId: string;
};

export const shouldSuppressPinnedLiveUnreadDivider = ({
	appendedMessageIds,
	isStickyToBottom,
	unreadAnchorMessageId,
}: {
	appendedMessageIds: ReadonlySet<string>;
	isStickyToBottom: boolean;
	unreadAnchorMessageId?: string;
}) => Boolean(isStickyToBottom && unreadAnchorMessageId && appendedMessageIds.has(unreadAnchorMessageId));

export const resolveSettlingUnreadDivider = ({
	currentRoomId,
	currentUnreadAnchorMessageId,
	lastReadRequestAnchorId,
	loadedMessageIds,
	previousLiveUnreadDivider,
}: {
	currentRoomId: string;
	currentUnreadAnchorMessageId?: string;
	lastReadRequestAnchorId?: string | null;
	loadedMessageIds: readonly string[];
	previousLiveUnreadDivider: TimelineUnreadDividerSnapshot | null;
}) => {
	if (currentUnreadAnchorMessageId || !previousLiveUnreadDivider) {
		return null;
	}

	if (previousLiveUnreadDivider.roomId !== currentRoomId) {
		return null;
	}

	if (lastReadRequestAnchorId !== previousLiveUnreadDivider.messageId) {
		return null;
	}

	if (!loadedMessageIds.includes(previousLiveUnreadDivider.messageId)) {
		return null;
	}

	return previousLiveUnreadDivider;
};
