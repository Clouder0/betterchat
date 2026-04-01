export const shouldPreserveTimelineBottom = ({
	autoScrollBottomThreshold,
	bottomGap,
	followBottomThroughReflow,
	pendingLocalSendExpansion,
	stickyToBottom,
}: {
	autoScrollBottomThreshold: number;
	bottomGap: number;
	followBottomThroughReflow: boolean;
	pendingLocalSendExpansion: boolean;
	stickyToBottom: boolean;
}) =>
	followBottomThroughReflow ||
	stickyToBottom ||
	bottomGap <= autoScrollBottomThreshold ||
	pendingLocalSendExpansion;
