import type { SessionUser } from '@betterchat/contracts';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';

import { shouldDisableMotion, type MotionPreference } from '@/app/motionPreference';
import { MarkdownContent } from '@/components/MarkdownContent';
import { GalleryImage, TimelineImageGalleryProvider } from '@/features/media/ImageGallery';
import { ForwardedMessageCard } from '@/features/messages/ForwardedMessageCard';
import { composeForwardSourceMarkdown, parseForwardedMessageMarkdown, stripMarkdownToPlainText } from '@/features/messages/messageCompose';
import { getAvatarLabel } from '@/lib/avatar';
import type { DirectConversationLookupResult, RoomTimelineSnapshot, TimelineAttachment, TimelineMessage } from '@/lib/chatModels';
import { copyTextToClipboard } from '@/lib/clipboard';
import type { MentionInteractionUser } from '@/lib/mentions';
import { createHeldArrowNavigationState, resolveHeldArrowNavigationAllowance } from '@/lib/heldArrowNavigation';
import { spaceText } from '@/lib/text';
import {
	collectAuthorNavigableMessageIds,
	resolveAdjacentTimelineMessageId,
	resolveAdjacentAuthorNavigableMessageId,
	shouldVisuallyGroupTimelineMessages,
} from './authorQuickPanelNavigation';
import { shouldCancelBottomFollowOnViewportChange } from './bottomFollow';
import { shouldPreserveTimelineBottom } from './bottomPreservation';
import { resolveTimelineImageAttachmentMedia } from './attachmentMedia';
import { loadRoomMessageExpansion, saveRoomMessageExpansion } from './messageExpansionMemory';
import { messageMentionsCurrentUser, resolveLoadedMentionTargetMessageId } from './mentionNavigation';
import { resolveTimelinePointerHandoffTarget } from './pointerHandoff';
import { resolvePreferredTimelineFocusTarget } from './timelineFocusTarget';
import {
	findAppendedMessageIds,
	findMessageIdTransfers,
	resolveMeasuredMessageCollapsible,
	resolveMessageExpandedState,
	resolveTransferredAppendedMessageIds,
	resolveNextMessageExpansionOverride,
	resolveNextAppendedMessageExpansionDefaults,
	transferMessageStateById,
} from './messageCollapsing';
import { resolveTimelineMessageLayout } from './timelineMessageLayout';
import {
	mergePendingContentResizeAdjustment,
	normalizePendingContentResizeAdjustment,
	resolveHistoryPrependRestoreScrollTop,
	type ActiveHistoryPrependRestore,
	type PendingContentResizeAdjustment,
} from './timelineViewportRestoration';
import { loadRoomViewportSnapshot, saveRoomViewportSnapshot, type RoomViewportSnapshot } from './viewportMemory';
import { resolveRevealScrollTop } from './keyboardViewport';
import {
	buildMessageContextMenuActionKeySignature,
	resolveMessageContextMenuActiveKey,
	resolveMessageContextMenuIndexByKey,
	resolveMessageContextMenuKeyAtIndex,
} from './messageContextMenuState';
import {
	resolveCenteredMessageScrollTop,
	resolveTimelineAnimatedScrollTop,
	resolveTimelineScrollDuration,
	shouldCancelTimelineScrollAnimation,
	shouldAnimateTimelineScroll,
	shouldDeferTimelineViewportStateSync,
} from './timelineScrollMotion';
import { resolveTimelineChildFocusTarget, type TimelineChildFocusTarget } from './timelineChildFocus';
import {
	resolveOlderHistoryReadyLoadThreshold,
	shouldLoadOlderHistory,
	shouldPrefetchOlderHistory,
} from './olderHistoryPrefetch';
import {
	resolveSettlingUnreadDivider,
	shouldSuppressPinnedLiveUnreadDivider,
	type TimelineUnreadDividerSnapshot,
} from './unreadDividerState';
import styles from './TimelineView.module.css';

const AUTO_SCROLL_BOTTOM_THRESHOLD = 72;
const REPLY_JUMP_HIGHLIGHT_DURATION_MS = 750;
const UNREAD_CONTEXT_OFFSET_RATIO = 0.22;
const UNREAD_CONTEXT_OFFSET_MIN = 72;
const UNREAD_CONTEXT_OFFSET_MAX = 164;
const VIEWPORT_ANCHOR_TOP_BIAS = 12;
const VIEWPORT_PERSIST_DEBOUNCE_MS = 160;
const SEQUENTIAL_BOTTOM_JUMP_WINDOW_MS = 1600;
const BOTTOM_REFLOW_FOLLOW_WINDOW_MS = 1800;
const TIMELINE_TOAST_DURATION_MS = 1400;
const HISTORY_LOAD_TOP_THRESHOLD_PX = 72;
const HISTORY_PREPEND_RESTORE_GRACE_MS = 320;
const FLOATING_ACTION_TOP_THRESHOLD = 40;
const FLOATING_MENTION_VISIBILITY_PADDING_PX = 28;
const JUMP_TO_BOTTOM_VISIBILITY_THRESHOLD = 96;
const UNREAD_DIVIDER_SETTLE_MS = 220;
const KEYBOARD_FOCUS_REVEAL_PADDING_TOP = 14;
const KEYBOARD_FOCUS_REVEAL_PADDING_BOTTOM = 26;
const REPLY_RETURN_SOURCE_VISIBILITY_PADDING_PX = 48;
const REPLY_RETURN_SNAPSHOT_TOLERANCE_PX = 56;
const REPLY_JUMP_LATEST_REVEAL_DELAY_MS = 280;
const REPLY_RETURN_AUTO_DISMISS_MS = 4200;

type TimelineToastTone = 'success' | 'warning';
type PendingViewportSyncMode = 'minimal' | 'full';

type UnsavedRoomViewportSnapshot = Omit<RoomViewportSnapshot, 'updatedAt'>;
type ViewportAnchorSnapshot = UnsavedRoomViewportSnapshot | RoomViewportSnapshot;
type ReplyJumpNavigationState = {
	awaitingDeparture: boolean;
	snapshot: UnsavedRoomViewportSnapshot;
	sourceMessageId: string;
};
type MessageContextMenuState = {
	activeActionKey: string | null;
	anchorX: number;
	anchorY: number;
	messageId: string;
	source: 'keyboard' | 'pointer';
};
type QuickPanelTriggerTarget =
	| {
			kind: 'author';
	  }
	| {
			focusKey: string;
			kind: 'mention';
	  };
type AuthorQuickPanelState = {
	anchorRect: {
		bottom: number;
		height: number;
		left: number;
		right: number;
		top: number;
		width: number;
	};
	messageId: string;
	source: 'keyboard' | 'pointer';
	trigger: QuickPanelTriggerTarget;
	user: MentionInteractionUser;
};
type MessageContextMenuActionItem = {
	behavior?: 'close' | 'toast';
	failureToastLabel?: string;
	key: string;
	label: string;
	onSelect: () => void | Promise<void>;
	restoreFocus?: boolean;
	successToastLabel?: string;
};
type MessageContextMenuDividerItem = {
	key: string;
	kind: 'divider';
};
type MessageContextMenuItem = MessageContextMenuActionItem | MessageContextMenuDividerItem;
type TimelineFocusRequest = {
	strategy: 'preferred' | 'bottom-visible' | 'pointer-anchor' | 'first-message' | 'last-message' | 'unread-or-latest';
	token: number;
};
type FocusedMessageIdUpdater = string | null | ((currentMessageId: string | null) => string | null);
type FocusedAuthorTriggerState = {
	messageId: string;
	mode: 'avatar' | 'meta';
};
type VisualUnreadDividerState = TimelineUnreadDividerSnapshot & {
	phase: 'live' | 'settling';
};

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
	hour: '2-digit',
	minute: '2-digit',
});

const formatMessageTime = (isoTimestamp: string) => timeFormatter.format(new Date(isoTimestamp));
const clampViewportCoordinate = (value: number, viewport: number, content: number, margin = 12) =>
	Math.max(margin, Math.min(value, viewport - content - margin));
const isSpaceKey = (event: { code?: string; key: string }) => event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';

const clampUnreadContextOffset = (containerHeight: number) =>
	Math.max(UNREAD_CONTEXT_OFFSET_MIN, Math.min(containerHeight * UNREAD_CONTEXT_OFFSET_RATIO, UNREAD_CONTEXT_OFFSET_MAX));

const getAuthorTone = (authorName: string) => {
	const tones = ['accent', 'neutral', 'support', 'warning'] as const;
	const hash = Array.from(authorName).reduce((total, char) => total + char.charCodeAt(0), 0);
	return tones[hash % tones.length] ?? 'neutral';
};

const getDirectConversationActionLabel = (lookup: DirectConversationLookupResult | undefined) =>
	lookup?.conversation.state === 'none' ? '发起私信' : '打开私信';

const AttachmentImage = ({
	attachment,
	onFocus,
	onKeyDown,
	timelineMessageId,
}: {
	attachment: Extract<TimelineAttachment, { kind: 'image' }>;
	onFocus?: (event: ReactFocusEvent<HTMLImageElement>) => void;
	onKeyDown?: (event: ReactKeyboardEvent<HTMLImageElement>) => void;
	timelineMessageId?: string;
}) => {
	const media = resolveTimelineImageAttachmentMedia(attachment);

	return (
		<figure className={styles.attachmentFigure}>
			<GalleryImage
				alt={attachment.title ?? '图片附件'}
				className={styles.attachmentImage}
				height={media.height}
				imageId={`attachment-${attachment.id}`}
				onFocus={onFocus}
				onKeyDown={onKeyDown}
				src={media.src}
				testId={`timeline-image-${attachment.id}`}
				title={attachment.title}
				timelineMessageId={timelineMessageId}
				viewerHeight={media.viewerHeight}
				viewerSrc={media.viewerSrc}
				viewerWidth={media.viewerWidth}
				width={media.width}
			/>
			{attachment.title ? <figcaption className={styles.attachmentCaption}>{spaceText(attachment.title)}</figcaption> : null}
		</figure>
	);
};

const ReplyIcon = () => (
	<svg aria-hidden='true' className={styles.actionIcon} viewBox='0 0 24 24'>
		<path
			d='M9.25 7.5 4.75 12l4.5 4.5M5.5 12H14a4.5 4.5 0 0 1 4.5 4.5v.75'
			fill='none'
			stroke='currentColor'
			strokeLinecap='round'
			strokeLinejoin='round'
			strokeWidth='1.55'
		/>
	</svg>
);

const ForwardIcon = () => (
	<svg aria-hidden='true' className={styles.actionIcon} viewBox='0 0 24 24'>
		<path
			d='M14.75 7.5 19.25 12l-4.5 4.5M18.5 12H10a4.5 4.5 0 0 0-4.5 4.5v.75'
			fill='none'
			stroke='currentColor'
			strokeLinecap='round'
			strokeLinejoin='round'
			strokeWidth='1.55'
		/>
	</svg>
);

const ReturnIcon = () => (
	<svg aria-hidden='true' className={styles.returnIcon} viewBox='0 0 24 24'>
		<path
			d='M9.25 7.5 4.75 12l4.5 4.5M5.5 12H14a4.5 4.5 0 0 1 4.5 4.5v.75'
			fill='none'
			stroke='currentColor'
			strokeLinecap='round'
			strokeLinejoin='round'
			strokeWidth='1.55'
		/>
	</svg>
);

const MessageContextMenuLayer = memo(
	({
		actionableItems,
		items,
		message,
		activeKey,
		onClose,
		onActiveKeyChange,
		onContinueTimeline,
		onSelectAction,
		position,
		source,
	}: {
		activeKey: string | null;
		actionableItems: MessageContextMenuActionItem[];
		items: MessageContextMenuItem[];
		message: TimelineMessage;
		onClose: (options?: { restoreFocus?: boolean }) => void;
		onActiveKeyChange: (nextKey: string | null) => void;
		onContinueTimeline: (target: 'current' | 'next' | 'previous') => void;
		onSelectAction: (item: MessageContextMenuActionItem) => void;
		position: { left: number; top: number };
		source: 'keyboard' | 'pointer';
	}) => {
		const menuRef = useRef<HTMLDivElement>(null);
		const itemRefs = useRef(new Map<string, HTMLButtonElement>());
		const actionKeys = useMemo(() => actionableItems.map((item) => item.key), [actionableItems]);
		const actionKeySignature = useMemo(() => buildMessageContextMenuActionKeySignature(actionKeys), [actionKeys]);
		const actionKeysRef = useRef(actionKeys);
		actionKeysRef.current = actionKeys;
		const actionableItemsRef = useRef(actionableItems);
		actionableItemsRef.current = actionableItems;
		const activeKeyRef = useRef<string | null>(activeKey);
		activeKeyRef.current = activeKey;

		const setItemRef = useCallback(
			(itemKey: string) => (node: HTMLButtonElement | null) => {
				if (node) {
					itemRefs.current.set(itemKey, node);
					return;
				}

				itemRefs.current.delete(itemKey);
			},
			[],
		);

		const syncActiveKey = useCallback((nextKey: string | null, { focus = false }: { focus?: boolean } = {}) => {
			const resolvedKey = resolveMessageContextMenuActiveKey({
				actionKeys: actionKeysRef.current,
				currentKey: nextKey,
				source,
			});

			activeKeyRef.current = resolvedKey;
			onActiveKeyChange(resolvedKey);

			if (focus) {
				if (resolvedKey === null) {
					menuRef.current?.focus({ preventScroll: true });
				} else {
					itemRefs.current.get(resolvedKey)?.focus({ preventScroll: true });
				}
			}

			return resolvedKey;
		}, [onActiveKeyChange, source]);

		const handleCommand = useCallback(
			({
				key,
				preventDefault,
				shiftKey,
				stopPropagation,
			}: {
				key: string;
				preventDefault: () => void;
				shiftKey: boolean;
				stopPropagation?: () => void;
			}) => {
				const currentActionKeys = actionKeysRef.current;
				const currentActionableItems = actionableItemsRef.current;
				if (currentActionKeys.length === 0) {
					return false;
				}

				const currentIndex = resolveMessageContextMenuIndexByKey({
					actionKeys: currentActionKeys,
					activeKey: activeKeyRef.current,
				});

				if (key === 'ArrowDown') {
					preventDefault();
					stopPropagation?.();
					if (currentIndex !== null && currentIndex >= currentActionKeys.length - 1) {
						onContinueTimeline('next');
						return true;
					}

					syncActiveKey(
						resolveMessageContextMenuKeyAtIndex({
							actionKeys: currentActionKeys,
							index: currentIndex === null ? 0 : currentIndex + 1,
						}),
						{ focus: true },
					);
					return true;
				}

				if (key === 'ArrowUp') {
					preventDefault();
					stopPropagation?.();
					if (currentIndex !== null && currentIndex <= 0) {
						onContinueTimeline('previous');
						return true;
					}

					syncActiveKey(
						resolveMessageContextMenuKeyAtIndex({
							actionKeys: currentActionKeys,
							index: currentIndex === null ? currentActionKeys.length - 1 : currentIndex - 1,
						}),
						{ focus: true },
					);
					return true;
				}

				if (key === 'ArrowLeft' || key === 'ArrowRight') {
					preventDefault();
					stopPropagation?.();
					onContinueTimeline('current');
					return true;
				}

				if (key === 'Home') {
					preventDefault();
					stopPropagation?.();
					syncActiveKey(resolveMessageContextMenuKeyAtIndex({ actionKeys: currentActionKeys, index: 0 }), { focus: true });
					return true;
				}

				if (key === 'End') {
					preventDefault();
					stopPropagation?.();
					syncActiveKey(
						resolveMessageContextMenuKeyAtIndex({
							actionKeys: currentActionKeys,
							index: currentActionKeys.length - 1,
						}),
						{ focus: true },
					);
					return true;
				}

				if (key === 'Tab') {
					preventDefault();
					stopPropagation?.();
					syncActiveKey(
						resolveMessageContextMenuKeyAtIndex({
							actionKeys: currentActionKeys,
							index: currentIndex === null ? (shiftKey ? currentActionKeys.length - 1 : 0) : currentIndex + (shiftKey ? -1 : 1),
						}),
						{ focus: true },
					);
					return true;
				}

				if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
					const activeItem =
						(activeKeyRef.current
							? currentActionableItems.find((item) => item.key === activeKeyRef.current)
							: undefined) ?? currentActionableItems[0];
					if (!activeItem) {
						return false;
					}

					preventDefault();
					stopPropagation?.();
					onSelectAction(activeItem);
					return true;
				}

				if (key === 'Escape') {
					preventDefault();
					stopPropagation?.();
					onClose({ restoreFocus: true });
					return true;
				}

				return false;
			},
			[onClose, onContinueTimeline, onSelectAction, syncActiveKey],
		);

		useEffect(() => {
			syncActiveKey(
				resolveMessageContextMenuActiveKey({
					actionKeys: actionKeysRef.current,
					currentKey: activeKeyRef.current,
					source,
				}),
			);
		}, [actionKeySignature, message.id, source, syncActiveKey]);

		useLayoutEffect(() => {
			if (source !== 'keyboard') {
				return;
			}

			const nextKey = resolveMessageContextMenuActiveKey({
				actionKeys: actionKeysRef.current,
				currentKey: activeKeyRef.current,
				source,
			});
			if (nextKey === null) {
				return;
			}

			itemRefs.current.get(nextKey)?.focus({ preventScroll: true });
		}, [actionKeySignature, activeKey, source]);

		useEffect(() => {
			if (source !== 'pointer') {
				return;
			}

			const focusFrame = window.requestAnimationFrame(() => {
				menuRef.current?.focus();
			});

			return () => {
				window.cancelAnimationFrame(focusFrame);
			};
		}, [source]);

		useEffect(() => {
			if (source !== 'keyboard') {
				return;
			}

			const handleWindowKeyDown = (event: KeyboardEvent) => {
				const target = event.target;
				if (target instanceof Node && menuRef.current?.contains(target)) {
					return;
				}

				void handleCommand({
					key: event.key,
					preventDefault: () => event.preventDefault(),
					shiftKey: event.shiftKey,
					stopPropagation: () => event.stopPropagation(),
				});
			};

			window.addEventListener('keydown', handleWindowKeyDown, true);
			return () => {
				window.removeEventListener('keydown', handleWindowKeyDown, true);
			};
		}, [handleCommand, source]);

		if (typeof document === 'undefined') {
			return null;
		}

		return createPortal(
			<div
				ref={menuRef}
				aria-label={spaceText('消息操作菜单')}
				data-active-key={activeKey ?? ''}
				className={styles.messageContextMenu}
				data-source={source}
				data-testid='timeline-message-context-menu'
				role='menu'
				tabIndex={-1}
				style={{
					left: `${position.left}px`,
					top: `${position.top}px`,
				}}
				onContextMenu={(event) => event.preventDefault()}
				onKeyDownCapture={(event) => {
					void handleCommand({
						key: event.key,
						preventDefault: () => event.preventDefault(),
						shiftKey: event.shiftKey,
						stopPropagation: () => event.stopPropagation(),
					});
				}}
			>
				<div className={styles.messageContextMenuHeader}>
					<strong>{spaceText(message.author.displayName)}</strong>
					<time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
				</div>
				<div className={styles.messageContextMenuBody}>
					{items.map((item) =>
						'kind' in item ? (
							<div key={item.key} aria-hidden='true' className={styles.messageContextMenuDivider} />
						) : (
							<button
								key={item.key}
								className={styles.messageContextMenuItem}
								data-active={activeKey === item.key ? 'true' : 'false'}
								data-testid={`message-context-action-${item.key}`}
								onClick={() => onSelectAction(item)}
								onFocus={() => {
									syncActiveKey(item.key);
								}}
								ref={setItemRef(item.key)}
								role='menuitem'
								type='button'
							>
								<span>{spaceText(item.label)}</span>
							</button>
						),
					)}
				</div>
			</div>,
			document.body,
		);
	},
);

export const TimelineView = ({
	authorQuickPanelEnabled = false,
	authorQuickPanelLookup,
	authorQuickPanelLookupPending = false,
	authorQuickPanelRequestedUserId = null,
	authorQuickPanelSubmitting = false,
	currentUser = null,
	failedMessageActions = {},
	focusRequest = { strategy: 'preferred', token: 0 },
	forceScrollToBottomToken = 0,
	hasOlderHistory = false,
	isLoadingOlderHistory = false,
	keyboardFocusActive = true,
	localOutgoingMessageIds = new Set<string>(),
	mentionInteractionUsers = [],
	messageDeliveryStates = {},
	motionPreference = 'enabled',
	onCloseAuthorQuickPanel,
	onEnsureAuthorDirectConversation,
	onFocusWithin,
	onForwardMessage,
	onLoadOlderHistory,
	onPrefetchOlderHistory,
	onNavigateComposer,
	onNavigateHeader,
	onOpenAuthorQuickPanel,
	onPrepareAuthorQuickPanel,
	onRemoveFailedMessage,
	pendingLocalSendCount = 0,
	onRequestMarkRead,
	onResolveReplyTarget,
	onNavigateSidebar,
	onRetryFailedMessage,
	onReplyMessage,
	roomMentioned = false,
	timeline,
}: {
	authorQuickPanelEnabled?: boolean;
	authorQuickPanelLookup?: DirectConversationLookupResult;
	authorQuickPanelLookupPending?: boolean;
	authorQuickPanelRequestedUserId?: string | null;
	authorQuickPanelSubmitting?: boolean;
	currentUser?: Pick<SessionUser, 'displayName' | 'id' | 'username'> | null;
	failedMessageActions?: Record<string, { errorMessage?: string }>;
		focusRequest?: TimelineFocusRequest;
		forceScrollToBottomToken?: number;
		hasOlderHistory?: boolean;
		isLoadingOlderHistory?: boolean;
		keyboardFocusActive?: boolean;
		localOutgoingMessageIds?: ReadonlySet<string>;
		mentionInteractionUsers?: MentionInteractionUser[];
		messageDeliveryStates?: Record<string, 'sending' | 'failed'>;
		motionPreference?: MotionPreference;
		onCloseAuthorQuickPanel?: () => void;
		onEnsureAuthorDirectConversation?: (userId: string) => void;
		onFocusWithin?: () => void;
		onForwardMessage?: (message: TimelineMessage) => void;
		onLoadOlderHistory?: () => Promise<boolean>;
		onPrefetchOlderHistory?: () => Promise<void> | void;
	onNavigateComposer?: () => boolean | void;
	onNavigateHeader?: (control?: 'favorite' | 'alert' | 'info') => boolean | void;
	onOpenAuthorQuickPanel?: (userId: string) => void;
	onPrepareAuthorQuickPanel?: (userId: string) => void;
	onRemoveFailedMessage?: (messageId: string) => void;
	pendingLocalSendCount?: number;
	onRequestMarkRead?: () => void;
	onResolveReplyTarget?: (messageId: string) => Promise<boolean>;
	onNavigateSidebar?: () => boolean | void;
	onRetryFailedMessage?: (messageId: string) => void;
	onReplyMessage?: (message: TimelineMessage) => void;
	roomMentioned?: boolean;
	timeline: RoomTimelineSnapshot;
}) => {
	const initialFocusedMessageId = timeline.unreadAnchorMessageId ?? timeline.messages.at(-1)?.id ?? null;
	const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>(() => loadRoomMessageExpansion(timeline.roomId));
	const [messageContentHeights, setMessageContentHeights] = useState<Record<string, number>>({});
	const [showJumpToMention, setShowJumpToMention] = useState(false);
	const [showJumpToUnread, setShowJumpToUnread] = useState(false);
	const [showJumpToBottom, setShowJumpToBottom] = useState(false);
	const [settlingUnreadDivider, setSettlingUnreadDivider] = useState<TimelineUnreadDividerSnapshot | null>(null);
	const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
	const [focusedMessageId, setFocusedMessageId] = useState<string | null>(initialFocusedMessageId);
	const [focusedAuthorTrigger, setFocusedAuthorTrigger] = useState<FocusedAuthorTriggerState | null>(null);
	const [timelineInteractionMode, setTimelineInteractionMode] = useState<'keyboard' | 'pointer'>('pointer');
	const [messageContextMenu, setMessageContextMenu] = useState<MessageContextMenuState | null>(null);
	const [authorQuickPanel, setAuthorQuickPanel] = useState<AuthorQuickPanelState | null>(null);
	const [authorQuickPanelPosition, setAuthorQuickPanelPosition] = useState<{ left: number; top: number } | null>(null);
	const [messageContextMenuPosition, setMessageContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
	const [timelineToast, setTimelineToast] = useState<{ id: number; message: string; tone: TimelineToastTone } | null>(null);
	const [replyJumpNavigation, setReplyJumpNavigation] = useState<ReplyJumpNavigationState | null>(null);
	const messageStreamRef = useRef<HTMLDivElement>(null);
	const unreadDividerRef = useRef<HTMLDivElement>(null);
	const authorQuickPanelRef = useRef<HTMLDivElement>(null);
	const authorQuickPanelPrimaryActionRef = useRef<HTMLButtonElement>(null);
	const messageRefs = useRef(new Map<string, HTMLElement>());
	const messageBodyRefs = useRef(new Map<string, HTMLDivElement>());
	const messageContentRefs = useRef(new Map<string, HTMLDivElement>());
	const authorTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
	const messageReplyPreviewRefs = useRef(new Map<string, HTMLButtonElement>());
	const messageActionRefs = useRef(new Map<string, HTMLButtonElement>());
	const messageContentResizeObserverRef = useRef<ResizeObserver | null>(null);
	const messageStreamResizeObserverRef = useRef<ResizeObserver | null>(null);
	const highlightTimerRef = useRef<number | null>(null);
	const toastTimerRef = useRef<number | null>(null);
	const viewportPersistTimerRef = useRef<number | null>(null);
	const sequentialBottomJumpTimerRef = useRef<number | null>(null);
	const unreadDividerSettleTimerRef = useRef<number | null>(null);
	const replyJumpLatestRevealTimerRef = useRef<number | null>(null);
	const replyJumpReturnDismissTimerRef = useRef<number | null>(null);
	const contentResizeAdjustmentFrameRef = useRef<number | null>(null);
	const historyPrependRestoreSettleFrameRef = useRef<number | null>(null);
	const scrollAnimationFrameRef = useRef<number | null>(null);
	const olderHistoryLoadInFlightRef = useRef(false);
	const olderHistoryPrefetchPendingRef = useRef(false);
	const olderHistoryPrefetchReadyRef = useRef(false);
	const activeAnimatedScrollTargetRef = useRef<number | null>(null);
	const lastAnimatedScrollTopRef = useRef<number | null>(null);
	const viewportSyncFrameRef = useRef<number | null>(null);
	const pendingViewportSyncModeRef = useRef<PendingViewportSyncMode | null>(null);
	const currentViewportSnapshotRef = useRef<UnsavedRoomViewportSnapshot | RoomViewportSnapshot | null>(null);
	const programmaticViewportScrollRef = useRef(false);
	const programmaticViewportScrollResetFrameRef = useRef<number | null>(null);
	const stickyToBottomRef = useRef(true);
	const lastKnownBottomGapRef = useRef(0);
	const lastViewportTopRef = useRef(0);
	const pendingLocalSendExpansionRef = useRef(false);
	const pendingContentResizeAdjustmentRef = useRef<PendingContentResizeAdjustment<ViewportAnchorSnapshot> | null>(null);
	const activeHistoryPrependRestoreRef = useRef<ActiveHistoryPrependRestore<UnsavedRoomViewportSnapshot> | null>(null);
	const bottomReflowFollowUntilRef = useRef(0);
	const bottomReflowFollowRoomIdRef = useRef<string | null>(null);
	const previousRoomIdRef = useRef<string | null>(null);
	const previousMessageCountRef = useRef(0);
	const previousForceScrollToBottomTokenRef = useRef(forceScrollToBottomToken);
	const previousRenderedRoomIdRef = useRef<string | null>(null);
	const previousRenderedMessageIdsRef = useRef<string[]>([]);
	const previousRenderedMessagesRef = useRef<TimelineMessage[]>([]);
	const lastFocusRequestTokenRef = useRef(focusRequest.token);
	const appendedMessageExpansionDefaultsRef = useRef<Record<string, boolean>>({});
	const loadedExpansionRoomIdRef = useRef(timeline.roomId);
	const expandedMessagesRef = useRef(expandedMessages);
	const lastReadRequestAnchorRef = useRef<string | null>(null);
	const pendingUnreadDividerSettleAnchorRef = useRef<string | null>(null);
	const lastLiveUnreadDividerRef = useRef<TimelineUnreadDividerSnapshot | null>(null);
	const keyboardAnchorMessageIdRef = useRef<string | null>(initialFocusedMessageId);
	const focusedMessageIdRef = useRef<string | null>(initialFocusedMessageId);
	const pointerAnchorMessageIdRef = useRef<string | null>(null);
	const timelineInteractionModeRef = useRef<'keyboard' | 'pointer'>('pointer');
	const heldVerticalArrowNavigationRef = useRef(createHeldArrowNavigationState());
	const pendingResolvedReplyJumpRef = useRef<{
		focusTarget: boolean;
		sourceMessageId: string;
		targetMessageId: string;
	} | null>(null);
	const pendingSequentialBottomJumpRef = useRef(false);
	const [preferBottomAfterUnreadClick, setPreferBottomAfterUnreadClick] = useState(false);
	const [replyJumpLatestVisible, setReplyJumpLatestVisible] = useState(false);
	const [replyJumpReturnVisible, setReplyJumpReturnVisible] = useState(false);
	const [scrollSettleToken, setScrollSettleToken] = useState(0);
	const replyJumpLatestRevealAllowedRef = useRef(false);
	const replyJumpPendingManualRevealRef = useRef(false);
	const currentTimelineRoomIdRef = useRef(timeline.roomId);

	const updateFocusedMessageId = useCallback((nextMessageIdOrUpdater: FocusedMessageIdUpdater) => {
		const nextMessageId =
			typeof nextMessageIdOrUpdater === 'function'
				? nextMessageIdOrUpdater(focusedMessageIdRef.current)
				: nextMessageIdOrUpdater;
		if (nextMessageId === focusedMessageIdRef.current) {
			return nextMessageId;
		}

		focusedMessageIdRef.current = nextMessageId;
		setFocusedMessageId(nextMessageId);
		return nextMessageId;
	}, []);

	const updateTimelineInteractionMode = useCallback((nextInteractionMode: 'keyboard' | 'pointer') => {
		if (timelineInteractionModeRef.current === nextInteractionMode) {
			return nextInteractionMode;
		}

		timelineInteractionModeRef.current = nextInteractionMode;
		setTimelineInteractionMode(nextInteractionMode);
		return nextInteractionMode;
	}, []);

	const markTimelineKeyboardInteraction = useCallback(() => {
		updateTimelineInteractionMode('keyboard');
	}, [updateTimelineInteractionMode]);

	const markTimelinePointerInteraction = useCallback(() => {
		if (messageContextMenu?.source === 'keyboard' || authorQuickPanel?.source === 'keyboard') {
			return timelineInteractionModeRef.current;
		}

		updateTimelineInteractionMode('pointer');
	}, [authorQuickPanel?.source, messageContextMenu?.source, updateTimelineInteractionMode]);

	const shouldIgnoreHeldTimelineVerticalArrowNavigation = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
			return false;
		}

		const resolution = resolveHeldArrowNavigationAllowance({
			key: event.key,
			lastState: heldVerticalArrowNavigationRef.current,
			now: event.timeStamp,
			repeat: event.repeat,
		});
		heldVerticalArrowNavigationRef.current = resolution.nextState;
		if (resolution.allow) {
			return false;
		}

		event.preventDefault();
		return true;
	}, []);

	const unreadStartIndex = timeline.unreadAnchorMessageId
		? timeline.messages.findIndex((message) => message.id === timeline.unreadAnchorMessageId)
		: -1;
	const unreadCount = unreadStartIndex >= 0 ? timeline.messages.length - unreadStartIndex : 0;
	const liveUnreadDivider = useMemo<TimelineUnreadDividerSnapshot | null>(() => {
		if (unreadStartIndex < 0) {
			return null;
		}

		const anchorMessage = timeline.messages[unreadStartIndex];
		if (!anchorMessage) {
			return null;
		}

		return {
			label: `${formatMessageTime(anchorMessage.createdAt)} 之后 ${unreadCount} 条未读`,
			messageId: anchorMessage.id,
			roomId: timeline.roomId,
		};
	}, [timeline.messages, timeline.roomId, unreadCount, unreadStartIndex]);
	const mentionTargetMessageId = useMemo(
		() =>
			resolveLoadedMentionTargetMessageId({
				currentUser,
				messages: timeline.messages,
				roomMentioned,
				unreadFromMessageId: timeline.unreadAnchorMessageId,
			}),
		[currentUser, roomMentioned, timeline.messages, timeline.unreadAnchorMessageId],
	);
	const activeExpandedMessages =
		loadedExpansionRoomIdRef.current === timeline.roomId ? expandedMessages : loadRoomMessageExpansion(timeline.roomId);
	const currentMessageIds = useMemo(() => timeline.messages.map((message) => message.id), [timeline.messages]);
	const mentionInteractionUsersById = useMemo(
		() => new Map(mentionInteractionUsers.map((user) => [user.id, user])),
		[mentionInteractionUsers],
	);
	const timelineMessagesById = useMemo(() => new Map(timeline.messages.map((message) => [message.id, message])), [timeline.messages]);
	const authorNavigableMessageIds = useMemo(
		() =>
			collectAuthorNavigableMessageIds({
				authorQuickPanelEnabled,
				currentUserId: currentUser?.id,
				messages: timeline.messages,
				unreadAnchorMessageId: timeline.unreadAnchorMessageId,
			}),
		[authorQuickPanelEnabled, currentUser?.id, timeline.messages, timeline.unreadAnchorMessageId],
	);
	const activeContextMenuMessage = messageContextMenu
		? timeline.messages.find((message) => message.id === messageContextMenu.messageId) ?? null
		: null;
	const activeAuthorQuickPanelLookup =
		authorQuickPanel && authorQuickPanelRequestedUserId === authorQuickPanel.user.id ? authorQuickPanelLookup : undefined;
	const liveViewportBottomGap = lastKnownBottomGapRef.current;
	const liveAppendedMessageIds =
		previousRenderedRoomIdRef.current === timeline.roomId
			? findAppendedMessageIds(previousRenderedMessageIdsRef.current, currentMessageIds)
			: new Set<string>();
	const suppressPinnedLiveUnreadDivider = useMemo(
		() =>
			shouldSuppressPinnedLiveUnreadDivider({
				appendedMessageIds: liveAppendedMessageIds,
				isStickyToBottom: stickyToBottomRef.current,
				unreadAnchorMessageId: timeline.unreadAnchorMessageId,
			}),
		[liveAppendedMessageIds, timeline.unreadAnchorMessageId],
	);
	const visualLiveUnreadDivider = suppressPinnedLiveUnreadDivider ? null : liveUnreadDivider;
	const visualUnreadDivider =
		settlingUnreadDivider &&
		(!visualLiveUnreadDivider ||
			(visualLiveUnreadDivider.roomId === settlingUnreadDivider.roomId &&
				visualLiveUnreadDivider.messageId === settlingUnreadDivider.messageId))
			? ({
					...settlingUnreadDivider,
					phase: 'settling',
			  } satisfies VisualUnreadDividerState)
			: visualLiveUnreadDivider
				? ({
						...visualLiveUnreadDivider,
						phase: 'live',
				  } satisfies VisualUnreadDividerState)
				: null;
	const visualUnreadStartIndex = visualUnreadDivider
		? timeline.messages.findIndex((message) => message.id === visualUnreadDivider.messageId)
		: -1;
	const messageIdTransfers = useMemo(
		() =>
			previousRenderedRoomIdRef.current === timeline.roomId
				? findMessageIdTransfers(previousRenderedMessagesRef.current, timeline.messages)
				: [],
		[timeline.messages, timeline.roomId],
	);
	const localSendRequestedThisRender = forceScrollToBottomToken !== previousForceScrollToBottomTokenRef.current;
	if (localSendRequestedThisRender) {
		pendingLocalSendExpansionRef.current = true;
	}
	const expansionAppendedMessageIds = useMemo(
		() =>
			resolveTransferredAppendedMessageIds({
				appendedMessageIds: liveAppendedMessageIds,
				messageIdTransfers,
				preserveTransferredIds: pendingLocalSendExpansionRef.current,
			}),
		[liveAppendedMessageIds, messageIdTransfers],
	);
	const shouldDefaultExpandAppendedMessages =
		stickyToBottomRef.current ||
		liveViewportBottomGap <= AUTO_SCROLL_BOTTOM_THRESHOLD ||
		pendingLocalSendExpansionRef.current;
	const transferredExpandedMessages = useMemo(
		() => transferMessageStateById(activeExpandedMessages, messageIdTransfers),
		[activeExpandedMessages, messageIdTransfers],
	);
	const appendedMessageExpansionDefaults = useMemo(
		() =>
			resolveNextAppendedMessageExpansionDefaults({
				appendedMessageIds: expansionAppendedMessageIds,
				currentDefaults: transferMessageStateById(
					previousRenderedRoomIdRef.current === timeline.roomId ? appendedMessageExpansionDefaultsRef.current : {},
					messageIdTransfers,
				),
				currentMessageIds,
				expandByDefault: shouldDefaultExpandAppendedMessages,
			}),
		[currentMessageIds, expansionAppendedMessageIds, messageIdTransfers, shouldDefaultExpandAppendedMessages, timeline.roomId],
	);

	const setMessageRef = useCallback(
		(messageId: string) => (node: HTMLElement | null) => {
			if (node) {
				messageRefs.current.set(messageId, node);
				return;
			}

			messageRefs.current.delete(messageId);
		},
		[],
	);

	const setMessageBodyRef = useCallback(
		(messageId: string) => (node: HTMLDivElement | null) => {
			if (node) {
				messageBodyRefs.current.set(messageId, node);
				return;
			}

			messageBodyRefs.current.delete(messageId);
		},
		[],
	);

	const setAuthorTriggerRef = useCallback(
		(messageId: string) => (node: HTMLButtonElement | null) => {
			if (node) {
				authorTriggerRefs.current.set(messageId, node);
				return;
			}

			authorTriggerRefs.current.delete(messageId);
		},
		[],
	);

	const getAuthorTriggerNode = useCallback((messageId: string) => {
		const triggerFromRef = authorTriggerRefs.current.get(messageId);
		if (triggerFromRef) {
			return triggerFromRef;
		}

		const messageNode = messageRefs.current.get(messageId);
		if (messageNode) {
			return messageNode.querySelector<HTMLButtonElement>(`[data-testid="timeline-author-trigger-${messageId}"]`);
		}

		if (typeof document === 'undefined') {
			return null;
		}

		return document.querySelector<HTMLButtonElement>(`[data-testid="timeline-author-trigger-${messageId}"]`);
	}, []);

	const getMentionTriggerNode = useCallback((focusKey: string) => {
		if (typeof document === 'undefined') {
			return null;
		}

		return document.querySelector<HTMLButtonElement>(`[data-mention-focus-key="${focusKey}"]`);
	}, []);

	const getAuthorQuickPanelAnchorNode = useCallback(
		(panel: AuthorQuickPanelState) =>
			panel.trigger.kind === 'mention' ? getMentionTriggerNode(panel.trigger.focusKey) : getAuthorTriggerNode(panel.messageId),
		[getAuthorTriggerNode, getMentionTriggerNode],
	);

	const getMessageMentionNodes = useCallback((messageId: string) => {
		const messageNode =
			messageRefs.current.get(messageId) ??
			(typeof document === 'undefined'
				? null
				: document.querySelector<HTMLElement>(`[data-testid="timeline-message-${messageId}"]`));
		if (!messageNode) {
			return [] as HTMLButtonElement[];
		}

		return Array.from(
			messageNode.querySelectorAll<HTMLButtonElement>('button[data-mention-interactive="true"]'),
		).filter((mentionNode) => !mentionNode.closest('[inert]'));
	}, []);

	const getMessageImageNodes = useCallback((messageId: string) => {
		const messageNode =
			messageRefs.current.get(messageId) ??
			(typeof document === 'undefined'
				? null
				: document.querySelector<HTMLElement>(`[data-testid="timeline-message-${messageId}"]`));
		if (!messageNode) {
			return [] as HTMLImageElement[];
		}

		return Array.from(messageNode.querySelectorAll<HTMLImageElement>('img[data-timeline-interactive-image="true"]')).filter(
			(imageNode) => !imageNode.closest('[inert]'),
		);
	}, []);

	const getMessageContextMenuNode = useCallback(() => {
		if (typeof document === 'undefined') {
			return null;
		}

		return document.querySelector<HTMLDivElement>('[data-testid="timeline-message-context-menu"]');
	}, []);

	const resolveKeyboardMessageContextAnchor = useCallback((messageId: string) => {
		const messageNode = messageRefs.current.get(messageId);
		if (!messageNode) {
			return null;
		}

		const messageBodyNode = messageBodyRefs.current.get(messageId);
		const anchorRect = messageBodyNode?.getBoundingClientRect() ?? messageNode.getBoundingClientRect();
		return {
			x: anchorRect.left + Math.min(Math.max(anchorRect.width * 0.18, 92), 148),
			y: anchorRect.top + Math.min(Math.max(anchorRect.height * 0.18, 18), 34),
		};
	}, []);

	const setMessageActionRef = useCallback(
		(messageId: string, action: 'reply' | 'forward') => (node: HTMLButtonElement | null) => {
			const actionKey = `${messageId}:${action}`;
			if (node) {
				messageActionRefs.current.set(actionKey, node);
				return;
			}

			messageActionRefs.current.delete(actionKey);
		},
		[],
	);

	const setMessageReplyPreviewRef = useCallback(
		(messageId: string) => (node: HTMLButtonElement | null) => {
			if (node) {
				messageReplyPreviewRefs.current.set(messageId, node);
				return;
			}

			messageReplyPreviewRefs.current.delete(messageId);
		},
		[],
	);

	const setMessageContentRef = useCallback(
		(messageId: string) => (node: HTMLDivElement | null) => {
			const previousNode = messageContentRefs.current.get(messageId);
			if (previousNode && messageContentResizeObserverRef.current) {
				messageContentResizeObserverRef.current.unobserve(previousNode);
			}

			if (!node) {
				messageContentRefs.current.delete(messageId);
				return;
			}

			messageContentRefs.current.set(messageId, node);
			messageContentResizeObserverRef.current?.observe(node);
		},
		[],
	);

	const measureMountedMessageContentHeights = useCallback(() => {
		const currentMessageIdSet = new Set(currentMessageIds);

		setMessageContentHeights((currentHeights) => {
			const nextHeights = Object.fromEntries(
				Object.entries(currentHeights).filter(([messageId]) => currentMessageIdSet.has(messageId)),
			) as Record<string, number>;
			let hasChanges = Object.keys(nextHeights).length !== Object.keys(currentHeights).length;

			for (const messageId of currentMessageIds) {
				const node = messageContentRefs.current.get(messageId);
				if (!node) {
					continue;
				}

				const nextHeight = Math.ceil(node.getBoundingClientRect().height);
				if (nextHeights[messageId] === nextHeight) {
					continue;
				}

				hasChanges = true;
				nextHeights[messageId] = nextHeight;
			}

			return hasChanges ? nextHeights : currentHeights;
		});
	}, [currentMessageIds]);

	const captureViewportSnapshot = useCallback((): UnsavedRoomViewportSnapshot | null => {
		const container = messageStreamRef.current;
		if (!container || timeline.messages.length === 0) {
			return null;
		}

		const anchorTop = container.scrollTop + VIEWPORT_ANCHOR_TOP_BIAS;

		for (const message of timeline.messages) {
			const messageNode = messageRefs.current.get(message.id);
			if (!messageNode) {
				continue;
			}

			const messageBottom = messageNode.offsetTop + messageNode.offsetHeight;
			if (messageBottom <= anchorTop) {
				continue;
			}

			return {
				anchorMessageId: message.id,
				anchorOffset: Math.max(anchorTop - messageNode.offsetTop, 0),
			};
		}

		const fallbackMessage = timeline.messages.at(-1);
		if (!fallbackMessage) {
			return null;
		}

		const fallbackNode = messageRefs.current.get(fallbackMessage.id);
		if (!fallbackNode) {
			return null;
		}

		return {
			anchorMessageId: fallbackMessage.id,
			anchorOffset: Math.max(container.scrollTop - fallbackNode.offsetTop, 0),
		};
	}, [timeline.messages]);

	const persistViewportSnapshot = useCallback(
		(roomId = timeline.roomId) => {
			if (viewportPersistTimerRef.current) {
				window.clearTimeout(viewportPersistTimerRef.current);
				viewportPersistTimerRef.current = null;
			}

			const snapshot = captureViewportSnapshot() ?? currentViewportSnapshotRef.current;
			if (!snapshot) {
				return;
			}

			currentViewportSnapshotRef.current = snapshot;
			saveRoomViewportSnapshot(roomId, snapshot);
		},
		[captureViewportSnapshot, timeline.roomId],
	);

	const scheduleViewportSnapshotPersist = useCallback(
		(roomId = timeline.roomId) => {
			currentViewportSnapshotRef.current = captureViewportSnapshot();

			if (viewportPersistTimerRef.current) {
				window.clearTimeout(viewportPersistTimerRef.current);
			}

			viewportPersistTimerRef.current = window.setTimeout(() => {
				viewportPersistTimerRef.current = null;
				if (!currentViewportSnapshotRef.current) {
					return;
				}

				saveRoomViewportSnapshot(roomId, currentViewportSnapshotRef.current);
			}, VIEWPORT_PERSIST_DEBOUNCE_MS);
		},
		[captureViewportSnapshot, timeline.roomId],
	);

	const clearBottomReflowFollow = useCallback(() => {
		bottomReflowFollowRoomIdRef.current = null;
		bottomReflowFollowUntilRef.current = 0;
		stickyToBottomRef.current = false;
	}, []);

	const cancelTimelineScrollAnimation = useCallback(() => {
		if (programmaticViewportScrollResetFrameRef.current !== null) {
			window.cancelAnimationFrame(programmaticViewportScrollResetFrameRef.current);
			programmaticViewportScrollResetFrameRef.current = null;
		}

		if (contentResizeAdjustmentFrameRef.current !== null) {
			window.cancelAnimationFrame(contentResizeAdjustmentFrameRef.current);
			contentResizeAdjustmentFrameRef.current = null;
		}

		pendingContentResizeAdjustmentRef.current = null;
		programmaticViewportScrollRef.current = false;
		activeAnimatedScrollTargetRef.current = null;
		lastAnimatedScrollTopRef.current = null;

		if (scrollAnimationFrameRef.current === null) {
			return;
		}

		window.cancelAnimationFrame(scrollAnimationFrameRef.current);
		scrollAnimationFrameRef.current = null;
	}, []);

	const scrollMessageStreamTo = useCallback(
		(top: number, behavior: ScrollBehavior = 'auto', { preserveBottomFollow = false }: { preserveBottomFollow?: boolean } = {}) => {
			const container = messageStreamRef.current;
			if (!container) {
				return false;
			}

			const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0);
			const targetTop = Math.max(0, Math.min(top, maxScrollTop));
			const currentTop = container.scrollTop;
			const distancePx = targetTop - currentTop;
			const systemReducedMotion =
				typeof window !== 'undefined' && typeof window.matchMedia === 'function'
					? window.matchMedia('(prefers-reduced-motion: reduce)').matches
					: false;
			const reducedMotion = shouldDisableMotion({
				motionPreference,
				systemReducedMotion,
			});

			if (!preserveBottomFollow) {
				clearBottomReflowFollow();
			}

			cancelTimelineScrollAnimation();
			programmaticViewportScrollRef.current = true;

			if (
				!shouldAnimateTimelineScroll({
					behavior,
					distancePx,
					reducedMotion,
				})
			) {
				lastAnimatedScrollTopRef.current = targetTop;
				activeAnimatedScrollTargetRef.current = null;
				container.scrollTop = targetTop;
				currentViewportSnapshotRef.current = captureViewportSnapshot() ?? currentViewportSnapshotRef.current;
				programmaticViewportScrollResetFrameRef.current = window.requestAnimationFrame(() => {
					programmaticViewportScrollResetFrameRef.current = null;
					programmaticViewportScrollRef.current = false;
					lastAnimatedScrollTopRef.current = null;
				});
				return true;
			}

			const interruptedTop = container.scrollTop;
			container.scrollTo({
				top: interruptedTop,
				behavior: 'auto',
			});
			const animationStartTop = container.scrollTop;
			const animationDistancePx = targetTop - animationStartTop;

			if (
				!shouldAnimateTimelineScroll({
					behavior,
					distancePx: animationDistancePx,
					reducedMotion,
				})
			) {
				lastAnimatedScrollTopRef.current = targetTop;
				activeAnimatedScrollTargetRef.current = null;
				container.scrollTop = targetTop;
				programmaticViewportScrollRef.current = false;
				currentViewportSnapshotRef.current = captureViewportSnapshot() ?? currentViewportSnapshotRef.current;
				lastAnimatedScrollTopRef.current = null;
				setScrollSettleToken((currentToken) => currentToken + 1);
				return true;
			}

			const durationMs = resolveTimelineScrollDuration(animationDistancePx);
			const startedAt = performance.now();
			activeAnimatedScrollTargetRef.current = targetTop;
			lastAnimatedScrollTopRef.current = animationStartTop;

			const step = (now: number) => {
				const progress = Math.min((now - startedAt) / durationMs, 1);
				const nextScrollTop = resolveTimelineAnimatedScrollTop({
					from: animationStartTop,
					progress,
					to: targetTop,
				});
				lastAnimatedScrollTopRef.current = nextScrollTop;
				container.scrollTop = nextScrollTop;

				if (progress >= 1) {
					scrollAnimationFrameRef.current = null;
					programmaticViewportScrollRef.current = false;
					activeAnimatedScrollTargetRef.current = null;
					currentViewportSnapshotRef.current = captureViewportSnapshot() ?? currentViewportSnapshotRef.current;
					lastAnimatedScrollTopRef.current = null;
					setScrollSettleToken((currentToken) => currentToken + 1);
					return;
				}

				scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
			};

			scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
			return true;
		},
		[cancelTimelineScrollAnimation, captureViewportSnapshot, clearBottomReflowFollow, motionPreference],
	);

	const scrollMessageIntoCenter = useCallback(
		(messageId: string, behavior: ScrollBehavior = 'auto') => {
			const container = messageStreamRef.current;
			const messageNode = messageRefs.current.get(messageId);
			if (!container || !messageNode) {
				return false;
			}

			return scrollMessageStreamTo(
				resolveCenteredMessageScrollTop({
					containerHeight: container.clientHeight,
					targetHeight: messageNode.offsetHeight,
					targetTop: messageNode.offsetTop,
				}),
				behavior,
			);
		},
		[scrollMessageStreamTo],
	);

	const scrollToViewportSnapshot = useCallback((snapshot: ViewportAnchorSnapshot, behavior: ScrollBehavior = 'auto') => {
		const container = messageStreamRef.current;
		if (!container) {
			return false;
		}

		const anchorNode = messageRefs.current.get(snapshot.anchorMessageId);
		if (!anchorNode) {
			return false;
		}

		const clampedOffset = Math.min(snapshot.anchorOffset, Math.max(anchorNode.offsetHeight - 1, 0));
		scrollMessageStreamTo(Math.max(anchorNode.offsetTop + clampedOffset - VIEWPORT_ANCHOR_TOP_BIAS, 0), behavior);
		currentViewportSnapshotRef.current = {
			...snapshot,
			anchorOffset: clampedOffset,
		};
		return true;
	}, [scrollMessageStreamTo]);

	const restoreViewportSnapshot = useCallback(() => {
		const snapshot = loadRoomViewportSnapshot(timeline.roomId);
		if (!snapshot) {
			return false;
		}

		return scrollToViewportSnapshot(snapshot);
	}, [scrollToViewportSnapshot, timeline.roomId]);

	const highlightMessage = useCallback((messageId: string) => {
		setHighlightedMessageId(messageId);

		if (highlightTimerRef.current) {
			window.clearTimeout(highlightTimerRef.current);
		}

		highlightTimerRef.current = window.setTimeout(() => {
			setHighlightedMessageId((currentMessageId) => (currentMessageId === messageId ? null : currentMessageId));
		}, REPLY_JUMP_HIGHLIGHT_DURATION_MS);
	}, []);

	const isMessageComfortablyVisible = useCallback((messageId: string, padding = REPLY_RETURN_SOURCE_VISIBILITY_PADDING_PX) => {
		const container = messageStreamRef.current;
		const messageNode = messageRefs.current.get(messageId);

		if (!container || !messageNode) {
			return false;
		}

		const top = messageNode.offsetTop - container.scrollTop;
		const bottom = top + messageNode.offsetHeight;
		return top >= padding && bottom <= container.clientHeight - padding;
	}, []);

	const hasRejoinedReplySource = useCallback((navigation: ReplyJumpNavigationState) => {
		const container = messageStreamRef.current;
		if (!container) {
			return false;
		}

		const anchorNode = messageRefs.current.get(navigation.snapshot.anchorMessageId);
		if (!anchorNode) {
			return isMessageComfortablyVisible(navigation.sourceMessageId);
		}

		const clampedOffset = Math.min(navigation.snapshot.anchorOffset, Math.max(anchorNode.offsetHeight - 1, 0));
		const snapshotScrollTop = Math.max(anchorNode.offsetTop + clampedOffset - VIEWPORT_ANCHOR_TOP_BIAS, 0);
		return Math.abs(container.scrollTop - snapshotScrollTop) <= REPLY_RETURN_SNAPSHOT_TOLERANCE_PX;
	}, [isMessageComfortablyVisible]);

	const scrollToUnread = useCallback((behavior: ScrollBehavior = 'smooth') => {
		const container = messageStreamRef.current;
		const unreadDivider = unreadDividerRef.current;

		if (!container || !unreadDivider) {
			return;
		}

		scrollMessageStreamTo(Math.max(unreadDivider.offsetTop - clampUnreadContextOffset(container.clientHeight), 0), behavior);
	}, [scrollMessageStreamTo]);

	const clearSequentialBottomJump = useCallback(() => {
		pendingSequentialBottomJumpRef.current = false;
		setPreferBottomAfterUnreadClick(false);

		if (sequentialBottomJumpTimerRef.current) {
			window.clearTimeout(sequentialBottomJumpTimerRef.current);
			sequentialBottomJumpTimerRef.current = null;
		}
	}, []);

	const commitExpandedMessages = useCallback(
		(nextExpandedMessages: Record<string, boolean>, persistEntries?: Record<string, boolean | null | undefined>) => {
			loadedExpansionRoomIdRef.current = timeline.roomId;
			expandedMessagesRef.current = nextExpandedMessages;
			setExpandedMessages(nextExpandedMessages);

			if (persistEntries && Object.keys(persistEntries).length > 0) {
				saveRoomMessageExpansion(timeline.roomId, persistEntries);
			}
		},
		[timeline.roomId],
	);

	const toggleMessageExpanded = useCallback(
		(messageId: string) => {
			const currentExpandedMessages =
				loadedExpansionRoomIdRef.current === timeline.roomId ? expandedMessagesRef.current : loadRoomMessageExpansion(timeline.roomId);
			const message = timeline.messages.find((entry) => entry.id === messageId);
			if (!message) {
				return;
			}

			const collapsible = resolveMeasuredMessageCollapsible(messageContentHeights[messageId], message);
			const currentExpanded = resolveMessageExpandedState({
				appendedExpandedByDefault: appendedMessageExpansionDefaults[messageId],
				collapsible,
				persistedExpanded: currentExpandedMessages[messageId],
			});

			const nextExpanded = resolveNextMessageExpansionOverride({
				appendedExpandedByDefault: appendedMessageExpansionDefaults[messageId],
				collapsible,
				currentExpanded,
			});
			const nextExpandedMessages = {
				...currentExpandedMessages,
			};

			if (nextExpanded === undefined) {
				delete nextExpandedMessages[messageId];
			} else {
				nextExpandedMessages[messageId] = nextExpanded;
			}

			commitExpandedMessages(nextExpandedMessages, {
				[messageId]: nextExpanded ?? null,
			});
		},
		[appendedMessageExpansionDefaults, commitExpandedMessages, messageContentHeights, timeline.messages, timeline.roomId],
	);

	const focusMessage = useCallback(
		(
			messageId: string | null,
			behavior: ScrollBehavior = 'auto',
			interactionMode: 'keyboard' | 'pointer' | 'preserve' = 'preserve',
			scrollMode: 'nearest' | 'preserve' = 'nearest',
		) => {
			if (!messageId) {
				return false;
			}

			const messageNode = messageRefs.current.get(messageId);
			if (!messageNode) {
				return false;
			}

			if (interactionMode === 'keyboard') {
				markTimelineKeyboardInteraction();
				keyboardAnchorMessageIdRef.current = messageId;
			} else if (interactionMode === 'pointer') {
				markTimelinePointerInteraction();
			}

			setFocusedAuthorTrigger(null);
			updateFocusedMessageId(messageId);
			messageNode.focus({ preventScroll: true });
			if (scrollMode === 'nearest') {
				const container = messageStreamRef.current;
				if (container) {
					const nextScrollTop = resolveRevealScrollTop({
						paddingBottom: KEYBOARD_FOCUS_REVEAL_PADDING_BOTTOM,
						paddingTop: KEYBOARD_FOCUS_REVEAL_PADDING_TOP,
						targetHeight: messageNode.offsetHeight,
						targetTop: messageNode.offsetTop,
						viewportHeight: container.clientHeight,
						viewportTop: container.scrollTop,
					});
					if (nextScrollTop !== null) {
						scrollMessageStreamTo(nextScrollTop, behavior);
					}
				}
			}
			return true;
		},
		[markTimelineKeyboardInteraction, markTimelinePointerInteraction, scrollMessageStreamTo, updateFocusedMessageId],
	);

	const focusMessageAtIndex = useCallback(
		(index: number, behavior: ScrollBehavior = 'auto', interactionMode: 'keyboard' | 'pointer' | 'preserve' = 'keyboard') => {
			const message = timeline.messages[index];
			return focusMessage(message?.id ?? null, behavior, interactionMode);
		},
		[focusMessage, timeline.messages],
	);

	const focusFirstMessage = useCallback(
		(behavior: ScrollBehavior = 'auto', interactionMode: 'keyboard' | 'pointer' | 'preserve' = 'keyboard') =>
			focusMessageAtIndex(0, behavior, interactionMode),
		[focusMessageAtIndex],
	);

	const focusLastMessage = useCallback(
		(behavior: ScrollBehavior = 'auto', interactionMode: 'keyboard' | 'pointer' | 'preserve' = 'keyboard') =>
			focusMessageAtIndex(Math.max(currentMessageIds.length - 1, 0), behavior, interactionMode),
		[currentMessageIds.length, focusMessageAtIndex],
	);

	const focusUnreadAnchorMessage = useCallback(
		(interactionMode: 'keyboard' | 'pointer' | 'preserve' = 'keyboard') =>
			focusMessage(timeline.unreadAnchorMessageId ?? null, 'auto', interactionMode, 'preserve'),
		[focusMessage, timeline.unreadAnchorMessageId],
	);

	const focusLatestLoadedMessage = useCallback(
		(interactionMode: 'keyboard' | 'pointer' | 'preserve' = 'keyboard') =>
			focusMessage(currentMessageIds.at(-1) ?? null, 'auto', interactionMode, 'preserve'),
		[currentMessageIds, focusMessage],
	);

	const focusPreferredMessage = useCallback(
		(
			behavior: ScrollBehavior = 'auto',
			interactionMode: 'keyboard' | 'pointer' | 'preserve' = 'keyboard',
			strategy: 'preferred' | 'pointer-anchor' = 'preferred',
		) => {
			const resolvedInteractionMode = interactionMode === 'preserve' ? timelineInteractionModeRef.current : interactionMode;
			const preferredFocusedMessageId =
				resolvedInteractionMode === 'keyboard'
					? keyboardAnchorMessageIdRef.current ?? focusedMessageIdRef.current
					: focusedMessageIdRef.current;
			const currentViewportSnapshot = currentViewportSnapshotRef.current ?? captureViewportSnapshot();
			const nextFocusedMessageId = resolvePreferredTimelineFocusTarget({
				currentMessageIds,
				focusedMessageId: preferredFocusedMessageId,
				interactionMode: resolvedInteractionMode,
				pointerAnchorMessageId: pointerAnchorMessageIdRef.current,
				preferPointerAnchor: strategy === 'pointer-anchor',
				unreadFromMessageId: timeline.unreadAnchorMessageId,
				viewportAnchorMessageId: currentViewportSnapshot?.anchorMessageId ?? null,
			});

			return focusMessage(nextFocusedMessageId, behavior, interactionMode);
		},
		[
			captureViewportSnapshot,
			currentMessageIds,
			focusMessage,
			timeline.unreadAnchorMessageId,
		],
	);

	const focusBottomVisibleMessage = useCallback(
		(behavior: ScrollBehavior = 'auto', interactionMode: 'keyboard' | 'pointer' | 'preserve' = 'keyboard') => {
			const container = messageStreamRef.current;
			if (!container) {
				return false;
			}

			const viewportTop = container.scrollTop;
			const viewportBottom = viewportTop + container.clientHeight;
			const visibilityPadding = 12;

			for (let index = timeline.messages.length - 1; index >= 0; index -= 1) {
				const message = timeline.messages[index];
				if (!message) {
					continue;
				}

				const messageNode = messageRefs.current.get(message.id);
				if (!messageNode) {
					continue;
				}

				const messageTop = messageNode.offsetTop;
				const messageBottom = messageTop + messageNode.offsetHeight;
				if (messageTop >= viewportBottom - visibilityPadding) {
					continue;
				}

				if (messageBottom <= viewportTop + visibilityPadding) {
					break;
				}

				return focusMessage(message.id, behavior, interactionMode, 'preserve');
			}

			return false;
		},
		[focusMessage, timeline.messages],
	);

	const focusMessageAction = useCallback(
		(messageId: string | null, action: 'reply' | 'forward', behavior: ScrollBehavior = 'auto') => {
			if (!messageId) {
				return false;
			}

			const actionNode = messageActionRefs.current.get(`${messageId}:${action}`);
			const messageNode = messageRefs.current.get(messageId);
			if (!actionNode || !messageNode) {
				return false;
			}

			markTimelineKeyboardInteraction();
			keyboardAnchorMessageIdRef.current = messageId;
			setFocusedAuthorTrigger(null);
			updateFocusedMessageId(messageId);
			const container = messageStreamRef.current;
			if (container) {
				const nextScrollTop = resolveRevealScrollTop({
					paddingBottom: KEYBOARD_FOCUS_REVEAL_PADDING_BOTTOM,
					paddingTop: KEYBOARD_FOCUS_REVEAL_PADDING_TOP,
					targetHeight: messageNode.offsetHeight,
					targetTop: messageNode.offsetTop,
					viewportHeight: container.clientHeight,
					viewportTop: container.scrollTop,
				});
				if (nextScrollTop !== null) {
					scrollMessageStreamTo(nextScrollTop, behavior);
				}
			}
			window.requestAnimationFrame(() => {
				(messageActionRefs.current.get(`${messageId}:${action}`) ?? actionNode).focus({ preventScroll: true });
			});
			return true;
		},
		[markTimelineKeyboardInteraction, scrollMessageStreamTo, updateFocusedMessageId],
	);

	const focusMessageReplyPreview = useCallback(
		(messageId: string | null, behavior: ScrollBehavior = 'auto') => {
			if (!messageId) {
				return false;
			}

			const previewNode = messageReplyPreviewRefs.current.get(messageId);
			const messageNode = messageRefs.current.get(messageId);
			if (!previewNode || !messageNode) {
				return false;
			}

			markTimelineKeyboardInteraction();
			keyboardAnchorMessageIdRef.current = messageId;
			setFocusedAuthorTrigger(null);
			updateFocusedMessageId(messageId);
			const container = messageStreamRef.current;
			if (container) {
				const nextScrollTop = resolveRevealScrollTop({
					paddingBottom: KEYBOARD_FOCUS_REVEAL_PADDING_BOTTOM,
					paddingTop: KEYBOARD_FOCUS_REVEAL_PADDING_TOP,
					targetHeight: messageNode.offsetHeight,
					targetTop: messageNode.offsetTop,
					viewportHeight: container.clientHeight,
					viewportTop: container.scrollTop,
				});
				if (nextScrollTop !== null) {
					scrollMessageStreamTo(nextScrollTop, behavior);
				}
			}
			window.requestAnimationFrame(() => {
				(messageReplyPreviewRefs.current.get(messageId) ?? previewNode).focus({ preventScroll: true });
			});
			return true;
		},
		[markTimelineKeyboardInteraction, scrollMessageStreamTo, updateFocusedMessageId],
	);

	const focusMessageImage = useCallback(
		(messageId: string | null, imageIndex = 0, behavior: ScrollBehavior = 'auto') => {
			if (!messageId) {
				return false;
			}

			const imageNode = getMessageImageNodes(messageId)[imageIndex] ?? null;
			const messageNode = messageRefs.current.get(messageId);
			if (!imageNode || !messageNode) {
				return false;
			}

			markTimelineKeyboardInteraction();
			keyboardAnchorMessageIdRef.current = messageId;
			setFocusedAuthorTrigger(null);
			updateFocusedMessageId(messageId);
			const container = messageStreamRef.current;
			if (container) {
				const nextScrollTop = resolveRevealScrollTop({
					paddingBottom: KEYBOARD_FOCUS_REVEAL_PADDING_BOTTOM,
					paddingTop: KEYBOARD_FOCUS_REVEAL_PADDING_TOP,
					targetHeight: messageNode.offsetHeight,
					targetTop: messageNode.offsetTop,
					viewportHeight: container.clientHeight,
					viewportTop: container.scrollTop,
				});
				if (nextScrollTop !== null) {
					scrollMessageStreamTo(nextScrollTop, behavior);
				}
			}
			window.requestAnimationFrame(() => {
				(getMessageImageNodes(messageId)[imageIndex] ?? imageNode).focus({ preventScroll: true });
			});
			return true;
		},
		[getMessageImageNodes, markTimelineKeyboardInteraction, scrollMessageStreamTo, updateFocusedMessageId],
	);

	const focusMessageMention = useCallback(
		(messageId: string | null, mentionIndex = 0, behavior: ScrollBehavior = 'auto') => {
			if (!messageId) {
				return false;
			}

			const mentionNode = getMessageMentionNodes(messageId)[mentionIndex] ?? null;
			const messageNode = messageRefs.current.get(messageId);
			if (!mentionNode || !messageNode) {
				return false;
			}

			markTimelineKeyboardInteraction();
			keyboardAnchorMessageIdRef.current = messageId;
			setFocusedAuthorTrigger(null);
			updateFocusedMessageId(messageId);
			const container = messageStreamRef.current;
			if (container) {
				const nextScrollTop = resolveRevealScrollTop({
					paddingBottom: KEYBOARD_FOCUS_REVEAL_PADDING_BOTTOM,
					paddingTop: KEYBOARD_FOCUS_REVEAL_PADDING_TOP,
					targetHeight: messageNode.offsetHeight,
					targetTop: messageNode.offsetTop,
					viewportHeight: container.clientHeight,
					viewportTop: container.scrollTop,
				});
				if (nextScrollTop !== null) {
					scrollMessageStreamTo(nextScrollTop, behavior);
				}
			}
			window.requestAnimationFrame(() => {
				(getMessageMentionNodes(messageId)[mentionIndex] ?? mentionNode).focus({ preventScroll: true });
			});
			return true;
		},
		[getMessageMentionNodes, markTimelineKeyboardInteraction, scrollMessageStreamTo, updateFocusedMessageId],
	);

	const syncFocusedMessageToViewport = useCallback(() => {
		const container = messageStreamRef.current;
		if (
			!container ||
			messageContextMenu ||
			authorQuickPanel?.source === 'keyboard' ||
			(typeof document !== 'undefined' && container.contains(document.activeElement))
		) {
			return;
		}

		if (timelineInteractionModeRef.current === 'keyboard' && !keyboardFocusActive) {
			return;
		}

		const currentViewportSnapshot = currentViewportSnapshotRef.current ?? captureViewportSnapshot();
		const nextFocusedMessageId = currentViewportSnapshot?.anchorMessageId ?? currentMessageIds.at(-1) ?? null;
		updateFocusedMessageId(nextFocusedMessageId);
	}, [authorQuickPanel?.source, captureViewportSnapshot, currentMessageIds, keyboardFocusActive, messageContextMenu, updateFocusedMessageId]);

	const focusHorizontalStop = useCallback(
		({
			behavior = 'auto',
			direction,
			from,
			message,
		}: {
			behavior?: ScrollBehavior;
			direction: 'left' | 'right';
			from: TimelineChildFocusTarget;
			message: TimelineMessage;
		}) => {
			const target = resolveTimelineChildFocusTarget({
				canOpenActions: !localOutgoingMessageIds.has(message.id),
				direction,
				from,
				hasReplyPreview: Boolean(message.replyTo),
				mentionCount: getMessageMentionNodes(message.id).length,
				imageCount: getMessageImageNodes(message.id).length,
			});

			if (!target) {
				return false;
			}

			if (target.kind === 'message') {
				return focusMessage(message.id, behavior, 'keyboard');
			}

			if (target.kind === 'reply-preview') {
				return focusMessageReplyPreview(message.id, behavior);
			}

			if (target.kind === 'mention') {
				return focusMessageMention(message.id, target.index, behavior);
			}

			if (target.kind === 'image') {
				return focusMessageImage(message.id, target.index, behavior);
			}

			if (target.kind === 'reply-action') {
				return focusMessageAction(message.id, 'reply', behavior);
			}

			return focusMessageAction(message.id, 'forward', behavior);
		},
		[
			focusMessage,
			focusMessageAction,
			focusMessageImage,
			focusMessageMention,
			focusMessageReplyPreview,
			getMessageImageNodes,
			getMessageMentionNodes,
			localOutgoingMessageIds,
		],
	);

	const focusMessageActionAtIndex = useCallback(
		(index: number, action: 'reply' | 'forward', behavior: ScrollBehavior = 'auto') => {
			const message = timeline.messages[index];
			return focusMessageAction(message?.id ?? null, action, behavior);
		},
		[focusMessageAction, timeline.messages],
	);

	const handleTimelineImageFocus = useCallback(
		(event: ReactFocusEvent<HTMLImageElement>) => {
			const messageId = event.currentTarget.dataset.timelineMessageId;
			if (!messageId) {
				return;
			}

			setFocusedAuthorTrigger(null);
			updateFocusedMessageId(messageId);
		},
		[updateFocusedMessageId],
	);

	const handleTimelineMentionFocus = useCallback(
		(event: ReactFocusEvent<HTMLButtonElement>) => {
			const messageId = event.currentTarget.dataset.timelineMessageId;
			if (!messageId) {
				return;
			}

			keyboardAnchorMessageIdRef.current = messageId;
			setFocusedAuthorTrigger(null);
			updateFocusedMessageId(messageId);
		},
		[updateFocusedMessageId],
	);

	const focusAuthorTrigger = useCallback(
		(messageId: string | null, behavior: ScrollBehavior = 'auto', interactionMode: 'keyboard' | 'pointer' = 'keyboard') => {
			if (!messageId) {
				return false;
			}

			const triggerNode = getAuthorTriggerNode(messageId);
			const messageNode =
				messageRefs.current.get(messageId) ??
				(typeof document === 'undefined'
					? null
					: document.querySelector<HTMLElement>(`[data-testid="timeline-message-${messageId}"]`));
			if (!triggerNode || !messageNode) {
				return false;
			}

			if (interactionMode === 'keyboard') {
				markTimelineKeyboardInteraction();
				keyboardAnchorMessageIdRef.current = messageId;
			} else {
				markTimelinePointerInteraction();
			}

			setFocusedAuthorTrigger({
				messageId,
				mode: interactionMode === 'keyboard' ? 'avatar' : 'meta',
			});
			updateFocusedMessageId(messageId);
			const container = messageStreamRef.current;
			if (container) {
				const nextScrollTop = resolveRevealScrollTop({
					paddingBottom: KEYBOARD_FOCUS_REVEAL_PADDING_BOTTOM,
					paddingTop: KEYBOARD_FOCUS_REVEAL_PADDING_TOP,
					targetHeight: messageNode.offsetHeight,
					targetTop: messageNode.offsetTop,
					viewportHeight: container.clientHeight,
					viewportTop: container.scrollTop,
				});
				if (nextScrollTop !== null) {
					scrollMessageStreamTo(nextScrollTop, behavior);
				}
			}
			triggerNode.focus({ preventScroll: true });
			return true;
		},
		[
			getAuthorTriggerNode,
			markTimelineKeyboardInteraction,
			markTimelinePointerInteraction,
			scrollMessageStreamTo,
			updateFocusedMessageId,
		],
	);

	const focusAdjacentAuthorTrigger = useCallback(
		(messageId: string, direction: 'next' | 'previous', behavior: ScrollBehavior = 'auto') => {
			const targetMessageId = resolveAdjacentAuthorNavigableMessageId({
				direction,
				messageId,
				navigableMessageIds: authorNavigableMessageIds,
			});

			return focusAuthorTrigger(targetMessageId, behavior, 'keyboard');
		},
		[authorNavigableMessageIds, focusAuthorTrigger],
	);

	const copyMessagePlainText = useCallback(async (message: TimelineMessage) => {
		const plainText = stripMarkdownToPlainText(composeForwardSourceMarkdown(message)) || '图片消息';
		await copyTextToClipboard(plainText);
	}, []);

	const primeSequentialBottomJump = useCallback(() => {
		pendingSequentialBottomJumpRef.current = true;
		setPreferBottomAfterUnreadClick(true);

		if (sequentialBottomJumpTimerRef.current) {
			window.clearTimeout(sequentialBottomJumpTimerRef.current);
		}

		sequentialBottomJumpTimerRef.current = window.setTimeout(() => {
			sequentialBottomJumpTimerRef.current = null;
			pendingSequentialBottomJumpRef.current = false;
			setPreferBottomAfterUnreadClick(false);
		}, SEQUENTIAL_BOTTOM_JUMP_WINDOW_MS);
	}, []);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
		const container = messageStreamRef.current;

		if (!container) {
			return;
		}

		clearSequentialBottomJump();
		stickyToBottomRef.current = true;
		bottomReflowFollowRoomIdRef.current = timeline.roomId;
		bottomReflowFollowUntilRef.current = Date.now() + BOTTOM_REFLOW_FOLLOW_WINDOW_MS;
		scrollMessageStreamTo(container.scrollHeight, behavior, {
			preserveBottomFollow: true,
		});
	}, [clearSequentialBottomJump, scrollMessageStreamTo, timeline.roomId]);

	const shouldFollowBottomThroughReflow = useCallback(
		(roomId = timeline.roomId) =>
			bottomReflowFollowRoomIdRef.current === roomId && Date.now() <= bottomReflowFollowUntilRef.current,
		[timeline.roomId],
	);
	const shouldPreserveBottomDuringReflow = useCallback(
		(bottomGap: number) =>
			shouldPreserveTimelineBottom({
				autoScrollBottomThreshold: AUTO_SCROLL_BOTTOM_THRESHOLD,
				bottomGap,
				followBottomThroughReflow: shouldFollowBottomThroughReflow(),
				pendingLocalSendExpansion: pendingLocalSendExpansionRef.current,
				stickyToBottom: stickyToBottomRef.current,
			}),
		[shouldFollowBottomThroughReflow],
	);

	const clearReplyJumpReturnDismissTimer = useCallback(() => {
		if (replyJumpReturnDismissTimerRef.current) {
			window.clearTimeout(replyJumpReturnDismissTimerRef.current);
			replyJumpReturnDismissTimerRef.current = null;
		}
	}, []);

	const scheduleReplyJumpReturnDismiss = useCallback(() => {
		clearReplyJumpReturnDismissTimer();
		replyJumpReturnDismissTimerRef.current = window.setTimeout(() => {
			replyJumpReturnDismissTimerRef.current = null;
			setReplyJumpReturnVisible(false);
		}, REPLY_RETURN_AUTO_DISMISS_MS);
	}, [clearReplyJumpReturnDismissTimer]);

	const clearUnreadDividerSettleTimer = useCallback(() => {
		if (unreadDividerSettleTimerRef.current !== null) {
			window.clearTimeout(unreadDividerSettleTimerRef.current);
			unreadDividerSettleTimerRef.current = null;
		}
	}, []);
	const startUnreadDividerSettling = useCallback((snapshot: TimelineUnreadDividerSnapshot | null) => {
		if (!snapshot) {
			return;
		}

		pendingUnreadDividerSettleAnchorRef.current = snapshot.messageId;
		setSettlingUnreadDivider((currentDivider) =>
			currentDivider?.roomId === snapshot.roomId &&
			currentDivider.messageId === snapshot.messageId &&
			currentDivider.label === snapshot.label
				? currentDivider
				: snapshot,
		);
	}, []);
	const maybeRequestMarkRead = useCallback(() => {
		if (!onRequestMarkRead || !timeline.unreadAnchorMessageId || !stickyToBottomRef.current) {
			return;
		}

		if (lastReadRequestAnchorRef.current === timeline.unreadAnchorMessageId) {
			return;
		}

		lastReadRequestAnchorRef.current = timeline.unreadAnchorMessageId;
		if (!suppressPinnedLiveUnreadDivider) {
			startUnreadDividerSettling(liveUnreadDivider);
		}
		onRequestMarkRead();
	}, [
		liveUnreadDivider,
		onRequestMarkRead,
		startUnreadDividerSettling,
		suppressPinnedLiveUnreadDivider,
		timeline.unreadAnchorMessageId,
	]);

	const updateFloatingActions = useCallback(() => {
		const container = messageStreamRef.current;

		if (!container) {
			return;
		}

		const { scrollTop, clientHeight, scrollHeight } = container;
		const bottomGap = scrollHeight - (scrollTop + clientHeight);
		lastKnownBottomGapRef.current = bottomGap;
		stickyToBottomRef.current = bottomGap <= AUTO_SCROLL_BOTTOM_THRESHOLD;
		const unreadTop = unreadDividerRef.current?.offsetTop ?? null;
		const mentionNode = mentionTargetMessageId ? messageRefs.current.get(mentionTargetMessageId) ?? null : null;
		const isAboveUnread = unreadTop !== null && unreadTop > scrollTop + FLOATING_ACTION_TOP_THRESHOLD;
		const isPastUnread = unreadTop !== null && unreadTop < scrollTop - 24;
		const isMentionBelow =
			mentionTargetMessageId !== null &&
			mentionNode !== null &&
			!isMessageComfortablyVisible(mentionTargetMessageId, FLOATING_MENTION_VISIBILITY_PADDING_PX) &&
			mentionNode.offsetTop > scrollTop + FLOATING_ACTION_TOP_THRESHOLD;

		if (bottomGap <= AUTO_SCROLL_BOTTOM_THRESHOLD && !isAboveUnread) {
			clearSequentialBottomJump();
		}

		setShowJumpToMention(isMentionBelow);
		setShowJumpToUnread(isAboveUnread);
		setShowJumpToBottom(
			unreadTop === null
				? bottomGap > JUMP_TO_BOTTOM_VISIBILITY_THRESHOLD
				: !isAboveUnread && isPastUnread && bottomGap > JUMP_TO_BOTTOM_VISIBILITY_THRESHOLD,
		);
		}, [clearSequentialBottomJump, isMessageComfortablyVisible, mentionTargetMessageId]);

	useLayoutEffect(() => {
		if (liveUnreadDivider) {
			lastLiveUnreadDividerRef.current = liveUnreadDivider;
			if (
				pendingUnreadDividerSettleAnchorRef.current !== null &&
				pendingUnreadDividerSettleAnchorRef.current !== liveUnreadDivider.messageId
			) {
				pendingUnreadDividerSettleAnchorRef.current = null;
			}
			const preservingActiveSettlingDivider =
				settlingUnreadDivider?.roomId === liveUnreadDivider.roomId && settlingUnreadDivider.messageId === liveUnreadDivider.messageId;
			if (settlingUnreadDivider !== null && !preservingActiveSettlingDivider) {
				clearUnreadDividerSettleTimer();
				setSettlingUnreadDivider(null);
			}
			return;
		}

		const nextSettlingUnreadDivider = resolveSettlingUnreadDivider({
			currentRoomId: timeline.roomId,
			currentUnreadAnchorMessageId: timeline.unreadAnchorMessageId,
			lastReadRequestAnchorId: pendingUnreadDividerSettleAnchorRef.current,
			loadedMessageIds: currentMessageIds,
			previousLiveUnreadDivider: lastLiveUnreadDividerRef.current,
		});

		if (!nextSettlingUnreadDivider) {
			if (settlingUnreadDivider !== null) {
				clearUnreadDividerSettleTimer();
				setSettlingUnreadDivider(null);
			}
			return;
		}

		const matchesCurrentSettlingDivider =
			settlingUnreadDivider?.roomId === nextSettlingUnreadDivider.roomId &&
			settlingUnreadDivider.messageId === nextSettlingUnreadDivider.messageId &&
			settlingUnreadDivider.label === nextSettlingUnreadDivider.label;
		if (!matchesCurrentSettlingDivider) {
			setSettlingUnreadDivider(nextSettlingUnreadDivider);
		}

		if (unreadDividerSettleTimerRef.current !== null) {
			return;
		}

		unreadDividerSettleTimerRef.current = window.setTimeout(() => {
			unreadDividerSettleTimerRef.current = null;
			if (pendingUnreadDividerSettleAnchorRef.current === nextSettlingUnreadDivider.messageId) {
				pendingUnreadDividerSettleAnchorRef.current = null;
			}
			setSettlingUnreadDivider((currentDivider) =>
				currentDivider?.roomId === nextSettlingUnreadDivider.roomId &&
				currentDivider.messageId === nextSettlingUnreadDivider.messageId
					? null
					: currentDivider,
			);
		}, UNREAD_DIVIDER_SETTLE_MS);
	}, [
		clearUnreadDividerSettleTimer,
		currentMessageIds,
		liveUnreadDivider,
		settlingUnreadDivider,
		timeline.roomId,
		timeline.unreadAnchorMessageId,
	]);

	const runViewportSync = useCallback(
		(mode: PendingViewportSyncMode = 'full') => {
			updateFloatingActions();
			if (mode === 'minimal') {
				return;
			}

			maybeRequestMarkRead();
			currentViewportSnapshotRef.current = captureViewportSnapshot();
			syncFocusedMessageToViewport();
			scheduleViewportSnapshotPersist();
		},
		[captureViewportSnapshot, maybeRequestMarkRead, scheduleViewportSnapshotPersist, syncFocusedMessageToViewport, updateFloatingActions],
	);

	const scheduleViewportSync = useCallback(
		(mode: PendingViewportSyncMode = 'full') => {
			const currentMode = pendingViewportSyncModeRef.current;
			pendingViewportSyncModeRef.current = currentMode === 'full' || mode === 'full' ? 'full' : mode;

			if (viewportSyncFrameRef.current !== null || typeof window === 'undefined') {
				return;
			}

			viewportSyncFrameRef.current = window.requestAnimationFrame(() => {
				viewportSyncFrameRef.current = null;
				const pendingMode = pendingViewportSyncModeRef.current;
				pendingViewportSyncModeRef.current = null;
				if (!pendingMode) {
					return;
				}

				runViewportSync(pendingMode);
			});
		},
		[runViewportSync],
	);

	const scheduleHistoryPrependRestoreSettleCheck = useCallback(() => {
		if (historyPrependRestoreSettleFrameRef.current !== null || typeof window === 'undefined') {
			return;
		}

		const scheduledRestore = activeHistoryPrependRestoreRef.current;
		if (!scheduledRestore || scheduledRestore.roomId !== timeline.roomId) {
			return;
		}

		const scheduledRevision = scheduledRestore.revision;
		historyPrependRestoreSettleFrameRef.current = window.requestAnimationFrame(() => {
			historyPrependRestoreSettleFrameRef.current = null;
			const currentRestore = activeHistoryPrependRestoreRef.current;
			if (!currentRestore || currentRestore.roomId !== timeline.roomId) {
				return;
			}

			if (performance.now() - currentRestore.startedAt < HISTORY_PREPEND_RESTORE_GRACE_MS) {
				scheduleHistoryPrependRestoreSettleCheck();
				return;
			}

			if (
				olderHistoryLoadInFlightRef.current ||
				currentRestore.pendingLayoutRestore ||
				currentRestore.revision !== scheduledRevision ||
				contentResizeAdjustmentFrameRef.current !== null ||
				pendingContentResizeAdjustmentRef.current?.source === 'history-prepend'
			) {
				scheduleHistoryPrependRestoreSettleCheck();
				return;
			}

			activeHistoryPrependRestoreRef.current = null;
		});
	}, [timeline.roomId]);

	const scheduleContentResizeAdjustment = useCallback(
		(
			mode: 'anchor' | 'bottom',
			snapshot: UnsavedRoomViewportSnapshot | RoomViewportSnapshot | null = null,
			roomId = timeline.roomId,
			source: 'bottom-reflow' | 'content-resize' | 'history-prepend' = mode === 'bottom' ? 'bottom-reflow' : 'content-resize',
		) => {
			const normalizedAdjustment = normalizePendingContentResizeAdjustment({
				activeHistoryPrependRestore: activeHistoryPrependRestoreRef.current,
				nextAdjustment: {
					mode,
					roomId,
					snapshot,
					source,
				},
			});
			if (
				normalizedAdjustment.source === 'history-prepend' &&
				activeHistoryPrependRestoreRef.current &&
				activeHistoryPrependRestoreRef.current.roomId === roomId
			) {
				activeHistoryPrependRestoreRef.current.revision += 1;
			}

			pendingContentResizeAdjustmentRef.current = mergePendingContentResizeAdjustment({
				currentAdjustment: pendingContentResizeAdjustmentRef.current,
				nextAdjustment: normalizedAdjustment,
			});

			if (historyPrependRestoreSettleFrameRef.current !== null) {
				window.cancelAnimationFrame(historyPrependRestoreSettleFrameRef.current);
				historyPrependRestoreSettleFrameRef.current = null;
			}

			if (normalizedAdjustment.source === 'history-prepend') {
				scheduleHistoryPrependRestoreSettleCheck();
			}

			if (scrollAnimationFrameRef.current !== null || contentResizeAdjustmentFrameRef.current !== null || typeof window === 'undefined') {
				return;
			}

			contentResizeAdjustmentFrameRef.current = window.requestAnimationFrame(() => {
				contentResizeAdjustmentFrameRef.current = null;
				const pendingAdjustment = pendingContentResizeAdjustmentRef.current;
				pendingContentResizeAdjustmentRef.current = null;

				if (!pendingAdjustment || pendingAdjustment.roomId !== timeline.roomId) {
					return;
				}

				if (pendingAdjustment.mode === 'bottom') {
					scrollToBottom('auto');
				} else if (pendingAdjustment.snapshot) {
					scrollToViewportSnapshot(pendingAdjustment.snapshot, 'auto');
				}

				if (pendingAdjustment.source === 'history-prepend') {
					scheduleHistoryPrependRestoreSettleCheck();
				}

				runViewportSync('full');
			});
		},
		[runViewportSync, scheduleHistoryPrependRestoreSettleCheck, scrollToBottom, scrollToViewportSnapshot, timeline.roomId],
	);

	useEffect(() => {
		if (
			scrollSettleToken === 0 ||
			pendingContentResizeAdjustmentRef.current === null ||
			scrollAnimationFrameRef.current !== null ||
			contentResizeAdjustmentFrameRef.current !== null ||
			typeof window === 'undefined'
		) {
			return;
		}

		contentResizeAdjustmentFrameRef.current = window.requestAnimationFrame(() => {
			contentResizeAdjustmentFrameRef.current = null;
			const pendingAdjustment = pendingContentResizeAdjustmentRef.current;
			pendingContentResizeAdjustmentRef.current = null;

			if (!pendingAdjustment || pendingAdjustment.roomId !== timeline.roomId) {
				return;
			}

			if (pendingAdjustment.mode === 'bottom') {
				scrollToBottom('auto');
			} else if (pendingAdjustment.snapshot) {
				scrollToViewportSnapshot(pendingAdjustment.snapshot, 'auto');
			}

			if (pendingAdjustment.source === 'history-prepend') {
				scheduleHistoryPrependRestoreSettleCheck();
			}

			runViewportSync('full');
		});
	}, [
		runViewportSync,
		scheduleHistoryPrependRestoreSettleCheck,
		scrollSettleToken,
		scrollToBottom,
		scrollToViewportSnapshot,
		timeline.roomId,
	]);

	const startOlderHistoryLoad = useCallback(() => {
		const container = messageStreamRef.current;
		if (!container || !onLoadOlderHistory) {
			return;
		}

		const viewportSnapshot = captureViewportSnapshot();
		const targetRoomId = timeline.roomId;
		olderHistoryLoadInFlightRef.current = true;
		olderHistoryPrefetchReadyRef.current = false;
		if (viewportSnapshot) {
			activeHistoryPrependRestoreRef.current = {
				baselineMessageCount: currentMessageIds.length,
				baselineScrollHeight: container.scrollHeight,
				baselineScrollTop: container.scrollTop,
				pendingLayoutRestore: true,
				revision: 0,
				roomId: targetRoomId,
				snapshot: viewportSnapshot,
				startedAt: performance.now(),
			};
		}

		void onLoadOlderHistory()
			.then((loadedOlderHistory) => {
				if (!loadedOlderHistory || currentTimelineRoomIdRef.current !== targetRoomId) {
					if (activeHistoryPrependRestoreRef.current?.roomId === targetRoomId) {
						activeHistoryPrependRestoreRef.current = null;
					}
					return;
				}

				scheduleContentResizeAdjustment(
					'anchor',
					viewportSnapshot,
					targetRoomId,
					viewportSnapshot ? 'history-prepend' : 'content-resize',
				);
			})
			.finally(() => {
				if (currentTimelineRoomIdRef.current === targetRoomId) {
					olderHistoryLoadInFlightRef.current = false;
				}
			});
	}, [captureViewportSnapshot, currentMessageIds.length, onLoadOlderHistory, scheduleContentResizeAdjustment, timeline.roomId]);

	const maybePrefetchOlderHistory = useCallback((previousScrollTop: number, currentScrollTop: number) => {
		const container = messageStreamRef.current;
		if (
			!container ||
			!onPrefetchOlderHistory ||
			olderHistoryPrefetchReadyRef.current ||
			!shouldPrefetchOlderHistory({
				hasOlderHistory,
				isLoadingOlderHistory,
				loadThresholdPx: HISTORY_LOAD_TOP_THRESHOLD_PX,
				prefetchPending: olderHistoryPrefetchPendingRef.current,
				scrollingUp: currentScrollTop < previousScrollTop,
				scrollTop: currentScrollTop,
				viewportHeight: container.clientHeight,
			})
		) {
			return;
		}

		olderHistoryPrefetchPendingRef.current = true;
		olderHistoryPrefetchReadyRef.current = false;
		void Promise.resolve(onPrefetchOlderHistory())
			.then(() => {
				olderHistoryPrefetchReadyRef.current = true;
				if (
					messageStreamRef.current &&
					!isLoadingOlderHistory &&
					!olderHistoryLoadInFlightRef.current &&
					!programmaticViewportScrollRef.current &&
					messageStreamRef.current.scrollTop <=
						resolveOlderHistoryReadyLoadThreshold({
							loadThresholdPx: HISTORY_LOAD_TOP_THRESHOLD_PX,
							viewportHeight: messageStreamRef.current.clientHeight,
						})
				) {
					startOlderHistoryLoad();
				}
			})
			.catch(() => undefined)
			.finally(() => {
				olderHistoryPrefetchPendingRef.current = false;
			});
	}, [hasOlderHistory, isLoadingOlderHistory, onPrefetchOlderHistory, startOlderHistoryLoad]);

	const maybeLoadOlderHistory = useCallback((previousScrollTop: number, currentScrollTop: number) => {
		const container = messageStreamRef.current;
		if (
			!container ||
			!onLoadOlderHistory ||
			!shouldLoadOlderHistory({
				hasOlderHistory,
				isLoadingOlderHistory,
				loadInFlight: olderHistoryLoadInFlightRef.current,
				loadThresholdPx: HISTORY_LOAD_TOP_THRESHOLD_PX,
				prefetchedPageReady: olderHistoryPrefetchReadyRef.current,
				programmaticScrollActive: programmaticViewportScrollRef.current,
				scrollingUp: currentScrollTop < previousScrollTop,
				scrollTop: currentScrollTop,
				viewportHeight: container.clientHeight,
			})
		) {
			return;
		}

		startOlderHistoryLoad();
	}, [
		hasOlderHistory,
		isLoadingOlderHistory,
		onLoadOlderHistory,
		startOlderHistoryLoad,
	]);

	const jumpToLoadedOriginalMessage = useCallback(
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
			if (replyJumpLatestRevealTimerRef.current) {
				window.clearTimeout(replyJumpLatestRevealTimerRef.current);
				replyJumpLatestRevealTimerRef.current = null;
			}
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
			clearReplyJumpReturnDismissTimer,
			highlightMessage,
			isMessageComfortablyVisible,
			markTimelineKeyboardInteraction,
			scrollMessageIntoCenter,
			updateFocusedMessageId,
		],
	);

	const jumpToOriginalMessage = useCallback(
		async (sourceMessageId: string, targetMessageId: string, { focusTarget = false }: { focusTarget?: boolean } = {}) => {
			if (jumpToLoadedOriginalMessage(sourceMessageId, targetMessageId, { focusTarget })) {
				return;
			}

			if (currentMessageIds.includes(targetMessageId)) {
				pendingResolvedReplyJumpRef.current = {
					focusTarget,
					sourceMessageId,
					targetMessageId,
				};
				window.requestAnimationFrame(() => {
					const pendingReplyJump = pendingResolvedReplyJumpRef.current;
					if (
						!pendingReplyJump ||
						pendingReplyJump.sourceMessageId !== sourceMessageId ||
						pendingReplyJump.targetMessageId !== targetMessageId
					) {
						return;
					}

					if (
						jumpToLoadedOriginalMessage(sourceMessageId, targetMessageId, {
							focusTarget,
						})
					) {
						pendingResolvedReplyJumpRef.current = null;
					}
				});
				return;
			}

			if (!onResolveReplyTarget) {
				return;
			}

			const resolved = await onResolveReplyTarget(targetMessageId);
			if (!resolved) {
				return;
			}

			pendingResolvedReplyJumpRef.current = {
				focusTarget,
				sourceMessageId,
				targetMessageId,
			};
		},
		[currentMessageIds, jumpToLoadedOriginalMessage, onResolveReplyTarget],
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

		if (replyJumpLatestRevealTimerRef.current) {
			window.clearTimeout(replyJumpLatestRevealTimerRef.current);
			replyJumpLatestRevealTimerRef.current = null;
		}
		clearReplyJumpReturnDismissTimer();
		replyJumpLatestRevealAllowedRef.current = false;
		replyJumpPendingManualRevealRef.current = false;
		setReplyJumpLatestVisible(false);
		setReplyJumpReturnVisible(false);
		setReplyJumpNavigation(null);
	}, [clearReplyJumpReturnDismissTimer, focusMessage, highlightMessage, replyJumpNavigation, scrollMessageIntoCenter, scrollToViewportSnapshot]);

	const jumpToMention = useCallback(() => {
		if (!mentionTargetMessageId) {
			return;
		}

		const targetNode = messageRefs.current.get(mentionTargetMessageId);
		if (!targetNode) {
			return;
		}

		if (!isMessageComfortablyVisible(mentionTargetMessageId)) {
			scrollMessageIntoCenter(mentionTargetMessageId, 'smooth');
		}

		highlightMessage(mentionTargetMessageId);
		updateFocusedMessageId(mentionTargetMessageId);
	}, [highlightMessage, isMessageComfortablyVisible, mentionTargetMessageId, scrollMessageIntoCenter, updateFocusedMessageId]);

	const showTimelineToast = useCallback(
		(message: string, tone: TimelineToastTone) => {
			if (toastTimerRef.current) {
				window.clearTimeout(toastTimerRef.current);
				toastTimerRef.current = null;
			}

			setTimelineToast({
				id: Date.now(),
				message,
				tone,
			});

			toastTimerRef.current = window.setTimeout(() => {
				toastTimerRef.current = null;
				setTimelineToast((currentToast) => (currentToast?.message === message ? null : currentToast));
			}, TIMELINE_TOAST_DURATION_MS);
		},
		[],
	);

	const closeAuthorQuickPanel = useCallback(
		({ restoreFocus = false }: { restoreFocus?: boolean } = {}) => {
			const restoreTarget = restoreFocus ? authorQuickPanel?.trigger ?? null : null;
			const restoreMessageId = restoreFocus ? authorQuickPanel?.messageId ?? null : null;
			setAuthorQuickPanel(null);
			setAuthorQuickPanelPosition(null);
			onCloseAuthorQuickPanel?.();

			if (restoreTarget && restoreMessageId) {
				window.requestAnimationFrame(() => {
					if (restoreTarget.kind === 'mention') {
						const mentionTriggerNode = getMentionTriggerNode(restoreTarget.focusKey);
						if (mentionTriggerNode) {
							markTimelineKeyboardInteraction();
							keyboardAnchorMessageIdRef.current = restoreMessageId;
							updateFocusedMessageId(restoreMessageId);
							mentionTriggerNode.focus({ preventScroll: true });
							return;
						}
					}

					void focusAuthorTrigger(restoreMessageId, 'auto', 'keyboard');
				});
			}
		},
		[
			authorQuickPanel?.messageId,
			authorQuickPanel?.trigger,
			focusAuthorTrigger,
			getMentionTriggerNode,
			markTimelineKeyboardInteraction,
			onCloseAuthorQuickPanel,
			updateFocusedMessageId,
		],
	);

	const openAuthorQuickPanel = useCallback(
		({
			anchorRect,
			message,
			trigger,
			source,
			user,
		}: {
			anchorRect: DOMRect;
			message: TimelineMessage;
			trigger: QuickPanelTriggerTarget;
			source: 'keyboard' | 'pointer';
			user: MentionInteractionUser;
		}) => {
			if (!authorQuickPanelEnabled || !onOpenAuthorQuickPanel || currentUser?.id === user.id) {
				return;
			}

			const nextPanel = {
				anchorRect: {
					bottom: anchorRect.bottom,
					height: anchorRect.height,
					left: anchorRect.left,
					right: anchorRect.right,
					top: anchorRect.top,
					width: anchorRect.width,
				},
				messageId: message.id,
				source,
				trigger,
				user,
			} satisfies AuthorQuickPanelState;

			if (
				authorQuickPanel?.messageId === nextPanel.messageId &&
				authorQuickPanel.user.id === nextPanel.user.id &&
				authorQuickPanel.trigger.kind === nextPanel.trigger.kind &&
				(authorQuickPanel.trigger.kind !== 'mention' ||
					nextPanel.trigger.kind !== 'mention' ||
					authorQuickPanel.trigger.focusKey === nextPanel.trigger.focusKey)
			) {
				closeAuthorQuickPanel({ restoreFocus: source === 'keyboard' });
				return;
			}

			if (source === 'keyboard') {
				markTimelineKeyboardInteraction();
				keyboardAnchorMessageIdRef.current = message.id;
			} else {
				markTimelinePointerInteraction();
			}

			setMessageContextMenu(null);
			setMessageContextMenuPosition(null);
			updateFocusedMessageId(message.id);
			setAuthorQuickPanel(nextPanel);
			setAuthorQuickPanelPosition({
				left: nextPanel.anchorRect.left,
				top: nextPanel.anchorRect.bottom + 8,
			});
			onOpenAuthorQuickPanel(nextPanel.user.id);
		},
		[
			authorQuickPanel,
			authorQuickPanelEnabled,
			closeAuthorQuickPanel,
			currentUser?.id,
			markTimelineKeyboardInteraction,
			markTimelinePointerInteraction,
			onOpenAuthorQuickPanel,
			setMessageContextMenu,
			setMessageContextMenuPosition,
			updateFocusedMessageId,
		],
	);

	const handleTimelineMentionOpen = useCallback(
		({
			anchorRect,
			focusKey,
			source,
			timelineMessageId,
			user,
		}: {
			anchorRect: DOMRect;
			focusKey: string;
			source: 'keyboard' | 'pointer';
			timelineMessageId?: string;
			user: MentionInteractionUser;
		}) => {
			if (!timelineMessageId) {
				return;
			}

			const message = timelineMessagesById.get(timelineMessageId);
			if (!message) {
				return;
			}

			openAuthorQuickPanel({
				anchorRect,
				message,
				trigger: {
					focusKey,
					kind: 'mention',
				},
				source,
				user,
			});
		},
		[openAuthorQuickPanel, timelineMessagesById],
	);

	const prepareTimelineMentionQuickPanel = useCallback(
		(user: MentionInteractionUser) => {
			onPrepareAuthorQuickPanel?.(user.id);
		},
		[onPrepareAuthorQuickPanel],
	);

	const handleAuthorTriggerKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLButtonElement>, message: TimelineMessage) => {
			const currentIndex = authorNavigableMessageIds.indexOf(message.id);
			if (currentIndex < 0) {
				return;
			}

			if (event.altKey || event.ctrlKey || event.metaKey) {
				return;
			}

			if (shouldIgnoreHeldTimelineVerticalArrowNavigation(event)) {
				return;
			}

			markTimelineKeyboardInteraction();

			if (event.key === 'ArrowRight') {
				event.preventDefault();
				void focusMessage(message.id, 'auto', 'keyboard');
				return;
			}

			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				onNavigateSidebar?.();
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				if (currentIndex === 0) {
					onNavigateHeader?.('favorite');
					return;
				}

				void focusAdjacentAuthorTrigger(message.id, 'previous');
				return;
			}

			if (event.key === 'ArrowDown') {
				event.preventDefault();
				if (currentIndex === authorNavigableMessageIds.length - 1) {
					onNavigateComposer?.();
					return;
				}

				void focusAdjacentAuthorTrigger(message.id, 'next');
				return;
			}

			if (event.key === 'Enter' || isSpaceKey(event)) {
				event.preventDefault();
				openAuthorQuickPanel({
					anchorRect: event.currentTarget.getBoundingClientRect(),
					message,
					trigger: {
						kind: 'author',
					},
					source: 'keyboard',
					user: {
						displayName: message.author.displayName,
						id: message.author.id,
						username: message.author.username,
					},
				});
				return;
			}

			if (event.key === 'Escape') {
				event.preventDefault();
				closeAuthorQuickPanel({ restoreFocus: true });
			}
		},
		[
			authorNavigableMessageIds,
			closeAuthorQuickPanel,
			focusAdjacentAuthorTrigger,
			focusMessage,
			markTimelineKeyboardInteraction,
			onNavigateComposer,
			onNavigateHeader,
			onNavigateSidebar,
			openAuthorQuickPanel,
			shouldIgnoreHeldTimelineVerticalArrowNavigation,
		],
	);

	const handleAuthorQuickPanelKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>) => {
			if (!authorQuickPanel) {
				return;
			}

			const currentIndex = currentMessageIds.indexOf(authorQuickPanel.messageId);
			if (currentIndex < 0) {
				return;
			}

			if (shouldIgnoreHeldTimelineVerticalArrowNavigation(event)) {
				return;
			}

			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				closeAuthorQuickPanel({ restoreFocus: true });
				return;
			}

			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				event.stopPropagation();
				closeAuthorQuickPanel();
				window.requestAnimationFrame(() => {
					onNavigateSidebar?.();
				});
				return;
			}

			if (event.key === 'ArrowRight') {
				event.preventDefault();
				event.stopPropagation();
				closeAuthorQuickPanel();
				window.requestAnimationFrame(() => {
					void focusMessage(authorQuickPanel.messageId, 'auto', 'keyboard', 'preserve');
				});
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				event.stopPropagation();
				closeAuthorQuickPanel();
				window.requestAnimationFrame(() => {
					if (currentIndex === 0) {
						onNavigateHeader?.('favorite');
						return;
					}

					void focusMessage(
						resolveAdjacentTimelineMessageId({
							direction: 'previous',
							messageId: authorQuickPanel.messageId,
							messageIds: currentMessageIds,
						}),
						'auto',
						'keyboard',
					);
				});
				return;
			}

			if (event.key === 'ArrowDown') {
				event.preventDefault();
				event.stopPropagation();
				closeAuthorQuickPanel();
				window.requestAnimationFrame(() => {
					if (currentIndex >= currentMessageIds.length - 1) {
						onNavigateComposer?.();
						return;
					}

					void focusMessage(
						resolveAdjacentTimelineMessageId({
							direction: 'next',
							messageId: authorQuickPanel.messageId,
							messageIds: currentMessageIds,
						}),
						'auto',
						'keyboard',
					);
				});
			}
		},
		[
			authorQuickPanel,
			closeAuthorQuickPanel,
			currentMessageIds,
			focusMessage,
			onNavigateComposer,
			onNavigateHeader,
			onNavigateSidebar,
			shouldIgnoreHeldTimelineVerticalArrowNavigation,
		],
	);

	const closeMessageContextMenu = useCallback(
		({ restoreFocus = false }: { restoreFocus?: boolean } = {}) => {
			const restoreMessageId = restoreFocus ? messageContextMenu?.messageId ?? null : null;
			const restoreInteractionMode = messageContextMenu?.source === 'keyboard' ? 'keyboard' : 'pointer';
			setMessageContextMenu(null);
			setMessageContextMenuPosition(null);

			if (restoreMessageId) {
				window.requestAnimationFrame(() => {
					void focusMessage(restoreMessageId, 'auto', restoreInteractionMode, 'preserve');
				});
			}
		},
		[focusMessage, messageContextMenu?.messageId, messageContextMenu?.source],
	);

	const updateMessageContextMenuActiveKey = useCallback((nextKey: string | null) => {
		setMessageContextMenu((currentMenu) => {
			if (!currentMenu || currentMenu.activeActionKey === nextKey) {
				return currentMenu;
			}

			return {
				...currentMenu,
				activeActionKey: nextKey,
			};
		});
	}, []);

	const openMessageContextMenu = useCallback(
		({
			anchorX,
			anchorY,
			messageId,
			source,
		}: {
			anchorX: number;
			anchorY: number;
			messageId: string;
			source: 'keyboard' | 'pointer';
		}) => {
			cancelTimelineScrollAnimation();

			if (source === 'keyboard') {
				markTimelineKeyboardInteraction();
				pointerAnchorMessageIdRef.current = null;
			} else {
				markTimelinePointerInteraction();
			}

			setAuthorQuickPanel(null);
			setAuthorQuickPanelPosition(null);
			onCloseAuthorQuickPanel?.();
			updateFocusedMessageId(messageId);
			setMessageContextMenu({
				activeActionKey: null,
				anchorX,
				anchorY,
				messageId,
				source,
			});
			setMessageContextMenuPosition({
				left: anchorX,
				top: anchorY,
			});
		},
		[
			cancelTimelineScrollAnimation,
			markTimelineKeyboardInteraction,
			markTimelinePointerInteraction,
			onCloseAuthorQuickPanel,
			updateFocusedMessageId,
		],
	);

	const openKeyboardMessageContextMenu = useCallback(
		(messageId: string) => {
			if (localOutgoingMessageIds.has(messageId)) {
				return;
			}

			const anchor = resolveKeyboardMessageContextAnchor(messageId);
			if (!anchor) {
				return;
			}

			openMessageContextMenu({
				anchorX: anchor.x,
				anchorY: anchor.y,
				messageId,
				source: 'keyboard',
			});
		},
		[localOutgoingMessageIds, openMessageContextMenu, resolveKeyboardMessageContextAnchor],
	);

	const handleMessageSecondaryAction = useCallback(
		(event: ReactMouseEvent<HTMLElement>, messageId: string) => {
			if (localOutgoingMessageIds.has(messageId)) {
				event.preventDefault();
				return;
			}

			event.preventDefault();
			openMessageContextMenu({
				anchorX: event.clientX,
				anchorY: event.clientY,
				messageId,
				source: 'pointer',
			});
		},
		[localOutgoingMessageIds, openMessageContextMenu],
	);

	const handleMessagePointerDown = useCallback((event: ReactMouseEvent<HTMLElement>, messageId: string) => {
		if (event.button !== 2) {
			return;
		}

		markTimelinePointerInteraction();
		updateFocusedMessageId(messageId);
	}, [markTimelinePointerInteraction, updateFocusedMessageId]);

	const runMessageContextAction = useCallback(
		(item: MessageContextMenuActionItem) => {
			void Promise.resolve(item.onSelect())
				.then(() => {
					if (item.behavior === 'toast' && item.successToastLabel) {
						showTimelineToast(item.successToastLabel, 'success');
					}
					closeMessageContextMenu({ restoreFocus: item.restoreFocus });
				})
				.catch(() => {
					if (item.behavior === 'toast') {
						showTimelineToast(item.failureToastLabel ?? '操作失败', 'warning');
					}
					closeMessageContextMenu({ restoreFocus: item.restoreFocus });
				});
		},
		[closeMessageContextMenu, showTimelineToast],
	);

	const dismissReplyJumpNavigation = useCallback(() => {
		if (replyJumpLatestRevealTimerRef.current) {
			window.clearTimeout(replyJumpLatestRevealTimerRef.current);
			replyJumpLatestRevealTimerRef.current = null;
		}

		clearReplyJumpReturnDismissTimer();
		replyJumpLatestRevealAllowedRef.current = false;
		replyJumpPendingManualRevealRef.current = false;
		setReplyJumpLatestVisible(false);
		setReplyJumpReturnVisible(false);
		setReplyJumpNavigation(null);
	}, [clearReplyJumpReturnDismissTimer]);

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

	const jumpToUnreadOrLatest = useCallback(
		({
			behavior = 'smooth',
			focusTarget = false,
		}: {
			behavior?: ScrollBehavior;
			focusTarget?: boolean;
		} = {}) => {
			if (currentMessageIds.length === 0) {
				return false;
			}

			const focusLatest = () => (focusTarget ? focusLatestLoadedMessage('keyboard') : true);
			const focusUnread = () => (focusTarget ? focusUnreadAnchorMessage('keyboard') : true);
			const currentReplyJumpNavigation = replyJumpNavigation;
			const shouldUseReplyLatestShortcut =
				currentReplyJumpNavigation?.awaitingDeparture === false &&
				replyJumpLatestVisible &&
				(showJumpToBottom || showJumpToUnread || preferBottomAfterUnreadClick);

			if (shouldUseReplyLatestShortcut) {
				return jumpReplyNavigationToLatest({
					behavior: 'auto',
					focusTarget,
				});
			}

			if (pendingSequentialBottomJumpRef.current || preferBottomAfterUnreadClick) {
				scrollToBottom(behavior);
				return focusLatest();
			}

			if (showJumpToUnread && timeline.unreadAnchorMessageId) {
				primeSequentialBottomJump();
				scrollToUnread(behavior);
				return focusUnread();
			}

			scrollToBottom(behavior);
			return focusLatest();
		},
		[
			currentMessageIds.length,
			dismissReplyJumpNavigation,
			focusLatestLoadedMessage,
			focusUnreadAnchorMessage,
			jumpReplyNavigationToLatest,
			preferBottomAfterUnreadClick,
			primeSequentialBottomJump,
			replyJumpLatestVisible,
			replyJumpNavigation,
			scrollToBottom,
			scrollToUnread,
			showJumpToBottom,
			showJumpToUnread,
			timeline.unreadAnchorMessageId,
		],
	);

	const replyReturnAction = replyJumpNavigation && !replyJumpNavigation.awaitingDeparture && replyJumpReturnVisible
		? {
				key: 'reply-return' as const,
				label: '返回',
				onClick: returnToReplySource,
		  }
		: null;

	const resolvedJumpAction = preferBottomAfterUnreadClick
		? {
				key: 'latest' as const,
				label: '最新',
				tone: 'neutral' as const,
				onClick: () => {
					void jumpToUnreadOrLatest();
				},
		  }
		: mentionTargetMessageId && (showJumpToMention || showJumpToUnread)
			? {
					key: 'mention' as const,
					label: '提及',
					tone: 'mention' as const,
					onClick: () => jumpToMention(),
			  }
		: showJumpToUnread
			? {
					key: 'unread' as const,
					label: `${unreadCount} 条未读`,
					tone: 'accent' as const,
					onClick: () => {
						void jumpToUnreadOrLatest();
					},
			  }
			: showJumpToBottom
			? {
					key: 'latest' as const,
					label: '最新',
					tone: 'neutral' as const,
					onClick: () => {
						void jumpToUnreadOrLatest();
					},
			  }
			: null;
	const jumpAction =
		replyJumpNavigation && !replyJumpNavigation.awaitingDeparture
			? replyJumpLatestVisible && (showJumpToBottom || showJumpToUnread || preferBottomAfterUnreadClick)
				? {
						key: 'latest' as const,
						label: '最新',
						tone: 'neutral' as const,
						onClick: () => {
							void jumpReplyNavigationToLatest({
								behavior: 'auto',
							});
						},
				  }
				: null
			: resolvedJumpAction;

	const messageMetadata = useMemo(
		() =>
			timeline.messages.reduce<Record<string, { collapsible: boolean; expanded: boolean }>>((metadata, message) => {
				const collapsible = resolveMeasuredMessageCollapsible(messageContentHeights[message.id], message);
				const persistedExpanded = transferredExpandedMessages[message.id];
				metadata[message.id] = {
					collapsible,
					expanded: resolveMessageExpandedState({
						appendedExpandedByDefault: appendedMessageExpansionDefaults[message.id],
						collapsible,
						persistedExpanded,
					}),
				};
				return metadata;
			}, {}),
		[appendedMessageExpansionDefaults, messageContentHeights, timeline.messages, transferredExpandedMessages],
	);
	const messageMentionStates = useMemo(
		() =>
			timeline.messages.reduce<Record<string, boolean>>((mentions, message) => {
				mentions[message.id] = messageMentionsCurrentUser({
					currentUser,
					message,
				});
				return mentions;
			}, {}),
		[currentUser, timeline.messages],
	);
	const activeContextMenuMetadata = activeContextMenuMessage ? messageMetadata[activeContextMenuMessage.id] : undefined;
	const messageContextMenuItems = useMemo(() => {
		if (!activeContextMenuMessage || localOutgoingMessageIds.has(activeContextMenuMessage.id)) {
			return [];
		}

		const items: MessageContextMenuItem[] = [];

		if (onReplyMessage) {
			items.push({
				key: 'reply',
				label: '回复',
				onSelect: () => onReplyMessage(activeContextMenuMessage),
			});
		}

		if (onForwardMessage) {
			items.push({
				key: 'forward',
				label: '转发',
				onSelect: () => onForwardMessage(activeContextMenuMessage),
			});
		}

		if (activeContextMenuMessage.replyTo) {
			items.push({
				key: 'jump-to-original',
				label: '跳到原消息',
				onSelect: () =>
					jumpToOriginalMessage(activeContextMenuMessage.id, activeContextMenuMessage.replyTo!.messageId, {
						focusTarget: true,
					}),
			});
		}

		if (items.length > 0) {
			items.push({ key: 'divider-primary', kind: 'divider' });
		}

		items.push({
			behavior: 'toast',
			failureToastLabel: '复制失败',
			key: 'copy-text',
			label: '复制文本',
			onSelect: () => copyMessagePlainText(activeContextMenuMessage),
			restoreFocus: true,
			successToastLabel: '已复制文本',
		});

		items.push({
			behavior: 'toast',
			failureToastLabel: '复制失败',
			key: 'copy-markdown',
			label: '复制 Markdown',
			onSelect: async () => {
				const markdown = composeForwardSourceMarkdown(activeContextMenuMessage) || activeContextMenuMessage.body.rawMarkdown;
				await copyTextToClipboard(markdown);
			},
			restoreFocus: true,
			successToastLabel: '已复制 Markdown',
		});

		if (activeContextMenuMetadata?.collapsible) {
			items.push({ key: 'divider-toggle', kind: 'divider' });
			items.push({
				key: 'toggle-expanded',
				label: activeContextMenuMetadata.expanded ? '收起' : '展开全文',
				onSelect: () => toggleMessageExpanded(activeContextMenuMessage.id),
				restoreFocus: true,
			});
		}

		return items;
	}, [
		activeContextMenuMessage,
		activeContextMenuMetadata,
		copyMessagePlainText,
		jumpToOriginalMessage,
		localOutgoingMessageIds,
		onForwardMessage,
		onReplyMessage,
		toggleMessageExpanded,
	]);
	const actionableContextMenuItems = useMemo(
		() => messageContextMenuItems.filter((item): item is MessageContextMenuActionItem => !('kind' in item)),
		[messageContextMenuItems],
	);

	useEffect(() => {
		currentTimelineRoomIdRef.current = timeline.roomId;
		olderHistoryLoadInFlightRef.current = false;
		olderHistoryPrefetchPendingRef.current = false;
		olderHistoryPrefetchReadyRef.current = false;
		pendingUnreadDividerSettleAnchorRef.current = null;
		lastLiveUnreadDividerRef.current = null;
		clearUnreadDividerSettleTimer();
		setSettlingUnreadDivider(null);
	}, [clearUnreadDividerSettleTimer, timeline.roomId]);

	useEffect(() => {
		if (!isLoadingOlderHistory) {
			olderHistoryLoadInFlightRef.current = false;
		}
	}, [isLoadingOlderHistory]);

	useEffect(() => {
		const persistedExpansion = loadRoomMessageExpansion(timeline.roomId);
		loadedExpansionRoomIdRef.current = timeline.roomId;
		expandedMessagesRef.current = persistedExpansion;
		appendedMessageExpansionDefaultsRef.current = {};
		pendingLocalSendExpansionRef.current = false;
		replyJumpLatestRevealAllowedRef.current = false;
		replyJumpPendingManualRevealRef.current = false;
		if (replyJumpLatestRevealTimerRef.current) {
			window.clearTimeout(replyJumpLatestRevealTimerRef.current);
			replyJumpLatestRevealTimerRef.current = null;
		}
		clearReplyJumpReturnDismissTimer();
		bottomReflowFollowRoomIdRef.current = timeline.roomId;
		bottomReflowFollowUntilRef.current = 0;
		lastReadRequestAnchorRef.current = null;
		keyboardAnchorMessageIdRef.current = timeline.unreadAnchorMessageId ?? timeline.messages.at(-1)?.id ?? null;
		pointerAnchorMessageIdRef.current = null;
		pendingResolvedReplyJumpRef.current = null;
		setExpandedMessages(persistedExpansion);
		setHighlightedMessageId(null);
		updateTimelineInteractionMode('pointer');
		setAuthorQuickPanel(null);
		setAuthorQuickPanelPosition(null);
		setMessageContextMenu(null);
		setMessageContextMenuPosition(null);
		setShowJumpToMention(false);
		setReplyJumpLatestVisible(false);
		setReplyJumpReturnVisible(false);
		setReplyJumpNavigation(null);
		cancelTimelineScrollAnimation();
		clearSequentialBottomJump();
		onCloseAuthorQuickPanel?.();
	}, [cancelTimelineScrollAnimation, clearReplyJumpReturnDismissTimer, clearSequentialBottomJump, onCloseAuthorQuickPanel, timeline.roomId, updateTimelineInteractionMode]);

	useEffect(() => {
		if (!timeline.unreadAnchorMessageId) {
			lastReadRequestAnchorRef.current = null;
		}
	}, [timeline.unreadAnchorMessageId]);

	const syncMessageContextMenuPosition = useCallback(() => {
		if (!messageContextMenu || typeof window === 'undefined') {
			return;
		}

		const menuNode = getMessageContextMenuNode();
		if (!menuNode) {
			return;
		}

		const nextAnchor =
			messageContextMenu.source === 'keyboard'
				? resolveKeyboardMessageContextAnchor(messageContextMenu.messageId)
				: {
						x: messageContextMenu.anchorX,
						y: messageContextMenu.anchorY,
				  };
		if (!nextAnchor) {
			closeMessageContextMenu();
			return;
		}

		const menuRect = menuNode.getBoundingClientRect();
		const nextLeft = clampViewportCoordinate(nextAnchor.x, window.innerWidth, menuRect.width);
		const nextTop = clampViewportCoordinate(nextAnchor.y, window.innerHeight, menuRect.height);

		setMessageContextMenuPosition((currentPosition) =>
			currentPosition && currentPosition.left === nextLeft && currentPosition.top === nextTop
				? currentPosition
				: { left: nextLeft, top: nextTop },
		);
	}, [closeMessageContextMenu, getMessageContextMenuNode, messageContextMenu, resolveKeyboardMessageContextAnchor]);

	useLayoutEffect(() => {
		syncMessageContextMenuPosition();
	}, [syncMessageContextMenuPosition]);

	useLayoutEffect(() => {
		if (!authorQuickPanel || !authorQuickPanelRef.current || typeof window === 'undefined') {
			return;
		}

		const anchorRect = getAuthorQuickPanelAnchorNode(authorQuickPanel)?.getBoundingClientRect() ?? authorQuickPanel.anchorRect;
		const panelRect = authorQuickPanelRef.current.getBoundingClientRect();
		const nextLeft = clampViewportCoordinate(anchorRect.left, window.innerWidth, panelRect.width);
		const preferredTop = anchorRect.bottom + 8;
		const fallbackTop = anchorRect.top - panelRect.height - 8;
		const unclampedTop =
			preferredTop + panelRect.height + 12 <= window.innerHeight || fallbackTop < 12 ? preferredTop : fallbackTop;
		const nextTop = clampViewportCoordinate(unclampedTop, window.innerHeight, panelRect.height);

		setAuthorQuickPanelPosition((currentPosition) =>
			currentPosition && currentPosition.left === nextLeft && currentPosition.top === nextTop
				? currentPosition
				: { left: nextLeft, top: nextTop },
		);
	}, [authorQuickPanel, getAuthorQuickPanelAnchorNode]);

	useLayoutEffect(() => {
		if (!authorQuickPanel || authorQuickPanel.source !== 'keyboard') {
			return;
		}

		const primaryAction = authorQuickPanelPrimaryActionRef.current;
		if (!primaryAction || primaryAction.disabled) {
			return;
		}

		primaryAction.focus({ preventScroll: true });
	}, [
		activeAuthorQuickPanelLookup,
		authorQuickPanel,
		authorQuickPanelLookupPending,
		authorQuickPanelRequestedUserId,
		authorQuickPanelSubmitting,
	]);

	useEffect(
		() => () => {
			if (programmaticViewportScrollResetFrameRef.current !== null) {
				window.cancelAnimationFrame(programmaticViewportScrollResetFrameRef.current);
				programmaticViewportScrollResetFrameRef.current = null;
			}

			if (highlightTimerRef.current) {
				window.clearTimeout(highlightTimerRef.current);
			}

			if (toastTimerRef.current) {
				window.clearTimeout(toastTimerRef.current);
				toastTimerRef.current = null;
			}

			if (viewportPersistTimerRef.current) {
				window.clearTimeout(viewportPersistTimerRef.current);
				viewportPersistTimerRef.current = null;
			}

				if (sequentialBottomJumpTimerRef.current) {
					window.clearTimeout(sequentialBottomJumpTimerRef.current);
					sequentialBottomJumpTimerRef.current = null;
				}

				if (unreadDividerSettleTimerRef.current) {
					window.clearTimeout(unreadDividerSettleTimerRef.current);
					unreadDividerSettleTimerRef.current = null;
				}

				if (replyJumpLatestRevealTimerRef.current) {
					window.clearTimeout(replyJumpLatestRevealTimerRef.current);
				replyJumpLatestRevealTimerRef.current = null;
			}

			if (replyJumpReturnDismissTimerRef.current) {
				window.clearTimeout(replyJumpReturnDismissTimerRef.current);
				replyJumpReturnDismissTimerRef.current = null;
			}

			if (contentResizeAdjustmentFrameRef.current !== null) {
				window.cancelAnimationFrame(contentResizeAdjustmentFrameRef.current);
				contentResizeAdjustmentFrameRef.current = null;
			}

			cancelTimelineScrollAnimation();
			bottomReflowFollowRoomIdRef.current = null;
			bottomReflowFollowUntilRef.current = 0;
		},
		[cancelTimelineScrollAnimation],
	);

	useEffect(() => {
		if (!messageContextMenu) {
			return;
		}

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			const menuNode = getMessageContextMenuNode();
			if (target instanceof Node && menuNode?.contains(target)) {
				return;
			}

			closeMessageContextMenu();
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				closeMessageContextMenu({ restoreFocus: true });
			}
		};

		const handleViewportMutation = () => {
			window.requestAnimationFrame(syncMessageContextMenuPosition);
		};

		document.addEventListener('pointerdown', handlePointerDown, true);
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('resize', handleViewportMutation);
		window.addEventListener('scroll', handleViewportMutation, true);

		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('resize', handleViewportMutation);
			window.removeEventListener('scroll', handleViewportMutation, true);
		};
	}, [closeMessageContextMenu, getMessageContextMenuNode, messageContextMenu, syncMessageContextMenuPosition]);

	useEffect(() => {
		if (messageContextMenu && !activeContextMenuMessage) {
			closeMessageContextMenu();
		}
	}, [activeContextMenuMessage, closeMessageContextMenu, messageContextMenu]);

	useEffect(() => {
		if (!authorQuickPanel) {
			return;
		}

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Node) {
				if (authorQuickPanelRef.current?.contains(target)) {
					return;
				}

				const triggerNode = getAuthorQuickPanelAnchorNode(authorQuickPanel);
				if (triggerNode?.contains(target)) {
					return;
				}
			}

			closeAuthorQuickPanel();
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				closeAuthorQuickPanel({ restoreFocus: authorQuickPanel.source === 'keyboard' });
			}
		};

		document.addEventListener('pointerdown', handlePointerDown, true);
		window.addEventListener('keydown', handleKeyDown);

		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [authorQuickPanel, closeAuthorQuickPanel, getAuthorQuickPanelAnchorNode]);

	useEffect(() => {
		if (!authorQuickPanel || typeof window === 'undefined') {
			return;
		}

		const syncAuthorQuickPanelPosition = () => {
			const triggerNode = getAuthorQuickPanelAnchorNode(authorQuickPanel);
			const panelNode = authorQuickPanelRef.current;
			if (!triggerNode || !panelNode) {
				closeAuthorQuickPanel();
				return;
			}

			const anchorRect = triggerNode.getBoundingClientRect();
			const panelRect = panelNode.getBoundingClientRect();
			const nextLeft = clampViewportCoordinate(anchorRect.left, window.innerWidth, panelRect.width);
			const preferredTop = anchorRect.bottom + 8;
			const fallbackTop = anchorRect.top - panelRect.height - 8;
			const unclampedTop =
				preferredTop + panelRect.height + 12 <= window.innerHeight || fallbackTop < 12 ? preferredTop : fallbackTop;
			const nextTop = clampViewportCoordinate(unclampedTop, window.innerHeight, panelRect.height);

			setAuthorQuickPanelPosition((currentPosition) =>
				currentPosition && currentPosition.left === nextLeft && currentPosition.top === nextTop
					? currentPosition
					: { left: nextLeft, top: nextTop },
			);
		};

		const handleViewportMutation = () => {
			window.requestAnimationFrame(syncAuthorQuickPanelPosition);
		};

		window.addEventListener('resize', handleViewportMutation);
		window.addEventListener('scroll', handleViewportMutation, true);

		return () => {
			window.removeEventListener('resize', handleViewportMutation);
			window.removeEventListener('scroll', handleViewportMutation, true);
		};
	}, [authorQuickPanel, closeAuthorQuickPanel, getAuthorQuickPanelAnchorNode]);

	useEffect(() => {
		if (authorQuickPanel && !currentMessageIds.includes(authorQuickPanel.messageId)) {
			closeAuthorQuickPanel();
		}
	}, [authorQuickPanel, closeAuthorQuickPanel, currentMessageIds]);

	useEffect(() => {
		const pendingReplyJump = pendingResolvedReplyJumpRef.current;
		if (!pendingReplyJump || !currentMessageIds.includes(pendingReplyJump.targetMessageId)) {
			return;
		}

		pendingResolvedReplyJumpRef.current = null;
		window.requestAnimationFrame(() => {
			void jumpToLoadedOriginalMessage(pendingReplyJump.sourceMessageId, pendingReplyJump.targetMessageId, {
				focusTarget: pendingReplyJump.focusTarget,
			});
		});
	}, [currentMessageIds, jumpToLoadedOriginalMessage]);

	useEffect(() => {
		if (!replyJumpNavigation) {
			clearReplyJumpReturnDismissTimer();
			return;
		}

		const resetReplyJumpLatestReveal = () => {
			if (replyJumpLatestRevealTimerRef.current) {
				window.clearTimeout(replyJumpLatestRevealTimerRef.current);
				replyJumpLatestRevealTimerRef.current = null;
			}

			replyJumpLatestRevealAllowedRef.current = false;
			replyJumpPendingManualRevealRef.current = false;
			setReplyJumpLatestVisible(false);
		};

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
		replyJumpNavigation,
		replyJumpReturnVisible,
		scheduleReplyJumpReturnDismiss,
		timeline.messages.length,
		timeline.roomId,
	]);

	useEffect(() => {
		loadedExpansionRoomIdRef.current = timeline.roomId;
		expandedMessagesRef.current = expandedMessages;
	}, [expandedMessages, timeline.roomId]);

	useEffect(() => {
		if (focusRequest.token === lastFocusRequestTokenRef.current) {
			return;
		}

		lastFocusRequestTokenRef.current = focusRequest.token;
		if (focusRequest.strategy === 'bottom-visible' && focusBottomVisibleMessage('auto', 'keyboard')) {
			return;
		}

		if (focusRequest.strategy === 'first-message' && focusFirstMessage('auto', 'keyboard')) {
			return;
		}

		if (focusRequest.strategy === 'unread-or-latest' && jumpToUnreadOrLatest({ behavior: 'auto', focusTarget: true })) {
			return;
		}

		if (focusRequest.strategy === 'last-message' && focusLastMessage('auto', 'keyboard')) {
			return;
		}

		void focusPreferredMessage('auto', 'keyboard', focusRequest.strategy === 'pointer-anchor' ? 'pointer-anchor' : 'preferred');
	}, [focusBottomVisibleMessage, focusFirstMessage, focusLastMessage, focusPreferredMessage, focusRequest, jumpToUnreadOrLatest]);

	useLayoutEffect(() => {
		measureMountedMessageContentHeights();
	}, [measureMountedMessageContentHeights]);

	useEffect(() => {
		if (typeof ResizeObserver === 'undefined') {
			return;
		}

		const observer = new ResizeObserver((entries) => {
			const liveBottomGap = messageStreamRef.current
				? Math.max(
						messageStreamRef.current.scrollHeight -
							(messageStreamRef.current.scrollTop + messageStreamRef.current.clientHeight),
						0,
				  )
				: lastKnownBottomGapRef.current;
			const shouldPreserveBottom = shouldPreserveBottomDuringReflow(liveBottomGap);
			const shouldSuspendAnchorPreservationDuringProgrammaticScroll =
				!shouldPreserveBottom && (programmaticViewportScrollRef.current || scrollAnimationFrameRef.current !== null);
			const viewportSnapshot =
				shouldPreserveBottom || shouldSuspendAnchorPreservationDuringProgrammaticScroll
					? null
					: captureViewportSnapshot() ?? currentViewportSnapshotRef.current;
			setMessageContentHeights((currentHeights) => {
				let hasChanges = false;
				const nextHeights = { ...currentHeights };

				for (const entry of entries) {
					const node = entry.target as HTMLDivElement;
					const messageId = node.dataset.contentMessageId;
					if (!messageId) {
						continue;
					}

					const nextHeight = Math.ceil(entry.contentRect.height);
					if (nextHeights[messageId] === nextHeight) {
						continue;
					}

					hasChanges = true;
					nextHeights[messageId] = nextHeight;
				}

				if (hasChanges) {
					if (shouldPreserveBottom) {
						scheduleContentResizeAdjustment('bottom', viewportSnapshot);
					} else if (!shouldSuspendAnchorPreservationDuringProgrammaticScroll && viewportSnapshot) {
						scheduleContentResizeAdjustment('anchor', viewportSnapshot);
					}

					return nextHeights;
				}

				return currentHeights;
			});
		});

		messageContentResizeObserverRef.current = observer;
		for (const node of messageContentRefs.current.values()) {
			observer.observe(node);
		}

		return () => {
			observer.disconnect();
			messageContentResizeObserverRef.current = null;
		};
	}, [captureViewportSnapshot, scheduleContentResizeAdjustment, shouldPreserveBottomDuringReflow]);

	useEffect(() => {
		if (typeof ResizeObserver === 'undefined') {
			return;
		}

		const container = messageStreamRef.current;
		if (!container) {
			return;
		}

		let previousClientHeight = container.clientHeight;
		let previousClientWidth = container.clientWidth;
		const observer = new ResizeObserver(() => {
			const currentContainer = messageStreamRef.current;
			if (!currentContainer) {
				return;
			}

			const nextClientHeight = currentContainer.clientHeight;
			const nextClientWidth = currentContainer.clientWidth;
			if (nextClientHeight === previousClientHeight && nextClientWidth === previousClientWidth) {
				return;
			}

			previousClientHeight = nextClientHeight;
			previousClientWidth = nextClientWidth;

			const liveBottomGap = Math.max(
				currentContainer.scrollHeight - (currentContainer.scrollTop + currentContainer.clientHeight),
				0,
			);
			if (shouldPreserveBottomDuringReflow(liveBottomGap)) {
				scrollToBottom('auto');
			}

			runViewportSync('full');
		});

		messageStreamResizeObserverRef.current = observer;
		observer.observe(container);

		return () => {
			observer.disconnect();
			messageStreamResizeObserverRef.current = null;
		};
	}, [runViewportSync, scrollToBottom, shouldPreserveBottomDuringReflow, timeline.roomId]);

	useEffect(() => {
		appendedMessageExpansionDefaultsRef.current = appendedMessageExpansionDefaults;
	}, [appendedMessageExpansionDefaults, timeline.roomId]);

	useEffect(() => {
		if (!pendingLocalSendExpansionRef.current || pendingLocalSendCount > 0) {
			return;
		}

		pendingLocalSendExpansionRef.current = false;
	}, [pendingLocalSendCount, timeline.roomId]);

	useLayoutEffect(() => {
		if (!shouldFollowBottomThroughReflow()) {
			return;
		}

		scrollToBottom('auto');
		runViewportSync('full');
	}, [messageContentHeights, runViewportSync, scrollToBottom, shouldFollowBottomThroughReflow]);

	useEffect(() => {
		if (messageIdTransfers.length === 0 || transferredExpandedMessages === activeExpandedMessages) {
			return;
		}

		const transferPersistEntries = messageIdTransfers.reduce<Record<string, boolean | null>>((entries, { fromId, toId }) => {
			const expanded = transferredExpandedMessages[toId];
			if (expanded !== undefined) {
				entries[toId] = expanded;
			}

			entries[fromId] = null;
			return entries;
		}, {});

		commitExpandedMessages(transferredExpandedMessages, transferPersistEntries);
	}, [activeExpandedMessages, commitExpandedMessages, messageIdTransfers, transferredExpandedMessages]);

	useEffect(() => {
		previousRenderedRoomIdRef.current = timeline.roomId;
		previousRenderedMessageIdsRef.current = currentMessageIds;
		previousRenderedMessagesRef.current = timeline.messages;
	}, [currentMessageIds, timeline.messages, timeline.roomId]);

	useEffect(() => {
		if (!focusedMessageId || currentMessageIds.includes(focusedMessageId)) {
			return;
		}

		const transferredFocusedMessageId = messageIdTransfers.find(({ fromId }) => fromId === focusedMessageId)?.toId;
		const currentViewportAnchorMessageId =
			currentViewportSnapshotRef.current && currentMessageIds.includes(currentViewportSnapshotRef.current.anchorMessageId)
				? currentViewportSnapshotRef.current.anchorMessageId
				: null;
		updateFocusedMessageId(transferredFocusedMessageId ?? currentViewportAnchorMessageId ?? timeline.unreadAnchorMessageId ?? currentMessageIds.at(-1) ?? null);
	}, [currentMessageIds, focusedMessageId, messageIdTransfers, timeline.unreadAnchorMessageId, updateFocusedMessageId]);

	useLayoutEffect(() => {
		const activeHistoryPrependRestore = activeHistoryPrependRestoreRef.current;
		if (
			!activeHistoryPrependRestore ||
			activeHistoryPrependRestore.roomId !== timeline.roomId ||
			!activeHistoryPrependRestore.pendingLayoutRestore
		) {
			return;
		}

		const container = messageStreamRef.current;
		if (
			currentMessageIds.length <= activeHistoryPrependRestore.baselineMessageCount &&
			(container?.scrollHeight ?? 0) <= activeHistoryPrependRestore.baselineScrollHeight
		) {
			return;
		}

		if (container) {
			scrollMessageStreamTo(
				resolveHistoryPrependRestoreScrollTop({
					baselineScrollHeight: activeHistoryPrependRestore.baselineScrollHeight,
					baselineScrollTop: activeHistoryPrependRestore.baselineScrollTop,
					currentScrollHeight: container.scrollHeight,
				}),
				'auto',
			);
		} else if (!scrollToViewportSnapshot(activeHistoryPrependRestore.snapshot, 'auto')) {
			return;
		}

		activeHistoryPrependRestore.pendingLayoutRestore = false;
		scheduleHistoryPrependRestoreSettleCheck();
		runViewportSync('full');
	}, [
		currentMessageIds,
		runViewportSync,
		scheduleHistoryPrependRestoreSettleCheck,
		scrollMessageStreamTo,
		scrollToViewportSnapshot,
		timeline.roomId,
	]);

	useLayoutEffect(() => {
		const isFirstRender = previousRoomIdRef.current === null;
		const roomChanged = previousRoomIdRef.current !== timeline.roomId;
		const appendedTailMessages = liveAppendedMessageIds.size > 0;
		const messageWindowAdvanced = appendedTailMessages || timeline.messages.length > previousMessageCountRef.current;
		const shouldStickToBottom = stickyToBottomRef.current;
		const localSendTriggered = forceScrollToBottomToken !== previousForceScrollToBottomTokenRef.current;

		previousRoomIdRef.current = timeline.roomId;
		previousMessageCountRef.current = timeline.messages.length;
		previousForceScrollToBottomTokenRef.current = forceScrollToBottomToken;

		if (isFirstRender || roomChanged) {
			currentViewportSnapshotRef.current = null;
			activeHistoryPrependRestoreRef.current = null;
		}

		if (!isFirstRender && !roomChanged && !messageWindowAdvanced && !localSendTriggered) {
			return;
		}

		if (isFirstRender || roomChanged) {
			const restoredPreviousViewport = restoreViewportSnapshot();

			if (!restoredPreviousViewport) {
				if (unreadStartIndex >= 0) {
					scrollToUnread('auto');
				} else {
					scrollToBottom('auto');
				}
			}
		} else if ((messageWindowAdvanced || localSendTriggered) && (localSendTriggered || shouldStickToBottom)) {
			scrollToBottom('auto');
		}

		runViewportSync('full');
	}, [
		restoreViewportSnapshot,
		runViewportSync,
		scrollToBottom,
		scrollToUnread,
		forceScrollToBottomToken,
		liveAppendedMessageIds,
		timeline.messages.length,
		timeline.roomId,
		unreadStartIndex,
	]);

	useLayoutEffect(
		() => () => {
			if (viewportSyncFrameRef.current !== null) {
				window.cancelAnimationFrame(viewportSyncFrameRef.current);
				viewportSyncFrameRef.current = null;
			}
			if (historyPrependRestoreSettleFrameRef.current !== null) {
				window.cancelAnimationFrame(historyPrependRestoreSettleFrameRef.current);
				historyPrependRestoreSettleFrameRef.current = null;
			}
			pendingViewportSyncModeRef.current = null;
			persistViewportSnapshot(timeline.roomId);
		},
		[persistViewportSnapshot, timeline.roomId],
	);

	useEffect(() => {
		const container = messageStreamRef.current;
		if (!container) {
			return;
		}

		const handleViewportChange = () => {
			const previousScrollTop = lastViewportTopRef.current;
			const currentScrollTop = container.scrollTop;
			if (
				shouldCancelTimelineScrollAnimation({
					actualScrollTop: currentScrollTop,
					animatedScrollActive: scrollAnimationFrameRef.current !== null,
					expectedScrollTop: lastAnimatedScrollTopRef.current,
					previousScrollTop,
					targetScrollTop: activeAnimatedScrollTargetRef.current,
				})
			) {
				cancelTimelineScrollAnimation();
			}
			const currentBottomGap = Math.max(container.scrollHeight - (currentScrollTop + container.clientHeight), 0);

			if (
				shouldCancelBottomFollowOnViewportChange({
					bottomGap: currentBottomGap,
					programmaticScrollActive: programmaticViewportScrollRef.current,
					scrollTop: currentScrollTop,
					previousScrollTop,
				})
			) {
				bottomReflowFollowUntilRef.current = 0;
				bottomReflowFollowRoomIdRef.current = null;
			}

			lastViewportTopRef.current = currentScrollTop;
				scheduleViewportSync(
					shouldDeferTimelineViewportStateSync({
						animatedScrollActive: scrollAnimationFrameRef.current !== null,
						programmaticScrollActive: programmaticViewportScrollRef.current,
					})
						? 'minimal'
						: 'full',
				);
				maybePrefetchOlderHistory(previousScrollTop, currentScrollTop);
				maybeLoadOlderHistory(previousScrollTop, currentScrollTop);
			};

		runViewportSync('full');
		lastViewportTopRef.current = container.scrollTop;
		container.addEventListener('scroll', handleViewportChange, { passive: true });
		window.addEventListener('resize', handleViewportChange);

		return () => {
			container.removeEventListener('scroll', handleViewportChange);
			window.removeEventListener('resize', handleViewportChange);
		};
		}, [cancelTimelineScrollAnimation, maybeLoadOlderHistory, maybePrefetchOlderHistory, runViewportSync, scheduleViewportSync]);

	useEffect(() => {
		runViewportSync('full');
	}, [expandedMessages, runViewportSync, timeline.roomId]);

	const handleMessageKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>, message: TimelineMessage) => {
			if (event.target !== event.currentTarget) {
				return;
			}

			const currentIndex = currentMessageIds.indexOf(message.id);
			if (currentIndex < 0) {
				return;
			}

			const interactionModeBeforeKey = timelineInteractionModeRef.current;
			const isLocalOutgoingMessage = localOutgoingMessageIds.has(message.id);

			if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
				if (isLocalOutgoingMessage) {
					return;
				}

				event.preventDefault();
				openKeyboardMessageContextMenu(message.id);
				return;
			}

			if (event.altKey || event.ctrlKey || event.metaKey) {
				return;
			}

			if (shouldIgnoreHeldTimelineVerticalArrowNavigation(event)) {
				return;
			}

			const pointerHandoffTarget = resolveTimelinePointerHandoffTarget({
				currentMessageId: message.id,
				pointerAnchorMessageId: pointerAnchorMessageIdRef.current,
				timelineInteractionMode: interactionModeBeforeKey,
			});
			markTimelineKeyboardInteraction();

			if (event.key === 'ArrowDown') {
				event.preventDefault();
				if (pointerHandoffTarget) {
					void focusMessage(pointerHandoffTarget, 'auto', 'keyboard', 'preserve');
					return;
				}

				if (currentIndex === currentMessageIds.length - 1) {
					onNavigateComposer?.();
					return;
				}

				void focusMessageAtIndex(Math.min(currentIndex + 1, currentMessageIds.length - 1));
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				if (pointerHandoffTarget) {
					void focusMessage(pointerHandoffTarget, 'auto', 'keyboard', 'preserve');
					return;
				}

				if (currentIndex === 0) {
					onNavigateHeader?.('favorite');
					return;
				}

				void focusMessageAtIndex(Math.max(currentIndex - 1, 0));
				return;
			}

			if (event.key === 'Home') {
				event.preventDefault();
				void focusMessageAtIndex(0);
				return;
			}

			if (event.key === 'End') {
				event.preventDefault();
				if (replyJumpNavigation) {
					void jumpReplyNavigationToLatest({
						behavior: 'auto',
						focusTarget: true,
					});
					return;
				}

				void jumpToUnreadOrLatest({ behavior: 'auto', focusTarget: true });
				return;
			}

			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				event.stopPropagation();

				const authorTriggerNode =
					event.currentTarget.querySelector<HTMLButtonElement>(`[data-testid="timeline-author-trigger-${message.id}"]`) ??
					getAuthorTriggerNode(message.id);
				if (authorTriggerNode) {
					markTimelineKeyboardInteraction();
					keyboardAnchorMessageIdRef.current = message.id;
					updateFocusedMessageId(message.id);
					authorTriggerNode.focus({ preventScroll: true });
					return;
				}

				onNavigateSidebar?.();
				return;
			}

			if (event.key === 'ArrowRight') {
				event.preventDefault();
				void focusHorizontalStop({
					direction: 'right',
					from: {
						kind: 'message',
					},
					message,
				});
				return;
			}

			if (event.key === 'Escape' && replyJumpNavigation) {
				event.preventDefault();
				returnToReplySource();
				return;
			}

			if (event.key === 'Enter' || isSpaceKey(event)) {
				event.preventDefault();
				const metadata = messageMetadata[message.id];
				if (metadata?.collapsible && !metadata.expanded) {
					toggleMessageExpanded(message.id);
					window.requestAnimationFrame(() => {
						void focusMessage(message.id, 'auto', 'keyboard', 'preserve');
					});
					return;
				}

				if (isLocalOutgoingMessage) {
					return;
				}

				openKeyboardMessageContextMenu(message.id);
				return;
			}

			const normalizedKey = event.key.toLowerCase();
			if (event.repeat && ['c', 'e', 'f', 'j', 'r'].includes(normalizedKey)) {
				return;
			}

			if (normalizedKey === 'r' && onReplyMessage) {
				if (isLocalOutgoingMessage) {
					return;
				}

				event.preventDefault();
				onReplyMessage(message);
				return;
			}

			if (normalizedKey === 'f' && onForwardMessage) {
				if (isLocalOutgoingMessage) {
					return;
				}

				event.preventDefault();
				onForwardMessage(message);
				return;
			}

			if (normalizedKey === 'j' && message.replyTo) {
				if (isLocalOutgoingMessage) {
					return;
				}

				event.preventDefault();
				jumpToOriginalMessage(message.id, message.replyTo.messageId, {
					focusTarget: true,
				});
				return;
			}

			if (normalizedKey === 'e' && messageMetadata[message.id]?.collapsible) {
				event.preventDefault();
				toggleMessageExpanded(message.id);
				window.requestAnimationFrame(() => {
					void focusMessage(message.id, 'auto', 'keyboard', 'preserve');
				});
				return;
			}

			if (normalizedKey === 'c') {
				event.preventDefault();
				void copyMessagePlainText(message)
					.then(() => {
						showTimelineToast('已复制文本', 'success');
					})
					.catch(() => {
						showTimelineToast('复制失败', 'warning');
					});
			}
		},
		[
			copyMessagePlainText,
			currentMessageIds,
			focusMessage,
			focusMessageAtIndex,
			focusHorizontalStop,
			getAuthorTriggerNode,
			jumpReplyNavigationToLatest,
			jumpToUnreadOrLatest,
			jumpToOriginalMessage,
			markTimelineKeyboardInteraction,
			messageMetadata,
			onForwardMessage,
			onNavigateComposer,
			onNavigateHeader,
			onNavigateSidebar,
			onReplyMessage,
			openKeyboardMessageContextMenu,
			replyJumpNavigation,
			returnToReplySource,
			shouldIgnoreHeldTimelineVerticalArrowNavigation,
			showTimelineToast,
			toggleMessageExpanded,
		],
	);

	const handleMessageActionKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLButtonElement>, message: TimelineMessage, action: 'reply' | 'forward') => {
			const currentIndex = currentMessageIds.indexOf(message.id);
			if (currentIndex < 0) {
				return;
			}

			const interactionModeBeforeKey = timelineInteractionModeRef.current;

			if (event.altKey || event.ctrlKey || event.metaKey) {
				return;
			}

			if (shouldIgnoreHeldTimelineVerticalArrowNavigation(event)) {
				return;
			}

			const pointerHandoffTarget = resolveTimelinePointerHandoffTarget({
				currentMessageId: message.id,
				pointerAnchorMessageId: pointerAnchorMessageIdRef.current,
				timelineInteractionMode: interactionModeBeforeKey,
			});
			markTimelineKeyboardInteraction();

			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				void focusHorizontalStop({
					direction: 'left',
					from:
						action === 'reply'
							? {
									kind: 'reply-action',
							  }
							: {
									kind: 'forward-action',
							  },
					message,
				});
				return;
			}

			if (event.key === 'ArrowRight') {
				event.preventDefault();
				if (action === 'reply') {
					void focusMessageAction(message.id, 'forward');
				}
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				if (pointerHandoffTarget) {
					void focusMessage(pointerHandoffTarget, 'auto', 'keyboard', 'preserve');
					return;
				}

				if (currentIndex === 0) {
					onNavigateHeader?.(action === 'forward' ? 'info' : 'favorite');
					return;
				}

				void focusMessageActionAtIndex(Math.max(currentIndex - 1, 0), action);
				return;
			}

			if (event.key === 'ArrowDown') {
				event.preventDefault();
				if (pointerHandoffTarget) {
					void focusMessage(pointerHandoffTarget, 'auto', 'keyboard', 'preserve');
					return;
				}

				if (currentIndex === currentMessageIds.length - 1) {
					onNavigateComposer?.();
					return;
				}

				void focusMessageActionAtIndex(Math.min(currentIndex + 1, currentMessageIds.length - 1), action);
				return;
			}

			if (event.key === 'Escape') {
				event.preventDefault();
				void focusMessage(message.id, 'auto', 'keyboard');
				return;
			}

			if (event.key === 'Home') {
				event.preventDefault();
				void focusMessageAtIndex(0);
				return;
			}

			if (event.key === 'End') {
				event.preventDefault();
				if (replyJumpNavigation) {
					void jumpReplyNavigationToLatest({
						behavior: 'auto',
						focusTarget: true,
					});
					return;
				}

				void jumpToUnreadOrLatest({ behavior: 'auto', focusTarget: true });
			}
		},
		[
			currentMessageIds,
			focusHorizontalStop,
			focusMessageActionAtIndex,
			focusMessageAtIndex,
			jumpReplyNavigationToLatest,
			jumpToUnreadOrLatest,
			markTimelineKeyboardInteraction,
			onNavigateComposer,
			onNavigateHeader,
			replyJumpNavigation,
			shouldIgnoreHeldTimelineVerticalArrowNavigation,
		],
	);

	const handleReplyPreviewKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLButtonElement>, message: TimelineMessage) => {
			const currentIndex = currentMessageIds.indexOf(message.id);
			if (currentIndex < 0) {
				return;
			}

			const interactionModeBeforeKey = timelineInteractionModeRef.current;

			if (event.altKey || event.ctrlKey || event.metaKey) {
				return;
			}

			if (shouldIgnoreHeldTimelineVerticalArrowNavigation(event)) {
				return;
			}

			const pointerHandoffTarget = resolveTimelinePointerHandoffTarget({
				currentMessageId: message.id,
				pointerAnchorMessageId: pointerAnchorMessageIdRef.current,
				timelineInteractionMode: interactionModeBeforeKey,
			});
			markTimelineKeyboardInteraction();

			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				void focusMessage(message.id, 'auto', 'keyboard');
				return;
			}

			if (event.key === 'ArrowRight') {
				event.preventDefault();
				void focusHorizontalStop({
					direction: 'right',
					from: {
						kind: 'reply-preview',
					},
					message,
				});
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				if (pointerHandoffTarget) {
					void focusMessage(pointerHandoffTarget, 'auto', 'keyboard', 'preserve');
					return;
				}

				if (currentIndex === 0) {
					onNavigateHeader?.('favorite');
					return;
				}

				void focusMessageAtIndex(Math.max(currentIndex - 1, 0));
				return;
			}

			if (event.key === 'ArrowDown') {
				event.preventDefault();
				if (pointerHandoffTarget) {
					void focusMessage(pointerHandoffTarget, 'auto', 'keyboard', 'preserve');
					return;
				}

				if (currentIndex === currentMessageIds.length - 1) {
					onNavigateComposer?.();
					return;
				}

				void focusMessageAtIndex(Math.min(currentIndex + 1, currentMessageIds.length - 1));
				return;
			}

			if (event.key === 'Home') {
				event.preventDefault();
				void focusMessageAtIndex(0);
				return;
			}

			if (event.key === 'End') {
				event.preventDefault();
				if (replyJumpNavigation) {
					void jumpReplyNavigationToLatest({
						behavior: 'auto',
						focusTarget: true,
					});
					return;
				}

				void jumpToUnreadOrLatest({ behavior: 'auto', focusTarget: true });
				return;
			}

			if (event.key === 'Escape') {
				event.preventDefault();
				void focusMessage(message.id, 'auto', 'keyboard');
			}
		},
		[
			currentMessageIds,
			focusMessage,
			focusMessageAtIndex,
			focusHorizontalStop,
			jumpReplyNavigationToLatest,
			jumpToUnreadOrLatest,
			markTimelineKeyboardInteraction,
			onNavigateComposer,
			onNavigateHeader,
			replyJumpNavigation,
			shouldIgnoreHeldTimelineVerticalArrowNavigation,
		],
	);

	const handleTimelineImageKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLImageElement>) => {
			const messageId = event.currentTarget.dataset.timelineMessageId;
			if (!messageId) {
				return;
			}

			const message = timelineMessagesById.get(messageId);
			if (!message) {
				return;
			}

			const currentIndex = currentMessageIds.indexOf(messageId);
			if (currentIndex < 0 || event.altKey || event.ctrlKey || event.metaKey) {
				return;
			}

			if (shouldIgnoreHeldTimelineVerticalArrowNavigation(event)) {
				return;
			}

			if (event.key === 'Enter' || isSpaceKey(event)) {
				event.stopPropagation();
				return;
			}

			const interactionModeBeforeKey = timelineInteractionModeRef.current;
			const pointerHandoffTarget = resolveTimelinePointerHandoffTarget({
				currentMessageId: messageId,
				pointerAnchorMessageId: pointerAnchorMessageIdRef.current,
				timelineInteractionMode: interactionModeBeforeKey,
			});
			const messageImageNodes = getMessageImageNodes(messageId);
			const currentImageIndex = Math.max(messageImageNodes.indexOf(event.currentTarget), 0);
			markTimelineKeyboardInteraction();

			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				event.stopPropagation();
				void focusHorizontalStop({
					direction: 'left',
					from: {
						kind: 'image',
						index: currentImageIndex,
					},
					message,
				});
				return;
			}

			if (event.key === 'ArrowRight') {
				event.preventDefault();
				event.stopPropagation();
				void focusHorizontalStop({
					direction: 'right',
					from: {
						kind: 'image',
						index: currentImageIndex,
					},
					message,
				});
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				event.stopPropagation();
				if (pointerHandoffTarget) {
					void focusMessage(pointerHandoffTarget, 'auto', 'keyboard', 'preserve');
					return;
				}

				if (currentIndex === 0) {
					onNavigateHeader?.('favorite');
					return;
				}

				void focusMessageAtIndex(Math.max(currentIndex - 1, 0));
				return;
			}

			if (event.key === 'ArrowDown') {
				event.preventDefault();
				event.stopPropagation();
				if (pointerHandoffTarget) {
					void focusMessage(pointerHandoffTarget, 'auto', 'keyboard', 'preserve');
					return;
				}

				if (currentIndex === currentMessageIds.length - 1) {
					onNavigateComposer?.();
					return;
				}

				void focusMessageAtIndex(Math.min(currentIndex + 1, currentMessageIds.length - 1));
				return;
			}

			if (event.key === 'Home') {
				event.preventDefault();
				event.stopPropagation();
				void focusMessageAtIndex(0);
				return;
			}

			if (event.key === 'End') {
				event.preventDefault();
				event.stopPropagation();
				if (replyJumpNavigation) {
					void jumpReplyNavigationToLatest({
						behavior: 'auto',
						focusTarget: true,
					});
					return;
				}

				void jumpToUnreadOrLatest({ behavior: 'auto', focusTarget: true });
				return;
			}

			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				void focusMessage(messageId, 'auto', 'keyboard');
			}
		},
		[
			currentMessageIds,
			focusHorizontalStop,
			focusMessage,
			focusMessageAtIndex,
			getMessageImageNodes,
			jumpReplyNavigationToLatest,
			jumpToUnreadOrLatest,
			markTimelineKeyboardInteraction,
			onNavigateComposer,
			onNavigateHeader,
			replyJumpNavigation,
			shouldIgnoreHeldTimelineVerticalArrowNavigation,
			timelineMessagesById,
		],
	);

	const handleTimelineMentionKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLButtonElement>) => {
			const messageId = event.currentTarget.dataset.timelineMessageId;
			const mentionUserId = event.currentTarget.dataset.mentionUserId;
			const mentionFocusKey = event.currentTarget.dataset.mentionFocusKey;
			const mentionToken = event.currentTarget.dataset.mentionTokenValue;
			if (!messageId || !mentionUserId || !mentionFocusKey || !mentionToken) {
				return;
			}

			const message = timelineMessagesById.get(messageId);
			const mentionUser = mentionInteractionUsersById.get(mentionUserId);
			if (!message || !mentionUser) {
				return;
			}

			const currentIndex = currentMessageIds.indexOf(messageId);
			if (currentIndex < 0 || event.altKey || event.ctrlKey || event.metaKey) {
				return;
			}

			if (shouldIgnoreHeldTimelineVerticalArrowNavigation(event)) {
				return;
			}

			if (event.key === 'Enter' || isSpaceKey(event)) {
				return;
			}

			const interactionModeBeforeKey = timelineInteractionModeRef.current;
			const pointerHandoffTarget = resolveTimelinePointerHandoffTarget({
				currentMessageId: messageId,
				pointerAnchorMessageId: pointerAnchorMessageIdRef.current,
				timelineInteractionMode: interactionModeBeforeKey,
			});
			const messageMentionNodes = getMessageMentionNodes(messageId);
			const currentMentionIndex = Math.max(messageMentionNodes.indexOf(event.currentTarget), 0);
			markTimelineKeyboardInteraction();

			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				event.stopPropagation();
				void focusHorizontalStop({
					direction: 'left',
					from: {
						kind: 'mention',
						index: currentMentionIndex,
					},
					message,
				});
				return;
			}

			if (event.key === 'ArrowRight') {
				event.preventDefault();
				event.stopPropagation();
				void focusHorizontalStop({
					direction: 'right',
					from: {
						kind: 'mention',
						index: currentMentionIndex,
					},
					message,
				});
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				event.stopPropagation();
				if (pointerHandoffTarget) {
					void focusMessage(pointerHandoffTarget, 'auto', 'keyboard', 'preserve');
					return;
				}

				if (currentIndex === 0) {
					onNavigateHeader?.('favorite');
					return;
				}

				void focusMessageAtIndex(Math.max(currentIndex - 1, 0));
				return;
			}

			if (event.key === 'ArrowDown') {
				event.preventDefault();
				event.stopPropagation();
				if (pointerHandoffTarget) {
					void focusMessage(pointerHandoffTarget, 'auto', 'keyboard', 'preserve');
					return;
				}

				if (currentIndex === currentMessageIds.length - 1) {
					onNavigateComposer?.();
					return;
				}

				void focusMessageAtIndex(Math.min(currentIndex + 1, currentMessageIds.length - 1));
				return;
			}

			if (event.key === 'Home') {
				event.preventDefault();
				event.stopPropagation();
				void focusMessageAtIndex(0);
				return;
			}

			if (event.key === 'End') {
				event.preventDefault();
				event.stopPropagation();
				if (replyJumpNavigation) {
					void jumpReplyNavigationToLatest({
						behavior: 'auto',
						focusTarget: true,
					});
					return;
				}

				void jumpToUnreadOrLatest({ behavior: 'auto', focusTarget: true });
				return;
			}

			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				void focusMessage(messageId, 'auto', 'keyboard');
				return;
			}

			if (event.key === 'Tab') {
				keyboardAnchorMessageIdRef.current = messageId;
				return;
			}

			if (event.key === 'F10' && event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				openAuthorQuickPanel({
					anchorRect: event.currentTarget.getBoundingClientRect(),
					message,
					trigger: {
						focusKey: mentionFocusKey,
						kind: 'mention',
					},
					source: 'keyboard',
					user: mentionUser,
				});
			}
		},
		[
			currentMessageIds,
			focusHorizontalStop,
			focusMessage,
			focusMessageAtIndex,
			getMessageMentionNodes,
			jumpReplyNavigationToLatest,
			jumpToUnreadOrLatest,
			markTimelineKeyboardInteraction,
			mentionInteractionUsersById,
			onNavigateComposer,
			onNavigateHeader,
			openAuthorQuickPanel,
			replyJumpNavigation,
			shouldIgnoreHeldTimelineVerticalArrowNavigation,
			timelineMessagesById,
		],
	);

	const timelineImageFocusHandlerRef = useRef(handleTimelineImageFocus);
	const timelineImageKeyDownHandlerRef = useRef(handleTimelineImageKeyDown);
	const timelineMentionFocusHandlerRef = useRef(handleTimelineMentionFocus);
	const timelineMentionKeyDownHandlerRef = useRef(handleTimelineMentionKeyDown);

	useLayoutEffect(() => {
		timelineImageFocusHandlerRef.current = handleTimelineImageFocus;
	}, [handleTimelineImageFocus]);

	useLayoutEffect(() => {
		timelineImageKeyDownHandlerRef.current = handleTimelineImageKeyDown;
	}, [handleTimelineImageKeyDown]);

	useLayoutEffect(() => {
		timelineMentionFocusHandlerRef.current = handleTimelineMentionFocus;
	}, [handleTimelineMentionFocus]);

	useLayoutEffect(() => {
		timelineMentionKeyDownHandlerRef.current = handleTimelineMentionKeyDown;
	}, [handleTimelineMentionKeyDown]);

	const stableHandleTimelineImageFocus = useCallback((event: ReactFocusEvent<HTMLImageElement>) => {
		timelineImageFocusHandlerRef.current(event);
	}, []);

	const stableHandleTimelineImageKeyDown = useCallback((event: ReactKeyboardEvent<HTMLImageElement>) => {
		timelineImageKeyDownHandlerRef.current(event);
	}, []);

	const stableHandleTimelineMentionFocus = useCallback((event: ReactFocusEvent<HTMLButtonElement>) => {
		timelineMentionFocusHandlerRef.current(event);
	}, []);

	const stableHandleTimelineMentionKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
		timelineMentionKeyDownHandlerRef.current(event);
	}, []);

	const closeMessageContextMenuAndContinueTimeline = useCallback(
		(target: 'current' | 'next' | 'previous') => {
			const anchorMessageId = activeContextMenuMessage?.id ?? messageContextMenu?.messageId ?? null;
			const anchorMessageIndex = anchorMessageId ? currentMessageIds.indexOf(anchorMessageId) : -1;

			closeMessageContextMenu();

			window.requestAnimationFrame(() => {
				if (target === 'current') {
					void focusMessage(anchorMessageId, 'auto', 'keyboard', 'preserve');
					return;
				}

				if (anchorMessageIndex < 0) {
					void focusMessage(anchorMessageId, 'auto', 'keyboard', 'preserve');
					return;
				}

				if (target === 'previous') {
					if (anchorMessageIndex === 0) {
						onNavigateHeader?.('favorite');
						return;
					}

					void focusMessage(currentMessageIds[anchorMessageIndex - 1] ?? null, 'auto', 'keyboard');
					return;
				}

				if (anchorMessageIndex >= currentMessageIds.length - 1) {
					onNavigateComposer?.();
					return;
				}

				void focusMessage(currentMessageIds[anchorMessageIndex + 1] ?? null, 'auto', 'keyboard');
			});
		},
		[
			activeContextMenuMessage?.id,
			closeMessageContextMenu,
			currentMessageIds,
			focusMessage,
			messageContextMenu?.messageId,
			onNavigateComposer,
			onNavigateHeader,
		],
	);

	const messageContextMenuLayer =
		activeContextMenuMessage && messageContextMenuPosition && typeof document !== 'undefined'
			? (
					<MessageContextMenuLayer
						activeKey={messageContextMenu?.activeActionKey ?? null}
						actionableItems={actionableContextMenuItems}
						items={messageContextMenuItems}
						message={activeContextMenuMessage}
						onActiveKeyChange={updateMessageContextMenuActiveKey}
						onClose={closeMessageContextMenu}
						onContinueTimeline={closeMessageContextMenuAndContinueTimeline}
						onSelectAction={runMessageContextAction}
						position={messageContextMenuPosition}
						source={messageContextMenu?.source ?? 'pointer'}
					/>
			  )
			: null;

	const authorQuickPanelLayer =
		authorQuickPanel && authorQuickPanelPosition && typeof document !== 'undefined'
			? createPortal(
					<div
						ref={authorQuickPanelRef}
						aria-label={spaceText('用户快捷面板')}
						className={styles.authorQuickPanel}
						data-testid='timeline-author-quick-panel'
						data-user-id={authorQuickPanel.user.id}
						role='dialog'
						style={{
							left: `${authorQuickPanelPosition.left}px`,
							top: `${authorQuickPanelPosition.top}px`,
						}}
						onKeyDownCapture={handleAuthorQuickPanelKeyDown}
					>
						<div className={styles.authorQuickPanelHeader}>
							<div className={styles.authorQuickPanelAvatar} data-tone={getAuthorTone(activeAuthorQuickPanelLookup?.user.displayName ?? authorQuickPanel.user.displayName ?? '用户')}>
								{getAvatarLabel(activeAuthorQuickPanelLookup?.user.displayName ?? authorQuickPanel.user.displayName ?? '用户')}
							</div>
							<div className={styles.authorQuickPanelMeta}>
								<strong data-testid='timeline-author-quick-panel-name'>
									{spaceText(activeAuthorQuickPanelLookup?.user.displayName ?? authorQuickPanel.user.displayName ?? '正在加载')}
								</strong>
								{activeAuthorQuickPanelLookup?.user.username || authorQuickPanel.user.username ? (
									<span data-testid='timeline-author-quick-panel-handle'>
										@{activeAuthorQuickPanelLookup?.user.username ?? authorQuickPanel.user.username}
									</span>
								) : null}
							</div>
						</div>
						<p className={styles.authorQuickPanelStatus} data-testid='timeline-author-quick-panel-status'>
							{spaceText(
								authorQuickPanelLookupPending && authorQuickPanelRequestedUserId === authorQuickPanel.user.id
									? '正在加载用户信息'
									: activeAuthorQuickPanelLookup?.user.presence
										? activeAuthorQuickPanelLookup.user.presence === 'online'
											? '在线'
											: activeAuthorQuickPanelLookup.user.presence === 'away'
												? '离开'
												: activeAuthorQuickPanelLookup.user.presence === 'busy'
													? '忙碌'
													: '离线'
										: activeAuthorQuickPanelLookup
											? activeAuthorQuickPanelLookup.conversation.state === 'none'
												? '尚未建立私信'
												: activeAuthorQuickPanelLookup.conversation.state === 'hidden'
													? '已有私信，当前已隐藏'
													: '已有私信'
											: '正在加载用户信息',
							)}
						</p>
						<div className={styles.authorQuickPanelActions}>
							<button
								ref={authorQuickPanelPrimaryActionRef}
								className={styles.authorQuickPanelPrimaryAction}
								data-testid='timeline-author-quick-panel-primary-action'
								disabled={
									authorQuickPanelSubmitting ||
									authorQuickPanelLookupPending ||
									authorQuickPanelRequestedUserId !== authorQuickPanel.user.id ||
									!activeAuthorQuickPanelLookup
								}
								onClick={() => onEnsureAuthorDirectConversation?.(authorQuickPanel.user.id)}
								type='button'
							>
								{spaceText(authorQuickPanelSubmitting ? '处理中…' : getDirectConversationActionLabel(activeAuthorQuickPanelLookup))}
							</button>
						</div>
					</div>,
					document.body,
			  )
			: null;

	const toastLayer =
		timelineToast && typeof document !== 'undefined'
			? createPortal(
					<div className={styles.toastDock}>
						<div
							aria-live='polite'
							className={styles.toast}
							data-testid='timeline-toast'
							data-tone={timelineToast.tone}
							key={timelineToast.id}
							role='status'
						>
							{spaceText(timelineToast.message)}
						</div>
					</div>,
					document.body,
			  )
			: null;

	return (
		<TimelineImageGalleryProvider key={timeline.roomId} galleryKey={timeline.roomId}>
			<div className={styles.viewport}>
				<div
					ref={messageStreamRef}
					className={styles.messageStream}
					data-interaction-mode={timelineInteractionMode}
					data-testid='timeline'
					onFocusCapture={() => onFocusWithin?.()}
					onPointerDownCapture={(event) => {
						cancelTimelineScrollAnimation();
						if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
							markTimelinePointerInteraction();
						}
					}}
					onPointerMoveCapture={(event) => {
						if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
							markTimelinePointerInteraction();
						}
					}}
					onTouchStartCapture={() => cancelTimelineScrollAnimation()}
					onWheelCapture={() => cancelTimelineScrollAnimation()}
				>
				{timeline.messages.map((message, index) => {
					const metadata = messageMetadata[message.id];
					const isMentionedMessage = messageMentionStates[message.id] ?? false;
					const isCollapsed = Boolean(metadata?.collapsible && !metadata.expanded);
					const forwardedMessage = parseForwardedMessageMarkdown(message.body.rawMarkdown);
					const messageLayout = resolveTimelineMessageLayout({
						attachments: message.attachments,
						forwardedMessage,
						rawMarkdown: message.body.rawMarkdown,
					});
					const authorTone = getAuthorTone(message.author.displayName);
					const deliveryState = messageDeliveryStates[message.id];
					const isLocalOutgoingMessage = localOutgoingMessageIds.has(message.id);
					const failedMessageAction = deliveryState === 'failed' ? failedMessageActions[message.id] : undefined;
					const isKeyboardFocused = focusedMessageId === message.id;
					const isContextOpen = messageContextMenu?.messageId === message.id;
					const allowMessageChildTabFocus =
						messageContextMenu?.messageId === message.id || (isKeyboardFocused && timelineInteractionMode === 'keyboard');
					const groupedWithPrevious =
						index !== visualUnreadStartIndex && shouldVisuallyGroupTimelineMessages(timeline.messages[index - 1], message);
					const groupedWithNext =
						index + 1 !== visualUnreadStartIndex && shouldVisuallyGroupTimelineMessages(message, timeline.messages[index + 1]);
					const canOpenAuthorQuickPanel =
						authorQuickPanelEnabled && !groupedWithPrevious && currentUser?.id !== message.author.id;
					const isAuthorQuickPanelOpen = authorQuickPanel?.messageId === message.id;
					const buildMentionInteraction = (focusKeyPrefix: string) =>
						authorQuickPanelEnabled
							? {
									focusKeyPrefix,
									onFocus: stableHandleTimelineMentionFocus,
									onKeyDown: stableHandleTimelineMentionKeyDown,
									onOpen: handleTimelineMentionOpen,
									onPrepare: prepareTimelineMentionQuickPanel,
									tabIndex: allowMessageChildTabFocus ? 0 : -1,
									timelineMessageId: message.id,
									users: mentionInteractionUsers,
							  }
							: undefined;
					const bodyMentionInteraction = buildMentionInteraction(`${message.id}:body`);
					const forwardedLeadMentionInteraction = buildMentionInteraction(`${message.id}:forward-lead`);
					const forwardedBodyMentionInteraction = buildMentionInteraction(`${message.id}:forward-body`);
					const deliveryAccessory = deliveryState === 'sending' ? (
						<div className={styles.deliveryInline} data-state={deliveryState}>
							<p
								className={styles.deliveryState}
								data-state={deliveryState}
								data-testid={deliveryState === 'sending' ? `timeline-message-sending-${message.id}` : undefined}
							>
								{spaceText(deliveryState === 'sending' ? '发送中' : '发送失败')}
							</p>
						</div>
					) : null;

					return (
						<Fragment key={message.id}>
								{index === visualUnreadStartIndex && visualUnreadDivider ? (
									<div
										ref={
											visualLiveUnreadDivider && visualLiveUnreadDivider.messageId === visualUnreadDivider.messageId
												? unreadDividerRef
												: undefined
										}
										className={styles.unreadDividerSlot}
										data-state={visualUnreadDivider.phase}
										data-testid='timeline-unread-divider'
								>
									<div className={styles.unreadDivider}>
										<span>{spaceText(visualUnreadDivider.label)}</span>
									</div>
								</div>
							) : null}

							<article
								ref={setMessageRef(message.id)}
								data-author-focus-mode={focusedAuthorTrigger?.messageId === message.id ? focusedAuthorTrigger.mode : 'none'}
								data-author-focused={focusedAuthorTrigger?.messageId === message.id ? 'true' : 'false'}
								data-author-panel-open={isAuthorQuickPanelOpen ? 'true' : 'false'}
								data-author-panel-source={isAuthorQuickPanelOpen ? authorQuickPanel?.source ?? 'pointer' : 'none'}
								className={styles.messageRow}
								data-context-open={isContextOpen ? 'true' : 'false'}
								data-context-source={isContextOpen ? messageContextMenu?.source ?? 'pointer' : 'none'}
								data-delivery-state={deliveryState ?? 'sent'}
								data-grouped-next={groupedWithNext ? 'true' : 'false'}
								data-grouped-prev={groupedWithPrevious ? 'true' : 'false'}
								data-highlighted={highlightedMessageId === message.id ? 'true' : 'false'}
								data-keyboard-focused={isKeyboardFocused ? 'true' : 'false'}
								data-keyboard-visible={
									isKeyboardFocused && !isContextOpen && timelineInteractionMode === 'keyboard' && keyboardFocusActive ? 'true' : 'false'
								}
								data-mentioned={isMentionedMessage ? 'true' : 'false'}
								data-testid={`timeline-message-${message.id}`}
								data-message-id={message.id}
								onContextMenu={(event) => handleMessageSecondaryAction(event, message.id)}
								onFocus={(event) => {
									if (event.target === event.currentTarget) {
										setFocusedAuthorTrigger(null);
									}
									updateFocusedMessageId(message.id);
								}}
								onKeyDown={(event) => handleMessageKeyDown(event, message)}
								onPointerEnter={(event) => {
									if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
										pointerAnchorMessageIdRef.current = message.id;
									}
								}}
								onMouseDown={(event) => handleMessagePointerDown(event, message.id)}
								tabIndex={isKeyboardFocused ? 0 : -1}
							>
								{groupedWithPrevious ? (
									<div className={styles.messageGutter} aria-hidden='true'>
										<span className={styles.groupedTimestamp}>{formatMessageTime(message.createdAt)}</span>
									</div>
								) : (
									<div className={styles.avatarShell}>
										{canOpenAuthorQuickPanel ? (
											<button
												aria-label={spaceText(`查看 ${message.author.displayName} 并发起私信`)}
												className={styles.avatarTrigger}
												data-testid={`timeline-author-avatar-trigger-${message.id}`}
												onClick={(event) =>
													openAuthorQuickPanel({
														anchorRect: event.currentTarget.getBoundingClientRect(),
														message,
														trigger: {
															kind: 'author',
														},
														source: 'pointer',
														user: {
															displayName: message.author.displayName,
															id: message.author.id,
															username: message.author.username,
														},
													})
												}
												onPointerEnter={(event) => {
													if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
														onPrepareAuthorQuickPanel?.(message.author.id);
													}
												}}
												onMouseDown={(event) => {
													event.preventDefault();
													markTimelinePointerInteraction();
													onPrepareAuthorQuickPanel?.(message.author.id);
													updateFocusedMessageId(message.id);
												}}
												tabIndex={-1}
												type='button'
											>
												<span className={styles.avatar} data-testid={`timeline-author-avatar-${message.id}`} data-tone={authorTone}>
													{getAvatarLabel(message.author.displayName)}
												</span>
											</button>
										) : (
											<div className={styles.avatar} data-testid={`timeline-author-avatar-${message.id}`} data-tone={authorTone}>
												{getAvatarLabel(message.author.displayName)}
											</div>
										)}
									</div>
								)}
								<div
									className={styles.messageBody}
									data-grouped={groupedWithPrevious ? 'true' : 'false'}
									data-mentioned={isMentionedMessage ? 'true' : 'false'}
									data-testid={`timeline-message-body-${message.id}`}
									ref={setMessageBodyRef(message.id)}
								>
									<div className={styles.messageToolbar} data-grouped={groupedWithPrevious ? 'true' : 'false'}>
										{!groupedWithPrevious ? (
											<div className={styles.messageMeta}>
												{canOpenAuthorQuickPanel ? (
													<button
														aria-expanded={isAuthorQuickPanelOpen}
														aria-haspopup='dialog'
														aria-label={spaceText(`查看 ${message.author.displayName} 并发起私信`)}
														className={styles.authorMetaButton}
														data-testid={`timeline-author-trigger-${message.id}`}
														onClick={(event) =>
															openAuthorQuickPanel({
																anchorRect: event.currentTarget.getBoundingClientRect(),
																message,
																trigger: {
																	kind: 'author',
																},
																source: 'pointer',
																user: {
																	displayName: message.author.displayName,
																	id: message.author.id,
																	username: message.author.username,
																},
															})
														}
														onFocus={() => {
															setFocusedAuthorTrigger({
																messageId: message.id,
																mode: timelineInteractionModeRef.current === 'keyboard' ? 'avatar' : 'meta',
															});
															updateFocusedMessageId(message.id);
															onPrepareAuthorQuickPanel?.(message.author.id);
														}}
														onBlur={() => {
															setFocusedAuthorTrigger((currentAuthorTrigger) =>
																currentAuthorTrigger?.messageId === message.id ? null : currentAuthorTrigger,
															);
														}}
														onKeyDown={(event) => handleAuthorTriggerKeyDown(event, message)}
														onPointerEnter={(event) => {
															if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
																onPrepareAuthorQuickPanel?.(message.author.id);
															}
														}}
														ref={setAuthorTriggerRef(message.id)}
														tabIndex={allowMessageChildTabFocus ? 0 : -1}
														type='button'
													>
														<strong>{spaceText(message.author.displayName)}</strong>
														{message.author.username ? <span>@{message.author.username}</span> : null}
													</button>
												) : (
													<>
														<strong>{spaceText(message.author.displayName)}</strong>
														{message.author.username ? <span>@{message.author.username}</span> : null}
													</>
												)}
												<time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
												{message.flags.edited ? <span>{spaceText('已编辑')}</span> : null}
											</div>
										) : null}

										{deliveryAccessory || !isLocalOutgoingMessage ? (
											<div className={styles.messageAccessory}>
												{deliveryAccessory ?? (
													<div className={styles.messageActions} data-testid={`message-actions-${message.id}`}>
														<button
															aria-label={spaceText(`回复 ${message.author.displayName} 的消息`)}
															className={styles.messageActionButton}
															data-testid={`message-action-reply-${message.id}`}
															onClick={() => onReplyMessage?.(message)}
															onFocus={() => setFocusedAuthorTrigger(null)}
															onKeyDown={(event) => handleMessageActionKeyDown(event, message, 'reply')}
															ref={setMessageActionRef(message.id, 'reply')}
															tabIndex={allowMessageChildTabFocus ? 0 : -1}
															title={spaceText('回复')}
															type='button'
														>
															<ReplyIcon />
														</button>
														<button
															aria-label={spaceText(`转发 ${message.author.displayName} 的消息`)}
															className={styles.messageActionButton}
															data-testid={`message-action-forward-${message.id}`}
															onClick={() => onForwardMessage?.(message)}
															onFocus={() => setFocusedAuthorTrigger(null)}
															onKeyDown={(event) => handleMessageActionKeyDown(event, message, 'forward')}
															ref={setMessageActionRef(message.id, 'forward')}
															tabIndex={allowMessageChildTabFocus ? 0 : -1}
															title={spaceText('转发')}
															type='button'
														>
															<ForwardIcon />
														</button>
													</div>
												)}
											</div>
										) : null}
									</div>

									{message.replyTo ? (
										<div className={styles.replyPreview} data-long={message.replyTo.long ? 'true' : 'false'}>
											<span aria-hidden='true' className={styles.replyGlyph}>
												↳
											</span>
											<button
												className={styles.replyCard}
												data-testid={`reply-jump-${message.id}`}
												onFocus={() => {
													setFocusedAuthorTrigger(null);
													updateFocusedMessageId(message.id);
												}}
												onClick={(event) =>
													jumpToOriginalMessage(message.id, message.replyTo!.messageId, {
														focusTarget: event.detail === 0,
													})
												}
												onKeyDown={(event) => handleReplyPreviewKeyDown(event, message)}
												ref={setMessageReplyPreviewRef(message.id)}
												tabIndex={allowMessageChildTabFocus ? 0 : -1}
												type='button'
											>
												<div className={styles.replyMeta}>
													<span className={styles.replyLabel}>{spaceText('回复')}</span>
													<strong>{spaceText(message.replyTo.authorName)}</strong>
													{message.replyTo.long ? <span className={styles.replyHint}>{spaceText('长消息')}</span> : null}
												</div>
												<p className={styles.replyExcerpt}>{spaceText(message.replyTo.excerpt)}</p>
											</button>
										</div>
									) : null}

									<div
										className={styles.messageContent}
										data-collapsed={isCollapsed ? 'true' : 'false'}
										data-collapsible={metadata?.collapsible ? 'true' : 'false'}
										data-expanded={metadata?.collapsible ? (metadata.expanded ? 'true' : 'false') : undefined}
										data-leading-surface={messageLayout.leadingSurface ? 'true' : 'false'}
										data-surface-only={messageLayout.surfaceOnly ? 'true' : 'false'}
										data-testid={`timeline-message-content-${message.id}`}
									>
										<div
											ref={setMessageContentRef(message.id)}
											aria-hidden={isCollapsed ? 'true' : undefined}
											className={styles.messageContentInner}
											data-content-message-id={message.id}
											inert={isCollapsed}
										>
											{message.flags.deleted ? (
												<p className={styles.deletedMessage}>{spaceText('该消息已删除。')}</p>
											) : forwardedMessage ? (
												<>
													{forwardedMessage.leadMarkdown ? (
														<MarkdownContent
															currentUser={currentUser}
															dense
															imageInteraction={{
																onFocus: stableHandleTimelineImageFocus,
																onKeyDown: stableHandleTimelineImageKeyDown,
																	tabIndex: allowMessageChildTabFocus ? 0 : -1,
																	timelineMessageId: message.id,
																}}
															mentionInteraction={forwardedLeadMentionInteraction}
															source={forwardedMessage.leadMarkdown}
														/>
													) : null}
													<ForwardedMessageCard
														authorName={forwardedMessage.authorName}
														bodyMarkdown={forwardedMessage.bodyMarkdown}
														currentUser={currentUser}
														mentionInteraction={forwardedBodyMentionInteraction}
														roomTitle={forwardedMessage.roomTitle}
														timeLabel={forwardedMessage.timeLabel}
													/>
												</>
											) : (
												<MarkdownContent
													currentUser={currentUser}
													dense
													imageInteraction={{
														onFocus: stableHandleTimelineImageFocus,
														onKeyDown: stableHandleTimelineImageKeyDown,
															tabIndex: allowMessageChildTabFocus ? 0 : -1,
															timelineMessageId: message.id,
														}}
													mentionInteraction={bodyMentionInteraction}
													source={message.body.rawMarkdown}
												/>
											)}

											{message.attachments?.length ? (
												<div className={styles.attachments}>
													{message.attachments.map((attachment) =>
														attachment.kind === 'image' ? (
															<AttachmentImage
																key={attachment.id}
																attachment={attachment}
																onFocus={handleTimelineImageFocus}
																onKeyDown={handleTimelineImageKeyDown}
																timelineMessageId={message.id}
															/>
														) : null,
													)}
												</div>
											) : null}
										</div>

										{isCollapsed ? (
											<button
												aria-expanded='false'
												className={styles.messageExpandOverlay}
												data-testid={`timeline-message-toggle-${message.id}`}
												onClick={() => toggleMessageExpanded(message.id)}
												tabIndex={allowMessageChildTabFocus ? 0 : -1}
												type='button'
											>
												<span className={styles.messageExpandHint}>
													<span className={styles.messageExpandHintLabel}>{spaceText('展开全文')}</span>
													<span aria-hidden='true' className={styles.messageExpandHintGlyph}>
														↓
													</span>
												</span>
											</button>
										) : null}
									</div>

									{metadata?.collapsible && !isCollapsed ? (
										<button
											aria-expanded={metadata.expanded}
											className={styles.messageToggle}
											data-testid={`timeline-message-toggle-${message.id}`}
											onClick={() => toggleMessageExpanded(message.id)}
											tabIndex={allowMessageChildTabFocus ? 0 : -1}
											type='button'
										>
											{metadata.expanded ? '收起' : '展开全文'}
										</button>
									) : null}

									{deliveryState === 'failed' ? (
										<div className={styles.deliveryFailure} data-testid={`timeline-message-failure-${message.id}`}>
											<p className={styles.deliveryState} data-state={deliveryState}>
												{spaceText('发送失败')}
											</p>
											{(onRetryFailedMessage || onRemoveFailedMessage) ? (
												<div className={styles.deliveryActions}>
													{onRetryFailedMessage ? (
														<button
															className={styles.deliveryActionButton}
															data-testid={`timeline-message-retry-${message.id}`}
															onClick={(event) => {
																event.stopPropagation();
																onRetryFailedMessage(message.id);
															}}
															onMouseDown={(event) => event.stopPropagation()}
															tabIndex={allowMessageChildTabFocus ? 0 : -1}
															type='button'
														>
															{spaceText('重发')}
														</button>
													) : null}
													{onRemoveFailedMessage ? (
														<button
															className={styles.deliveryActionButton}
															data-testid={`timeline-message-remove-${message.id}`}
															data-variant='remove'
															onClick={(event) => {
																event.stopPropagation();
																onRemoveFailedMessage(message.id);
															}}
															onMouseDown={(event) => event.stopPropagation()}
															tabIndex={allowMessageChildTabFocus ? 0 : -1}
															type='button'
														>
															{spaceText('移除')}
														</button>
													) : null}
												</div>
											) : null}
											{failedMessageAction?.errorMessage ? (
												<p className={styles.deliveryError} data-testid={`timeline-message-error-${message.id}`}>
													{spaceText(failedMessageAction.errorMessage)}
												</p>
											) : null}
										</div>
									) : null}

									{message.thread ? (
										<div className={styles.threadMeta}>
											<span className={styles.threadCount}>{spaceText(`${message.thread.replyCount} 条回复`)}</span>
											{message.thread.lastReplyAt ? <span>{spaceText(`最后回复 ${formatMessageTime(message.thread.lastReplyAt)}`)}</span> : null}
										</div>
									) : null}
								</div>
							</article>
						</Fragment>
					);
				})}
				</div>
				{replyReturnAction || jumpAction ? (
					<div className={styles.jumpDock}>
						{replyReturnAction ? (
							<button
								aria-label={spaceText('返回刚才浏览位置')}
								className={styles.replyReturnButton}
								data-testid='timeline-return-button'
								onClick={replyReturnAction.onClick}
								type='button'
							>
								<ReturnIcon />
								<span className={styles.replyReturnLabel}>{spaceText(replyReturnAction.label)}</span>
							</button>
						) : null}
						{jumpAction ? (
							<button
								className={styles.jumpButton}
								data-action={jumpAction.key}
								data-testid='timeline-jump-button'
								data-tone={jumpAction.tone}
								onClick={jumpAction.onClick}
								type='button'
							>
								{jumpAction.tone === 'accent' ? <span className={styles.jumpDot} /> : null}
								{jumpAction.tone === 'mention' ? <span className={styles.jumpMentionBadge}>@</span> : null}
								<span className={styles.jumpLabel}>{spaceText(jumpAction.label)}</span>
								<span aria-hidden='true' className={styles.jumpArrow}>
									↓
								</span>
							</button>
						) : null}
					</div>
					) : null}
				</div>
				{authorQuickPanelLayer}
				{messageContextMenuLayer}
				{toastLayer}
			</TimelineImageGalleryProvider>
	);
};
