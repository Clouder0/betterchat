export const resolvePreferredTimelineFocusTarget = ({
	currentMessageIds,
	focusedMessageId,
	interactionMode,
	pointerAnchorMessageId,
	preferPointerAnchor,
	unreadFromMessageId,
	viewportAnchorMessageId,
}: {
	currentMessageIds: string[];
	focusedMessageId: string | null;
	interactionMode: 'keyboard' | 'pointer';
	pointerAnchorMessageId: string | null;
	preferPointerAnchor: boolean;
	unreadFromMessageId?: string;
	viewportAnchorMessageId: string | null;
}) => {
	const hasFocusedMessage = Boolean(focusedMessageId) && currentMessageIds.includes(focusedMessageId!);
	const hasPointerAnchor = Boolean(pointerAnchorMessageId) && currentMessageIds.includes(pointerAnchorMessageId!);
	const hasViewportAnchor = Boolean(viewportAnchorMessageId) && currentMessageIds.includes(viewportAnchorMessageId!);
	const hasUnreadAnchor = Boolean(unreadFromMessageId) && currentMessageIds.includes(unreadFromMessageId!);

	if (preferPointerAnchor && hasPointerAnchor) {
		return pointerAnchorMessageId;
	}

	if (interactionMode === 'keyboard' && hasFocusedMessage) {
		return focusedMessageId;
	}

	if (hasViewportAnchor) {
		return viewportAnchorMessageId;
	}

	if (hasFocusedMessage) {
		return focusedMessageId;
	}

	if (hasUnreadAnchor) {
		return unreadFromMessageId ?? null;
	}

	return currentMessageIds.at(-1) ?? null;
};
