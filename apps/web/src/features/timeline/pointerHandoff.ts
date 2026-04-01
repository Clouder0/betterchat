export const resolveTimelinePointerHandoffTarget = ({
	currentMessageId,
	pointerAnchorMessageId,
	timelineInteractionMode,
}: {
	currentMessageId: string;
	pointerAnchorMessageId: string | null;
	timelineInteractionMode: 'keyboard' | 'pointer';
}) => {
	if (timelineInteractionMode !== 'pointer' || !pointerAnchorMessageId || pointerAnchorMessageId === currentMessageId) {
		return null;
	}

	return pointerAnchorMessageId;
};
