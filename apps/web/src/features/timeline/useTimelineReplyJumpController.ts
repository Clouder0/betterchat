import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';

const REPLY_JUMP_LATEST_REVEAL_DELAY_MS = 280;
const REPLY_RETURN_AUTO_DISMISS_MS = 4200;

const isSpaceKey = (event: { code?: string; key: string }) => event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';

export type ReplyJumpNavigationState<TSnapshot> = {
	awaitingDeparture: boolean;
	snapshot: TSnapshot;
	sourceMessageId: string;
};

export const useTimelineReplyJumpController = <TSnapshot extends { anchorMessageId: string; anchorOffset: number }>({
	captureViewportSnapshot,
	focusLatestLoadedMessage,
	focusMessage,
	hasRejoinedReplySource,
	highlightMessage,
	isMessageComfortablyVisible,
	markTimelineKeyboardInteraction,
	messageRefs,
	messageStreamRef,
	scrollMessageIntoCenter,
	scrollToBottom,
	scrollToViewportSnapshot,
	timelineMessageCount,
	timelineRoomId,
	updateFocusedMessageId,
}: {
	captureViewportSnapshot: () => TSnapshot | null;
	focusLatestLoadedMessage: (interactionMode?: 'keyboard' | 'pointer' | 'preserve') => boolean;
	focusMessage: (
		messageId: string | null,
		behavior?: ScrollBehavior,
		interactionMode?: 'keyboard' | 'pointer' | 'preserve',
		scrollMode?: 'nearest' | 'preserve',
	) => boolean;
	hasRejoinedReplySource: (navigation: ReplyJumpNavigationState<TSnapshot>) => boolean;
	highlightMessage: (messageId: string) => void;
	isMessageComfortablyVisible: (messageId: string, padding?: number) => boolean;
	markTimelineKeyboardInteraction: () => void;
	messageRefs: MutableRefObject<Map<string, HTMLElement>>;
	messageStreamRef: RefObject<HTMLDivElement | null>;
	scrollMessageIntoCenter: (messageId: string, behavior?: ScrollBehavior) => boolean;
	scrollToBottom: (behavior?: ScrollBehavior) => void;
	scrollToViewportSnapshot: (snapshot: TSnapshot, behavior?: ScrollBehavior) => boolean;
	timelineMessageCount: number;
	timelineRoomId: string;
	updateFocusedMessageId: (nextMessageId: string | null) => string | null;
}) => {
	const [replyJumpNavigation, setReplyJumpNavigation] = useState<ReplyJumpNavigationState<TSnapshot> | null>(null);
	const [replyJumpLatestVisible, setReplyJumpLatestVisible] = useState(false);
	const [replyJumpReturnVisible, setReplyJumpReturnVisible] = useState(false);
	const replyJumpLatestRevealTimerRef = useRef<number | null>(null);
	const replyJumpReturnDismissTimerRef = useRef<number | null>(null);
	const replyJumpLatestRevealAllowedRef = useRef(false);
	const replyJumpPendingManualRevealRef = useRef(false);

	const clearReplyJumpReturnDismissTimer = useCallback(() => {
		if (replyJumpReturnDismissTimerRef.current) {
			window.clearTimeout(replyJumpReturnDismissTimerRef.current);
			replyJumpReturnDismissTimerRef.current = null;
		}
	}, []);

	const clearReplyJumpLatestRevealTimer = useCallback(() => {
		if (replyJumpLatestRevealTimerRef.current) {
			window.clearTimeout(replyJumpLatestRevealTimerRef.current);
			replyJumpLatestRevealTimerRef.current = null;
		}
	}, []);

	const resetReplyJumpLatestReveal = useCallback(() => {
		clearReplyJumpLatestRevealTimer();
		replyJumpLatestRevealAllowedRef.current = false;
		replyJumpPendingManualRevealRef.current = false;
		setReplyJumpLatestVisible(false);
	}, [clearReplyJumpLatestRevealTimer]);

	const dismissReplyJumpNavigation = useCallback(() => {
		clearReplyJumpLatestRevealTimer();
		clearReplyJumpReturnDismissTimer();
		replyJumpLatestRevealAllowedRef.current = false;
		replyJumpPendingManualRevealRef.current = false;
		setReplyJumpLatestVisible(false);
		setReplyJumpReturnVisible(false);
		setReplyJumpNavigation(null);
	}, [clearReplyJumpLatestRevealTimer, clearReplyJumpReturnDismissTimer]);

	const scheduleReplyJumpReturnDismiss = useCallback(() => {
		clearReplyJumpReturnDismissTimer();
		replyJumpReturnDismissTimerRef.current = window.setTimeout(() => {
			replyJumpReturnDismissTimerRef.current = null;
			setReplyJumpReturnVisible(false);
		}, REPLY_RETURN_AUTO_DISMISS_MS);
	}, [clearReplyJumpReturnDismissTimer]);

	const startLoadedReplyJump = useCallback(
		(sourceMessageId: string, targetMessageId: string, { focusTarget = false }: { focusTarget?: boolean } = {}) => {
			const messageNode = messageRefs.current.get(targetMessageId);
			if (!messageNode) {
				return false;
			}

			const snapshot = captureViewportSnapshot();
			const targetAlreadyVisible = isMessageComfortablyVisible(targetMessageId);
			replyJumpLatestRevealAllowedRef.current = false;
			replyJumpPendingManualRevealRef.current = false;
			setReplyJumpLatestVisible(false);
			clearReplyJumpLatestRevealTimer();
			clearReplyJumpReturnDismissTimer();

			if (snapshot && !targetAlreadyVisible) {
				setReplyJumpReturnVisible(true);
				setReplyJumpNavigation({
					awaitingDeparture: true,
					snapshot,
					sourceMessageId,
				});
			} else {
				setReplyJumpReturnVisible(false);
				setReplyJumpNavigation(null);
			}

			if (!targetAlreadyVisible) {
				scrollMessageIntoCenter(targetMessageId, 'smooth');
			}

			highlightMessage(targetMessageId);
			updateFocusedMessageId(targetMessageId);
			if (focusTarget) {
				markTimelineKeyboardInteraction();
				window.requestAnimationFrame(() => {
					messageNode.focus({ preventScroll: true });
				});
			}

			return true;
		},
		[
			captureViewportSnapshot,
			clearReplyJumpLatestRevealTimer,
			clearReplyJumpReturnDismissTimer,
			highlightMessage,
			isMessageComfortablyVisible,
			markTimelineKeyboardInteraction,
			messageRefs,
			scrollMessageIntoCenter,
			updateFocusedMessageId,
		],
	);

	const returnToReplySource = useCallback(() => {
		if (!replyJumpNavigation) {
			return;
		}

		const sourceMessageNode = messageRefs.current.get(replyJumpNavigation.sourceMessageId);
		const restored = scrollToViewportSnapshot(replyJumpNavigation.snapshot, 'smooth');

		if (!restored && sourceMessageNode) {
			scrollMessageIntoCenter(replyJumpNavigation.sourceMessageId, 'smooth');
		}

		if (sourceMessageNode) {
			highlightMessage(replyJumpNavigation.sourceMessageId);
			window.requestAnimationFrame(() => {
				void focusMessage(replyJumpNavigation.sourceMessageId, 'auto', 'keyboard');
			});
		}

		clearReplyJumpLatestRevealTimer();
		clearReplyJumpReturnDismissTimer();
		replyJumpLatestRevealAllowedRef.current = false;
		replyJumpPendingManualRevealRef.current = false;
		setReplyJumpLatestVisible(false);
		setReplyJumpReturnVisible(false);
		setReplyJumpNavigation(null);
	}, [
		clearReplyJumpLatestRevealTimer,
		clearReplyJumpReturnDismissTimer,
		focusMessage,
		highlightMessage,
		messageRefs,
		replyJumpNavigation,
		scrollMessageIntoCenter,
		scrollToViewportSnapshot,
	]);

	const jumpReplyNavigationToLatest = useCallback(
		({ behavior = 'auto', focusTarget = false }: { behavior?: ScrollBehavior; focusTarget?: boolean } = {}) => {
			if (!replyJumpNavigation) {
				return false;
			}

			dismissReplyJumpNavigation();
			scrollToBottom(behavior);
			return focusTarget ? focusLatestLoadedMessage('keyboard') : true;
		},
		[dismissReplyJumpNavigation, focusLatestLoadedMessage, replyJumpNavigation, scrollToBottom],
	);

	const resetReplyJumpState = useCallback(() => {
		dismissReplyJumpNavigation();
	}, [dismissReplyJumpNavigation]);

	useEffect(() => {
		if (!replyJumpNavigation) {
			clearReplyJumpReturnDismissTimer();
			return;
		}

		if (replyJumpNavigation.awaitingDeparture) {
			clearReplyJumpReturnDismissTimer();
			resetReplyJumpLatestReveal();
		} else if (!replyJumpLatestRevealAllowedRef.current && !replyJumpLatestRevealTimerRef.current) {
			replyJumpLatestRevealTimerRef.current = window.setTimeout(() => {
				replyJumpLatestRevealTimerRef.current = null;
				replyJumpLatestRevealAllowedRef.current = true;
				if (!replyJumpPendingManualRevealRef.current || hasRejoinedReplySource(replyJumpNavigation)) {
					return;
				}

				replyJumpPendingManualRevealRef.current = false;
				setReplyJumpLatestVisible(true);
			}, REPLY_JUMP_LATEST_REVEAL_DELAY_MS);
		}

		if (!replyJumpNavigation.awaitingDeparture && replyJumpReturnVisible && !replyJumpReturnDismissTimerRef.current) {
			scheduleReplyJumpReturnDismiss();
		}

		const syncReplyReturnVisibility = () => {
			const rejoinedSource = hasRejoinedReplySource(replyJumpNavigation);
			if (replyJumpNavigation.awaitingDeparture) {
				if (rejoinedSource) {
					return;
				}

				setReplyJumpNavigation((currentNavigation) =>
					currentNavigation === replyJumpNavigation
						? {
								...currentNavigation,
								awaitingDeparture: false,
						  }
						: currentNavigation,
				);
				return;
			}

			if (!rejoinedSource) {
				return;
			}

			resetReplyJumpLatestReveal();
			setReplyJumpNavigation((currentNavigation) => (currentNavigation === replyJumpNavigation ? null : currentNavigation));
		};

		syncReplyReturnVisibility();

		const container = messageStreamRef.current;
		if (!container) {
			return;
		}

		const revealLatestAction = () => {
			if (replyJumpNavigation.awaitingDeparture) {
				return;
			}

			if (replyJumpReturnVisible) {
				scheduleReplyJumpReturnDismiss();
			}

			if (!replyJumpLatestRevealAllowedRef.current) {
				replyJumpPendingManualRevealRef.current = true;
				return;
			}

			replyJumpPendingManualRevealRef.current = false;
			setReplyJumpLatestVisible(true);
		};

		const handleTouchMove = () => {
			revealLatestAction();
		};

		const handleWheel = () => {
			revealLatestAction();
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key) && !isSpaceKey(event)) {
				return;
			}

			revealLatestAction();
		};

		container.addEventListener('scroll', syncReplyReturnVisibility, { passive: true });
		container.addEventListener('touchmove', handleTouchMove, { passive: true });
		container.addEventListener('wheel', handleWheel, { passive: true });
		window.addEventListener('resize', syncReplyReturnVisibility);
		window.addEventListener('keydown', handleKeyDown);

		return () => {
			container.removeEventListener('scroll', syncReplyReturnVisibility);
			container.removeEventListener('touchmove', handleTouchMove);
			container.removeEventListener('wheel', handleWheel);
			window.removeEventListener('resize', syncReplyReturnVisibility);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [
		clearReplyJumpReturnDismissTimer,
		hasRejoinedReplySource,
		messageStreamRef,
		replyJumpNavigation,
		replyJumpReturnVisible,
		resetReplyJumpLatestReveal,
		scheduleReplyJumpReturnDismiss,
		timelineMessageCount,
		timelineRoomId,
	]);

	useEffect(
		() => () => {
			clearReplyJumpLatestRevealTimer();
			clearReplyJumpReturnDismissTimer();
		},
		[clearReplyJumpLatestRevealTimer, clearReplyJumpReturnDismissTimer],
	);

	return {
		dismissReplyJumpNavigation,
		jumpReplyNavigationToLatest,
		replyJumpLatestVisible,
		replyJumpNavigation,
		replyJumpReturnVisible,
		resetReplyJumpState,
		returnToReplySource,
		startLoadedReplyJump,
	};
};
