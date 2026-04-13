import type {
	ConversationParticipant,
	SessionUser,
} from '@betterchat/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
} from 'react';

import { applyDocumentMotionPreference, getStoredMotionPreference, isDocumentMotionDisabled, type MotionPreference } from '@/app/motionPreference';
import { useTheme } from '@/app/ThemeProvider';
import { ComposerBar, type ComposerBarHandle, type ComposerSubmitPayload } from '@/features/composer/ComposerBar';
import { resolveImageUploadFailureMessage } from '@/features/composer/imageUploadErrors';
import { preloadLiveMarkdownEditor } from '@/features/composer/loadLiveMarkdownEditor';
import { toMentionInteractionUsers } from '@/features/composer/mentions';
import { loadComposerSendShortcut, saveComposerSendShortcut } from '@/features/composer/sendShortcutPreference';
import { ForwardMessageDialog } from '@/features/messages/ForwardMessageDialog';
import { DeleteMessageDialog } from '@/features/messages/DeleteMessageDialog';
import { buildForwardedMessageMarkdown, createReplyPreviewFromMessage } from '@/features/messages/messageCompose';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { TimelineView } from '@/features/timeline/TimelineView';
import {
	browserNotificationBackgroundSupported,
	loadBrowserNotificationDelivery,
	loadRoomNotificationDefaults,
	loadRoomNotificationPreferences as loadRoomAlertPreferences,
	resolveBrowserNotificationPermissionState,
	resolveDefaultRoomNotificationPreference,
	resolveEffectiveBrowserNotificationDelivery,
	resolveRoomNotificationPreference as resolveRoomAlertPreference,
	roomNotificationPreferenceUsesDefault,
	saveBrowserNotificationDelivery,
	saveRoomNotificationDefaults,
	saveRoomNotificationPreferences as saveRoomAlertPreferences,
	updateRoomNotificationPreferences as updateRoomAlertPreferences,
	type BrowserNotificationDelivery,
	type BrowserNotificationPermissionState,
	type RoomNotificationDefaults,
	type RoomNotificationPreference as RoomAlertPreference,
} from '@/features/notifications/notificationPreferences';
import {
	isBrowserNotificationDeliveryEnabled,
} from '@/features/notifications/notificationPolicy';
import {
	mergeMessageContextIntoTimeline,
	mergeTimelineMessagesPreferIncoming,
} from '@/features/timeline/timelineContext';
import { betterChatApi, betterChatQueryKeys, isBetterChatApiError } from '@/lib/betterchat';
import { createMutationErrorHandler, type ToastOptions } from '@/lib/mutationErrorHandler';
import { toRoomListSnapshot, toRoomSnapshot, toRoomSummary, toRoomTimelineSnapshot } from '@/lib/chatAdapters';
import {
	createBetterChatRealtimeController,
	type BetterChatRealtimeStatus,
	type SocketError,
	type WatchedRoomState,
} from '@/lib/betterchat-realtime';
import { getAvatarLabel } from '@/lib/avatar';
import { createHeldArrowNavigationState, resolveHeldArrowNavigationAllowance } from '@/lib/heldArrowNavigation';
import type {
	DirectConversationLookupResult,
	RoomListSnapshot,
	RoomSnapshot,
	RoomSummary,
	RoomTimelineSnapshot,
	TimelineAttachment,
	TimelineMessage,
} from '@/lib/chatModels';
import { spaceText } from '@/lib/text';

import { mergeTimelineMessageWithLocalSubmission, reconcileSubmissionTimeline, timelineMessagesShareIdentity } from './submissionReconciliation';
import {
	applyFavoriteOverrides,
	loadFavoriteOverrides,
	resolveFavoriteOverride,
	saveFavoriteOverrides,
	updateFavoriteOverrides,
} from '../sidebar/favoriteOverrides';
import {
	resolveSidebarBrowserNotificationBody,
	resolveSidebarBrowserNotificationMessageBody,
	resolveSidebarNotificationFetchCount,
	resolveSidebarNotificationMessages,
	shouldFallbackNotifyForSidebarEntry,
	type SidebarNotificationMessageCandidate,
	shouldNotifyForSidebarEntry,
} from '../sidebar/sidebarBrowserNotifications';
import { SidebarAttentionDock } from '../sidebar/SidebarAttentionDock';
import { buildSidebarAttentionDock } from '../sidebar/sidebarAttentionDockModel';
import { buildSidebarGroups, getDefaultRoomId } from '../sidebar/sidebarModel';
import { deriveSidebarOrderingState, type SidebarOrderingState } from '../sidebar/sidebarOrdering';
import { resolveSidebarSecondaryMeta } from '../sidebar/sidebarPresence';
import { formatSidebarUnreadBadgeCount } from '../sidebar/sidebarUnreadBadge';
import { resolveElementKeyboardRegion, type KeyboardFocusRegion } from './keyboardRegion';
import { resolveSidebarMentionSignal } from '../sidebar/sidebarMentionSignal';
import styles from './AppShell.module.css';
import {
	clampComposerEditorHeight,
	formatComposerEditorHeightCssValue,
	loadComposerEditorHeightPreference,
	resolveComposerEditorHeightBounds,
	resolveComposerEditorResizeHeight,
	saveComposerEditorHeightPreference,
} from './composerHeightPreference';
import { resolveSidebarSearchKeyAction } from './sidebarSearchKeyAction';
import { shouldIgnorePointerRegionMove, shouldRefreshTimelinePointerEpoch } from './pointerRegionOwnership';
import { canApplyPendingComposerFocus } from './postNavigationFocus';
import { revealSidebarRoomInContainer } from './sidebarActiveRoomReveal';
import {
	hasOlderHistory,
	mergeOlderHistoryPage,
	olderHistoryStatesEqual,
	resolveRetainedOlderHistory,
	resolveOlderHistoryLoadCursor,
	resolveOlderHistoryNextCursor,
	type OlderHistoryState,
} from './olderHistoryState';
import { resolveShellKeyboardAction } from './shellKeyboardRouter';
import { useSidebarInteractionController } from './useSidebarInteractionController';

const roomKindLabel: Record<'channel' | 'group' | 'dm', string> = {
	channel: '频道',
	group: '群组',
	dm: '私信',
};

const roomKindGlyph: Record<'channel' | 'group' | 'dm', string> = {
	channel: '#',
	group: '◎',
	dm: '私',
};
const roomAlertPreferenceLabel: Record<RoomAlertPreference, string> = {
	all: '所有消息',
	personal: '仅个人相关',
	mute: '静音',
};
const browserNotificationDeliveryLabel: Record<Exclude<BrowserNotificationDelivery, 'background'>, string> = {
	foreground: '仅在 BetterChat 打开时',
	off: '已关闭',
};
const getRoomUnreadCount = (room: Pick<RoomSummary, 'attention'>) => room.attention.badgeCount ?? 0;
const isRoomMentioned = (room: Pick<RoomSummary, 'attention'>) => room.attention.level === 'mention';
const isRoomVisible = (room: Pick<RoomSummary, 'visibility'>) => room.visibility === 'visible';
const clearRoomAttention = <TRoom extends Pick<RoomSummary, 'attention'> & object>(room: TRoom): TRoom =>
	({
		...room,
		attention: {
			level: 'none',
		},
	}) as TRoom;
const setRoomVisible = <TRoom extends Pick<RoomSummary, 'visibility'> & object>(room: TRoom): TRoom =>
	({
		...room,
		visibility: 'visible',
	}) as TRoom;
const resolveRoomHeaderPresenceText = ({
	handle,
	presence,
}: {
	handle: string | null;
	presence: ReturnType<typeof resolveUserPresence>;
}) => {
	if (!presence) {
		return handle;
	}

	if (presence.tone === 'online') {
		return handle ?? presence.label;
	}

	if (!handle) {
		return presence.label;
	}

	return `${presence.label} · ${handle}`;
};
const resolveDirectMessageHandle = ({
	currentUserId,
	roomKind,
	roomSubtitle,
	sidebarSubtitle,
	timelineMessages,
}: {
	currentUserId: string | null;
	roomKind: RoomSummary['kind'];
	roomSubtitle?: string | null;
	sidebarSubtitle?: string | null;
	timelineMessages?: TimelineMessage[];
}) => {
	if (roomKind !== 'dm') {
		return null;
	}

	const explicitHandle = [roomSubtitle, sidebarSubtitle].find((value) => typeof value === 'string' && value.trim().startsWith('@'));
	if (explicitHandle) {
		return explicitHandle.trim();
	}

	const counterpartMessage = timelineMessages?.find((message) => {
		if (!message.author.username?.trim()) {
			return false;
		}

		if (!currentUserId) {
			return true;
		}

		return message.author.id !== currentUserId;
	});

	if (!counterpartMessage?.author.username?.trim()) {
		return null;
	}

	return `@${counterpartMessage.author.username.trim()}`;
};

const searchPlaceholder = '跳转到房间';
const apiSidebarPollingIntervalMs = 1_500;
const apiRoomDetailsPollingIntervalMs = 2_000;
const apiRoomTimelinePollingIntervalMs = 1_000;
const directConversationLookupStaleTimeMs = 30_000;
const roomParticipantsStaleTimeMs = 30_000;

const loadAllRoomParticipants = async (roomId: string): Promise<ConversationParticipant[]> => {
	const entries: ConversationParticipant[] = [];
	let cursor: string | undefined;

	for (;;) {
		const page = await betterChatApi.roomParticipants(roomId, {
			cursor,
			limit: 100,
		});
		entries.push(...page.entries);
		if (!page.nextCursor) {
			return entries;
		}

		cursor = page.nextCursor;
	}
};
const resolveApiPollingInterval = ({
	baseIntervalMs,
	pushEnabled,
	realtimeStatus,
}: {
	baseIntervalMs: number;
	pushEnabled: boolean;
	realtimeStatus: BetterChatRealtimeStatus;
}) => {
	if (!pushEnabled) {
		return baseIntervalMs;
	}

	if (realtimeStatus.kind !== 'ready') {
		return baseIntervalMs;
	}

	return realtimeStatus.pollIntervalMs > 0 ? Math.max(realtimeStatus.pollIntervalMs, baseIntervalMs) : false;
};
type MessageDeliveryState = 'sending' | 'failed';
type LocalRoomMessage =
	| {
			errorMessage?: string;
			kind: 'image';
			message: TimelineMessage;
			previewUrl?: string;
			status: MessageDeliveryState;
			payload: {
				file: File;
				imageDimensions?: {
					height: number;
					width: number;
				};
				text: string;
			};
	  }
	| {
			errorMessage?: string;
			kind: 'text';
			message: TimelineMessage;
			status: MessageDeliveryState;
			payload: {
				replyPreview?: TimelineMessage['replyTo'];
				replyToMessageId?: string;
				text: string;
			};
};
type TimelineFocusStrategy = 'preferred' | 'bottom-visible' | 'pointer-anchor' | 'first-message' | 'last-message' | 'unread-or-latest';
type RoomHeaderControl = 'favorite' | 'alert' | 'info';
type ForwardToastState = {
	actionable: boolean;
	id: number;
	roomId: string;
	roomTitle: string;
};
type KeyboardFocusRegionUpdater = KeyboardFocusRegion | ((currentRegion: KeyboardFocusRegion) => KeyboardFocusRegion);
const emptyMessageDeliveryStates: Record<string, MessageDeliveryState> = {};
const emptyFailedMessageActions: Record<string, { errorMessage?: string }> = {};
const emptyLocalOutgoingMessageIds = new Set<string>();

const normalizeIdentityValue = (value: string) => value.trim().replace(/^@/, '').replace(/[\s._-]+/g, '').toLowerCase();
const resolveDeliveryErrorMessage = (error: unknown) => (error instanceof Error && error.message.trim() ? error.message.trim() : '发送失败，请重试。');
const resolveBrowserNotificationPageState = () => {
	if (typeof document === 'undefined') {
		return {
			pageFocused: true,
			pageVisible: true,
		};
	}

	return {
		pageFocused: typeof document.hasFocus === 'function' ? document.hasFocus() : true,
		pageVisible: document.visibilityState !== 'hidden',
	};
};
const resolveUserPresence = (status: string | undefined) => {
	switch (status) {
		case 'online':
			return { label: '在线', tone: 'online' as const };
		case 'away':
			return { label: '离开', tone: 'away' as const };
		case 'busy':
			return { label: '忙碌', tone: 'busy' as const };
		case 'offline':
			return { label: '离线', tone: 'offline' as const };
		default:
			return null;
	}
};

const RoomInfoGlyph = () => (
	<svg aria-hidden='true' viewBox='0 0 16 16'>
		<circle cx='8' cy='8' r='5.2' />
		<path d='M8 7.1v3.5' />
		<path d='M8 5.15h.01' />
	</svg>
);

const createSubmissionId = (roomId: string) => `${roomId}-submission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createLocalMessageSendKey = (roomId: string, messageId: string) => `${roomId}:${messageId}`;
const createOptimisticImageAttachment = ({
	fileName,
	height,
	messageId,
	previewUrl,
	width,
}: {
	fileName: string;
	height?: number;
	messageId: string;
	previewUrl: string;
	width?: number;
}): TimelineAttachment => ({
	id: `${messageId}-image`,
	kind: 'image',
	title: fileName,
	preview: {
		url: previewUrl,
		...(typeof width === 'number' ? { width } : {}),
		...(typeof height === 'number' ? { height } : {}),
	},
	source: {
		url: previewUrl,
		...(typeof width === 'number' ? { width } : {}),
		...(typeof height === 'number' ? { height } : {}),
	},
});

const createOptimisticTimelineMessage = ({
	attachments,
	currentUser,
	roomId,
	replyTo,
	submissionId,
	text,
}: {
	attachments?: TimelineAttachment[];
	currentUser: SessionUser;
	roomId: string;
	replyTo?: TimelineMessage['replyTo'];
	submissionId: string;
	text: string;
}) => ({
	id: submissionId,
	submissionId,
	roomId,
	createdAt: new Date().toISOString(),
	author: {
		id: currentUser.id,
		displayName: currentUser.displayName,
		username: currentUser.username,
		avatarUrl: currentUser.avatarUrl,
	},
	body: {
		rawMarkdown: text,
	},
	flags: {
		edited: false,
		deleted: false,
	},
	attachments,
	replyTo,
} satisfies TimelineMessage);

const roomLoadingSkeletonRows = [
	{ key: 'cluster-a-1', compact: false, widths: ['22%', '68%', '54%'] },
	{ key: 'cluster-a-2', compact: true, widths: ['76%'] },
	{ key: 'cluster-b-1', compact: false, widths: ['18%', '72%', '46%'] },
	{ key: 'cluster-c-1', compact: false, widths: ['20%', '64%'] },
] as const;

const hasOpenBlockingDialog = () => typeof document !== 'undefined' && Boolean(document.querySelector('[role="dialog"]'));
const isEditableElement = (element: Element | null) =>
	element instanceof HTMLInputElement ||
	element instanceof HTMLTextAreaElement ||
	element instanceof HTMLSelectElement ||
	(element instanceof HTMLElement && element.isContentEditable) ||
	element?.getAttribute('role') === 'textbox';

const RoomLoadingSkeleton = () => (
	<div aria-busy='true' aria-label='正在加载房间' className={styles.loadingShell} data-testid='room-loading-skeleton'>
		<div className={styles.loadingHeader} aria-hidden='true'>
			<div className={`${styles.skeletonBlock} ${styles.loadingTitle}`} />
			<div className={styles.loadingMetaRow}>
				<div className={`${styles.skeletonBlock} ${styles.loadingChip} ${styles.loadingChipShort}`} />
				<div className={`${styles.skeletonBlock} ${styles.loadingChip} ${styles.loadingChipLong}`} />
			</div>
			<div className={`${styles.skeletonBlock} ${styles.loadingSummary}`} />
		</div>

		<div className={styles.loadingTimeline} aria-hidden='true'>
			{roomLoadingSkeletonRows.map((row) => (
				<div key={row.key} className={styles.loadingMessage} data-compact={row.compact ? 'true' : 'false'}>
					<div className={`${styles.skeletonBlock} ${styles.loadingAvatar}`} />
					<div className={styles.loadingMessageBody}>
						{row.widths.map((width, index) => (
							<div key={`${row.key}-${width}-${index}`} className={`${styles.skeletonBlock} ${styles.loadingLine}`} style={{ width }} />
						))}
					</div>
				</div>
			))}
		</div>

		<div aria-hidden='true' className={styles.loadingBottomLane} data-mode='quiet' data-testid='room-loading-bottom-lane'>
			<div className={styles.loadingBottomBoundary} />
			<div className={styles.loadingBottomSpacer} />
		</div>
	</div>
);

const RoomAlertPreferenceGlyph = ({ preference }: { preference: RoomAlertPreference }) =>
	preference === 'mute' ? (
		<svg aria-hidden='true' viewBox='0 0 16 16'>
			<path d='M8 2.3a3.4 3.4 0 0 1 3.4 3.4v1.28c0 .92.3 1.82.85 2.56l.65.88H3.1l.65-.88c.55-.74.85-1.64.85-2.56V5.7A3.4 3.4 0 0 1 8 2.3Z' />
			<path d='M6.4 12.2a1.66 1.66 0 0 0 3.2 0' />
			<path d='M3 3l10 10' />
		</svg>
	) : preference === 'personal' ? (
		<svg aria-hidden='true' viewBox='0 0 16 16'>
			<path d='M8 2.3a3.4 3.4 0 0 1 3.4 3.4v1.28c0 .92.3 1.82.85 2.56l.65.88H3.1l.65-.88c.55-.74.85-1.64.85-2.56V5.7A3.4 3.4 0 0 1 8 2.3Z' />
			<path d='M6.4 12.2a1.66 1.66 0 0 0 3.2 0' />
			<circle cx='11.85' cy='4.15' fill='currentColor' r='1.1' stroke='none' />
		</svg>
	) : (
		<svg aria-hidden='true' viewBox='0 0 16 16'>
			<path d='M8 2.3a3.4 3.4 0 0 1 3.4 3.4v1.28c0 .92.3 1.82.85 2.56l.65.88H3.1l.65-.88c.55-.74.85-1.64.85-2.56V5.7A3.4 3.4 0 0 1 8 2.3Z' />
			<path d='M6.4 12.2a1.66 1.66 0 0 0 3.2 0' />
		</svg>
	);

const RoomAlertToggleGlyph = ({ preference }: { preference: RoomAlertPreference }) =>
	preference === 'all' ? (
		<svg aria-hidden='true' viewBox='0 0 16 16'>
			<path d='M8 2.2a3.35 3.35 0 0 1 3.35 3.35v1.34c0 .89.29 1.75.82 2.46l.68.91H3.15l.68-.91a4.08 4.08 0 0 0 .82-2.46V5.55A3.35 3.35 0 0 1 8 2.2Z' />
			<path d='M6.38 12.15a1.7 1.7 0 0 0 3.24 0' />
		</svg>
	) : preference === 'personal' ? (
		<svg aria-hidden='true' viewBox='0 0 16 16'>
			<path d='M8 2.2a3.35 3.35 0 0 1 3.35 3.35v1.34c0 .89.29 1.75.82 2.46l.68.91H3.15l.68-.91a4.08 4.08 0 0 0 .82-2.46V5.55A3.35 3.35 0 0 1 8 2.2Z' />
			<path d='M6.38 12.15a1.7 1.7 0 0 0 3.24 0' />
			<circle cx='11.8' cy='4.1' fill='currentColor' r='1.08' stroke='none' />
		</svg>
	) : (
		<svg aria-hidden='true' viewBox='0 0 16 16'>
			<path d='M8 2.2a3.35 3.35 0 0 1 3.35 3.35v1.34c0 .89.29 1.75.82 2.46l.68.91H3.15l.68-.91a4.08 4.08 0 0 0 .82-2.46V5.55A3.35 3.35 0 0 1 8 2.2Z' />
			<path d='M6.38 12.15a1.7 1.7 0 0 0 3.24 0' />
			<path d='M3.1 3.1 12.9 12.9' />
		</svg>
	);

const resolveRoomAlertDefaultLabel = ({
	defaults,
	roomKind,
}: {
	defaults: RoomNotificationDefaults;
	roomKind: 'channel' | 'group' | 'dm';
}) => roomAlertPreferenceLabel[resolveDefaultRoomNotificationPreference({ defaults, roomKind })];

const resolveRoomAlertPreferenceDescription = ({
	preference,
	roomKind,
}: {
	preference: RoomAlertPreference;
	roomKind: 'channel' | 'group' | 'dm';
}) => {
	if (preference === 'mute') {
		return '该房间仍会保留未读标记，但不会进入注意力栏或浏览器通知。';
	}

	if (preference === 'all') {
		return roomKind === 'dm' ? '来自该私信的每条新消息都允许打断你。' : '该房间的每条新消息都允许打断你。';
	}

	return roomKind === 'dm' ? '来自该私信的新消息会按个人相关提醒处理。' : '仅提及你的消息会在该房间触发打断式提醒。';
};

const resolveRoomAlertEffectSummary = ({
	delivery,
	permission,
	preference,
	roomKind,
}: {
	delivery: Exclude<BrowserNotificationDelivery, 'background'>;
	permission: BrowserNotificationPermissionState;
	preference: RoomAlertPreference;
	roomKind: 'channel' | 'group' | 'dm';
}) => {
	if (preference === 'mute') {
		return '效果：仅保留未读事实，不进入注意力栏，也不触发浏览器通知。';
	}

	if (permission === 'unsupported') {
		return '效果：当前浏览器不支持 Notification API，房间规则仅影响注意力栏。';
	}

	if (permission === 'denied') {
		return '效果：浏览器权限已阻止，房间规则会保留，但当前无法送达浏览器通知。';
	}

	if (delivery === 'off') {
		return '效果：该房间仍会参与注意力栏判断，但此浏览器已关闭浏览器通知。';
	}

	if (permission === 'default') {
		return '效果：浏览器尚未授权通知；房间规则会保留，授权后才会真正送达浏览器通知。';
	}

	if (preference === 'all') {
		return roomKind === 'dm'
			? `效果：来自该私信的新消息会${browserNotificationDeliveryLabel[delivery]}触发浏览器通知。`
			: `效果：该房间的新消息会${browserNotificationDeliveryLabel[delivery]}触发浏览器通知。`;
	}

	return roomKind === 'dm'
		? `效果：来自该私信的新消息会${browserNotificationDeliveryLabel[delivery]}触发浏览器通知。`
		: `效果：仅提及你的消息会${browserNotificationDeliveryLabel[delivery]}触发浏览器通知。`;
};

type SessionLifecycleState = 'active' | 'closing' | 'logged-out';

export const AppShell = ({ roomId }: { roomId?: string }) => {
	const { resolvedTheme, setThemePreference, themePreference } = useTheme();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const searchShortcutModifierLabel = useMemo(() => {
		if (typeof navigator === 'undefined') {
			return '⌘';
		}

		return /mac|iphone|ipad|ipod/i.test(navigator.platform) ? '⌘' : 'Ctrl';
	}, []);
	const workspaceRef = useRef<HTMLDivElement>(null);
	const sidebarRef = useRef<HTMLElement>(null);
	const conversationBodyRef = useRef<HTMLDivElement>(null);
	const composerSectionRef = useRef<HTMLDivElement>(null);
	const composerBarRef = useRef<ComposerBarHandle>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const sidebarBodyRef = useRef<HTMLDivElement>(null);
	const favoriteToggleRef = useRef<HTMLButtonElement>(null);
	const roomAlertToggleRef = useRef<HTMLButtonElement>(null);
	const roomAlertMenuRef = useRef<HTMLDivElement>(null);
	const roomInfoTriggerRef = useRef<HTMLButtonElement>(null);
	const sidebarRoomRefs = useRef(new Map<string, HTMLButtonElement>());
	const sidebarHeldArrowNavigationRef = useRef(createHeldArrowNavigationState());
	const sendQueueRef = useRef<Record<string, Promise<void>>>({});
	const localMessageSendLocksRef = useRef(new Set<string>());
	const optimisticPreviewUrlsRef = useRef(new Set<string>());
	const roomLocalMessagesRef = useRef<Record<string, LocalRoomMessage[]>>({});
	const roomOlderHistoryRef = useRef<Record<string, OlderHistoryState>>({});
	const roomOlderHistoryLoadingRef = useRef<Record<string, boolean>>({});
	const roomOlderHistoryPrefetchPagesRef = useRef<Record<string, { cursor: string; page: RoomTimelineSnapshot }>>({});
	const roomOlderHistoryPrefetchInFlightRef = useRef<Record<string, { cursor: string; promise: Promise<RoomTimelineSnapshot> }>>({});
	const activeRoomLoadedWindowRef = useRef<{
		messages: TimelineMessage[];
		nextCursor?: string;
		roomId: string;
	} | null>(null);
	const previousSidebarEntriesRef = useRef<Map<string, RoomSummary> | null>(null);
	const roomNotificationLastMessageIdRef = useRef<Record<string, string>>({});
	const roomNotificationInflightRef = useRef(new Set<string>());
	const queuedFavoriteMutationRef = useRef<{ favorite: boolean; targetRoomId: string } | null>(null);
	const browserNotificationEffectsMountedRef = useRef(true);
	const previousSidebarOrderEntriesRef = useRef<RoomSummary[]>([]);
	const previousSidebarOrderingStateRef = useRef<SidebarOrderingState>({});
	const forwardToastTimerRef = useRef<number | null>(null);
	const forwardToastActionRef = useRef<HTMLButtonElement>(null);
	const initialFocusBootstrappedRef = useRef(false);
	const realtimeControllerRef = useRef<ReturnType<typeof createBetterChatRealtimeController> | null>(null);
	const activeRoomIdRef = useRef<string | undefined>(roomId);
	const composerResizeStateRef = useRef<{
		currentHeight: number;
		pointerId: number;
		startHeight: number;
		startY: number;
	} | null>(null);
	const pointerRegionRef = useRef<KeyboardFocusRegion>(null);
	const keyboardFocusRegionRef = useRef<KeyboardFocusRegion>(null);
	const sidebarInteractionModeRef = useRef<'keyboard' | 'pointer'>('pointer');
	const interactionEpochRef = useRef(0);
	const lastSidebarFocusEpochRef = useRef(0);
	const lastTimelinePointerEpochRef = useRef(0);
	const composerLiveHeightRef = useRef(loadComposerEditorHeightPreference());
	const composerResizeFrameRef = useRef<number | null>(null);
	const composerResizePendingHeightRef = useRef<number | null>(null);
	const composerResizeGlobalListenersRef = useRef<{
		move: (event: PointerEvent) => void;
		stop: (event: PointerEvent) => void;
	} | null>(null);
	const [searchValue, setSearchValue] = useState('');
	const [favoriteOverrides, setFavoriteOverrides] = useState(loadFavoriteOverrides);
	const [roomAlertPreferences, setRoomAlertPreferences] = useState(loadRoomAlertPreferences);
	const [roomNotificationDefaults, setRoomNotificationDefaults] = useState<RoomNotificationDefaults>(loadRoomNotificationDefaults);
	const [browserNotificationDelivery, setBrowserNotificationDelivery] = useState<BrowserNotificationDelivery>(loadBrowserNotificationDelivery);
	const [browserNotificationPermission, setBrowserNotificationPermission] =
		useState<BrowserNotificationPermissionState>(resolveBrowserNotificationPermissionState);
	const [favoriteMutationInFlight, setFavoriteMutationInFlight] = useState(false);
	const [motionPreference, setMotionPreference] = useState<MotionPreference>(getStoredMotionPreference);
	const [composerEditorHeight, setComposerEditorHeight] = useState(loadComposerEditorHeightPreference);
	const [conversationBodyHeight, setConversationBodyHeight] = useState(0);
	const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
	const [composerResizeDragging, setComposerResizeDragging] = useState(false);
	const [composerResizeKeyboardAdjusting, setComposerResizeKeyboardAdjusting] = useState(false);
	const [roomLocalMessages, setRoomLocalMessages] = useState<Record<string, LocalRoomMessage[]>>({});
	const [roomOlderHistory, setRoomOlderHistory] = useState<Record<string, OlderHistoryState>>({});
	const [roomOlderHistoryLoading, setRoomOlderHistoryLoading] = useState<Record<string, boolean>>({});
	const [composerSendShortcut, setComposerSendShortcut] = useState(loadComposerSendShortcut);
	const [composerFocusToken, setComposerFocusToken] = useState(0);
	const [composerReadyRoomId, setComposerReadyRoomId] = useState<string | null>(null);
	const [composerFocusedRoomId, setComposerFocusedRoomId] = useState<string | null>(null);
	const [timelineFocusRequest, setTimelineFocusRequest] = useState<{
		strategy: TimelineFocusStrategy;
		token: number;
	}>({
		strategy: 'preferred',
		token: 0,
	});
	const [composerReplyTarget, setComposerReplyTarget] = useState<{
		preview: NonNullable<TimelineMessage['replyTo']>;
		sourceMessageId: string;
	} | null>(null);
	const [composerEditTarget, setComposerEditTarget] = useState<{
		messageId: string;
		roomId: string;
		originalText: string;
	} | null>(null);
	const [deleteDialogSource, setDeleteDialogSource] = useState<{
		message: TimelineMessage;
		isSubmitting: boolean;
	} | null>(null);
	const [forwardDialogSource, setForwardDialogSource] = useState<{
		message: TimelineMessage;
		roomTitle: string;
	} | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [roomInfoOpen, setRoomInfoOpen] = useState(false);
	const [roomAlertMenuOpen, setRoomAlertMenuOpen] = useState(false);
	const [activeTimelineAuthorUserId, setActiveTimelineAuthorUserId] = useState<string | null>(null);
	const [timelineScrollToBottomToken, setTimelineScrollToBottomToken] = useState(0);
	const [timelineExpansionRequest, setTimelineExpansionRequest] = useState<{ messageId: string; token: number } | null>(null);
	const [focusedSidebarRoomId, setFocusedSidebarRoomId] = useState<string | null>(roomId ?? null);
	const [sidebarInteractionMode, setSidebarInteractionMode] = useState<'keyboard' | 'pointer'>('pointer');
	const [keyboardFocusRegion, setKeyboardFocusRegion] = useState<KeyboardFocusRegion>(null);
	const [forwardToast, setForwardToast] = useState<ForwardToastState | null>(null);
	const [errorToast, setErrorToast] = useState<ToastOptions | null>(null);
	const errorToastTimerRef = useRef<number | null>(null);
	const previousEffectiveSidebarCollapsedRef = useRef<boolean | null>(null);
	const [pendingForwardJumpRoomId, setPendingForwardJumpRoomId] = useState<string | null>(null);
	const [pendingDirectConversationFocusRoomId, setPendingDirectConversationFocusRoomId] = useState<string | null>(null);
	const [pendingSidebarRevealRoomId, setPendingSidebarRevealRoomId] = useState<string | null>(roomId ?? null);
	const [roomPendingSendCounts, setRoomPendingSendCounts] = useState<Record<string, number>>({});
	const [realtimeStatus, setRealtimeStatus] = useState<BetterChatRealtimeStatus>({
		kind: 'connecting',
	});
	const [sessionLifecycle, setSessionLifecycle] = useState<SessionLifecycleState>('active');

	const updateKeyboardFocusRegion = useCallback((nextRegionOrUpdater: KeyboardFocusRegionUpdater) => {
		const nextRegion =
			typeof nextRegionOrUpdater === 'function'
				? nextRegionOrUpdater(keyboardFocusRegionRef.current)
				: nextRegionOrUpdater;
		if (nextRegion === 'sidebar-list') {
			interactionEpochRef.current += 1;
			lastSidebarFocusEpochRef.current = interactionEpochRef.current;
		}
		keyboardFocusRegionRef.current = nextRegion;
		setKeyboardFocusRegion(nextRegion);
		return nextRegion;
	}, []);
	const updateSidebarInteractionMode = useCallback((nextInteractionMode: 'keyboard' | 'pointer') => {
		if (sidebarInteractionModeRef.current === nextInteractionMode) {
			return nextInteractionMode;
		}

		sidebarInteractionModeRef.current = nextInteractionMode;
		setSidebarInteractionMode(nextInteractionMode);
		return nextInteractionMode;
	}, []);
	const favoriteOverridesEnabled = betterChatApi.mode === 'fixture';
	const sessionActive = sessionLifecycle === 'active';
	const apiModePollingEnabled = betterChatApi.mode === 'api' && sessionActive;
	const browserNotificationBackgroundAvailable = useMemo(() => browserNotificationBackgroundSupported(), []);
	const effectiveBrowserNotificationDelivery = useMemo(
		() => resolveEffectiveBrowserNotificationDelivery({ delivery: browserNotificationDelivery }),
		[browserNotificationDelivery],
	);
	const composerHeightBounds = useMemo(
		() =>
			resolveComposerEditorHeightBounds({
				conversationBodyHeight,
			}),
		[conversationBodyHeight],
	);
	const resolvedComposerEditorHeight = clampComposerEditorHeight(composerEditorHeight, composerHeightBounds);
	const activeRoomKey = roomId ?? null;
	const composerReady = activeRoomKey !== null && composerReadyRoomId === activeRoomKey;
	const composerFocused = activeRoomKey !== null && composerFocusedRoomId === activeRoomKey;
	const composerSectionStyle = useMemo(
		() =>
			({
				'--composer-editor-height': formatComposerEditorHeightCssValue(
					composerResizeDragging ? composerLiveHeightRef.current : resolvedComposerEditorHeight,
				),
			}) as CSSProperties,
		[composerResizeDragging, resolvedComposerEditorHeight],
	);

	const bootstrapQuery = useQuery({
		enabled: sessionActive,
		queryKey: betterChatQueryKeys.workspace,
		queryFn: () => betterChatApi.workspace(),
		retry: false,
	});
	const realtimePushEnabled = apiModePollingEnabled && (bootstrapQuery.data?.capabilities.realtimeEnabled ?? false);
	const sidebarPollingInterval = resolveApiPollingInterval({
		baseIntervalMs: apiSidebarPollingIntervalMs,
		pushEnabled: realtimePushEnabled,
		realtimeStatus,
	});
	const roomDetailsPollingInterval = resolveApiPollingInterval({
		baseIntervalMs: apiRoomDetailsPollingIntervalMs,
		pushEnabled: realtimePushEnabled,
		realtimeStatus,
	});
	const roomTimelinePollingInterval = resolveApiPollingInterval({
		baseIntervalMs: apiRoomTimelinePollingIntervalMs,
		pushEnabled: realtimePushEnabled,
		realtimeStatus,
	});

	const sidebarQuery = useQuery({
		enabled: sessionActive,
		queryKey: betterChatQueryKeys.roomList,
		queryFn: () => betterChatApi.roomList(),
		retry: false,
		refetchInterval: apiModePollingEnabled ? sidebarPollingInterval : false,
		refetchIntervalInBackground: apiModePollingEnabled,
	});

	const roomDetailsQuery = useQuery({
		queryKey: roomId ? betterChatQueryKeys.room(roomId) : ['room', 'empty'],
		queryFn: () => betterChatApi.room(roomId!),
		enabled: sessionActive && Boolean(roomId),
		retry: false,
		refetchInterval: apiModePollingEnabled && roomId ? roomDetailsPollingInterval : false,
		refetchIntervalInBackground: apiModePollingEnabled,
	});

	const roomTimelineQuery = useQuery({
		queryKey: roomId ? betterChatQueryKeys.roomTimeline(roomId) : ['room-timeline', 'empty'],
		queryFn: () => betterChatApi.roomTimeline(roomId!),
		enabled: sessionActive && Boolean(roomId),
		retry: false,
		refetchInterval: apiModePollingEnabled && roomId ? roomTimelinePollingInterval : false,
		refetchIntervalInBackground: apiModePollingEnabled,
	});
	const roomParticipantsQuery = useQuery({
		queryKey: roomId ? betterChatQueryKeys.roomParticipants(roomId) : ['room-participants', 'empty'],
		queryFn: () => loadAllRoomParticipants(roomId!),
		enabled: sessionActive && Boolean(roomId),
		retry: false,
		staleTime: roomParticipantsStaleTimeMs,
	});
	const timelineAuthorDirectConversationQuery = useQuery({
		queryKey: activeTimelineAuthorUserId
			? betterChatQueryKeys.directConversation(activeTimelineAuthorUserId)
			: ['direct-conversation', 'empty'],
		queryFn: () => betterChatApi.directConversationLookup(activeTimelineAuthorUserId!),
		enabled: sessionActive && Boolean(activeTimelineAuthorUserId),
		retry: false,
		staleTime: directConversationLookupStaleTimeMs,
	});

	useEffect(() => {
		activeRoomIdRef.current = roomId;
	}, [roomId]);

	useEffect(() => {
		setActiveTimelineAuthorUserId(null);
	}, [roomId]);

	useEffect(() => {
		preloadLiveMarkdownEditor();
	}, []);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}

		const syncViewportWidth = () => {
			setViewportWidth(window.innerWidth);
		};

		syncViewportWidth();
		window.addEventListener('resize', syncViewportWidth);
		return () => window.removeEventListener('resize', syncViewportWidth);
	}, []);

	useEffect(() => {
		setBrowserNotificationPermission(resolveBrowserNotificationPermissionState());
	}, []);

	const applyComposerEditorHeightToSection = useCallback((nextHeight: number) => {
		composerLiveHeightRef.current = nextHeight;
		composerSectionRef.current?.style.setProperty('--composer-editor-height', formatComposerEditorHeightCssValue(nextHeight));
	}, []);

	const flushComposerHeightPreview = useCallback(() => {
		if (typeof window !== 'undefined' && composerResizeFrameRef.current !== null) {
			window.cancelAnimationFrame(composerResizeFrameRef.current);
			composerResizeFrameRef.current = null;
		}

		const pendingHeight = composerResizePendingHeightRef.current;
		if (pendingHeight !== null) {
			applyComposerEditorHeightToSection(pendingHeight);
			composerResizePendingHeightRef.current = null;
		}
	}, [applyComposerEditorHeightToSection]);

	const clearComposerResizeGlobalListeners = useCallback(() => {
		if (typeof window === 'undefined') {
			composerResizeGlobalListenersRef.current = null;
			return;
		}

		const listeners = composerResizeGlobalListenersRef.current;
		if (!listeners) {
			return;
		}

		window.removeEventListener('pointermove', listeners.move, true);
		window.removeEventListener('pointerup', listeners.stop, true);
		window.removeEventListener('pointercancel', listeners.stop, true);
		composerResizeGlobalListenersRef.current = null;
	}, []);

	const previewComposerHeight = useCallback(
		(nextHeight: number) => {
			const clampedHeight = clampComposerEditorHeight(nextHeight, composerHeightBounds);
			composerLiveHeightRef.current = clampedHeight;
			composerResizePendingHeightRef.current = clampedHeight;

			if (typeof window === 'undefined') {
				applyComposerEditorHeightToSection(clampedHeight);
				composerResizePendingHeightRef.current = null;
				return clampedHeight;
			}

			if (composerResizeFrameRef.current !== null) {
				return clampedHeight;
			}

			composerResizeFrameRef.current = window.requestAnimationFrame(() => {
				composerResizeFrameRef.current = null;
				const pendingHeight = composerResizePendingHeightRef.current;
				if (pendingHeight === null) {
					return;
				}

				applyComposerEditorHeightToSection(pendingHeight);
				composerResizePendingHeightRef.current = null;
			});

			return clampedHeight;
		},
		[applyComposerEditorHeightToSection, composerHeightBounds],
	);

	useLayoutEffect(() => {
		if (composerResizeDragging) {
			return;
		}

		applyComposerEditorHeightToSection(resolvedComposerEditorHeight);
	}, [applyComposerEditorHeightToSection, composerResizeDragging, resolvedComposerEditorHeight]);

	useEffect(
		() => () => {
			if (typeof window !== 'undefined' && composerResizeFrameRef.current !== null) {
				window.cancelAnimationFrame(composerResizeFrameRef.current);
			}

			clearComposerResizeGlobalListeners();
		},
		[],
	);

	useEffect(() => {
		if (!composerResizeDragging || typeof document === 'undefined') {
			return;
		}

		const previousCursor = document.body.style.cursor;
		const previousUserSelect = document.body.style.userSelect;
		document.body.style.cursor = 'row-resize';
		document.body.style.userSelect = 'none';

		return () => {
			document.body.style.cursor = previousCursor;
			document.body.style.userSelect = previousUserSelect;
		};
	}, [composerResizeDragging]);

	const closeRealtimeController = useCallback(() => {
		realtimeControllerRef.current?.close();
		realtimeControllerRef.current = null;
		setRealtimeStatus({ kind: 'stopped' });
	}, []);

	const quiesceSession = useCallback(() => {
		setSessionLifecycle((currentLifecycle) => (currentLifecycle === 'active' ? 'closing' : currentLifecycle));
		closeRealtimeController();
		void queryClient.cancelQueries();
	}, [closeRealtimeController, queryClient]);

	const resetSessionAndReturnToLogin = useCallback(() => {
		setSessionLifecycle('logged-out');
		closeRealtimeController();
		queryClient.clear();
		void navigate({
			to: '/login',
			replace: true,
		});
	}, [closeRealtimeController, navigate, queryClient]);

	useEffect(() => {
		if (!sessionActive) {
			return;
		}

		const unauthorizedError = [bootstrapQuery.error, sidebarQuery.error].find(
			(error) => isBetterChatApiError(error) && error.code === 'UNAUTHENTICATED',
		);

		if (!unauthorizedError) {
			return;
		}

		resetSessionAndReturnToLogin();
	}, [bootstrapQuery.error, resetSessionAndReturnToLogin, sessionActive, sidebarQuery.error]);

	useEffect(() => {
		setRoomInfoOpen(false);
		setRoomAlertMenuOpen(false);
		setComposerReplyTarget(null);
		setComposerEditTarget(null);
		setForwardDialogSource(null);
		setDeleteDialogSource(null);
	}, [roomId]);

	useEffect(() => {
		if (!roomAlertMenuOpen || typeof document === 'undefined') {
			return;
		}

		const handlePointerDown = (event: MouseEvent | PointerEvent | TouchEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}

			if (roomAlertMenuRef.current?.contains(target) || roomAlertToggleRef.current?.contains(target)) {
				return;
			}

			setRoomAlertMenuOpen(false);
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') {
				return;
			}

			setRoomAlertMenuOpen(false);
			roomAlertToggleRef.current?.focus();
		};

		document.addEventListener('mousedown', handlePointerDown, true);
		document.addEventListener('touchstart', handlePointerDown, true);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('mousedown', handlePointerDown, true);
			document.removeEventListener('touchstart', handlePointerDown, true);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [roomAlertMenuOpen]);

	useEffect(() => {
		if (!roomInfoOpen && !settingsOpen) {
			return;
		}

		setRoomAlertMenuOpen(false);
	}, [roomInfoOpen, settingsOpen]);

	useEffect(
		() => () => {
			if (forwardToastTimerRef.current) {
				window.clearTimeout(forwardToastTimerRef.current);
				forwardToastTimerRef.current = null;
			}

			if (errorToastTimerRef.current) {
				window.clearTimeout(errorToastTimerRef.current);
				errorToastTimerRef.current = null;
			}

			optimisticPreviewUrlsRef.current.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
			optimisticPreviewUrlsRef.current.clear();
		},
		[],
	);

	useEffect(() => {
		roomLocalMessagesRef.current = roomLocalMessages;
	}, [roomLocalMessages]);

	useEffect(() => {
		roomOlderHistoryRef.current = roomOlderHistory;
	}, [roomOlderHistory]);

	useEffect(() => {
		roomOlderHistoryLoadingRef.current = roomOlderHistoryLoading;
	}, [roomOlderHistoryLoading]);

	useEffect(() => {
		saveComposerSendShortcut(composerSendShortcut);
	}, [composerSendShortcut]);

	useEffect(() => {
		if (!favoriteOverridesEnabled) {
			return;
		}

		saveFavoriteOverrides(favoriteOverrides);
	}, [favoriteOverrides, favoriteOverridesEnabled]);

	useEffect(() => {
		saveRoomAlertPreferences(roomAlertPreferences);
	}, [roomAlertPreferences]);

	useEffect(() => {
		saveRoomNotificationDefaults(roomNotificationDefaults);
	}, [roomNotificationDefaults]);

	useEffect(() => {
		saveBrowserNotificationDelivery(browserNotificationDelivery);
	}, [browserNotificationDelivery]);

	useEffect(() => {
		applyDocumentMotionPreference(motionPreference);
	}, [motionPreference]);

	const rawSidebarEntries = sidebarQuery.data?.rooms ?? [];
	const sidebarEntries = useMemo(
		() => (favoriteOverridesEnabled ? applyFavoriteOverrides(rawSidebarEntries, favoriteOverrides) : [...rawSidebarEntries]),
		[favoriteOverrides, favoriteOverridesEnabled, rawSidebarEntries],
	);
	const sidebarOrderingState = useMemo(
		() =>
			deriveSidebarOrderingState({
				activeRoomId: roomId,
				nextEntries: sidebarEntries,
				previousEntries: previousSidebarOrderEntriesRef.current,
				previousState: previousSidebarOrderingStateRef.current,
			}),
		[roomId, sidebarEntries],
	);
	useEffect(() => {
		previousSidebarOrderEntriesRef.current = sidebarEntries;
		previousSidebarOrderingStateRef.current = sidebarOrderingState;
	}, [sidebarEntries, sidebarOrderingState]);
	const sidebarGroups = useMemo(
		() => buildSidebarGroups(sidebarEntries, searchValue, roomAlertPreferences, sidebarOrderingState, roomId, roomNotificationDefaults),
		[roomAlertPreferences, roomId, roomNotificationDefaults, searchValue, sidebarEntries, sidebarOrderingState],
	);
	const sidebarAttentionDock = useMemo(
		() =>
			buildSidebarAttentionDock(sidebarEntries, {
				activeRoomId: roomId,
				notificationDefaults: roomNotificationDefaults,
				notificationPreferences: roomAlertPreferences,
			}),
		[roomAlertPreferences, roomId, roomNotificationDefaults, sidebarEntries],
	);
	const realtimeWatchState = useMemo(() => {
		const watchedRooms: WatchedRoomState[] = [];

		if (roomId) {
			const cachedRoomDetails =
				queryClient.getQueryData<RoomSnapshot>(betterChatQueryKeys.room(roomId)) ?? roomDetailsQuery.data ?? undefined;
			const cachedRoomTimeline =
				queryClient.getQueryData<RoomTimelineSnapshot>(betterChatQueryKeys.roomTimeline(roomId)) ?? roomTimelineQuery.data ?? undefined;
			watchedRooms.push({
				roomId,
				...(cachedRoomDetails?.version ? { roomVersion: cachedRoomDetails.version } : {}),
				...(cachedRoomTimeline?.version ? { timelineVersion: cachedRoomTimeline.version } : {}),
			});
		}

		return {
			directoryVersion: sidebarQuery.data?.version,
			rooms: watchedRooms,
		};
	}, [queryClient, roomDetailsQuery.data, roomId, roomTimelineQuery.data, sidebarQuery.data?.version]);
	const visibleSidebarRoomIds = useMemo(
		() => sidebarGroups.flatMap((group) => group.entries.map((entry) => entry.id)),
		[sidebarGroups],
	);
	const firstSearchResult = useMemo(() => sidebarGroups.flatMap((group) => group.entries)[0], [sidebarGroups]);
	const activeEntryServer = useMemo(() => rawSidebarEntries.find((entry) => entry.id === roomId) ?? null, [roomId, rawSidebarEntries]);
	const activeEntry = useMemo(() => sidebarEntries.find((entry) => entry.id === roomId) ?? null, [roomId, sidebarEntries]);
	const roomKind = roomDetailsQuery.data?.room.kind ?? activeEntry?.kind ?? 'channel';
	const activeEntrySecondaryMeta = useMemo(
		() => (activeEntry ? resolveSidebarSecondaryMeta(activeEntry) : { presence: null, presenceLabel: null, text: '' }),
		[activeEntry],
	);
	const activeRoomPresence = useMemo(
		() => resolveUserPresence(roomDetailsQuery.data?.room.presence ?? activeEntry?.presence ?? activeEntrySecondaryMeta.presence?.tone),
		[activeEntry?.presence, activeEntrySecondaryMeta.presence?.tone, roomDetailsQuery.data?.room.presence],
	);
	const currentUser = bootstrapQuery.data?.currentUser ?? null;
	const currentUserId = bootstrapQuery.data?.currentUser.id ?? null;
	const activeRoomHandle = useMemo(
		() =>
			resolveDirectMessageHandle({
				currentUserId,
				roomKind,
				roomSubtitle: roomDetailsQuery.data?.room.subtitle,
				sidebarSubtitle: activeEntry?.subtitle,
				timelineMessages: roomTimelineQuery.data?.messages,
			}),
		[currentUserId, roomKind, roomDetailsQuery.data?.room.subtitle, activeEntry?.subtitle, roomTimelineQuery.data?.messages],
	);
	const activeRoomHeaderPresenceText = useMemo(
		() =>
			roomKind === 'dm'
				? resolveRoomHeaderPresenceText({
						handle: activeRoomHandle,
						presence: activeRoomPresence,
				  })
				: null,
		[activeRoomHandle, activeRoomPresence, roomKind],
	);

	useEffect(() => {
		if (roomId || !sidebarEntries.length) {
			return;
		}

		const defaultRoomId = getDefaultRoomId(sidebarEntries);
		if (!defaultRoomId) {
			return;
		}

		void navigate({
			to: '/app/rooms/$roomId',
			params: { roomId: defaultRoomId },
			replace: true,
		});
	}, [navigate, roomId, sidebarEntries]);

	useEffect(() => {
		setFocusedSidebarRoomId((currentRoomId) => {
			if (currentRoomId && visibleSidebarRoomIds.includes(currentRoomId)) {
				return currentRoomId;
			}

			if (roomId && visibleSidebarRoomIds.includes(roomId)) {
				return roomId;
			}

			return visibleSidebarRoomIds[0] ?? null;
		});
	}, [roomId, visibleSidebarRoomIds]);

	const setSidebarRoomRef = useCallback(
		(targetRoomId: string) => (node: HTMLButtonElement | null) => {
			if (node) {
				sidebarRoomRefs.current.set(targetRoomId, node);
				return;
			}

			sidebarRoomRefs.current.delete(targetRoomId);
		},
		[],
	);

	const markSidebarKeyboardInteraction = useCallback(() => {
		updateSidebarInteractionMode('keyboard');
	}, [updateSidebarInteractionMode]);

	const markSidebarPointerInteraction = useCallback(() => {
		updateSidebarInteractionMode('pointer');
	}, [updateSidebarInteractionMode]);

	const focusSidebarSearch = useCallback(
		({ select = false }: { select?: boolean } = {}) => {
			const searchInput = searchInputRef.current;
			if (!searchInput) {
				return false;
			}

			markSidebarKeyboardInteraction();
			updateKeyboardFocusRegion(null);
			searchInput.focus();
			if (select) {
				searchInput.select();
			}

			return true;
		},
		[markSidebarKeyboardInteraction, updateKeyboardFocusRegion],
	);

	const focusSidebarRoom = useCallback(
		(targetRoomId: string | null, interactionMode: 'keyboard' | 'pointer' = 'keyboard') => {
			if (!targetRoomId) {
				return false;
			}

			const roomButton = sidebarRoomRefs.current.get(targetRoomId);
			if (!roomButton) {
				return false;
			}

			if (interactionMode === 'keyboard') {
				markSidebarKeyboardInteraction();
			} else {
				markSidebarPointerInteraction();
			}

			updateKeyboardFocusRegion('sidebar-list');
			setFocusedSidebarRoomId(targetRoomId);
			roomButton.focus({ preventScroll: true });
			return true;
		},
		[markSidebarKeyboardInteraction, markSidebarPointerInteraction, updateKeyboardFocusRegion],
	);

	const shouldIgnoreHeldSidebarArrowNavigation = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
			return false;
		}

		const resolution = resolveHeldArrowNavigationAllowance({
			key: event.key,
			lastState: sidebarHeldArrowNavigationRef.current,
			now: event.timeStamp,
			repeat: event.repeat,
		});
		sidebarHeldArrowNavigationRef.current = resolution.nextState;
		if (resolution.allow) {
			return false;
		}

		event.preventDefault();
		return true;
	}, []);

	const focusTimeline = useCallback((strategy: TimelineFocusStrategy = 'preferred') => {
		if ((Boolean(roomId) && (roomDetailsQuery.isLoading || roomTimelineQuery.isLoading)) || !roomTimelineQuery.data) {
			return false;
		}

		updateKeyboardFocusRegion('timeline');
		setTimelineFocusRequest((currentRequest) => ({
			strategy,
			token: currentRequest.token + 1,
		}));
		return true;
	}, [roomDetailsQuery.isLoading, roomId, roomTimelineQuery.data, roomTimelineQuery.isLoading, updateKeyboardFocusRegion]);

	const focusComposer = useCallback(() => {
		if (!roomTimelineQuery.data || !composerReady) {
			return false;
		}

		updateKeyboardFocusRegion('composer');
		if (composerBarRef.current?.focus()) {
			return true;
		}

		setComposerFocusToken((currentToken) => currentToken + 1);
		return true;
	}, [composerReady, roomTimelineQuery.data, updateKeyboardFocusRegion]);

	const handleComposerFocusChange = useCallback(
		(focused: boolean) => {
			const scopedRoomId = roomId ?? null;
			setComposerFocusedRoomId((currentRoomId) => {
				if (focused) {
					return scopedRoomId;
				}

				return currentRoomId === scopedRoomId ? null : currentRoomId;
			});
			updateKeyboardFocusRegion((currentRegion) => (focused ? 'composer' : currentRegion === 'composer' ? null : currentRegion));
		},
		[roomId, updateKeyboardFocusRegion],
	);

	const handleComposerReadyChange = useCallback(
		(ready: boolean) => {
			const scopedRoomId = roomId ?? null;
			setComposerReadyRoomId((currentRoomId) => {
				if (ready) {
					return scopedRoomId;
				}

				return currentRoomId === scopedRoomId ? null : currentRoomId;
			});
		},
		[roomId],
	);

	const focusRoomHeaderControl = useCallback((control: RoomHeaderControl = 'favorite') => {
		const targetNode =
			control === 'info'
				? roomInfoTriggerRef.current
				: control === 'alert'
					? roomAlertToggleRef.current
					: favoriteToggleRef.current;
		if (!targetNode) {
			return false;
		}

		updateKeyboardFocusRegion('header');
		targetNode.focus();
		return true;
	}, [updateKeyboardFocusRegion]);

	const focusSidebarFromResizeHandle = useCallback(() => {
		if (focusSidebarRoom(focusedSidebarRoomId ?? roomId ?? visibleSidebarRoomIds[0] ?? null)) {
			return true;
		}

		return focusSidebarSearch();
	}, [focusSidebarRoom, focusSidebarSearch, focusedSidebarRoomId, roomId, visibleSidebarRoomIds]);

	const {
		clearSidebarResizeKeyboardAdjusting,
		effectiveSidebarCollapsed,
		expandSidebar,
		handleSidebarResizeDoubleClick,
		handleSidebarResizeKeyDown,
		handleSidebarResizePointerDown,
		handleSidebarResizePointerMove,
		sidebarCollapsed,
		sidebarResizeDragging,
		sidebarResizeEnabled,
		sidebarResizeKeyboardAdjusting,
		sidebarWidthBounds,
		stopSidebarResize,
		toggleSidebarCollapse,
		visibleSidebarWidth,
		workspaceStyle,
	} = useSidebarInteractionController({
		focusSidebarFromResizeHandle,
		focusTimeline,
		markSidebarPointerInteraction,
		roomInfoOpen,
		sidebarRef,
		viewportWidth,
		workspaceRef,
	});

	useEffect(() => {
		setPendingSidebarRevealRoomId(roomId ?? null);
	}, [roomId]);

	useEffect(() => {
		const previousCollapsed = previousEffectiveSidebarCollapsedRef.current;
		previousEffectiveSidebarCollapsedRef.current = effectiveSidebarCollapsed;
		if (previousCollapsed === null || !previousCollapsed || effectiveSidebarCollapsed || !roomId) {
			return;
		}

		setPendingSidebarRevealRoomId(roomId);
	}, [effectiveSidebarCollapsed, roomId]);

	useLayoutEffect(() => {
		if (!pendingSidebarRevealRoomId || effectiveSidebarCollapsed) {
			return;
		}

		const sidebarBody = sidebarBodyRef.current;
		const roomButton = sidebarRoomRefs.current.get(pendingSidebarRevealRoomId);
		if (!sidebarBody || !roomButton) {
			return;
		}

		revealSidebarRoomInContainer({
			container: sidebarBody,
			motionDisabled: isDocumentMotionDisabled(),
			roomButton,
		});
		setPendingSidebarRevealRoomId((currentRoomId) => (currentRoomId === pendingSidebarRevealRoomId ? null : currentRoomId));
	}, [effectiveSidebarCollapsed, pendingSidebarRevealRoomId, visibleSidebarRoomIds]);

	useEffect(() => {
		const handlePointerRegion = (event: PointerEvent) => {
			if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
				return;
			}

			const target = event.target;
			const nextRegion = target instanceof Element ? resolveElementKeyboardRegion(target) : null;
			const previousRegion = pointerRegionRef.current;
			if (
				shouldIgnorePointerRegionMove({
					eventType: event.type === 'pointerdown' ? 'pointerdown' : 'pointermove',
					lastSidebarFocusEpoch: lastSidebarFocusEpochRef.current,
					lastTimelinePointerEpoch: lastTimelinePointerEpochRef.current,
					nextRegion,
					previousRegion,
				})
			) {
				return;
			}

			pointerRegionRef.current = nextRegion;
			if (
				shouldRefreshTimelinePointerEpoch({
					eventType: event.type === 'pointerdown' ? 'pointerdown' : 'pointermove',
					lastSidebarFocusEpoch: lastSidebarFocusEpochRef.current,
					lastTimelinePointerEpoch: lastTimelinePointerEpochRef.current,
					nextRegion,
					previousRegion,
				})
			) {
				interactionEpochRef.current += 1;
				lastTimelinePointerEpochRef.current = interactionEpochRef.current;
			}
		};

		window.addEventListener('pointermove', handlePointerRegion, {
			capture: true,
			passive: true,
		});
		window.addEventListener('pointerdown', handlePointerRegion, {
			capture: true,
			passive: true,
		});

		return () => {
			window.removeEventListener('pointermove', handlePointerRegion, true);
			window.removeEventListener('pointerdown', handlePointerRegion, true);
		};
	}, []);

	useEffect(() => {
		const handlePointerTimelineKeyboardEntry = (event: KeyboardEvent) => {
			if (event.isComposing || hasOpenBlockingDialog()) {
				return;
			}

			if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
				return;
			}

			if (!['ArrowDown', 'ArrowUp', 'End', 'Home'].includes(event.key)) {
				return;
			}

			if (pointerRegionRef.current !== 'timeline') {
				return;
			}

			const activeElement = document.activeElement;
			if (isEditableElement(activeElement)) {
				return;
			}

			const activeRegion = resolveElementKeyboardRegion(activeElement);
			const allowSidebarPointerHandoff =
				activeRegion === 'sidebar-list' && lastTimelinePointerEpochRef.current > lastSidebarFocusEpochRef.current;
			if (activeRegion !== null && !allowSidebarPointerHandoff) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			void focusTimeline(
				event.key === 'Home' ? 'first-message' : event.key === 'End' ? 'unread-or-latest' : 'pointer-anchor',
			);
		};

		window.addEventListener('keydown', handlePointerTimelineKeyboardEntry, true);
		return () => window.removeEventListener('keydown', handlePointerTimelineKeyboardEntry, true);
	}, [focusTimeline]);

	const commitComposerHeight = useCallback(
		(nextHeight: number) => {
			const clampedHeight = clampComposerEditorHeight(nextHeight, composerHeightBounds);
			flushComposerHeightPreview();
			applyComposerEditorHeightToSection(clampedHeight);
			setComposerEditorHeight((currentHeight) => (currentHeight === clampedHeight ? currentHeight : clampedHeight));
			saveComposerEditorHeightPreference(clampedHeight);
			return clampedHeight;
		},
		[applyComposerEditorHeightToSection, composerHeightBounds, flushComposerHeightPreview],
	);

	const stopComposerResize = useCallback(
		(pointerId?: number) => {
			const resizeState = composerResizeStateRef.current;
			if (pointerId !== undefined && resizeState?.pointerId !== pointerId) {
				return;
			}

			clearComposerResizeGlobalListeners();

			if (resizeState) {
				commitComposerHeight(resizeState.currentHeight);
			}

			composerResizeStateRef.current = null;
			setComposerResizeDragging(false);
		},
		[clearComposerResizeGlobalListeners, commitComposerHeight],
	);

	const handleComposerResizePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) {
				return;
			}

			event.preventDefault();
			updateKeyboardFocusRegion('composer');
			setComposerResizeKeyboardAdjusting(false);
			composerResizeStateRef.current = {
				currentHeight: composerLiveHeightRef.current,
				pointerId: event.pointerId,
				startHeight: composerLiveHeightRef.current,
				startY: event.clientY,
			};
			clearComposerResizeGlobalListeners();
			if (typeof window !== 'undefined') {
				const handleWindowPointerMove = (moveEvent: PointerEvent) => {
					const resizeState = composerResizeStateRef.current;
					if (!resizeState || moveEvent.pointerId !== resizeState.pointerId) {
						return;
					}

					resizeState.currentHeight = previewComposerHeight(
						resolveComposerEditorResizeHeight({
							bounds: composerHeightBounds,
							currentY: moveEvent.clientY,
							startHeight: resizeState.startHeight,
							startY: resizeState.startY,
						}),
					);
				};
				const handleWindowPointerStop = (stopEvent: PointerEvent) => {
					stopComposerResize(stopEvent.pointerId);
				};
				composerResizeGlobalListenersRef.current = {
					move: handleWindowPointerMove,
					stop: handleWindowPointerStop,
				};
				window.addEventListener('pointermove', handleWindowPointerMove, true);
				window.addEventListener('pointerup', handleWindowPointerStop, true);
				window.addEventListener('pointercancel', handleWindowPointerStop, true);
			}
			setComposerResizeDragging(true);
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[clearComposerResizeGlobalListeners, composerHeightBounds, previewComposerHeight, stopComposerResize, updateKeyboardFocusRegion],
	);

	const handleComposerResizePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			const resizeState = composerResizeStateRef.current;
			if (!resizeState || resizeState.pointerId !== event.pointerId) {
				return;
			}

			event.preventDefault();
			resizeState.currentHeight = previewComposerHeight(
				resolveComposerEditorResizeHeight({
					bounds: composerHeightBounds,
					currentY: event.clientY,
					startHeight: resizeState.startHeight,
					startY: resizeState.startY,
				}),
			);
		},
		[composerHeightBounds, previewComposerHeight],
	);

	const handleComposerResizeKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				setComposerResizeKeyboardAdjusting((currentState) => !currentState);
				return;
			}

			if (event.key === 'Escape' && composerResizeKeyboardAdjusting) {
				event.preventDefault();
				setComposerResizeKeyboardAdjusting(false);
				return;
			}

			if (!composerResizeKeyboardAdjusting) {
				if (event.key === 'ArrowUp') {
					event.preventDefault();
					void focusTimeline('bottom-visible');
					return;
				}

				if (event.key === 'ArrowDown') {
					event.preventDefault();
					void focusComposer();
				}

				return;
			}

			const step = event.shiftKey ? 48 : 20;
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				commitComposerHeight(resolvedComposerEditorHeight - step);
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				commitComposerHeight(resolvedComposerEditorHeight + step);
				return;
			}

			if (event.key === 'Home') {
				event.preventDefault();
				commitComposerHeight(composerHeightBounds.min);
				return;
			}

			if (event.key === 'End') {
				event.preventDefault();
				commitComposerHeight(composerHeightBounds.max);
			}
		},
		[
			commitComposerHeight,
			composerHeightBounds.max,
			composerHeightBounds.min,
			composerResizeKeyboardAdjusting,
			focusComposer,
			focusTimeline,
			resolvedComposerEditorHeight,
		],
	);

	const clearForwardToast = useCallback(() => {
		if (forwardToastTimerRef.current) {
			window.clearTimeout(forwardToastTimerRef.current);
			forwardToastTimerRef.current = null;
		}

		setForwardToast(null);
	}, []);

	const showErrorToast = useCallback((options: ToastOptions) => {
		if (errorToastTimerRef.current) {
			window.clearTimeout(errorToastTimerRef.current);
			errorToastTimerRef.current = null;
		}

		setErrorToast(options);

		errorToastTimerRef.current = window.setTimeout(() => {
			errorToastTimerRef.current = null;
			setErrorToast((current) => (current?.message === options.message ? null : current));
		}, 4000);
	}, []);

	const clearErrorToast = useCallback(() => {
		if (errorToastTimerRef.current) {
			window.clearTimeout(errorToastTimerRef.current);
			errorToastTimerRef.current = null;
		}
		setErrorToast(null);
	}, []);

	const closeRoomInfoSidebarToTarget = useCallback(
		(target: 'none' | 'timeline' | 'info' = 'none') => {
			setRoomInfoOpen(false);

			if (target === 'none') {
				return;
			}

			window.requestAnimationFrame(() => {
				if (target === 'info') {
					roomInfoTriggerRef.current?.focus();
					return;
				}

				void focusTimeline();
			});
		},
		[focusTimeline],
	);

	const openRoom = useCallback(
		(targetRoomId: string) => {
			setSearchValue('');
			void navigate({
				to: '/app/rooms/$roomId',
				params: { roomId: targetRoomId },
			});
		},
		[navigate],
	);
	const emitRoomNotification = useCallback(
		({
			body,
			roomId: targetRoomId,
			tag,
			title,
		}: {
			body: string;
			roomId: string;
			tag: string;
			title: string;
		}) => {
			const notification = new window.Notification(spaceText(title), {
				body: spaceText(body),
				tag,
			});
			notification.onclick = () => {
				window.focus();
				openRoom(targetRoomId);
				notification.close();
			};
		},
		[openRoom],
	);
	const emitRoomMessageNotifications = useCallback(
		({
			entry,
			messages,
		}: {
			entry: Pick<RoomSummary, 'id' | 'title'>;
			messages: SidebarNotificationMessageCandidate[];
		}) => {
			for (const message of messages) {
				emitRoomNotification({
					body: resolveSidebarBrowserNotificationMessageBody(message),
					roomId: entry.id,
					tag: `betterchat-room-${entry.id}-message-${message.id}`,
					title: entry.title,
				});
			}

			const latestNotifiedMessage = messages.at(-1);
			if (latestNotifiedMessage) {
				roomNotificationLastMessageIdRef.current[entry.id] = latestNotifiedMessage.id;
			}
		},
		[emitRoomNotification],
	);
	const rememberLatestRoomNotificationBaseline = useCallback(
		({
			messages,
			roomId: targetRoomId,
		}: {
			messages: readonly SidebarNotificationMessageCandidate[];
			roomId: string;
		}) => {
			const latestExternalMessage = [...messages].reverse().find((message) => message.author.id !== currentUserId);
			if (!latestExternalMessage) {
				return;
			}

			roomNotificationLastMessageIdRef.current[targetRoomId] = latestExternalMessage.id;
		},
		[currentUserId],
	);
	useEffect(() => {
		browserNotificationEffectsMountedRef.current = true;
		return () => {
			browserNotificationEffectsMountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		const nextSidebarEntries = new Map(sidebarEntries.map((entry) => [entry.id, entry] as const));
		const previousSidebarEntries = previousSidebarEntriesRef.current;
		previousSidebarEntriesRef.current = nextSidebarEntries;

		if (
			previousSidebarEntries === null ||
			typeof window === 'undefined' ||
			!isBrowserNotificationDeliveryEnabled({
				delivery: effectiveBrowserNotificationDelivery,
				permission: browserNotificationPermission,
			})
		) {
			return;
		}

		const { pageFocused, pageVisible } = resolveBrowserNotificationPageState();

		const notifyForEntry = async (entry: RoomSummary, previousEntry: RoomSummary | null, preference: RoomAlertPreference) => {
			if (roomNotificationInflightRef.current.has(entry.id)) {
				return;
			}

			const fetchCount = resolveSidebarNotificationFetchCount({
				nextEntry: entry,
				previousEntry,
			});
			if (fetchCount <= 0) {
				return;
			}

			roomNotificationInflightRef.current.add(entry.id);
			try {
				const fallbackBody = resolveSidebarBrowserNotificationBody(entry);
				try {
					const timeline = await betterChatApi.roomTimeline(entry.id, {
						limit: Math.max(fetchCount + 4, 10),
					});
					if (!browserNotificationEffectsMountedRef.current) {
						return;
					}

					const messagesToNotify = resolveSidebarNotificationMessages({
						currentUser,
						entry,
						lastNotifiedMessageId: roomNotificationLastMessageIdRef.current[entry.id] ?? null,
						limit: fetchCount,
						messages: timeline.messages,
						preference,
					});
					if (messagesToNotify.length === 0) {
						return;
					}

					emitRoomMessageNotifications({
						entry,
						messages: messagesToNotify,
					});
					return;
				} catch {
					if (!browserNotificationEffectsMountedRef.current) {
						return;
					}

					if (
						shouldFallbackNotifyForSidebarEntry({
							currentRoomId: roomId ?? null,
							nextEntry: entry,
							pageFocused,
							pageVisible,
							previousEntry,
							preference,
						})
					) {
						emitRoomNotification({
							body: fallbackBody,
							roomId: entry.id,
							tag: `betterchat-room-${entry.id}-fallback-${Date.now()}`,
							title: entry.title,
						});
					}
				}
			} finally {
				roomNotificationInflightRef.current.delete(entry.id);
			}
		};

		for (const entry of sidebarEntries) {
			const preference = resolveRoomAlertPreference({
				defaults: roomNotificationDefaults,
				preferences: roomAlertPreferences,
				roomId: entry.id,
				roomKind: entry.kind,
			});
			const previousEntry = previousSidebarEntries.get(entry.id) ?? null;
			const shouldNotify = shouldNotifyForSidebarEntry({
				currentRoomId: roomId ?? null,
				nextEntry: entry,
				pageFocused,
				pageVisible,
				previousEntry,
				preference,
			});
			if (!shouldNotify) {
				continue;
			}

			void notifyForEntry(entry, previousEntry, preference);
		}
	}, [
		browserNotificationPermission,
		currentUser,
		effectiveBrowserNotificationDelivery,
		emitRoomMessageNotifications,
		emitRoomNotification,
		roomAlertPreferences,
		roomId,
		roomNotificationDefaults,
		sidebarEntries,
	]);

	const bootstrapError = bootstrapQuery.error && isBetterChatApiError(bootstrapQuery.error) ? bootstrapQuery.error : null;
	const sidebarError = sidebarQuery.error && isBetterChatApiError(sidebarQuery.error) ? sidebarQuery.error : null;
	const roomDetailsError = roomDetailsQuery.error && isBetterChatApiError(roomDetailsQuery.error) ? roomDetailsQuery.error : null;
	const timelineError = roomTimelineQuery.error && isBetterChatApiError(roomTimelineQuery.error) ? roomTimelineQuery.error : null;
	const hasShellError = Boolean(bootstrapError && bootstrapError.code !== 'UNAUTHENTICATED') || Boolean(sidebarError && sidebarError.code !== 'UNAUTHENTICATED');
	const shellLoading = bootstrapQuery.isLoading || sidebarQuery.isLoading;
	const roomLoading = Boolean(roomId) && (roomDetailsQuery.isLoading || roomTimelineQuery.isLoading);
	const roomFavoriteServerValue = roomDetailsQuery.data?.room.favorite ?? activeEntryServer?.favorite ?? false;
	const activeRoomKind = roomDetailsQuery.data?.room.kind ?? activeEntryServer?.kind ?? null;
	const roomIsFavorite =
		roomId && favoriteOverridesEnabled
			? resolveFavoriteOverride({
					overrides: favoriteOverrides,
					roomId,
					serverValue: roomFavoriteServerValue,
			  })
			: roomFavoriteServerValue;
	const activeRoomAlertPreference = roomId
		? resolveRoomAlertPreference({
				defaults: roomNotificationDefaults,
				preferences: roomAlertPreferences,
				roomId,
				roomKind: activeRoomKind ?? 'channel',
		  })
		: roomNotificationDefaults.rooms;
	const activeRoomAlertUsesDefault = roomId
		? roomNotificationPreferenceUsesDefault({
				preferences: roomAlertPreferences,
				roomId,
		  })
		: false;
	const activeRoomDefaultAlertPreference = activeRoomKind
		? resolveDefaultRoomNotificationPreference({
				defaults: roomNotificationDefaults,
				roomKind: activeRoomKind,
		  })
		: roomNotificationDefaults.rooms;
	const workspaceCanSendMessages = bootstrapQuery.data?.capabilities.canSendMessages ?? false;
	const roomCanSendMessages = roomDetailsQuery.data?.room.capabilities.canSendMessages ?? true;
	const canSendMessages = workspaceCanSendMessages && roomCanSendMessages;
	const composerDisabledReason = canSendMessages ? undefined : '此房间不允许发送消息。';
	const showReadonlyComposerNotice = Boolean(roomId) && !canSendMessages;
	const canUploadImages =
		canSendMessages && (roomDetailsQuery.data?.room.capabilities.canUploadImages ?? bootstrapQuery.data?.capabilities.canUploadImages ?? false);
	const displayName = currentUser?.displayName.trim() ?? '';
	const username = currentUser?.username.trim() ?? '';
	const hasDistinctHandle = Boolean(username) && normalizeIdentityValue(displayName) !== normalizeIdentityValue(username);
	const primaryUserLabel = displayName || username;
	const secondaryUserLabel = hasDistinctHandle ? `@${username}` : null;
	const userPresence = resolveUserPresence(currentUser?.status);
	const activeRoomPendingSendCount = roomId ? roomPendingSendCounts[roomId] ?? 0 : 0;
	const activeRoomLocalMessages = useMemo(() => (roomId ? roomLocalMessages[roomId] ?? [] : []), [roomId, roomLocalMessages]);
	const activeRoomOlderHistory = useMemo(() => (roomId ? roomOlderHistory[roomId] : undefined), [roomId, roomOlderHistory]);
	const activeRoomEffectiveOlderHistory = useMemo(() => {
		if (!roomId || !roomTimelineQuery.data) {
			return activeRoomOlderHistory;
		}

		const previousLoadedWindow = activeRoomLoadedWindowRef.current;
		if (!previousLoadedWindow || previousLoadedWindow.roomId !== roomId) {
			return activeRoomOlderHistory;
		}

		return resolveRetainedOlderHistory({
			current: activeRoomOlderHistory,
			nextBaseMessages: roomTimelineQuery.data.messages,
			previousLoadedMessages: previousLoadedWindow.messages,
			previousNextCursor: previousLoadedWindow.nextCursor,
		});
	}, [activeRoomOlderHistory, roomId, roomTimelineQuery.data]);
	const activeRoomHasOlderHistory = hasOlderHistory({
		baseNextCursor: roomTimelineQuery.data?.nextCursor,
		olderHistory: activeRoomEffectiveOlderHistory,
	});
	const activeRoomOlderHistoryLoading = roomId ? (roomOlderHistoryLoading[roomId] ?? false) : false;
	const activeRoomBaseTimeline = useMemo(() => {
		if (!roomTimelineQuery.data) {
			return roomTimelineQuery.data;
		}

		const mergedMessages = mergeTimelineMessagesPreferIncoming(
			activeRoomEffectiveOlderHistory?.messages ?? [],
			roomTimelineQuery.data.messages,
		);
		return {
			...roomTimelineQuery.data,
			messages: mergedMessages,
			nextCursor: resolveOlderHistoryNextCursor({
				baseNextCursor: roomTimelineQuery.data.nextCursor,
				olderHistory: activeRoomEffectiveOlderHistory,
			}),
		};
	}, [activeRoomEffectiveOlderHistory, roomTimelineQuery.data]);
	const activeRoomSubmissionReconciliation = useMemo(
		() =>
			activeRoomBaseTimeline
				? reconcileSubmissionTimeline({
						canonicalMessages: activeRoomBaseTimeline.messages,
						localMessages: activeRoomLocalMessages,
				  })
				: undefined,
		[activeRoomBaseTimeline, activeRoomLocalMessages],
	);
	const activeRoomMessageDeliveryStates = activeRoomSubmissionReconciliation?.messageDeliveryStates ?? emptyMessageDeliveryStates;
	const activeRoomFailedMessageActions = activeRoomSubmissionReconciliation?.failedMessageActions ?? emptyFailedMessageActions;
	const activeRoomLocalOutgoingMessageIds =
		activeRoomSubmissionReconciliation?.localOutgoingMessageIds ?? emptyLocalOutgoingMessageIds;
	const activeRoomTimeline = useMemo(
		() =>
			activeRoomBaseTimeline
				? {
						...activeRoomBaseTimeline,
						messages: activeRoomSubmissionReconciliation?.messages ?? activeRoomBaseTimeline.messages,
				  }
				: activeRoomBaseTimeline,
		[activeRoomBaseTimeline, activeRoomSubmissionReconciliation],
	);
	useEffect(() => {
		if (!roomId || !activeRoomEffectiveOlderHistory || olderHistoryStatesEqual(activeRoomOlderHistory, activeRoomEffectiveOlderHistory)) {
			return;
		}

		setRoomOlderHistory((currentHistory) => {
			const currentRoomHistory = currentHistory[roomId];
			if (olderHistoryStatesEqual(currentRoomHistory, activeRoomEffectiveOlderHistory)) {
				return currentHistory;
			}

			const nextHistory = {
				...currentHistory,
				[roomId]: activeRoomEffectiveOlderHistory,
			};
			roomOlderHistoryRef.current = nextHistory;
			return nextHistory;
		});
	}, [activeRoomEffectiveOlderHistory, activeRoomOlderHistory, roomId]);
	useEffect(() => {
		if (!roomId || !activeRoomBaseTimeline) {
			return;
		}

		activeRoomLoadedWindowRef.current = {
			messages: activeRoomBaseTimeline.messages,
			nextCursor: activeRoomBaseTimeline.nextCursor,
			roomId,
		};
	}, [activeRoomBaseTimeline, roomId]);
	const prefetchOlderRoomHistoryPage = useCallback(
		(targetRoomId: string, cursor?: string | null) => {
			if (!cursor) {
				return;
			}

			const cachedPage = roomOlderHistoryPrefetchPagesRef.current[targetRoomId];
			if (cachedPage?.cursor === cursor) {
				return Promise.resolve();
			}

			const inFlight = roomOlderHistoryPrefetchInFlightRef.current[targetRoomId];
			if (inFlight?.cursor === cursor) {
				return inFlight.promise.then(() => undefined);
			}

			const promise = betterChatApi.roomTimeline(targetRoomId, {
				cursor,
			}).then((page) => {
				const currentInFlight = roomOlderHistoryPrefetchInFlightRef.current[targetRoomId];
				if (currentInFlight?.cursor === cursor) {
					delete roomOlderHistoryPrefetchInFlightRef.current[targetRoomId];
				}

				roomOlderHistoryPrefetchPagesRef.current[targetRoomId] = {
					cursor,
					page,
				};
				return page;
			}).catch((error) => {
				const currentInFlight = roomOlderHistoryPrefetchInFlightRef.current[targetRoomId];
				if (currentInFlight?.cursor === cursor) {
					delete roomOlderHistoryPrefetchInFlightRef.current[targetRoomId];
				}
				throw error;
			});

			roomOlderHistoryPrefetchInFlightRef.current[targetRoomId] = {
				cursor,
				promise,
			};
			return promise.then(() => undefined);
		},
		[],
	);
	const prefetchOlderRoomHistory = useCallback(
		(targetRoomId: string) => {
			if (roomOlderHistoryLoadingRef.current[targetRoomId]) {
				return;
			}

			const baseTimeline =
				queryClient.getQueryData<RoomTimelineSnapshot>(betterChatQueryKeys.roomTimeline(targetRoomId)) ??
				(targetRoomId === roomId ? roomTimelineQuery.data : undefined);
			const currentOlderHistory =
				targetRoomId === roomId ? activeRoomEffectiveOlderHistory : roomOlderHistoryRef.current[targetRoomId];
			const cursor = resolveOlderHistoryLoadCursor({
				baseNextCursor: baseTimeline?.nextCursor,
				olderHistory: currentOlderHistory,
			});
			return prefetchOlderRoomHistoryPage(targetRoomId, cursor);
		},
		[activeRoomEffectiveOlderHistory, prefetchOlderRoomHistoryPage, queryClient, roomId, roomTimelineQuery.data],
	);
	useEffect(() => {
		const conversationBody = conversationBodyRef.current;
		if (!conversationBody || roomLoading || !activeRoomTimeline) {
			return;
		}

		const syncConversationBodyHeight = () => {
			setConversationBodyHeight(conversationBody.getBoundingClientRect().height);
		};

		syncConversationBodyHeight();
		if (typeof ResizeObserver === 'undefined') {
			window.addEventListener('resize', syncConversationBodyHeight);
			return () => window.removeEventListener('resize', syncConversationBodyHeight);
		}

		const observer = new ResizeObserver(() => {
			syncConversationBodyHeight();
		});
		observer.observe(conversationBody);

		return () => {
			observer.disconnect();
		};
	}, [activeRoomTimeline, roomId, roomLoading]);
	const activeRoomTitle = roomDetailsQuery.data?.room.title ?? activeEntry?.title ?? '当前房间';
	useEffect(() => {
		if (!roomId || !activeRoomTimeline) {
			return;
		}

		const { pageFocused, pageVisible } = resolveBrowserNotificationPageState();
		if (!pageFocused || !pageVisible) {
			return;
		}

		rememberLatestRoomNotificationBaseline({
			messages: activeRoomTimeline.messages,
			roomId,
		});
	}, [
		activeRoomTimeline,
		rememberLatestRoomNotificationBaseline,
		roomId,
	]);
	useEffect(() => {
		if (
			!roomId ||
			!activeRoomTimeline ||
			typeof window === 'undefined' ||
			!isBrowserNotificationDeliveryEnabled({
				delivery: effectiveBrowserNotificationDelivery,
				permission: browserNotificationPermission,
			})
		) {
			return;
		}

		const { pageFocused, pageVisible } = resolveBrowserNotificationPageState();
		if (pageFocused && pageVisible) {
			return;
		}

		const activeRoomNotificationKind = activeRoomKind ?? activeEntry?.kind ?? 'channel';
		const messagesToNotify = resolveSidebarNotificationMessages({
			currentUser,
			entry: {
				kind: activeRoomNotificationKind,
			},
			lastNotifiedMessageId: roomNotificationLastMessageIdRef.current[roomId] ?? null,
			limit: activeRoomTimeline.messages.length,
			messages: activeRoomTimeline.messages,
			preference: activeRoomAlertPreference,
		});
		if (messagesToNotify.length === 0) {
			return;
		}

		emitRoomMessageNotifications({
			entry: {
				id: roomId,
				title: activeRoomTitle,
			},
			messages: messagesToNotify,
		});
	}, [
		activeEntry?.kind,
		activeRoomAlertPreference,
		activeRoomKind,
		activeRoomTimeline,
		activeRoomTitle,
		browserNotificationPermission,
		currentUser,
		effectiveBrowserNotificationDelivery,
		emitRoomMessageNotifications,
		roomId,
	]);
	const activeRoomMentionInteractionUsers = useMemo(
		() => toMentionInteractionUsers(roomParticipantsQuery.data ?? []),
		[roomParticipantsQuery.data],
	);
	const patchSidebarEntry = useCallback(
		(targetRoomId: string, updater: (entry: RoomSummary) => RoomSummary) => {
			queryClient.setQueryData<RoomListSnapshot | undefined>(betterChatQueryKeys.roomList, (currentSidebar) =>
				currentSidebar
					? {
							...currentSidebar,
							rooms: currentSidebar.rooms.map((entry) => (entry.id === targetRoomId ? updater(entry) : entry)),
					  }
					: currentSidebar,
			);
		},
		[queryClient],
	);
	const patchRoomDetails = useCallback(
		(targetRoomId: string, updater: (details: RoomSnapshot) => RoomSnapshot) => {
			queryClient.setQueryData<RoomSnapshot | undefined>(betterChatQueryKeys.room(targetRoomId), (currentRoomDetails) =>
				currentRoomDetails ? updater(currentRoomDetails) : currentRoomDetails,
			);
		},
		[queryClient],
	);
	const patchRoomTimeline = useCallback(
		(targetRoomId: string, updater: (timeline: RoomTimelineSnapshot) => RoomTimelineSnapshot) => {
			queryClient.setQueryData<RoomTimelineSnapshot | undefined>(betterChatQueryKeys.roomTimeline(targetRoomId), (currentTimeline) =>
				currentTimeline ? updater(currentTimeline) : currentTimeline,
			);
		},
		[queryClient],
	);
	const invalidateRoomSnapshotQueries = useCallback(
		(targetRoomId: string) =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.roomList }),
				queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.room(targetRoomId) }),
				queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.roomTimeline(targetRoomId) }),
			]),
		[queryClient],
	);
	const refetchActiveSidebarSnapshot = useCallback(
		() => queryClient.refetchQueries({ queryKey: betterChatQueryKeys.roomList, type: 'active' }),
		[queryClient],
	);
	const refetchActiveRoomSnapshot = useCallback(
		(targetRoomId: string) =>
			Promise.all([
				queryClient.refetchQueries({
					queryKey: betterChatQueryKeys.room(targetRoomId),
					type: 'active',
				}),
				queryClient.refetchQueries({
					queryKey: betterChatQueryKeys.roomTimeline(targetRoomId),
					type: 'active',
				}),
			]),
		[queryClient],
	);
	const loadOlderRoomHistory = useCallback(
		async (targetRoomId: string) => {
			if (roomOlderHistoryLoadingRef.current[targetRoomId]) {
				return false;
			}

			const baseTimeline =
				queryClient.getQueryData<RoomTimelineSnapshot>(betterChatQueryKeys.roomTimeline(targetRoomId)) ??
				(targetRoomId === roomId ? roomTimelineQuery.data : undefined);
			const currentOlderHistory =
				targetRoomId === roomId ? activeRoomEffectiveOlderHistory : roomOlderHistoryRef.current[targetRoomId];
			const cursor = resolveOlderHistoryLoadCursor({
				baseNextCursor: baseTimeline?.nextCursor,
				olderHistory: currentOlderHistory,
			});
			if (!cursor) {
				return false;
			}

			setRoomOlderHistoryLoading((currentLoading) => {
				const nextLoading = {
					...currentLoading,
					[targetRoomId]: true,
				};
				roomOlderHistoryLoadingRef.current = nextLoading;
				return nextLoading;
			});

			try {
				const prefetchedOlderPage = roomOlderHistoryPrefetchPagesRef.current[targetRoomId];
				const inFlightPrefetch = roomOlderHistoryPrefetchInFlightRef.current[targetRoomId];
				const olderPage =
					prefetchedOlderPage?.cursor === cursor
						? prefetchedOlderPage.page
						: inFlightPrefetch?.cursor === cursor
							? await inFlightPrefetch.promise
							: await betterChatApi.roomTimeline(targetRoomId, {
									cursor,
							  });
				const currentHistory = roomOlderHistoryRef.current;
				const merged = mergeOlderHistoryPage({
					current: targetRoomId === roomId ? activeRoomEffectiveOlderHistory : currentHistory[targetRoomId],
					page: olderPage,
				});
				const nextCursorToPrefetch = merged.state.pagination.kind === 'ready' ? merged.state.pagination.nextCursor : null;
				const nextHistory = {
					...currentHistory,
					[targetRoomId]: merged.state,
				};
				roomOlderHistoryRef.current = nextHistory;
				setRoomOlderHistory(nextHistory);
				delete roomOlderHistoryPrefetchPagesRef.current[targetRoomId];
				prefetchOlderRoomHistoryPage(targetRoomId, nextCursorToPrefetch);

				return merged.loadedNewMessages;
			} finally {
				setRoomOlderHistoryLoading((currentLoading) => {
					if (!currentLoading[targetRoomId]) {
						return currentLoading;
					}

					const nextLoading = { ...currentLoading };
					delete nextLoading[targetRoomId];
					roomOlderHistoryLoadingRef.current = nextLoading;
					return nextLoading;
				});
			}
		},
		[activeRoomEffectiveOlderHistory, prefetchOlderRoomHistoryPage, queryClient, roomId, roomTimelineQuery.data],
	);
	const clearRoomUnreadState = useCallback(
		(targetRoomId: string) => {
			patchSidebarEntry(targetRoomId, (entry) => clearRoomAttention(entry));
			patchRoomDetails(targetRoomId, (details) => ({
				...details,
				room: clearRoomAttention(details.room),
			}));
			patchRoomTimeline(targetRoomId, (timeline) => ({
				...timeline,
				unreadAnchorMessageId: undefined,
			}));
		},
		[patchRoomDetails, patchRoomTimeline, patchSidebarEntry],
	);
	const logoutMutation = useMutation({
		mutationFn: () => betterChatApi.logout(),
		onMutate: () => {
			quiesceSession();
		},
		onSuccess: () => {
			resetSessionAndReturnToLogin();
		},
		onError: (error) => {
			if (isBetterChatApiError(error) && error.code === 'UNAUTHENTICATED') {
				resetSessionAndReturnToLogin();
				return;
			}

			setSessionLifecycle('active');
			const errorHandler = createMutationErrorHandler<unknown, unknown>({
				showToast: showErrorToast,
				queryClient,
			});
			errorHandler.onError(error, undefined, undefined);
		},
	});
	const favoriteMutation = useMutation({
		mutationFn: ({ favorite, targetRoomId }: { favorite: boolean; targetRoomId: string }) =>
			betterChatApi.setRoomFavorite(targetRoomId, { favorite }),
		onMutate: ({ favorite, targetRoomId }) => {
			// Capture previous state for rollback
			const previousSidebarEntry = sidebarEntries.find((entry) => entry.id === targetRoomId);
			const previousRoomDetails = queryClient.getQueryData<RoomSnapshot>(betterChatQueryKeys.room(targetRoomId));

			// Apply optimistic update
			patchSidebarEntry(targetRoomId, (entry) => ({
				...entry,
				favorite,
			}));
			patchRoomDetails(targetRoomId, (details) => ({
				...details,
				room: {
					...details.room,
					favorite,
				},
			}));

			return { previousSidebarEntry, previousRoomDetails };
		},
		onSuccess: ({ favorite, roomId: targetRoomId }) => {
			patchSidebarEntry(targetRoomId, (entry) => ({
				...entry,
				favorite,
			}));
			patchRoomDetails(targetRoomId, (details) => ({
				...details,
				room: {
					...details.room,
					favorite,
				},
			}));
		},
		onError: (error, variables, context) => {
			queuedFavoriteMutationRef.current = null;
			const errorHandler = createMutationErrorHandler<
				{ favorite: boolean; targetRoomId: string },
				{ previousSidebarEntry?: RoomSummary; previousRoomDetails?: RoomSnapshot }
			>({
				showToast: showErrorToast,
				queryClient,
				restoreState: (state) => {
					// Rollback optimistic update
					if (state.previousSidebarEntry) {
						patchSidebarEntry(variables.targetRoomId, () => state.previousSidebarEntry!);
					}
					if (state.previousRoomDetails) {
						patchRoomDetails(variables.targetRoomId, () => state.previousRoomDetails!);
					}
				},
			});
			errorHandler.onError(error, variables, context);
		},
		onSettled: (_data, _error, variables) => {
			setFavoriteMutationInFlight(false);
			void invalidateRoomSnapshotQueries(variables.targetRoomId);
		},
	});
	useEffect(() => {
		if (favoriteOverridesEnabled || favoriteMutationInFlight) {
			return;
		}

		const queuedFavoriteMutation = queuedFavoriteMutationRef.current;
		if (!queuedFavoriteMutation) {
			return;
		}

		queuedFavoriteMutationRef.current = null;
		setFavoriteMutationInFlight(true);
		favoriteMutation.mutate(queuedFavoriteMutation);
	}, [favoriteMutation, favoriteMutationInFlight, favoriteOverridesEnabled]);
	const roomOpenMutation = useMutation({
		mutationFn: (targetRoomId: string) => betterChatApi.setRoomVisibility(targetRoomId, { visibility: 'visible' }),
		onMutate: (targetRoomId) => {
			// Capture previous state for rollback
			const previousSidebarEntry = sidebarEntries.find((entry) => entry.id === targetRoomId);

			// Apply optimistic update
			patchSidebarEntry(targetRoomId, (entry) => setRoomVisible(entry));

			return { previousSidebarEntry };
		},
		onSuccess: ({ roomId: targetRoomId }) => {
			patchSidebarEntry(targetRoomId, (entry) => setRoomVisible(entry));
		},
		onError: (error, targetRoomId, context) => {
			const errorHandler = createMutationErrorHandler<string, { previousSidebarEntry?: RoomSummary }>({
				showToast: showErrorToast,
				queryClient,
				restoreState: (state) => {
					// Rollback optimistic update
					if (state.previousSidebarEntry) {
						patchSidebarEntry(targetRoomId, () => state.previousSidebarEntry!);
					}
				},
			});
			errorHandler.onError(error, targetRoomId, context);
		},
		onSettled: (_data, _error, targetRoomId) => {
			void invalidateRoomSnapshotQueries(targetRoomId);
		},
	});
	const roomReadMutation = useMutation({
		mutationFn: (targetRoomId: string) => betterChatApi.setRoomReadState(targetRoomId, { state: 'read' }),
		onMutate: (targetRoomId) => {
			// Capture previous state for rollback
			const previousSidebarEntry = sidebarEntries.find((entry) => entry.id === targetRoomId);
			const previousRoomDetails = queryClient.getQueryData<RoomSnapshot>(betterChatQueryKeys.room(targetRoomId));
			const previousTimeline = queryClient.getQueryData<RoomTimelineSnapshot>(
				betterChatQueryKeys.roomTimeline(targetRoomId),
			);

			// Apply optimistic update
			clearRoomUnreadState(targetRoomId);

			return { previousSidebarEntry, previousRoomDetails, previousTimeline };
		},
		onSuccess: ({ roomId: targetRoomId }) => {
			clearRoomUnreadState(targetRoomId);
		},
		onError: (error, targetRoomId, context) => {
			const errorHandler = createMutationErrorHandler<
				string,
				{
					previousSidebarEntry?: RoomSummary;
					previousRoomDetails?: RoomSnapshot;
					previousTimeline?: RoomTimelineSnapshot;
				}
			>({
				showToast: showErrorToast,
				queryClient,
				restoreState: (state) => {
					// Rollback optimistic update
					if (state.previousSidebarEntry) {
						patchSidebarEntry(targetRoomId, () => state.previousSidebarEntry!);
					}
					if (state.previousRoomDetails) {
						patchRoomDetails(targetRoomId, () => state.previousRoomDetails!);
					}
					if (state.previousTimeline) {
						patchRoomTimeline(targetRoomId, () => state.previousTimeline!);
					}
				},
			});
			errorHandler.onError(error, targetRoomId, context);
		},
		onSettled: (_data, _error, targetRoomId) => {
			void invalidateRoomSnapshotQueries(targetRoomId);
		},
	});
	const ensureDirectConversationMutation = useMutation({
		mutationFn: (userId: string) => betterChatApi.ensureDirectConversation(userId),
		onSuccess: ({ roomId: targetRoomId }) => {
			setActiveTimelineAuthorUserId(null);
			setPendingDirectConversationFocusRoomId(targetRoomId);
			void Promise.all([
				queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.roomList }),
				queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.room(targetRoomId) }),
				queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.roomTimeline(targetRoomId) }),
			]);
			void navigate({
				to: '/app/rooms/$roomId',
				params: {
					roomId: targetRoomId,
				},
			});
		},
		onError: (error) => {
			const errorHandler = createMutationErrorHandler<unknown, unknown>({
				showToast: showErrorToast,
				queryClient,
			});
			errorHandler.onError(error, undefined, undefined);
		},
	});
	const openTimelineAuthorQuickPanel = useCallback((userId: string) => {
		setActiveTimelineAuthorUserId(userId);
	}, []);
	const prepareTimelineAuthorQuickPanel = useCallback(
		(userId: string) => {
			if (!userId) {
				return;
			}

			void queryClient.prefetchQuery({
				queryKey: betterChatQueryKeys.directConversation(userId),
				queryFn: () => betterChatApi.directConversationLookup(userId),
				staleTime: directConversationLookupStaleTimeMs,
			});
		},
		[queryClient],
	);
	const closeTimelineAuthorQuickPanel = useCallback(() => {
		setActiveTimelineAuthorUserId(null);
	}, []);
	const ensureTimelineAuthorDirectConversation = useCallback((userId: string) => {
		ensureDirectConversationMutation.mutate(userId);
	}, [ensureDirectConversationMutation]);
	const resolveReplyTargetFromContext = useCallback(
		async (targetMessageId: string) => {
			if (!roomId) {
				return false;
			}

			try {
				const context = await betterChatApi.roomMessageContext(roomId, targetMessageId, {
					before: 10,
					after: 10,
				});
				queryClient.setQueryData<RoomTimelineSnapshot | undefined>(betterChatQueryKeys.roomTimeline(roomId), (currentTimeline) =>
					currentTimeline
						? mergeMessageContextIntoTimeline(currentTimeline, context)
						: {
								version: context.version,
								roomId: context.roomId,
								messages: context.messages,
						  },
				);
				return true;
			} catch {
				return false;
			}
		},
		[queryClient, roomId],
	);
	const handleRequestMarkRead = useCallback(() => {
		if (betterChatApi.mode !== 'api' || !roomId || roomReadMutation.isPending || !roomTimelineQuery.data?.unreadAnchorMessageId) {
			return;
		}

		roomReadMutation.mutate(roomId);
	}, [roomId, roomReadMutation, roomTimelineQuery.data?.unreadAnchorMessageId]);

	useEffect(() => {
		if (betterChatApi.mode !== 'api' || !roomId || !activeEntryServer || isRoomVisible(activeEntryServer) || roomOpenMutation.isPending) {
			return;
		}

		roomOpenMutation.mutate(roomId);
	}, [activeEntryServer, roomId, roomOpenMutation]);

	useEffect(() => {
		if (!apiModePollingEnabled) {
			setRealtimeStatus({ kind: 'stopped' });
			return;
		}

		if (!realtimePushEnabled) {
			setRealtimeStatus({ kind: 'disconnected' });
		}
	}, [apiModePollingEnabled, realtimePushEnabled]);

	useEffect(() => {
		if (!apiModePollingEnabled || !realtimePushEnabled) {
			realtimeControllerRef.current?.close();
			realtimeControllerRef.current = null;
			return;
		}

		const controller = createBetterChatRealtimeController({
			onEvent: (event) => {
				switch (event.type) {
					case 'ready':
						void refetchActiveSidebarSnapshot();
						if (activeRoomIdRef.current) {
							void refetchActiveRoomSnapshot(activeRoomIdRef.current);
						}
						return;
					case 'directory.resynced':
						queryClient.setQueryData<RoomListSnapshot>(betterChatQueryKeys.roomList, toRoomListSnapshot(event.snapshot));
						return;
					case 'directory.entry.upsert': {
						const nextEntry = toRoomSummary(event.entry);
						queryClient.setQueryData<RoomListSnapshot | undefined>(betterChatQueryKeys.roomList, (currentSidebar) => {
							if (!currentSidebar) {
								return {
									version: event.version,
									rooms: [nextEntry],
								};
							}

							const existingEntryIndex = currentSidebar.rooms.findIndex((entry) => entry.id === nextEntry.id);
							if (existingEntryIndex < 0) {
								return {
									...currentSidebar,
									version: event.version,
									rooms: [...currentSidebar.rooms, nextEntry],
								};
							}

							return {
								...currentSidebar,
								version: event.version,
								rooms: currentSidebar.rooms.map((entry, index) => (index === existingEntryIndex ? nextEntry : entry)),
							};
						});
						if (event.entry.conversation.id === activeRoomIdRef.current) {
							patchRoomDetails(event.entry.conversation.id, (details) => ({
								...details,
								room: {
									...details.room,
									...nextEntry,
								},
							}));
						}
						return;
					}
					case 'directory.entry.remove':
						queryClient.setQueryData<RoomListSnapshot | undefined>(betterChatQueryKeys.roomList, (currentSidebar) =>
							currentSidebar
								? {
										...currentSidebar,
										version: event.version,
										rooms: currentSidebar.rooms.filter((entry) => entry.id !== event.conversationId),
								  }
								: currentSidebar,
						);
						return;
					case 'conversation.resynced':
					case 'conversation.updated':
						queryClient.setQueryData<RoomSnapshot>(
							betterChatQueryKeys.room(event.snapshot.conversation.id),
							toRoomSnapshot(event.snapshot),
						);
						return;
					case 'timeline.resynced':
						if (event.snapshot.scope.kind === 'conversation') {
							queryClient.setQueryData<RoomTimelineSnapshot>(
								betterChatQueryKeys.roomTimeline(event.snapshot.scope.conversationId),
								toRoomTimelineSnapshot(event.snapshot),
							);
						}
						return;
					case 'presence.updated':
						patchSidebarEntry(event.conversationId, (entry) => ({
							...entry,
							presence: event.presence,
						}));
						patchRoomDetails(event.conversationId, (details) => ({
							...details,
							room: {
								...details.room,
								presence: event.presence,
							},
						}));
						return;
					case 'resync.required':
						if (event.scope === 'directory') {
							void refetchActiveSidebarSnapshot();
							return;
						}

						if (event.conversationId) {
							void refetchActiveSidebarSnapshot();
							if (event.conversationId === activeRoomIdRef.current) {
								void refetchActiveRoomSnapshot(event.conversationId);
							}
						}
						return;
					case 'session.invalidated':
						resetSessionAndReturnToLogin();
						return;
			default:
					return;
			}
		},
		onStatusChange: setRealtimeStatus,
		onSocketError: (error: SocketError) => {
			if (sessionLifecycle !== 'active') {
				return;
			}

			const recoverableTransportError = error.category === 'connection-error' || error.category === 'connection-lost';
			if (!recoverableTransportError) {
				console.error('[WebSocket Error]', error);
			}

			// Show toast for critical errors
			if (error.category === 'authentication-failed') {
				showErrorToast({ message: '连接认证失败，请重新登录', type: 'error' });
			} else if (error.category === 'rate-limited') {
				showErrorToast({ message: '连接重试次数过多，请刷新页面', type: 'error' });
			}
		},
	});

		realtimeControllerRef.current = controller;
		return () => {
			controller.close();
			if (realtimeControllerRef.current === controller) {
				realtimeControllerRef.current = null;
			}
		};
	}, [apiModePollingEnabled, queryClient, realtimePushEnabled, refetchActiveRoomSnapshot, refetchActiveSidebarSnapshot, resetSessionAndReturnToLogin, sessionLifecycle, showErrorToast]);

	useEffect(() => {
		const controller = realtimeControllerRef.current;
		if (!controller) {
			return;
		}

		controller.setWatchState(realtimeWatchState);
	}, [realtimeWatchState]);

	useEffect(() => {
		const handleKeydown = (event: KeyboardEvent) => {
			if (event.isComposing || hasOpenBlockingDialog()) {
				return;
			}

			const activeElement = document.activeElement;
			const isNeutralShellFocus =
				!activeElement ||
				activeElement === document.body ||
				activeElement === document.documentElement;
			const action = resolveShellKeyboardAction({
				altKey: event.altKey,
				ctrlKey: event.ctrlKey,
				isNeutralShellFocus,
				key: event.key,
				metaKey: event.metaKey,
				shiftKey: event.shiftKey,
			});
			if (!action) {
				return;
			}

			event.preventDefault();
			if (action.kind === 'toggle-sidebar-collapse') {
				if (sidebarResizeEnabled) {
					toggleSidebarCollapse();
				}
				return;
			}

			if (action.kind === 'focus-search') {
				if (sidebarCollapsed) {
					expandSidebar();
					setTimeout(() => focusSidebarSearch({ select: true }), 0);
				} else {
					void focusSidebarSearch({ select: true });
				}
				return;
			}

			if (action.kind === 'open-settings') {
				updateKeyboardFocusRegion(null);
				setSettingsOpen(true);
				return;
			}

			if (action.kind === 'focus-sidebar') {
				if (sidebarCollapsed) {
					expandSidebar();
					setTimeout(() => {
						if (!focusSidebarRoom(focusedSidebarRoomId ?? roomId ?? visibleSidebarRoomIds[0] ?? null)) {
							focusSidebarSearch();
						}
					}, 0);
				} else {
					if (!focusSidebarRoom(focusedSidebarRoomId ?? roomId ?? visibleSidebarRoomIds[0] ?? null)) {
						focusSidebarSearch();
					}
				}
				return;
			}

			if (action.kind === 'focus-timeline') {
				if (focusTimeline(action.strategy)) {
					return;
				}

				void focusSidebarRoom(focusedSidebarRoomId ?? roomId ?? visibleSidebarRoomIds[0] ?? null);
				return;
			}

			if (action.kind === 'focus-composer' && roomTimelineQuery.data) {
				void focusComposer();
			}
		};

		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	}, [expandSidebar, focusComposer, focusSidebarRoom, focusSidebarSearch, focusTimeline, focusedSidebarRoomId, roomId, roomTimelineQuery.data, sidebarCollapsed, sidebarResizeEnabled, toggleSidebarCollapse, updateKeyboardFocusRegion, visibleSidebarRoomIds]);

	useEffect(() => {
		if (initialFocusBootstrappedRef.current || shellLoading || hasOpenBlockingDialog()) {
			return;
		}

		const targetRoomId = roomId ?? visibleSidebarRoomIds[0] ?? null;
		if (!targetRoomId) {
			return;
		}

		const activeElement = document.activeElement;
		if (activeElement && activeElement !== document.body && activeElement !== document.documentElement) {
			return;
		}

		initialFocusBootstrappedRef.current = true;
		window.requestAnimationFrame(() => {
			void focusSidebarRoom(targetRoomId, 'pointer');
		});
	}, [focusSidebarRoom, roomId, shellLoading, visibleSidebarRoomIds]);

	useEffect(() => {
		if (
			!canApplyPendingComposerFocus({
				activeRoomId: roomId,
				composerReady,
				composerReadyRoomId,
				pendingRoomId: pendingForwardJumpRoomId,
				roomLoading,
			})
		) {
			return;
		}

		if (composerFocused) {
			setPendingForwardJumpRoomId(null);
			return;
		}

		const frameId = window.requestAnimationFrame(() => {
			void focusComposer();
		});
		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [composerFocused, composerReady, composerReadyRoomId, focusComposer, pendingForwardJumpRoomId, roomId, roomLoading]);

	useEffect(() => {
		if (
			!canApplyPendingComposerFocus({
				activeRoomId: roomId,
				composerReady,
				composerReadyRoomId,
				pendingRoomId: pendingDirectConversationFocusRoomId,
				roomLoading,
			})
		) {
			return;
		}

		if (composerFocused) {
			setPendingDirectConversationFocusRoomId(null);
			return;
		}

		const frameId = window.requestAnimationFrame(() => {
			void focusComposer();
		});
		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [composerFocused, composerReady, composerReadyRoomId, focusComposer, pendingDirectConversationFocusRoomId, roomId, roomLoading]);

	useEffect(() => {
		if (!forwardToast?.actionable || forwardToast.roomId !== roomId) {
			return;
		}

		clearForwardToast();
	}, [clearForwardToast, forwardToast, roomId]);

	useEffect(() => {
		if (!forwardToast?.actionable) {
			return;
		}

		const focusToastAction = () => {
			forwardToastActionRef.current?.focus({ preventScroll: true });
		};

		const frameId = window.requestAnimationFrame(focusToastAction);
		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [forwardToast]);

	const updateRoomPendingSendCount = useCallback((targetRoomId: string, delta: number) => {
		setRoomPendingSendCounts((currentCounts) => {
			const nextCount = Math.max((currentCounts[targetRoomId] ?? 0) + delta, 0);
			if (nextCount === 0) {
				const { [targetRoomId]: _removed, ...restCounts } = currentCounts;
				return restCounts;
			}

			return {
				...currentCounts,
				[targetRoomId]: nextCount,
			};
		});
	}, []);

	const releaseOptimisticPreviewUrl = useCallback((previewUrl: string | undefined) => {
		if (!previewUrl || !optimisticPreviewUrlsRef.current.has(previewUrl)) {
			return;
		}

		optimisticPreviewUrlsRef.current.delete(previewUrl);
		URL.revokeObjectURL(previewUrl);
	}, []);

	const commitLocalRoomMessages = useCallback(
		(updater: (currentMessages: Record<string, LocalRoomMessage[]>) => Record<string, LocalRoomMessage[]>) => {
			const currentMessages = roomLocalMessagesRef.current;
			const nextMessages = updater(currentMessages);
			if (nextMessages === currentMessages) {
				return currentMessages;
			}

			roomLocalMessagesRef.current = nextMessages;
			setRoomLocalMessages(nextMessages);
			return nextMessages;
		},
		[],
	);

	const addLocalRoomMessage = useCallback((targetRoomId: string, localMessage: LocalRoomMessage) => {
		commitLocalRoomMessages((currentMessages) => {
			const nextMessages = {
				...currentMessages,
				[targetRoomId]: [...(currentMessages[targetRoomId] ?? []), localMessage],
			};
			return nextMessages;
		});
	}, [commitLocalRoomMessages]);

	const updateLocalRoomMessage = useCallback(
		(targetRoomId: string, messageId: string, updater: (message: LocalRoomMessage) => LocalRoomMessage) => {
			commitLocalRoomMessages((currentMessages) => {
				const currentRoomMessages = currentMessages[targetRoomId] ?? [];
				let changed = false;
				const nextRoomMessages = currentRoomMessages.map((localMessage) => {
					if (localMessage.message.id !== messageId) {
						return localMessage;
					}

					const nextLocalMessage = updater(localMessage);
					if (nextLocalMessage === localMessage) {
						return localMessage;
					}

					changed = true;
					return nextLocalMessage;
				});

				if (!changed) {
					return currentMessages;
				}

				const nextMessages = {
					...currentMessages,
					[targetRoomId]: nextRoomMessages,
				};
				return nextMessages;
			});
		},
		[commitLocalRoomMessages],
	);

	const removeLocalRoomMessage = useCallback(
		(targetRoomId: string, messageId: string) => {
			let removedPreviewUrl: string | undefined;
			commitLocalRoomMessages((currentMessages) => {
				const currentRoomMessages = currentMessages[targetRoomId] ?? [];
				const nextRoomMessages = currentRoomMessages.filter((localMessage) => {
					if (localMessage.message.id === messageId) {
						removedPreviewUrl = localMessage.kind === 'image' ? localMessage.previewUrl : undefined;
						return false;
					}

					return true;
				});

				if (nextRoomMessages.length === currentRoomMessages.length) {
					return currentMessages;
				}

				const nextMessages = { ...currentMessages };
				if (nextRoomMessages.length === 0) {
					delete nextMessages[targetRoomId];
				} else {
					nextMessages[targetRoomId] = nextRoomMessages;
				}
				return nextMessages;
			});

			if (removedPreviewUrl) {
				releaseOptimisticPreviewUrl(removedPreviewUrl);
			}
		},
		[commitLocalRoomMessages, releaseOptimisticPreviewUrl],
	);

	const getLocalRoomMessage = useCallback(
		(targetRoomId: string, messageId: string) =>
			roomLocalMessagesRef.current[targetRoomId]?.find((localMessage) => localMessage.message.id === messageId) ?? null,
		[],
	);

	const appendServerTimelineMessage = useCallback(
		(targetRoomId: string, message: TimelineMessage) => {
			const localMessage =
				roomLocalMessagesRef.current[targetRoomId]?.find((entry) => timelineMessagesShareIdentity(entry.message, message))?.message ?? null;
			const incomingMessage = localMessage ? mergeTimelineMessageWithLocalSubmission(message, localMessage) : message;

			queryClient.setQueryData<RoomTimelineSnapshot | undefined>(
				betterChatQueryKeys.roomTimeline(targetRoomId),
				(currentTimeline) => {
					if (!currentTimeline) {
						return currentTimeline;
					}

					const existingMessageIndex = currentTimeline.messages.findIndex((currentMessage) =>
						timelineMessagesShareIdentity(currentMessage, message),
					);
					if (existingMessageIndex >= 0) {
						const existingMessage = currentTimeline.messages[existingMessageIndex];
						if (!existingMessage) {
							return currentTimeline;
						}
						const submissionId = incomingMessage.submissionId ?? existingMessage.submissionId;

						const mergedMessage: TimelineMessage = {
							...existingMessage,
							...incomingMessage,
							...(submissionId ? { submissionId } : {}),
							replyTo: incomingMessage.replyTo ?? existingMessage.replyTo,
							thread: incomingMessage.thread ?? existingMessage.thread,
							attachments: incomingMessage.attachments ?? existingMessage.attachments,
							reactions: incomingMessage.reactions ?? existingMessage.reactions,
						};
						const nextMessages = [...currentTimeline.messages];
						nextMessages[existingMessageIndex] = mergedMessage;
						return {
							...currentTimeline,
							messages: nextMessages,
						};
					}

					return {
						...currentTimeline,
						messages: [...currentTimeline.messages, incomingMessage],
					};
				},
			);
		},
		[queryClient],
	);

	const enqueueRoomSendTask = useCallback((targetRoomId: string, task: () => Promise<void>) => {
		const previousQueue = sendQueueRef.current[targetRoomId] ?? Promise.resolve();
		const queuedTask = previousQueue.catch(() => undefined).then(task);
		sendQueueRef.current[targetRoomId] = queuedTask;
		void queuedTask.catch(() => undefined).finally(() => {
			if (sendQueueRef.current[targetRoomId] === queuedTask) {
				delete sendQueueRef.current[targetRoomId];
			}
		});
	}, []);

	const requestCurrentRoomBottomStick = useCallback(
		(targetRoomId: string) => {
			if (targetRoomId !== roomId) {
				return false;
			}

			setTimelineScrollToBottomToken((currentToken) => currentToken + 1);
			return true;
		},
		[roomId],
	);

	const touchRoomAfterLocalSend = useCallback(
		(targetRoomId: string, createdAt: string) => {
			queryClient.setQueryData<RoomListSnapshot | undefined>(betterChatQueryKeys.roomList, (currentSidebar) =>
				currentSidebar
					? {
							...currentSidebar,
							rooms: currentSidebar.rooms.map((entry) =>
								entry.id === targetRoomId
									? clearRoomAttention({
											...setRoomVisible(entry),
											lastActivityAt: createdAt,
									  })
									: entry,
							),
					  }
					: currentSidebar,
			);

			queryClient.setQueryData<RoomSnapshot | undefined>(betterChatQueryKeys.room(targetRoomId), (currentRoomDetails) =>
				currentRoomDetails
					? {
							...currentRoomDetails,
							room: clearRoomAttention(currentRoomDetails.room),
					  }
					: currentRoomDetails,
			);
		},
		[queryClient],
	);

	const scheduleLocalRoomMessageSend = useCallback(
		(targetRoomId: string, messageId: string) => {
			const sendKey = createLocalMessageSendKey(targetRoomId, messageId);
			if (localMessageSendLocksRef.current.has(sendKey)) {
				return;
			}

			localMessageSendLocksRef.current.add(sendKey);
			updateRoomPendingSendCount(targetRoomId, 1);
			enqueueRoomSendTask(targetRoomId, async () => {
				try {
					const localMessage = getLocalRoomMessage(targetRoomId, messageId);
					if (!localMessage) {
						return;
					}

					let deliveredMessage: TimelineMessage;

					if (localMessage.kind === 'text') {
						const { message } = await betterChatApi.sendMessage(targetRoomId, {
							submissionId: localMessage.message.submissionId,
							replyToMessageId: localMessage.payload.replyToMessageId,
							text: localMessage.payload.text,
						});
						deliveredMessage =
							!message.replyTo && localMessage.payload.replyPreview ? { ...message, replyTo: localMessage.payload.replyPreview } : message;
					} else {
						const uploadImageFile = (uploadFile: File) =>
							betterChatApi.uploadImage(targetRoomId, {
								file: uploadFile,
								imageDimensions: localMessage.payload.imageDimensions,
								submissionId: localMessage.message.submissionId,
								text: localMessage.payload.text || undefined,
							});

						try {
							const { message } = await uploadImageFile(localMessage.payload.file);
							deliveredMessage = message;
						} catch (error) {
							const explicitUploadFailureMessage = resolveImageUploadFailureMessage(error);
							if (explicitUploadFailureMessage) {
								throw new Error(explicitUploadFailureMessage);
							}

							throw error;
						}
					}

					appendServerTimelineMessage(targetRoomId, deliveredMessage);
					removeLocalRoomMessage(targetRoomId, messageId);
					touchRoomAfterLocalSend(targetRoomId, deliveredMessage.createdAt);
					requestCurrentRoomBottomStick(targetRoomId);
					void Promise.all([
						queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.roomList }),
						queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.room(targetRoomId) }),
					]);
				} catch (error) {
					updateLocalRoomMessage(targetRoomId, messageId, (currentMessage) => ({
						...currentMessage,
						errorMessage: resolveDeliveryErrorMessage(error),
						status: 'failed',
					}));
					void Promise.all([
						queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.roomList }),
						queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.room(targetRoomId) }),
					]);
				} finally {
					updateRoomPendingSendCount(targetRoomId, -1);
					localMessageSendLocksRef.current.delete(sendKey);
				}
			});
		},
		[
			appendServerTimelineMessage,
			enqueueRoomSendTask,
			getLocalRoomMessage,
			queryClient,
			requestCurrentRoomBottomStick,
			removeLocalRoomMessage,
			touchRoomAfterLocalSend,
			updateLocalRoomMessage,
			updateRoomPendingSendCount,
		],
	);

	const enqueueRoomMessage = useCallback(
		({
			replyPreview,
			replyToMessageId,
			scrollCurrentRoomToBottom = false,
			targetRoomId,
			text,
		}: {
			replyPreview?: TimelineMessage['replyTo'];
			replyToMessageId?: string;
			scrollCurrentRoomToBottom?: boolean;
			targetRoomId: string;
			text: string;
		}) => {
			if (!currentUser) {
				throw new Error('当前会话未就绪，暂时无法发送消息。');
			}

			const submissionId = createSubmissionId(targetRoomId);
			const optimisticMessage = createOptimisticTimelineMessage({
				currentUser,
				roomId: targetRoomId,
				replyTo: replyPreview,
				submissionId,
				text,
			});

			addLocalRoomMessage(targetRoomId, {
				kind: 'text',
				message: optimisticMessage,
				payload: {
					replyPreview,
					replyToMessageId,
					text,
				},
				status: 'sending',
			});
			touchRoomAfterLocalSend(targetRoomId, optimisticMessage.createdAt);
			if (scrollCurrentRoomToBottom) {
				requestCurrentRoomBottomStick(targetRoomId);
			}
			scheduleLocalRoomMessageSend(targetRoomId, optimisticMessage.id);
		},
		[addLocalRoomMessage, currentUser, requestCurrentRoomBottomStick, scheduleLocalRoomMessageSend, touchRoomAfterLocalSend],
	);

	const enqueueRoomImage = useCallback(
		({
			file,
			imageDimensions,
			scrollCurrentRoomToBottom = false,
			targetRoomId,
			text,
		}: {
			file: File;
			imageDimensions?: {
				height: number;
				width: number;
			};
			scrollCurrentRoomToBottom?: boolean;
			targetRoomId: string;
			text: string;
		}) => {
			if (!currentUser) {
				throw new Error('当前会话未就绪，暂时无法发送图片。');
			}

			const optimisticPreviewUrl = URL.createObjectURL(file);
			optimisticPreviewUrlsRef.current.add(optimisticPreviewUrl);
			const submissionId = createSubmissionId(targetRoomId);
			const optimisticMessage = createOptimisticTimelineMessage({
				attachments: [
					createOptimisticImageAttachment({
						fileName: file.name,
						height: imageDimensions?.height,
						messageId: submissionId,
						previewUrl: optimisticPreviewUrl,
						width: imageDimensions?.width,
					}),
				],
				currentUser,
				roomId: targetRoomId,
				submissionId,
				text,
			});

			addLocalRoomMessage(targetRoomId, {
				errorMessage: undefined,
				kind: 'image',
				message: optimisticMessage,
				payload: {
					file,
					imageDimensions,
					text,
				},
				previewUrl: optimisticPreviewUrl,
				status: 'sending',
			});
			touchRoomAfterLocalSend(targetRoomId, optimisticMessage.createdAt);
			if (scrollCurrentRoomToBottom) {
				requestCurrentRoomBottomStick(targetRoomId);
			}
			scheduleLocalRoomMessageSend(targetRoomId, optimisticMessage.id);
		},
		[addLocalRoomMessage, currentUser, requestCurrentRoomBottomStick, scheduleLocalRoomMessageSend, touchRoomAfterLocalSend],
	);

	const sendMessage = useCallback(
		async ({ imageDimensions, imageFile, text }: ComposerSubmitPayload) => {
			if (!roomId) {
				throw new Error('当前没有可发送消息的房间。');
			}

			const activeEditTarget = composerEditTarget;
			if (activeEditTarget) {
				try {
					const { message: updatedMessage } = await betterChatApi.editMessage(
						activeEditTarget.roomId,
						activeEditTarget.messageId,
						{ text },
					);

					patchRoomTimeline(activeEditTarget.roomId, (timeline) => ({
						...timeline,
						messages: timeline.messages.map((m) =>
							m.id === activeEditTarget.messageId
								? { ...updatedMessage, actions: m.actions }
								: m,
						),
					}));

					setComposerEditTarget(null);
					void invalidateRoomSnapshotQueries(activeEditTarget.roomId);
				} catch (error) {
					const errorHandler = createMutationErrorHandler<unknown, unknown>({
						showToast: showErrorToast,
						queryClient,
					});
					errorHandler.onError(error, undefined, undefined);
					throw error;
				}
				return;
			}

			const activeReplyTarget = composerReplyTarget;
			if (imageFile) {
				if (activeReplyTarget) {
					throw new Error('当前版本暂不支持图片回复，请先取消回复或仅发送文字。');
				}

				await enqueueRoomImage({
					file: imageFile,
					imageDimensions,
					scrollCurrentRoomToBottom: true,
					targetRoomId: roomId,
					text,
				});
				return;
			}

			setComposerReplyTarget(null);

			try {
				await enqueueRoomMessage({
					replyPreview: activeReplyTarget?.preview,
					replyToMessageId: activeReplyTarget?.sourceMessageId,
					scrollCurrentRoomToBottom: true,
					targetRoomId: roomId,
					text,
				});
			} catch (error) {
				if (activeReplyTarget) {
					setComposerReplyTarget((currentTarget) => currentTarget ?? activeReplyTarget);
				}

				throw error;
			}
		},
		[composerEditTarget, composerReplyTarget, enqueueRoomImage, enqueueRoomMessage, invalidateRoomSnapshotQueries, patchRoomTimeline, queryClient, roomId, showErrorToast],
	);

	const handleReplyMessage = useCallback((message: TimelineMessage) => {
		setForwardDialogSource(null);
		setComposerEditTarget(null);
		setComposerReplyTarget({
			preview: createReplyPreviewFromMessage(message),
			sourceMessageId: message.id,
		});
		setComposerFocusToken((currentToken) => currentToken + 1);
		window.requestAnimationFrame(() => {
			void focusComposer();
		});
	}, [focusComposer]);

	const handleEditMessage = useCallback((message: TimelineMessage) => {
		setComposerReplyTarget(null);
		setForwardDialogSource(null);
		setComposerEditTarget({
			messageId: message.id,
			roomId: message.roomId,
			originalText: message.body.rawMarkdown,
		});
		setComposerFocusToken((currentToken) => currentToken + 1);
		window.requestAnimationFrame(() => {
			void focusComposer();
		});
	}, [focusComposer]);

	const handleDeleteMessage = useCallback((message: TimelineMessage) => {
		setDeleteDialogSource({ message, isSubmitting: false });
	}, []);

	const handleDeleteConfirm = useCallback(async () => {
		const source = deleteDialogSource;
		if (!source || source.isSubmitting) {
			return;
		}

		setDeleteDialogSource((current) => current ? { ...current, isSubmitting: true } : current);

		try {
			await betterChatApi.deleteMessage(source.message.roomId, source.message.id);

			patchRoomTimeline(source.message.roomId, (timeline) => ({
				...timeline,
				messages: timeline.messages.map((m) =>
					m.id === source.message.id
						? { ...m, body: { rawMarkdown: '' }, flags: { ...m.flags, deleted: true } }
						: m,
				),
			}));

			setDeleteDialogSource(null);
			void invalidateRoomSnapshotQueries(source.message.roomId);
		} catch (error) {
			setDeleteDialogSource((current) => current ? { ...current, isSubmitting: false } : current);
			const errorHandler = createMutationErrorHandler<unknown, unknown>({
				showToast: showErrorToast,
				queryClient,
			});
			errorHandler.onError(error, undefined, undefined);
		}
	}, [deleteDialogSource, invalidateRoomSnapshotQueries, patchRoomTimeline, queryClient, showErrorToast]);

	const handleClearEdit = useCallback(() => {
		setComposerEditTarget(null);
	}, []);

	const handleForwardMessage = useCallback(
		(message: TimelineMessage) => {
			setComposerReplyTarget(null);
			setForwardDialogSource({
				message,
				roomTitle: activeRoomTitle,
			});
		},
		[activeRoomTitle],
	);

	const handleForwardSubmit = useCallback(
		async ({ note, roomId: targetRoomId }: { note: string; roomId: string }) => {
			const source = forwardDialogSource;
			if (!source) {
				throw new Error('当前没有可转发的消息。');
			}

			await enqueueRoomMessage({
				scrollCurrentRoomToBottom: targetRoomId === roomId,
				targetRoomId,
				text: buildForwardedMessageMarkdown({
					leadText: note,
					message: source.message,
					roomTitle: source.roomTitle,
				}),
			});

			const targetRoomTitle =
				sidebarEntries.find((entry) => entry.id === targetRoomId)?.title ??
				(targetRoomId === roomId ? activeRoomTitle : '目标房间');
			const toastId = Date.now();
			const actionable = targetRoomId !== roomId;

			if (forwardToastTimerRef.current) {
				window.clearTimeout(forwardToastTimerRef.current);
			}

			setForwardToast({
				actionable,
				id: toastId,
				roomId: targetRoomId,
				roomTitle: targetRoomTitle,
			});

			forwardToastTimerRef.current = window.setTimeout(() => {
				forwardToastTimerRef.current = null;
				setForwardToast((currentToast) => (currentToast?.id === toastId ? null : currentToast));
			}, actionable ? 4400 : 3000);
		},
		[activeRoomTitle, enqueueRoomMessage, forwardDialogSource, roomId, sidebarEntries],
	);

	const handleForwardToastJump = useCallback(() => {
		if (!forwardToast?.actionable) {
			return;
		}

		const targetRoomId = forwardToast.roomId;
		clearForwardToast();
		setPendingForwardJumpRoomId(targetRoomId);
		openRoom(targetRoomId);
	}, [clearForwardToast, forwardToast, openRoom]);

	const handleLogout = useCallback(() => {
		if (logoutMutation.isPending) {
			return;
		}

		logoutMutation.mutate();
	}, [logoutMutation]);
	const favoriteToggleBusy = !favoriteOverridesEnabled && favoriteMutationInFlight;

	const handleFavoriteToggle = useCallback(() => {
		if (!roomId) {
			return;
		}

		if (!favoriteOverridesEnabled) {
			const queuedFavoriteMutation = {
				targetRoomId: roomId,
				favorite: !roomIsFavorite,
			};
			if (!favoriteMutationInFlight) {
				setFavoriteMutationInFlight(true);
				favoriteMutation.mutate(queuedFavoriteMutation);
				return;
			}

			queuedFavoriteMutationRef.current = queuedFavoriteMutation;
			return;
		}

		setFavoriteOverrides((currentOverrides) =>
			updateFavoriteOverrides({
				overrides: currentOverrides,
				roomId,
				serverValue: roomFavoriteServerValue,
				nextValue: !resolveFavoriteOverride({
					overrides: currentOverrides,
					roomId,
					serverValue: roomFavoriteServerValue,
				}),
			}),
		);
	}, [favoriteMutation, favoriteMutationInFlight, favoriteOverridesEnabled, roomFavoriteServerValue, roomId, roomIsFavorite]);

	const handleRetryFailedMessage = useCallback(
		(messageId: string) => {
			if (!roomId) {
				return;
			}

			const localMessage = getLocalRoomMessage(roomId, messageId);
			if (!localMessage || localMessage.status !== 'failed') {
				return;
			}

			updateLocalRoomMessage(roomId, messageId, (currentMessage) => ({
				...currentMessage,
				errorMessage: undefined,
				status: 'sending',
			}));
			setTimelineExpansionRequest((currentRequest) => ({
				messageId,
				token: (currentRequest?.token ?? 0) + 1,
			}));
			requestCurrentRoomBottomStick(roomId);
			scheduleLocalRoomMessageSend(roomId, messageId);
		},
		[getLocalRoomMessage, requestCurrentRoomBottomStick, roomId, scheduleLocalRoomMessageSend, updateLocalRoomMessage],
	);

	const handleRemoveFailedMessage = useCallback(
		(messageId: string) => {
			if (!roomId) {
				return;
			}

			removeLocalRoomMessage(roomId, messageId);
		},
		[removeLocalRoomMessage, roomId],
	);

	const handleRoomAlertPreferenceChange = useCallback(
		(nextPreference: RoomAlertPreference) => {
			if (!roomId || !activeRoomKind) {
				return;
			}

			setRoomAlertPreferences((currentPreferences) =>
				updateRoomAlertPreferences({
					defaults: roomNotificationDefaults,
					preferences: currentPreferences,
					roomId,
					roomKind: activeRoomKind,
					nextValue: nextPreference,
				}),
			);
		},
		[activeRoomKind, roomId, roomNotificationDefaults],
	);
	const handleRoomAlertMenuToggle = useCallback(() => {
		if (!roomId) {
			return;
		}

		setRoomAlertMenuOpen((currentOpen) => !currentOpen);
	}, [roomId]);
	const handleRoomAlertDefaultSelect = useCallback(() => {
		handleRoomAlertPreferenceChange(activeRoomDefaultAlertPreference);
		setRoomAlertMenuOpen(false);
	}, [activeRoomDefaultAlertPreference, handleRoomAlertPreferenceChange]);
	const handleBrowserNotificationDeliveryChange = useCallback(
		async (nextDelivery: BrowserNotificationDelivery) => {
			if (nextDelivery === browserNotificationDelivery) {
				return;
			}

			if (nextDelivery !== 'off' && typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'default') {
				const nextPermission = await window.Notification.requestPermission().catch(() => resolveBrowserNotificationPermissionState());
				setBrowserNotificationPermission(nextPermission);
			} else {
				setBrowserNotificationPermission(resolveBrowserNotificationPermissionState());
			}

			setBrowserNotificationDelivery(nextDelivery);
		},
		[browserNotificationDelivery],
	);
	const handleMotionPreferenceChange = useCallback((nextPreference: MotionPreference) => {
		setMotionPreference(nextPreference);
	}, []);

	return (
		<div className={styles.page} data-testid='app-shell' data-theme-surface='true'>
			<header className={styles.topBar}>
				<div className={styles.brandBlock}>
					<div className={styles.brandMark} />
					<div>
						<p className={styles.brandEyebrow}>{spaceText('BetterChat 产品路由')}</p>
						<h1 className={styles.brandTitle}>BetterChat</h1>
					</div>
				</div>

				<div className={styles.topBarMeta}>
					<span className={styles.environmentPill}>{spaceText(betterChatApi.mode === 'fixture' ? '合同夹具模式' : 'BetterChat API')}</span>
					{currentUser ? (
						<div className={styles.userBadge} data-secondary={secondaryUserLabel ? 'true' : 'false'} data-testid='current-user'>
							<span className={styles.userAvatarShell} data-status={userPresence?.tone ?? 'unknown'}>
								<span className={styles.userAvatar}>{getAvatarLabel(primaryUserLabel)}</span>
								{userPresence ? (
									<span
										aria-label={spaceText(`当前状态：${userPresence.label}`)}
										className={styles.userPresenceDot}
										data-status={userPresence.tone}
										data-testid='current-user-status-dot'
										title={spaceText(userPresence.label)}
									/>
								) : null}
							</span>
							<div className={styles.userMeta}>
								<div className={styles.userPrimaryRow}>
									<strong className={styles.userName}>{spaceText(primaryUserLabel)}</strong>
								</div>
								{secondaryUserLabel || userPresence ? (
									<div className={styles.userSecondaryRow}>
										{secondaryUserLabel ? <span className={styles.userHandle}>{secondaryUserLabel}</span> : null}
										{secondaryUserLabel && userPresence ? <span aria-hidden='true' className={styles.userSecondarySeparator}>·</span> : null}
										{userPresence ? (
											<span className={styles.userPresenceLabel} data-status={userPresence.tone} data-testid='current-user-status'>
												{spaceText(userPresence.label)}
											</span>
										) : null}
									</div>
								) : null}
							</div>
						</div>
					) : null}
						<SettingsPanel
							browserNotificationBackgroundSupported={browserNotificationBackgroundAvailable}
							browserNotificationDelivery={browserNotificationDelivery}
							browserNotificationPermission={browserNotificationPermission}
							onBrowserNotificationDeliveryChange={handleBrowserNotificationDeliveryChange}
							onOpenChange={setSettingsOpen}
							onComposerSendShortcutChange={setComposerSendShortcut}
							onLogout={handleLogout}
							onMotionPreferenceChange={handleMotionPreferenceChange}
							onRoomNotificationDefaultsChange={setRoomNotificationDefaults}
							onThemePreferenceChange={setThemePreference}
							open={settingsOpen}
							logoutPending={logoutMutation.isPending}
							motionPreference={motionPreference}
							resolvedTheme={resolvedTheme}
							roomNotificationDefaults={roomNotificationDefaults}
							sendShortcut={composerSendShortcut}
							themePreference={themePreference}
						/>
				</div>
			</header>

			<div
				className={`${styles.workspace} ${roomInfoOpen ? styles.workspaceWithInfo : ''}`.trim()}
				data-testid='app-workspace'
				onTransitionEnd={(event) => {
					if (event.propertyName === 'grid-template-columns') {
						(event.currentTarget as HTMLElement).removeAttribute('data-sidebar-transitioning');
					}
				}}
				ref={workspaceRef}
				style={workspaceStyle}
			>
				<aside className={styles.sidebar} data-collapsed={effectiveSidebarCollapsed ? 'true' : 'false'} data-testid='app-sidebar' data-theme-surface='true' id='app-sidebar' ref={sidebarRef}>
					<div className={styles.sidebarHeader}>
						<p className={styles.sidebarEyebrow}>{spaceText('工作区')}</p>
						<h2 className={styles.sidebarTitle}>{spaceText(bootstrapQuery.data?.workspace.name ?? '工作区')}</h2>
					</div>

					<div className={styles.searchBlock}>
						<label className={styles.searchField}>
							<input
								ref={searchInputRef}
								aria-keyshortcuts='Control+K Meta+K'
								className={styles.searchInput}
								data-testid='sidebar-search'
								onChange={(event) => setSearchValue(event.target.value)}
								onFocus={() => updateKeyboardFocusRegion(null)}
								onKeyDown={(event) => {
									const action = resolveSidebarSearchKeyAction({
										hasFallbackRoom: Boolean(focusedSidebarRoomId ?? roomId ?? visibleSidebarRoomIds[0] ?? null),
										hasFirstSearchResult: Boolean(firstSearchResult),
										hasVisibleSidebarRooms: visibleSidebarRoomIds.length > 0,
										key: event.key,
										searchValue,
									});

									if (!action) {
										return;
									}

									event.preventDefault();

									if (action === 'open-first-result') {
										openRoom(firstSearchResult!.id);
										return;
									}

									if (action === 'focus-first-room') {
										void focusSidebarRoom(visibleSidebarRoomIds[0] ?? null);
										return;
									}

									if (action === 'focus-header') {
										void focusRoomHeaderControl('favorite');
										return;
									}

									if (action === 'clear-search') {
										setSearchValue('');
										return;
									}

									void focusSidebarRoom(focusedSidebarRoomId ?? roomId ?? visibleSidebarRoomIds[0] ?? null);
								}}
								placeholder={spaceText(searchPlaceholder)}
								value={searchValue}
							/>
							<span className={styles.searchShortcut} aria-hidden='true' data-testid='sidebar-search-shortcut'>
								<span className={styles.searchKeycap} data-testid='sidebar-search-shortcut-modifier'>
									{searchShortcutModifierLabel}
								</span>
								<span className={styles.searchKeycap} data-testid='sidebar-search-shortcut-key'>
									K
								</span>
							</span>
						</label>
					</div>

					{sidebarAttentionDock.entries.length > 0 ? (
						<SidebarAttentionDock
							entries={sidebarAttentionDock.entries}
							onOpenRoom={openRoom}
							overflowCount={sidebarAttentionDock.overflowCount}
						/>
					) : null}

					<div
						className={styles.sidebarBody}
						data-navigation-mode={sidebarInteractionMode}
						data-testid='sidebar-body'
						ref={sidebarBodyRef}
						onPointerDownCapture={(event) => {
							if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
								markSidebarPointerInteraction();
							}
						}}
						onPointerMoveCapture={(event) => {
							if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
								markSidebarPointerInteraction();
							}
						}}
					>
						{shellLoading ? <p className={styles.sidebarState}>{spaceText('正在加载侧栏…')}</p> : null}
						{hasShellError ? <p className={styles.sidebarState}>{spaceText(bootstrapError?.message ?? sidebarError?.message ?? '加载失败')}</p> : null}
						{!shellLoading && !hasShellError && sidebarGroups.length === 0 ? (
							<p className={styles.sidebarState}>{spaceText(searchValue ? '没有找到匹配的房间。' : '当前没有可显示的房间。')}</p>
						) : null}
						{sidebarGroups.map((group) => (
							<section key={group.key} className={styles.sidebarSection} data-testid={`sidebar-section-${group.key}`}>
								<h3 className={styles.sectionTitle}>{spaceText(group.title)}</h3>
								<div className={styles.roomList}>
									{group.entries.map((entry) => {
										const entryRoomId = entry.id;
										const entryUnreadCount = getRoomUnreadCount(entry);
										const entryMentioned = isRoomMentioned(entry);
										const secondaryMeta = resolveSidebarSecondaryMeta(entry);
										const unreadBadgeLabel = formatSidebarUnreadBadgeCount(entryUnreadCount);
										const mentionSignal = resolveSidebarMentionSignal({
											mentioned: entryMentioned,
											unreadCount: entryUnreadCount,
										});
										const alertPreference = resolveRoomAlertPreference({
											defaults: roomNotificationDefaults,
											preferences: roomAlertPreferences,
											roomId: entryRoomId,
											roomKind: entry.kind,
										});
										const roomStatusText =
											secondaryMeta.presenceLabel && secondaryMeta.text
											? `${secondaryMeta.presenceLabel} · ${secondaryMeta.text}`
											: secondaryMeta.presenceLabel ?? secondaryMeta.text;

										return (
											<button
												key={entryRoomId}
												ref={setSidebarRoomRef(entryRoomId)}
												className={styles.roomRow}
												data-active={entryRoomId === roomId ? 'true' : 'false'}
												data-attention-level={entry.attention.level}
												data-keyboard-focused={focusedSidebarRoomId === entryRoomId ? 'true' : 'false'}
												data-mentioned={entryMentioned ? 'true' : 'false'}
												data-priority={alertPreference}
												data-keyboard-visible={
													sidebarInteractionMode === 'keyboard' &&
													keyboardFocusRegion === 'sidebar-list' &&
													focusedSidebarRoomId === entryRoomId
														? 'true'
														: 'false'
												}
												data-testid={`sidebar-room-${entryRoomId}`}
												onFocus={() => {
													setFocusedSidebarRoomId(entryRoomId);
													updateKeyboardFocusRegion('sidebar-list');
												}}
												onClick={() => openRoom(entryRoomId)}
												onKeyDown={(event) => {
													const currentIndex = visibleSidebarRoomIds.indexOf(entryRoomId);
													if (currentIndex < 0) {
														return;
													}

													if (shouldIgnoreHeldSidebarArrowNavigation(event)) {
														return;
													}

													if (event.key === 'ArrowDown') {
														event.preventDefault();
														void focusSidebarRoom(visibleSidebarRoomIds[Math.min(currentIndex + 1, visibleSidebarRoomIds.length - 1)] ?? null);
														return;
													}

													if (event.key === 'ArrowUp') {
														event.preventDefault();
														if (currentIndex === 0) {
															void focusSidebarSearch();
															return;
														}

														void focusSidebarRoom(visibleSidebarRoomIds[Math.max(currentIndex - 1, 0)] ?? null);
														return;
													}

													if (event.key === 'Home') {
														event.preventDefault();
														void focusSidebarRoom(visibleSidebarRoomIds[0] ?? null);
														return;
													}

													if (event.key === 'End') {
														event.preventDefault();
														void focusSidebarRoom(visibleSidebarRoomIds.at(-1) ?? null);
														return;
													}

													if (event.key === 'ArrowRight') {
														event.preventDefault();
														void focusTimeline();
													}
												}}
												tabIndex={focusedSidebarRoomId === entryRoomId ? 0 : -1}
												type='button'
											>
												<div className={styles.roomIdentity}>
													<span className={styles.roomAvatarShell} data-testid={`sidebar-room-avatar-shell-${entryRoomId}`}>
														<span className={styles.roomAvatar} data-kind={entry.kind}>
															{entry.kind === 'dm' ? getAvatarLabel(entry.title) : roomKindGlyph[entry.kind]}
														</span>
														{entry.kind === 'dm' && secondaryMeta.presence ? (
															<span
																aria-label={spaceText(`当前状态：${secondaryMeta.presence.label}`)}
																className={styles.roomPresenceDot}
																data-status={secondaryMeta.presence.tone}
																data-testid={`sidebar-room-presence-${entryRoomId}`}
																title={spaceText(secondaryMeta.presence.label)}
															/>
														) : null}
													</span>
													<div className={styles.roomInfo}>
														<span className={styles.roomNameRow}>
															<span className={styles.roomName} title={spaceText(entry.title)}>
																{spaceText(entry.title)}
															</span>
														</span>
														<span
															className={styles.roomStatus}
															data-testid={`sidebar-room-status-${entryRoomId}`}
															title={spaceText(roomStatusText)}
														>
															{spaceText(roomStatusText)}
														</span>
													</div>
												</div>

												<div className={styles.roomSignals}>
													<span
														aria-hidden={mentionSignal.showSignal ? undefined : true}
														aria-label={mentionSignal.showSignal ? spaceText(mentionSignal.title ?? '提及我') : undefined}
														className={styles.mentionBadge}
														data-testid={`sidebar-room-mention-${entryRoomId}`}
														data-visible={mentionSignal.showSignal ? 'true' : 'false'}
														title={mentionSignal.showSignal ? spaceText(mentionSignal.title ?? '提及我') : undefined}
													>
														@
													</span>
													<span
														aria-hidden={unreadBadgeLabel ? undefined : true}
														aria-label={
															unreadBadgeLabel
																? spaceText(`${mentionSignal.badgeAriaPrefix ?? ''}未读 ${String(entryUnreadCount)} 条消息`)
																: undefined
														}
														className={styles.roomBadge}
														data-length={unreadBadgeLabel ? String(unreadBadgeLabel.length) : undefined}
														data-mentioned={entryMentioned ? 'true' : 'false'}
														data-priority={alertPreference}
														data-testid={`sidebar-room-badge-${entryRoomId}`}
														data-visible={unreadBadgeLabel ? 'true' : 'false'}
													>
														{unreadBadgeLabel ?? ''}
													</span>
												</div>
											</button>
										);
									})}
								</div>
							</section>
						))}
					</div>
				</aside>

				<div
					aria-controls='app-sidebar'
					aria-label={spaceText(effectiveSidebarCollapsed ? '展开侧栏' : '调整侧栏宽度')}
					aria-orientation='vertical'
					aria-valuemax={sidebarWidthBounds.max}
					aria-valuemin={0}
					aria-valuenow={Math.round(visibleSidebarWidth)}
					aria-valuetext={spaceText(
						effectiveSidebarCollapsed
							? '已收起'
							: `${Math.round(visibleSidebarWidth)} 像素${sidebarResizeKeyboardAdjusting ? '，调整中' : ''}`,
					)}
					className={styles.sidebarResizeRail}
					data-dragging={sidebarResizeDragging ? 'true' : 'false'}
					data-keyboard-adjusting={sidebarResizeKeyboardAdjusting ? 'true' : 'false'}
					data-sidebar-collapsed={effectiveSidebarCollapsed ? 'true' : 'false'}
					data-testid='sidebar-resize-handle'
					onBlur={clearSidebarResizeKeyboardAdjusting}
					onDoubleClick={handleSidebarResizeDoubleClick}
					onFocus={() => updateKeyboardFocusRegion(null)}
					onKeyDown={handleSidebarResizeKeyDown}
					onLostPointerCapture={() => stopSidebarResize()}
					onPointerCancel={(event) => stopSidebarResize(event.pointerId)}
					onPointerDown={handleSidebarResizePointerDown}
					onPointerMove={handleSidebarResizePointerMove}
					onPointerUp={(event) => stopSidebarResize(event.pointerId)}
					role='separator'
					tabIndex={sidebarResizeEnabled ? 0 : -1}
				/>

					<section className={styles.mainPanel} data-theme-surface='true'>
						<header className={styles.roomHeader}>
							<div className={styles.roomIdentityBlock}>
								<p className={styles.panelEyebrow}>{spaceText(roomKindLabel[roomKind])}</p>
								<div className={styles.roomTitleRow}>
									<div className={styles.roomTitleMeta}>
										<div className={styles.roomTitleCluster}>
											<h2 className={styles.roomTitle} data-testid='room-title'>
												<span className={styles.roomTitleText} data-testid='room-title-text'>
													{spaceText(roomDetailsQuery.data?.room.title ?? activeEntry?.title ?? '选择房间')}
												</span>
											</h2>
										</div>
										<div className={styles.roomHeaderActions}>
											<button
												aria-label={roomIsFavorite ? '取消收藏当前房间' : '收藏当前房间'}
												aria-pressed={roomIsFavorite}
												aria-busy={favoriteToggleBusy}
												className={styles.favoriteToggle}
												data-active={roomIsFavorite ? 'true' : 'false'}
												data-pending={favoriteToggleBusy ? 'true' : 'false'}
												data-testid='room-favorite-toggle'
												onClick={handleFavoriteToggle}
												onFocus={() => updateKeyboardFocusRegion('header')}
												onKeyDown={(event) => {
													if (event.key === 'ArrowLeft') {
														event.preventDefault();
														focusSidebarSearch();
														return;
													}

													if (event.key === 'ArrowRight') {
														event.preventDefault();
														roomAlertToggleRef.current?.focus();
														return;
													}

													if (event.key === 'ArrowDown') {
														event.preventDefault();
														void focusTimeline();
													}
												}}
												ref={favoriteToggleRef}
												type='button'
												>
													<svg aria-hidden='true' className={styles.favoriteToggleIcon} viewBox='0 0 16 16'>
														<path d='M8 1.85 9.84 5.56l4.1.6-2.97 2.9.7 4.09L8 11.17l-3.67 1.98.7-4.09L2.06 6.16l4.1-.6L8 1.85Z' />
													</svg>
											</button>
											<div className={styles.roomAlertMenuShell}>
												<button
													aria-controls={roomAlertMenuOpen ? 'room-alert-menu' : undefined}
													aria-expanded={roomAlertMenuOpen}
													aria-haspopup='menu'
													aria-label={`打开房间通知设置，当前：${roomAlertPreferenceLabel[activeRoomAlertPreference]}`}
													className={styles.roomAlertToggle}
													data-active={activeRoomAlertPreference}
													data-testid='room-alert-toggle'
													onClick={handleRoomAlertMenuToggle}
													onFocus={() => updateKeyboardFocusRegion('header')}
													onKeyDown={(event) => {
														if (event.key === 'ArrowLeft') {
															event.preventDefault();
															favoriteToggleRef.current?.focus();
															return;
														}

														if (event.key === 'ArrowRight') {
															event.preventDefault();
															roomInfoTriggerRef.current?.focus();
															return;
														}

														if (event.key === 'ArrowDown') {
															event.preventDefault();
															void focusTimeline();
														}
													}}
													ref={roomAlertToggleRef}
													title={spaceText(`当前房间通知：${roomAlertPreferenceLabel[activeRoomAlertPreference]}`)}
													type='button'
												>
													<span aria-hidden='true' className={styles.roomAlertToggleIcon}>
														<RoomAlertToggleGlyph preference={activeRoomAlertPreference} />
													</span>
												</button>
												{roomAlertMenuOpen ? (
													<div
														className={styles.roomAlertMenu}
														data-theme-surface='true'
														data-testid='room-alert-menu'
														id='room-alert-menu'
														ref={roomAlertMenuRef}
														role='menu'
													>
														<button
															aria-checked={activeRoomAlertUsesDefault}
															className={styles.roomAlertMenuItem}
															data-active={activeRoomAlertUsesDefault ? 'true' : 'false'}
															data-testid='room-alert-menu-default'
															onClick={handleRoomAlertDefaultSelect}
															role='menuitemradio'
															type='button'
														>
															<span className={styles.roomAlertMenuCopy}>
																<strong>{spaceText('跟随默认')}</strong>
																<span>
																	{spaceText(
																		`当前默认：${resolveRoomAlertDefaultLabel({
																			defaults: roomNotificationDefaults,
																			roomKind: activeRoomKind ?? roomKind,
																		})}`,
																	)}
																</span>
															</span>
															<span aria-hidden='true' className={styles.roomAlertMenuIndicator} />
														</button>
														{(['all', 'personal', 'mute'] as const).map((preference) => (
															<button
																key={preference}
																aria-checked={!activeRoomAlertUsesDefault && activeRoomAlertPreference === preference}
																className={styles.roomAlertMenuItem}
																data-active={!activeRoomAlertUsesDefault && activeRoomAlertPreference === preference ? 'true' : 'false'}
																data-testid={`room-alert-menu-${preference}`}
																onClick={() => {
																	handleRoomAlertPreferenceChange(preference);
																	setRoomAlertMenuOpen(false);
																}}
																role='menuitemradio'
																type='button'
															>
																<span className={styles.roomAlertMenuCopy}>
																	<strong>{spaceText(roomAlertPreferenceLabel[preference])}</strong>
																	<span>
																		{spaceText(
																			resolveRoomAlertPreferenceDescription({
																				preference,
																				roomKind: activeRoomKind ?? roomKind,
																			}),
																		)}
																	</span>
																</span>
																<span aria-hidden='true' className={styles.roomAlertMenuIndicator} />
															</button>
														))}
													</div>
												) : null}
											</div>
											<button
												aria-controls={roomInfoOpen ? 'room-info-sidebar' : undefined}
												aria-expanded={roomInfoOpen}
												aria-label={roomInfoOpen ? '关闭房间信息' : '打开房间信息'}
												className={styles.roomInfoTrigger}
												data-open={roomInfoOpen ? 'true' : 'false'}
												data-testid='room-info-trigger'
												onClick={() => setRoomInfoOpen((currentState) => !currentState)}
												onFocus={() => updateKeyboardFocusRegion('header')}
												onKeyDown={(event) => {
													if (event.key === 'ArrowLeft') {
														event.preventDefault();
														roomAlertToggleRef.current?.focus();
														return;
													}

													if (event.key === 'ArrowDown') {
														event.preventDefault();
														void focusTimeline();
														return;
													}

													if (event.key === 'Escape' && roomInfoOpen) {
														event.preventDefault();
														closeRoomInfoSidebarToTarget('info');
													}
												}}
												ref={roomInfoTriggerRef}
												type='button'
											>
												<span aria-hidden='true' className={styles.roomInfoTriggerIcon}>
													<RoomInfoGlyph />
												</span>
											</button>
										</div>
									</div>
								</div>
								{roomKind === 'dm' && activeRoomPresence && activeRoomHeaderPresenceText ? (
									<p
										aria-label={spaceText(`当前状态：${activeRoomPresence.label}${activeRoomHandle ? `，${activeRoomHandle}` : ''}`)}
										className={styles.roomPresenceMeta}
										data-status={activeRoomPresence.tone}
										data-testid='room-header-presence'
									>
										<span aria-hidden='true' className={styles.roomHeaderPresenceDot} data-testid='room-header-presence-dot' />
										<span className={styles.roomPresenceMetaText} data-testid='room-header-presence-text'>
											{spaceText(activeRoomHeaderPresenceText)}
										</span>
									</p>
								) : (
									<p className={styles.roomSummary}>
										{spaceText(
											roomDetailsQuery.data?.room.topic ??
												roomDetailsQuery.data?.room.description ??
												activeEntry?.subtitle ??
												'从左侧打开一个房间，进入真实产品壳层。',
										)}
									</p>
								)}
							</div>
						</header>

					{roomLoading ? <RoomLoadingSkeleton /> : null}
					{!roomLoading && (roomDetailsError || timelineError) ? (
						<div className={styles.statePanel}>{spaceText(roomDetailsError?.message ?? timelineError?.message ?? '房间加载失败。')}</div>
					) : null}
					{!roomLoading && !roomDetailsError && !timelineError && activeRoomTimeline ? (
						<div className={styles.conversationBody} ref={conversationBodyRef}>
							<TimelineView
								authorQuickPanelEnabled={roomKind !== 'dm'}
								authorQuickPanelLookup={timelineAuthorDirectConversationQuery.data}
								authorQuickPanelLookupPending={timelineAuthorDirectConversationQuery.isPending}
								authorQuickPanelRequestedUserId={activeTimelineAuthorUserId}
								authorQuickPanelSubmitting={
									Boolean(activeTimelineAuthorUserId) &&
									ensureDirectConversationMutation.isPending &&
									ensureDirectConversationMutation.variables === activeTimelineAuthorUserId
								}
								currentUser={currentUser}
								expansionRequest={timelineExpansionRequest}
								failedMessageActions={activeRoomFailedMessageActions}
								focusRequest={timelineFocusRequest}
								forceScrollToBottomToken={timelineScrollToBottomToken}
								hasOlderHistory={activeRoomHasOlderHistory}
								isLoadingOlderHistory={activeRoomOlderHistoryLoading}
								keyboardFocusActive={keyboardFocusRegion === 'timeline'}
								localOutgoingMessageIds={activeRoomLocalOutgoingMessageIds}
								mentionInteractionUsers={activeRoomMentionInteractionUsers}
									messageDeliveryStates={activeRoomMessageDeliveryStates}
									onCloseAuthorQuickPanel={closeTimelineAuthorQuickPanel}
									onEnsureAuthorDirectConversation={ensureTimelineAuthorDirectConversation}
									onFocusWithin={() => updateKeyboardFocusRegion('timeline')}
									onForwardMessage={handleForwardMessage}
									onLoadOlderHistory={roomId ? () => loadOlderRoomHistory(roomId) : undefined}
									onPrefetchOlderHistory={roomId ? () => prefetchOlderRoomHistory(roomId) : undefined}
									onNavigateComposer={focusComposer}
									onNavigateHeader={focusRoomHeaderControl}
									onOpenAuthorQuickPanel={openTimelineAuthorQuickPanel}
									onPrepareAuthorQuickPanel={prepareTimelineAuthorQuickPanel}
									pendingLocalSendCount={activeRoomPendingSendCount}
								onRequestMarkRead={handleRequestMarkRead}
								onRemoveFailedMessage={handleRemoveFailedMessage}
								onResolveReplyTarget={resolveReplyTargetFromContext}
								onNavigateSidebar={() => focusSidebarRoom(focusedSidebarRoomId ?? roomId ?? visibleSidebarRoomIds[0] ?? null)}
									onRetryFailedMessage={handleRetryFailedMessage}
									onReplyMessage={handleReplyMessage}
									onEditMessage={handleEditMessage}
									onDeleteMessage={handleDeleteMessage}
									roomMentioned={activeEntry ? isRoomMentioned(activeEntry) : false}
									motionPreference={motionPreference}
									timeline={activeRoomTimeline}
								/>

							<div
								className={styles.composerSection}
								data-readonly={showReadonlyComposerNotice ? 'true' : 'false'}
								ref={composerSectionRef}
								style={showReadonlyComposerNotice ? undefined : composerSectionStyle}
							>
								{showReadonlyComposerNotice ? (
									<div className={styles.readonlyComposerSection} data-testid='readonly-composer'>
										<div aria-hidden='true' className={styles.readonlyComposerBoundary} />
										<div
											aria-label='只读房间提示'
											className={styles.readonlyComposerNotice}
											data-testid='readonly-composer-notice'
											role='note'
										>
											<span aria-hidden='true' className={styles.readonlyComposerIcon}>
												<svg viewBox='0 0 16 16'>
													<path
														d='M5.35 6.3V5.5a2.65 2.65 0 1 1 5.3 0v.8'
														fill='none'
														stroke='currentColor'
														strokeLinecap='round'
														strokeLinejoin='round'
														strokeWidth='1.2'
													/>
													<rect
														fill='none'
														height='6.2'
														rx='1.55'
														stroke='currentColor'
														strokeWidth='1.2'
														width='8.6'
														x='3.7'
														y='6.1'
													/>
													<circle cx='8' cy='9.2' fill='currentColor' r='0.85' />
												</svg>
											</span>
											<p className={styles.readonlyComposerCopy}>{spaceText(composerDisabledReason ?? '此房间不允许发送消息。')}</p>
										</div>
									</div>
								) : (
									<>
										<div
											aria-label='调整发送框高度'
											aria-orientation='horizontal'
											aria-valuemax={composerHeightBounds.max}
											aria-valuemin={composerHeightBounds.min}
											aria-valuenow={resolvedComposerEditorHeight}
											aria-valuetext={spaceText(`${Math.round(resolvedComposerEditorHeight)} 像素${composerResizeKeyboardAdjusting ? '，调整中' : ''}`)}
											className={styles.composerResizeRail}
											data-dragging={composerResizeDragging ? 'true' : 'false'}
											data-keyboard-adjusting={composerResizeKeyboardAdjusting ? 'true' : 'false'}
											data-testid='composer-resize-handle'
											onBlur={() => setComposerResizeKeyboardAdjusting(false)}
											onFocus={() => updateKeyboardFocusRegion(null)}
											onKeyDown={handleComposerResizeKeyDown}
											onLostPointerCapture={() => stopComposerResize()}
											onPointerCancel={(event) => stopComposerResize(event.pointerId)}
											onPointerDown={handleComposerResizePointerDown}
											onPointerMove={handleComposerResizePointerMove}
											onPointerUp={(event) => stopComposerResize(event.pointerId)}
											role='separator'
											tabIndex={0}
										/>

										<ComposerBar
											ref={composerBarRef}
											canUploadImages={canUploadImages}
											disabled={!canSendMessages}
											disabledReason={composerDisabledReason}
											focusToken={composerFocusToken}
											onFocusChange={handleComposerFocusChange}
											onReadyChange={handleComposerReadyChange}
											onNavigateUpBoundary={() => focusTimeline('bottom-visible')}
											onClearReply={() => setComposerReplyTarget(null)}
											editTarget={composerEditTarget ? { messageId: composerEditTarget.messageId, originalText: composerEditTarget.originalText } : null}
											onClearEdit={handleClearEdit}
											pendingCount={activeRoomPendingSendCount}
											onSend={sendMessage}
											replyTo={composerReplyTarget?.preview ?? null}
											roomId={roomId}
											sendShortcut={composerSendShortcut}
										/>
									</>
								)}
							</div>
						</div>
					) : null}
					{!roomLoading && !roomId && !sidebarEntries.length && !hasShellError ? (
						<div className={styles.statePanel}>{spaceText('当前没有可打开的房间。')}</div>
					) : null}
				</section>

				{roomInfoOpen && roomDetailsQuery.data ? (
					<aside
						className={styles.infoSidebar}
						data-theme-surface='true'
						data-testid='room-info-sidebar'
						id='room-info-sidebar'
						onKeyDown={(event) => {
							if (event.key === 'ArrowLeft') {
								event.preventDefault();
								closeRoomInfoSidebarToTarget('timeline');
								return;
							}

							if (event.key === 'Escape') {
								event.preventDefault();
								closeRoomInfoSidebarToTarget('info');
							}
						}}
					>
						<div className={styles.infoSidebarContent}>
							<div className={styles.infoSidebarHeader}>
								<p className={styles.panelEyebrow}>{spaceText('补充信息')}</p>
								<h3 className={styles.infoTitle}>{spaceText(roomDetailsQuery.data.room.title)}</h3>
							</div>

							<div className={styles.infoSection}>
								<p className={styles.infoLabel}>{spaceText('主题')}</p>
								<p className={styles.infoText}>{spaceText(roomDetailsQuery.data.room.topic ?? '暂无房间主题。')}</p>
							</div>

							<div className={styles.infoSection}>
								<p className={styles.infoLabel}>{spaceText('房间通知')}</p>
								<div className={styles.alertPreferenceSummary} data-active={activeRoomAlertPreference} data-testid='room-alert-summary'>
									<span aria-hidden='true' className={styles.alertPreferenceSummaryIcon}>
										<RoomAlertPreferenceGlyph preference={activeRoomAlertPreference} />
									</span>
									<div className={styles.alertPreferenceSummaryCopy}>
										<strong>{spaceText(roomAlertPreferenceLabel[activeRoomAlertPreference])}</strong>
										<span>{spaceText(resolveRoomAlertPreferenceDescription({ preference: activeRoomAlertPreference, roomKind: roomDetailsQuery.data.room.kind }))}</span>
										<span>
											{spaceText(
												activeRoomAlertUsesDefault
													? `默认值：跟随${roomDetailsQuery.data.room.kind === 'dm' ? '私信' : '频道与群组'}默认（${roomAlertPreferenceLabel[activeRoomDefaultAlertPreference]}）`
													: `默认值：已覆盖${roomDetailsQuery.data.room.kind === 'dm' ? '私信' : '频道与群组'}默认（${roomAlertPreferenceLabel[activeRoomDefaultAlertPreference]}）`,
											)}
										</span>
										<span>
											{spaceText(
												`浏览器：${
													effectiveBrowserNotificationDelivery === 'off'
														? browserNotificationDeliveryLabel.off
														: browserNotificationPermission === 'unsupported'
															? '当前浏览器不支持'
															: browserNotificationPermission === 'denied'
																? '浏览器权限已阻止'
																: browserNotificationPermission === 'default'
																	? '等待浏览器授权'
																	: browserNotificationDeliveryLabel[effectiveBrowserNotificationDelivery]
												}`,
											)}
										</span>
										<span>
											{spaceText(
												resolveRoomAlertEffectSummary({
													delivery: effectiveBrowserNotificationDelivery,
													permission: browserNotificationPermission,
													preference: activeRoomAlertPreference,
													roomKind: roomDetailsQuery.data.room.kind,
												}),
											)}
										</span>
									</div>
								</div>
							</div>

							<div className={styles.infoGrid}>
								<div className={styles.infoItem}>
									<span className={styles.infoLabel}>{spaceText('类型')}</span>
									<strong>{spaceText(roomKindLabel[roomDetailsQuery.data.room.kind])}</strong>
								</div>
								<div className={styles.infoItem}>
									<span className={styles.infoLabel}>{spaceText('成员')}</span>
									<strong>{spaceText(String(roomDetailsQuery.data.room.memberCount ?? 0))}</strong>
								</div>
								<div className={styles.infoItem}>
									<span className={styles.infoLabel}>{spaceText('收藏')}</span>
									<strong>{spaceText(roomIsFavorite ? '已收藏' : '未收藏')}</strong>
								</div>
								<div className={styles.infoItem}>
									<span className={styles.infoLabel}>{spaceText('未读')}</span>
									<strong>{spaceText(String(getRoomUnreadCount(roomDetailsQuery.data.room)))}</strong>
								</div>
							</div>

							<div className={styles.infoSection}>
								<p className={styles.infoLabel}>{spaceText('简介')}</p>
								<p className={styles.infoText}>{spaceText(roomDetailsQuery.data.room.description ?? '暂无简介。')}</p>
							</div>

							{roomDetailsQuery.data.room.announcement ? (
								<div className={styles.infoSection}>
									<p className={styles.infoLabel}>{spaceText('公告')}</p>
									<p className={styles.infoText}>{spaceText(roomDetailsQuery.data.room.announcement)}</p>
								</div>
							) : null}
						</div>

						<div className={styles.infoSidebarFooter}>
							<button
								aria-label='关闭房间信息侧栏'
								className={styles.infoSidebarClose}
								data-testid='room-info-close'
								onClick={() => closeRoomInfoSidebarToTarget('info')}
								type='button'
							>
								<span aria-hidden='true' className={styles.infoSidebarCloseGlyph}>
									›
								</span>
							</button>
						</div>
					</aside>
				) : null}
			</div>

			<ForwardMessageDialog
				currentRoomId={roomId ?? null}
				onOpenChange={(open) => {
					if (!open) {
						setForwardDialogSource(null);
					}
				}}
				onSubmit={handleForwardSubmit}
				open={Boolean(forwardDialogSource)}
				roomAlertPreferences={roomAlertPreferences}
				sidebarEntries={sidebarEntries}
				sidebarOrderingState={sidebarOrderingState}
				sourceMessage={forwardDialogSource?.message ?? null}
				sourceRoomTitle={forwardDialogSource?.roomTitle ?? null}
			/>
			<DeleteMessageDialog
				open={Boolean(deleteDialogSource)}
				onOpenChange={(open) => {
					if (!open) {
						setDeleteDialogSource(null);
					}
				}}
				onConfirm={handleDeleteConfirm}
				sourceMessage={deleteDialogSource?.message ?? null}
				isSubmitting={deleteDialogSource?.isSubmitting ?? false}
			/>
			{forwardToast ? (
				<div className={styles.forwardToastDock}>
					<div className={styles.forwardToast} data-testid='forward-toast'>
						<div aria-atomic='true' aria-live='polite' className={styles.forwardToastCopy}>
							<span className={styles.forwardToastEyebrow}>{spaceText('已转发到')}</span>
							<strong className={styles.forwardToastTitle}>
								{spaceText(forwardToast.actionable ? forwardToast.roomTitle : '当前聊天')}
							</strong>
						</div>
						{forwardToast.actionable ? (
							<button
								aria-keyshortcuts='Enter Space'
								className={styles.forwardToastAction}
								data-testid='forward-toast-jump'
								onClick={handleForwardToastJump}
								ref={forwardToastActionRef}
								type='button'
							>
								<span className={styles.forwardToastActionLabel}>{spaceText('前往')}</span>
								<span
									aria-hidden='true'
									className={styles.forwardToastActionKeycap}
									data-testid='forward-toast-jump-key'
								>
									Enter
								</span>
							</button>
						) : null}
					</div>
				</div>
			) : null}
			{errorToast ? (
				<div className={styles.forwardToastDock} data-testid='error-toast-dock'>
					<div className={styles.forwardToast} data-testid='error-toast' data-tone='error'>
						<div aria-atomic='true' aria-live='polite' className={styles.forwardToastCopy}>
							<span className={styles.forwardToastEyebrow}>{spaceText('错误')}</span>
							<strong className={styles.forwardToastTitle}>{spaceText(errorToast.message)}</strong>
						</div>
						<button
							aria-label='关闭'
							className={styles.forwardToastAction}
							data-testid='error-toast-close'
							onClick={clearErrorToast}
							type='button'
						>
							<span className={styles.forwardToastActionLabel}>{spaceText('关闭')}</span>
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
};
