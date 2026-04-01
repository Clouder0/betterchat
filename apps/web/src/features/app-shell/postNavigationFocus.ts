export const canApplyPendingComposerFocus = ({
	activeRoomId,
	composerReady,
	composerReadyRoomId,
	pendingRoomId,
	roomLoading,
}: {
	activeRoomId?: string;
	composerReady: boolean;
	composerReadyRoomId: string | null;
	pendingRoomId: string | null;
	roomLoading: boolean;
}) =>
	Boolean(pendingRoomId) &&
	activeRoomId === pendingRoomId &&
	!roomLoading &&
	composerReady &&
	composerReadyRoomId === activeRoomId;
