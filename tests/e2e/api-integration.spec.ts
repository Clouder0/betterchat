import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ConversationTimelineSnapshot, CreateConversationMessageResponse, DeleteMessageResponse, DirectorySnapshot } from '@betterchat/contracts';
import { restartBetterChatBackendService } from '../backend-stack-control.mjs';

import {
	betterChatGetJson,
	apiModeEnabled,
	betterChatPostJson,
	betterChatRequestJson,
	betterChatUploadImage,
	createBetterChatSession,
	loginAsApiUser,
	readSeedManifest,
} from './api-test-helpers';
import {
	createLargeBmpFixture,
	createLargePngFixture,
	collapseSidebar,
	disposeUnexpectedBrowserErrorGuard,
	expectNoUnexpectedBrowserErrors,
	installUnexpectedBrowserErrorGuard,
	isSidebarCollapsed,
	openRoom,
	readSidebarShellState,
	readTimelineViewportStateForMessage,
	readTimelineBottomGap,
	resetUnexpectedBrowserErrorGuard,
	scrollTimelineToBottom,
	TIMELINE_VIEWPORT_ANCHOR_TOP_BIAS,
	tinyPngFixture,
	waitForRoomLoadingToFinish,
	waitForSidebarCollapsedSettle,
	waitForSidebarExpandedPreview,
	waitForSidebarPreviewState,
	waitForSidebarTransitionEnd,
} from './test-helpers';

test.skip(!apiModeEnabled, 'API-mode suite');

const betterChatApiBaseUrl = process.env.BETTERCHAT_E2E_API_BASE_URL ?? 'http://127.0.0.1:3200';
type BrowserSocketPayload = Parameters<WebSocket['send']>[0];
type RealtimeWatchCommand = {
	type: 'watch-conversation' | 'watch-directory';
	conversationId?: string;
	conversationVersion?: string;
	directoryVersion?: string;
	timelineVersion?: string;
};

const conversationMessageBody = ({
	replyToMessageId,
	text,
}: {
	replyToMessageId?: string;
	text: string;
}) => ({
	target: {
		kind: 'conversation' as const,
		...(replyToMessageId ? { replyToMessageId } : {}),
	},
	content: {
		format: 'markdown' as const,
		text,
	},
});

const setConversationStarred = (session: Awaited<ReturnType<typeof createBetterChatSession>>, conversationId: string, value: boolean) =>
	betterChatPostJson(session, `/api/conversations/${conversationId}/membership/commands`, {
		type: 'set-starred',
		value,
	});

const markConversationRead = (session: Awaited<ReturnType<typeof createBetterChatSession>>, conversationId: string) =>
	betterChatPostJson(session, `/api/conversations/${conversationId}/membership/commands`, {
		type: 'mark-read',
	});

const markConversationUnread = ({
	conversationId,
	fromMessageId,
	session,
}: {
	conversationId: string;
	fromMessageId?: string;
	session: Awaited<ReturnType<typeof createBetterChatSession>>;
}) =>
	betterChatPostJson(session, `/api/conversations/${conversationId}/membership/commands`, {
		type: 'mark-unread',
		...(fromMessageId ? { fromMessageId } : {}),
	});

const readDirectory = (session: Awaited<ReturnType<typeof createBetterChatSession>>) =>
	betterChatGetJson<DirectorySnapshot>(session, '/api/directory');

const restartBetterChatBackend = async (): Promise<void> => {
	restartBetterChatBackendService();
	await expect.poll(async () => {
		try {
			const response = await fetch(new URL('/api/public/bootstrap', betterChatApiBaseUrl));
			if (!response.ok) {
				return false;
			}
			const payload = await response.json() as { ok?: boolean };
			return payload.ok === true;
		} catch {
			return false;
		}
	}, {
		timeout: 20_000,
	}).toBe(true);
};

const readSidebarSectionOrder = async (page: Page, section: 'dms' | 'favorites' | 'rooms') =>
	page.getByTestId(`sidebar-section-${section}`).locator('button[data-testid^="sidebar-room-"]').evaluateAll((nodes) =>
		nodes.map((node) => node.getAttribute('data-testid') ?? ''),
	);

const sampleTimelineScrollTopDrift = async (timeline: Locator, durationMs = 420) =>
	timeline.evaluate(async (node, requestedDurationMs) => {
		const samples = [node.scrollTop];
		const deadline = performance.now() + requestedDurationMs;

		await new Promise<void>((resolve) => {
			const step = () => {
				samples.push(node.scrollTop);
				if (performance.now() >= deadline) {
					resolve();
					return;
				}

				requestAnimationFrame(step);
			};

			requestAnimationFrame(step);
		});

		return {
			final: node.scrollTop,
			max: Math.max(...samples),
			min: Math.min(...samples),
		};
	}, durationMs);

const installNotificationRecorder = async (page: Page) => {
	await page.addInitScript(() => {
		const recordedNotifications: Array<{ body: string; tag: string; title: string }> = [];
		let visibilityState: DocumentVisibilityState = 'visible';
		let focused = true;

		class MockNotification {
			static permission = 'granted';

			static requestPermission = async () => 'granted' as NotificationPermission;

			onclick: ((this: Notification, ev: Event) => unknown) | null = null;

			constructor(title: string, options?: NotificationOptions) {
				recordedNotifications.push({
					body: options?.body ?? '',
					tag: options?.tag ?? '',
					title,
				});
			}

			close() {}
		}

		Object.defineProperty(window, 'Notification', {
			configurable: true,
			value: MockNotification,
		});
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get() {
				return visibilityState;
			},
		});
		Object.defineProperty(document, 'hidden', {
			configurable: true,
			get() {
				return visibilityState !== 'visible';
			},
		});
		document.hasFocus = () => focused;

		(
			window as Window & {
				__betterchatNotifications?: Array<{ body: string; tag: string; title: string }>;
				__betterchatSetPageAttention?: (state: { focused: boolean; visibilityState: DocumentVisibilityState }) => void;
			}
		).__betterchatNotifications = recordedNotifications;
		(
			window as Window & {
				__betterchatSetPageAttention?: (state: { focused: boolean; visibilityState: DocumentVisibilityState }) => void;
			}
		).__betterchatSetPageAttention = (state) => {
			visibilityState = state.visibilityState;
			focused = state.focused;
		};
	});
};

const installRealtimeWatchCommandRecorder = async (page: Page) => {
	await page.addInitScript(() => {
		const recordedCommands: RealtimeWatchCommand[] = [];
		const originalSend: (this: WebSocket, data: BrowserSocketPayload) => void = WebSocket.prototype.send;

		WebSocket.prototype.send = function patchedSend(data: BrowserSocketPayload) {
			if (typeof data === 'string') {
				try {
					const parsed = JSON.parse(data) as Partial<RealtimeWatchCommand>;
					if (parsed.type === 'watch-directory' || parsed.type === 'watch-conversation') {
						recordedCommands.push(parsed as RealtimeWatchCommand);
					}
				} catch {
					// Ignore non-JSON websocket payloads.
				}
			}

			return Reflect.apply(originalSend, this, [data]);
		};

		(
			window as Window & {
				__betterchatClearRealtimeWatchCommands?: () => void;
				__betterchatRealtimeWatchCommands?: RealtimeWatchCommand[];
			}
		).__betterchatRealtimeWatchCommands = recordedCommands;
		(
			window as Window & {
				__betterchatClearRealtimeWatchCommands?: () => void;
			}
		).__betterchatClearRealtimeWatchCommands = () => {
			recordedCommands.splice(0, recordedCommands.length);
		};
	});
};

const clearRecordedRealtimeWatchCommands = (page: Page) =>
	page.evaluate(() => {
		(
			window as Window & {
				__betterchatClearRealtimeWatchCommands?: () => void;
			}
		).__betterchatClearRealtimeWatchCommands?.();
	});

const readRecordedRealtimeWatchCommands = (page: Page) =>
	page.evaluate(() => {
		const commands =
			(
				window as Window & {
					__betterchatRealtimeWatchCommands?: RealtimeWatchCommand[];
				}
			).__betterchatRealtimeWatchCommands ?? [];
		return [...commands];
	});

const readRecordedNotifications = (page: Page) =>
	page.evaluate(() => {
		const recorded =
			(
				window as Window & {
					__betterchatNotifications?: Array<{ body: string; tag: string; title: string }>;
				}
			).__betterchatNotifications ?? [];
		return [...recorded];
	});

const clearRecordedNotifications = (page: Page) =>
	page.evaluate(() => {
		const recorded =
			(
				window as Window & {
					__betterchatNotifications?: Array<{ body: string; tag: string; title: string }>;
				}
			).__betterchatNotifications ?? [];
		recorded.splice(0, recorded.length);
	});

const setRecordedNotificationPageAttention = (
	page: Page,
	state: { focused: boolean; visibilityState: 'hidden' | 'visible' },
) =>
	page.evaluate((nextState) => {
		(
			window as Window & {
				__betterchatSetPageAttention?: (state: { focused: boolean; visibilityState: DocumentVisibilityState }) => void;
			}
		).__betterchatSetPageAttention?.(nextState);
	}, state);

const resolveDirectoryAttention = (entry: DirectorySnapshot['entries'][number] | undefined) => {
	if (!entry) {
		return {
			badgeCount: undefined,
			level: 'missing' as const,
		};
	}

	if (entry.membership.inbox.mentionCount > 0) {
		return {
			badgeCount: entry.membership.inbox.unreadMessages > 0 ? entry.membership.inbox.unreadMessages : undefined,
			level: 'mention' as const,
		};
	}

	if (entry.membership.inbox.unreadMessages > 0) {
		return {
			badgeCount: entry.membership.inbox.unreadMessages,
			level: 'unread' as const,
		};
	}

	if (entry.membership.inbox.hasThreadActivity || entry.membership.inbox.hasUncountedActivity) {
		return {
			badgeCount: undefined,
			level: 'activity' as const,
		};
	}

	return {
		badgeCount: undefined,
		level: 'none' as const,
	};
};

const createDeferred = <T,>() => {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
};

test.describe('api integration', () => {
	test.beforeEach(async ({ page }) => {
		installUnexpectedBrowserErrorGuard(page);
	});

	test.afterEach(async ({ page }, testInfo) => {
		try {
			if (testInfo.status === testInfo.expectedStatus) {
				expectNoUnexpectedBrowserErrors(page);
			}
		} finally {
			disposeUnexpectedBrowserErrorGuard(page);
		}
	});

	test('loads the anonymous login page without protected-route or favicon console noise', async ({ page }) => {
		await page.goto('/login');

		await expect(page.getByTestId('login-page')).toBeVisible();
		await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
	});

	test('collapses sidebar by dragging resize rail past snap threshold and settles fully collapsed', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await waitForRoomLoadingToFinish(page);

		const sidebar = page.getByTestId('app-sidebar');
		const resizeHandle = page.getByTestId('sidebar-resize-handle');
		const handleBox = await resizeHandle.boundingBox();
		expect(handleBox).not.toBeNull();
		if (!handleBox) {
			throw new Error('sidebar resize handle bounds were unavailable');
		}
		const sidebarBox = await sidebar.boundingBox();
		expect(sidebarBox).not.toBeNull();
		if (!sidebarBox) {
			throw new Error('sidebar bounds were unavailable');
		}
		const handleCenterX = handleBox.x + handleBox.width / 2;
		const handleCenterY = handleBox.y + handleBox.height / 2;
		const intermediateCloseX = handleCenterX - (sidebarBox.width - 160);

		await page.mouse.move(handleCenterX, handleCenterY);
		await page.mouse.down();
		await page.mouse.move(intermediateCloseX, handleCenterY, { steps: 10 });
		await waitForSidebarPreviewState(page, {
			collapsed: false,
			maxWidth: 176,
			minWidth: 144,
			searchVisible: true,
		});
		await page.mouse.move(20, handleCenterY, { steps: 12 });
		await waitForSidebarPreviewState(page, {
			collapsed: true,
			maxWidth: 104,
			minWidth: 0,
			searchVisible: false,
		});
		await page.mouse.up();

		await waitForSidebarCollapsedSettle(page);
		expect(await isSidebarCollapsed(page)).toBe(true);
		expect(await readSidebarShellState(page)).toEqual({
			collapsed: true,
			searchVisible: false,
			sidebarClientWidth: 0,
			sidebarWidth: 0,
		});
	});

	test('expands the collapsed sidebar on single click and reveals sidebar content', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await waitForRoomLoadingToFinish(page);

		const sidebar = page.getByTestId('app-sidebar');
		const resizeHandle = page.getByTestId('sidebar-resize-handle');
		const widthBeforeCollapse = (await sidebar.boundingBox())!.width;

		await collapseSidebar(page);
		expect(await isSidebarCollapsed(page)).toBe(true);

		await resizeHandle.click();
		await waitForSidebarTransitionEnd(page);

		expect(await isSidebarCollapsed(page)).toBe(false);
		await expect(page.getByTestId('sidebar-search')).toBeVisible();
		await expect(page.locator('button[data-testid^="sidebar-room-"]').first()).toBeVisible();

		const widthAfterExpand = (await sidebar.boundingBox())!.width;
		expect(widthAfterExpand).toBeGreaterThan(200);
		expect(Math.abs(widthAfterExpand - widthBeforeCollapse)).toBeLessThan(16);
	});

	test('reveals sidebar content during drag-open preview before pointer release', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await waitForRoomLoadingToFinish(page);

		await collapseSidebar(page);
		expect(await isSidebarCollapsed(page)).toBe(true);

		const resizeHandle = page.getByTestId('sidebar-resize-handle');
		const handleBox = await resizeHandle.boundingBox();
		expect(handleBox).not.toBeNull();
		if (!handleBox) {
			throw new Error('sidebar resize handle bounds were unavailable');
		}
		const handleCenterX = handleBox.x + handleBox.width / 2;
		const handleCenterY = handleBox.y + handleBox.height / 2;
		const intermediateOpenX = handleCenterX + 160;

		await page.mouse.move(handleCenterX, handleCenterY);
		await page.mouse.down();
		await page.mouse.move(intermediateOpenX, handleCenterY, { steps: 10 });
		await waitForSidebarPreviewState(page, {
			collapsed: false,
			maxWidth: 176,
			minWidth: 144,
			searchVisible: true,
		});
		await page.mouse.move(handleBox.x + 300, handleCenterY, { steps: 12 });
		await waitForSidebarExpandedPreview(page);
		await page.mouse.move(20, handleCenterY, { steps: 12 });
		await waitForSidebarPreviewState(page, {
			collapsed: true,
			maxWidth: 104,
			minWidth: 0,
			searchVisible: false,
		});
		await page.mouse.move(handleBox.x + 300, handleCenterY, { steps: 12 });
		await waitForSidebarExpandedPreview(page);
		await page.mouse.up();

		expect(await isSidebarCollapsed(page)).toBe(false);
		await expect(page.getByTestId('sidebar-search')).toBeVisible();
	});

	test('establishes realtime watch subscriptions and does not replay them after cached versions advance', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.publicEmpty;
		const senderSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		await installRealtimeWatchCommandRecorder(page);
		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await expect
			.poll(() => readRecordedRealtimeWatchCommands(page))
			.toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: 'watch-directory',
					}),
					expect.objectContaining({
						conversationId: room.roomId,
						type: 'watch-conversation',
					}),
				]),
			);
		await clearRecordedRealtimeWatchCommands(page);

		const probeText = `[betterchat][e2e] realtime watch replay ${Date.now()}`;
		const sent = await betterChatPostJson<CreateConversationMessageResponse>(
			senderSession,
			`/api/conversations/${room.roomId}/messages`,
			conversationMessageBody({ text: probeText }),
		);
		const messageId = sent.message.id;
		if (!messageId) {
			throw new Error('Expected BetterChat send response to include a canonical message id.');
		}

		await expect(page.getByTestId(`timeline-message-${messageId}`)).toContainText(probeText);
		await page.waitForTimeout(250);

		expect(await readRecordedRealtimeWatchCommands(page)).toEqual([]);
	});


	test('persists deleted-message tombstones across browser refresh in API mode', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.publicMain;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const probeText = `[betterchat][e2e] tombstone persistence ${Date.now()}`;
		const sent = await betterChatPostJson<CreateConversationMessageResponse>(
			aliceSession,
			`/api/conversations/${room.roomId}/messages`,
			conversationMessageBody({ text: probeText }),
		);
		const messageId = sent.message.id;
		if (!messageId) {
			throw new Error('Expected BetterChat send response to include a canonical message id.');
		}

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);

		const row = page.getByTestId(`timeline-message-${messageId}`);
		await expect(row).toContainText(probeText);

		const deleted = await betterChatRequestJson<DeleteMessageResponse>(aliceSession, {
			body: {},
			method: 'DELETE',
			path: `/api/conversations/${room.roomId}/messages/${messageId}`,
		});
		expect(deleted.messageId).toBe(messageId);

		await expect.poll(async () => {
			const timeline = await betterChatGetJson<ConversationTimelineSnapshot>(
				aliceSession,
				`/api/conversations/${room.roomId}/timeline`,
			);
			const deletedMessage = timeline.messages.find((message) => message.id === messageId);
			if (!deletedMessage) {
				return null;
			}

			return {
				authoredAt: deletedMessage.authoredAt,
				deleted: deletedMessage.state.deleted,
				text: deletedMessage.content.text,
			};
		}).toEqual({
			authoredAt: sent.message.authoredAt,
			deleted: true,
			text: '',
		});

		await expect(row).toContainText('该消息已删除。', { timeout: 10_000 });
		await expect(row).not.toContainText(probeText);

		await page.reload();
		await waitForRoomLoadingToFinish(page);

		const reloadedRow = page.getByTestId(`timeline-message-${messageId}`);
		await expect(reloadedRow).toContainText('该消息已删除。', { timeout: 10_000 });
		await expect(reloadedRow).not.toContainText(probeText);
	});

	test('persists deleted-message tombstones across BetterChat backend restart in API mode', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.publicMain;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const probeText = `[betterchat][e2e] tombstone restart persistence ${Date.now()}`;
		const sent = await betterChatPostJson<CreateConversationMessageResponse>(
			aliceSession,
			`/api/conversations/${room.roomId}/messages`,
			conversationMessageBody({ text: probeText }),
		);
		const messageId = sent.message.id;
		if (!messageId) {
			throw new Error('Expected BetterChat send response to include a canonical message id.');
		}

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);

		const row = page.getByTestId(`timeline-message-${messageId}`);
		await expect(row).toContainText(probeText);

		await betterChatRequestJson<DeleteMessageResponse>(aliceSession, {
			body: {},
			method: 'DELETE',
			path: `/api/conversations/${room.roomId}/messages/${messageId}`,
		});

		await expect(row).toContainText('该消息已删除。', { timeout: 10_000 });

		await restartBetterChatBackend();

		await page.reload();
		await waitForRoomLoadingToFinish(page);

		await expect.poll(async () => {
			const timeline = await betterChatGetJson<ConversationTimelineSnapshot>(
				aliceSession,
				`/api/conversations/${room.roomId}/timeline`,
			);
			const deletedMessage = timeline.messages.find((message) => message.id === messageId);
			return deletedMessage
				? {
					deleted: deletedMessage.state.deleted,
					text: deletedMessage.content.text,
				}
				: null;
		}).toEqual({
			deleted: true,
			text: '',
		});

		const reloadedRow = page.getByTestId(`timeline-message-${messageId}`);
		await expect(reloadedRow).toContainText('该消息已删除。', { timeout: 10_000 });
		await expect(reloadedRow).not.toContainText(probeText);
	});

	test('keeps a text send on a single visible row while canonical polling catches up before the send response resolves', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.publicEmpty;
		const text = `[betterchat][e2e] submission reconciliation ${Date.now()}`;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		let capturedSubmissionId: string | null = null;
		const releaseSendResponse = createDeferred<void>();
		const responseFetched = createDeferred<void>();

		await page.route(new RegExp(`/api/conversations/${room.roomId}/messages$`), async (route) => {
			if (route.request().method() !== 'POST') {
				await route.continue();
				return;
			}

			const payload = JSON.parse(route.request().postData() ?? '{}') as {
				content?: {
					text?: string;
				};
				submissionId?: string;
			};
			capturedSubmissionId = typeof payload.submissionId === 'string' ? payload.submissionId : null;

			const response = await route.fetch();
			responseFetched.resolve();
			await releaseSendResponse.promise;
			await route.fulfill({ response });
		});

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		await page.getByTestId('composer-textarea').fill(text);
		await page.getByTestId('composer-send').click();

		await expect.poll(() => capturedSubmissionId).toBeTruthy();
		await responseFetched.promise;
		const submissionId = capturedSubmissionId!;

		await expect.poll(async () => {
			const timeline = await betterChatGetJson<ConversationTimelineSnapshot>(
				aliceSession,
				`/api/conversations/${room.roomId}/timeline`,
			);
			return timeline.messages.some((message) => message.id === submissionId && message.content.text === text);
		}).toBe(true);

		const matchingRows = page.locator('article[data-message-id]').filter({ hasText: text });
		await expect(matchingRows).toHaveCount(1);
		await expect(page.getByTestId(`timeline-message-${submissionId}`)).toHaveAttribute('data-delivery-state', 'sending');
		await page.waitForTimeout(1_200);
		await expect(matchingRows).toHaveCount(1);

		releaseSendResponse.resolve();

		const deliveredRow = page.getByTestId(`timeline-message-${submissionId}`);
		await expect(deliveredRow).toContainText(text);
		await expect(deliveredRow).toHaveAttribute('data-delivery-state', 'sent');
		await expect(page.locator('article[data-message-id]').filter({ hasText: text })).toHaveCount(1);
	});

	test('opens an existing direct conversation from a live timeline author quick panel', async ({ page }) => {
		const manifest = readSeedManifest();
		const sourceRoom = manifest.rooms.publicEmpty;
		const targetDirectConversation = manifest.rooms.dmBob;
		const bobIdentity = manifest.users.bob;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const bobSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		const charlieSession = await createBetterChatSession({
			login: 'charlie',
			password: 'CharliePass123!',
		});

		await markConversationRead(aliceSession, sourceRoom.roomId);
		await betterChatPostJson(
			charlieSession,
			`/api/conversations/${sourceRoom.roomId}/messages`,
			conversationMessageBody({
				text: `[betterchat][e2e] author quick panel separator ${Date.now()}`,
			}),
		);
		const liveText = `[betterchat][e2e] author quick panel ${Date.now()}`;
		const postedMessage = await betterChatPostJson<{ message: { id: string } }>(
			bobSession,
			`/api/conversations/${sourceRoom.roomId}/messages`,
			conversationMessageBody({
				text: liveText,
			}),
		);

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, sourceRoom.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);
		await expect(page.getByTestId(`timeline-message-${postedMessage.message.id}`)).toContainText(liveText);

		const authorQuickPanelTrigger = page.getByTestId(`timeline-author-trigger-${postedMessage.message.id}`);
		await authorQuickPanelTrigger.click();
		const quickPanel = page.getByTestId('timeline-author-quick-panel');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-name')).toContainText(bobIdentity.displayName);
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-handle')).toContainText(`@${bobIdentity.username}`);
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-primary-action')).toContainText('打开私信');

		await quickPanel.getByTestId('timeline-author-quick-panel-primary-action').click();
		await expect(page).toHaveURL(new RegExp(`/app/rooms/${targetDirectConversation.roomId}$`));
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId('room-title')).toContainText(targetDirectConversation.title);
		await expect(page.getByTestId('composer-textarea')).toBeFocused();
	});

	test('opens a live user quick panel from an inline mention trigger', async ({ page }) => {
		const manifest = readSeedManifest();
		const sourceRoom = manifest.rooms.publicEmpty;
		const targetDirectConversation = manifest.rooms.dmBob;
		const bobIdentity = manifest.users.bob;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const bobSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		const charlieSession = await createBetterChatSession({
			login: 'charlie',
			password: 'CharliePass123!',
		});

		await markConversationRead(aliceSession, sourceRoom.roomId);
		const mentionText = `[betterchat][e2e] inline mention ${Date.now()} 请 @${bobIdentity.username} 看一下`;
		const postedMessage = await betterChatPostJson<{ message: { id: string } }>(
			charlieSession,
			`/api/conversations/${sourceRoom.roomId}/messages`,
			conversationMessageBody({
				text: mentionText,
			}),
		);

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, sourceRoom.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const mentionedMessage = page.getByTestId(`timeline-message-${postedMessage.message.id}`);
		await expect(mentionedMessage).toContainText(mentionText);
		const inlineMention = mentionedMessage.locator(
			`[data-mention-interactive="true"][data-mention-token-value="@${bobIdentity.username}"]`,
		);
		await expect(inlineMention).toHaveCount(1);

		await inlineMention.click();
		const quickPanel = page.getByTestId('timeline-author-quick-panel');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-name')).toContainText(bobIdentity.displayName);
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-handle')).toContainText(`@${bobIdentity.username}`);
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-primary-action')).toContainText('打开私信');

		await quickPanel.getByTestId('timeline-author-quick-panel-primary-action').click();
		await expect(page).toHaveURL(new RegExp(`/app/rooms/${targetDirectConversation.roomId}$`));
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId('room-title')).toContainText(targetDirectConversation.title);
		await expect(page.getByTestId('composer-textarea')).toBeFocused();
	});

	test('uses backend room mention candidates for empty-room member suggestions and special mentions', async ({ page }) => {
		const manifest = readSeedManifest();
		const publicRoom = manifest.rooms.publicEmpty;
		const directRoom = manifest.rooms.dmBob;
		const bobIdentity = manifest.users.bob;

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, publicRoom.roomId);
		await waitForRoomLoadingToFinish(page);

		const textarea = page.getByTestId('composer-textarea');
		await textarea.fill('请 @bo');
		const mentionMenu = page.getByTestId('composer-mention-menu');
		const bobOption = page.getByTestId(`composer-mention-option-${bobIdentity.userId}`);
		await expect(mentionMenu).toBeVisible();
		await expect(bobOption).toContainText(bobIdentity.displayName);
		await expect(bobOption).toContainText(`@${bobIdentity.username}`);

		await textarea.fill('@');
		await expect(page.getByTestId('composer-mention-option-special-all')).toBeVisible();
		await expect(page.getByTestId('composer-mention-option-special-here')).toBeVisible();

		await openRoom(page, directRoom.roomId);
		await waitForRoomLoadingToFinish(page);
		await page.getByTestId('composer-textarea').fill('@');
		await expect(page.getByTestId('composer-mention-option-special-all')).toHaveCount(0);
		await expect(page.getByTestId('composer-mention-option-special-here')).toHaveCount(0);
	});

	test('keeps grouped code-only live messages visually separated from the reply and forward action lane', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.privateMain;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const bobSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		const probeBase = Date.now();
		const firstProbe = `liveCodeOverlap${probeBase}A`;
		const secondProbe = `liveCodeOverlap${probeBase}B`;
		const firstMessage = await betterChatPostJson<{ message: { id: string } }>(
			bobSession,
			`/api/conversations/${room.roomId}/messages`,
			conversationMessageBody({
				text: `\`\`\`ts\nconst ${firstProbe} = true;\n\`\`\``,
			}),
		);
		const secondMessage = await betterChatPostJson<{ message: { id: string } }>(
			bobSession,
			`/api/conversations/${room.roomId}/messages`,
			conversationMessageBody({
				text: `\`\`\`ts\nconst ${secondProbe} = true;\n\`\`\``,
			}),
		);

		await markConversationRead(aliceSession, room.roomId);
		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const groupedMessage = page.getByTestId(`timeline-message-${secondMessage.message.id}`);
		await expect(groupedMessage).toContainText(secondProbe);
		await expect(groupedMessage).toHaveAttribute('data-grouped-prev', 'true');

		await groupedMessage.hover();

		const replyAction = groupedMessage.locator('[data-testid^="message-action-reply-"]');
		const codeBlock = groupedMessage.locator('figure').first();
		await expect(replyAction).toBeVisible();
		await expect(codeBlock).toBeVisible();

		const replyActionBox = await replyAction.boundingBox();
		const codeBlockBox = await codeBlock.boundingBox();
		expect(replyActionBox).not.toBeNull();
		expect(codeBlockBox).not.toBeNull();
		if (!replyActionBox || !codeBlockBox) {
			throw new Error('live grouped code-only message bounds were unavailable');
		}

		expect(replyActionBox.y + replyActionBox.height).toBeLessThanOrEqual(codeBlockBox.y - 6);
		await expect(page.getByTestId(`timeline-message-${firstMessage.message.id}`)).toContainText(firstProbe);
	});

	test('keeps live prepend history restoration stable after long older pages load', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.privateMain;
		const bobSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		const roomPrefix = `[betterchat][e2e][history-prepend:${Date.now()}]`;
		const longMessageCount = 96;
		for (let index = 0; index < longMessageCount; index += 1) {
			const ordinal = String(index + 1).padStart(2, '0');
			const longBody =
				index % 3 === 0
					? `${roomPrefix} ${ordinal}

这一页故意放更长的历史消息，验证 live older prepend 不会在第一次 restore 之后又被测量回弹打断。

\`\`\`ts
const liveHistoryProbe = {
  index: ${index + 1},
  mode: 'api-prepend-stability',
  expectations: ['stable-anchor', 'no-rebound', 'quiet-reflow'],
};
\`\`\`

如果这里还会晃一下，说明 prepend restore 仍然和普通 reflow 共享了错误的锚点。`
					: `${roomPrefix} ${ordinal}

> 这是一段更长的历史引用块，用来确认 older page 拼接完成后，用户正在看的那一段不会被重新测量又拉走。
>
> 目标是即使长消息稍后完成折叠与布局，视口也仍然稳定。

继续补一行普通正文，确保消息高度足以触发更真实的 prepend reflow。`;
			await betterChatPostJson(
				bobSession,
				`/api/conversations/${room.roomId}/messages`,
				conversationMessageBody({
					text: longBody,
				}),
			);
		}

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const timeline = page.getByTestId('timeline');
		await expect.poll(async () => timeline.locator('article[data-message-id]').count()).toBeGreaterThan(0);
		const initialMessageCount = await timeline.locator('article[data-message-id]').count();

		await timeline.evaluate((node) => {
			node.scrollTo({
				top: 0,
				behavior: 'auto',
			});
		});

		await expect.poll(async () => timeline.locator('article[data-message-id]').count()).toBeGreaterThan(initialMessageCount);
		const settledTop = await timeline.evaluate((node) => node.scrollTop);
		const drift = await sampleTimelineScrollTopDrift(timeline);
		expect(settledTop).toBeGreaterThan(24);
		expect(drift.max - drift.min).toBeLessThanOrEqual(8);
		expect(Math.abs(drift.final - settledTop)).toBeLessThanOrEqual(6);
	});

	test('prefetches the next older live timeline page before the viewport fully reaches the top edge', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.privateMain;
		const bobSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		const roomPrefix = `[betterchat][e2e][history-prefetch:${Date.now()}]`;
		for (let index = 0; index < 120; index += 1) {
			await betterChatPostJson(
				bobSession,
				`/api/conversations/${room.roomId}/messages`,
				conversationMessageBody({
					text: `${roomPrefix} ${String(index + 1).padStart(2, '0')}

这一条用于验证 older history 会在接近顶部时提前预取，而不是等滚动真正撞到顶部以后才发起请求。`,
				}),
			);
		}

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const timeline = page.getByTestId('timeline');
		await expect.poll(async () => timeline.locator('article[data-message-id]').count()).toBeGreaterThan(0);
		const initialMessageCount = await timeline.locator('article[data-message-id]').count();
		const initialScrollTop = await timeline.evaluate((node) => node.scrollTop);
		expect(initialScrollTop).toBeGreaterThan(220);
		const prefetchScrollTop = Math.min(220, initialScrollTop - 60);
		const olderTimelineRequests: string[] = [];
		page.on('request', (request) => {
			if (
				request.method() === 'GET' &&
				request.url().includes(`/api/conversations/${room.roomId}/timeline?cursor=`)
			) {
				olderTimelineRequests.push(request.url());
			}
		});

		const firstOlderPageResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'GET' &&
				response.url().includes(`/api/conversations/${room.roomId}/timeline?cursor=`),
		);
		await timeline.evaluate((node, targetTop) => {
			node.scrollTo({
				top: targetTop,
				behavior: 'auto',
			});
		}, prefetchScrollTop);
		await firstOlderPageResponse;
		expect(olderTimelineRequests).toHaveLength(1);
		const firstOlderPageRequest = olderTimelineRequests[0];
		await page.waitForTimeout(240);
		expect(await timeline.locator('article[data-message-id]').count()).toBe(initialMessageCount);

		await timeline.evaluate((node) => {
			node.scrollTo({
				top: 132,
				behavior: 'auto',
			});
		});

		await expect.poll(async () => timeline.locator('article[data-message-id]').count()).toBeGreaterThan(initialMessageCount);
		await expect.poll(async () => timeline.evaluate((node) => node.scrollTop)).toBeGreaterThan(72);
		await page.waitForTimeout(240);
		expect(olderTimelineRequests.filter((requestUrl) => requestUrl === firstOlderPageRequest)).toHaveLength(1);
	});

	test('adds quiet hover feedback to live markdown links', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.publicEmpty;
		const bobSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		const linkLabel = `运行手册 ${Date.now()}`;

		await betterChatPostJson(
			bobSession,
			`/api/conversations/${room.roomId}/messages`,
			conversationMessageBody({
				text: `请查看 [${linkLabel}](https://betterchat.example/runbook) 后再决定是否同步更多实现细节。`,
			}),
		);

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const link = page.getByRole('link', { name: linkLabel });
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(link).toHaveAttribute('rel', /noopener/);
		await expect(link).toHaveAttribute('rel', /noreferrer/);

		const readLinkStyles = async () =>
			link.evaluate((node) => {
				const styles = window.getComputedStyle(node as HTMLElement);
				return {
					backgroundSize: styles.backgroundSize,
					color: styles.color,
					textDecorationColor: styles.textDecorationColor,
				};
			});

		const beforeHover = await readLinkStyles();
		await link.hover();
		const afterHover = await readLinkStyles();

		expect(afterHover.color).not.toBe(beforeHover.color);
		expect(afterHover.textDecorationColor).not.toBe(beforeHover.textDecorationColor);
	});

	test('respects the global motion toggle in API mode and disables jump animations', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.privateMain;
		const bobSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const roomPrefix = `[betterchat][e2e][motion-off:${Date.now()}]`;
		for (let index = 0; index < 24; index += 1) {
			await betterChatPostJson(
				bobSession,
				`/api/conversations/${room.roomId}/messages`,
				conversationMessageBody({
					text: `${roomPrefix} ${String(index + 1).padStart(2, '0')} 让时间线足够长，便于验证关闭动效后的最新跳转会立即完成。`,
				}),
			);
		}
		await markConversationRead(aliceSession, room.roomId);

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		await page.getByTestId('settings-trigger').click();
		await expect(page.getByTestId('settings-panel')).toBeVisible();
		await page.getByTestId('settings-motion-disabled').click();
		await expect(page.getByTestId('settings-motion-disabled')).toHaveAttribute('data-active', 'true');
		await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-motion'))).toBe('off');

		await page.getByTestId('settings-theme-dark').click();
		await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
		expect(await page.evaluate(() => document.documentElement.hasAttribute('data-theme-switching'))).toBe(false);
		await page.getByTestId('settings-close').click();

		const timeline = page.getByTestId('timeline');
		await timeline.evaluate((node) => {
			node.scrollTo({
				top: 320,
				behavior: 'auto',
			});
		});

		await expect(page.getByTestId('timeline-jump-button')).toContainText('最新');
		await page.getByTestId('timeline-jump-button').click();
		const drift = await sampleTimelineScrollTopDrift(timeline, 220);
		expect(drift.max - drift.min).toBeLessThanOrEqual(4);
		expect(await readTimelineBottomGap(timeline)).toBeLessThanOrEqual(6);
	});

	test('opens a hidden room through BetterChat, persists favorite state, and supports logout', async ({ page }) => {
		const manifest = readSeedManifest();
		const hiddenRoom = manifest.rooms.privateHidden;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});

		await setConversationStarred(aliceSession, hiddenRoom.roomId, false);

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});

		const search = page.getByTestId('sidebar-search');
		await search.fill(hiddenRoom.title);
		await search.press('Enter');
		await waitForRoomLoadingToFinish(page);
		await expect(page).toHaveURL(new RegExp(`/app/rooms/${hiddenRoom.roomId}$`));
		await expect(page.getByTestId('room-title')).toContainText(hiddenRoom.title);

		const favoriteToggle = page.getByTestId('room-favorite-toggle');
		await expect(favoriteToggle).toHaveAttribute('aria-pressed', 'false');
		await favoriteToggle.click();
		await expect(favoriteToggle).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByTestId('sidebar-section-favorites').getByTestId(`sidebar-room-${hiddenRoom.roomId}`)).toBeVisible();

		await page.reload();
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId('room-favorite-toggle')).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByTestId('sidebar-section-favorites').getByTestId(`sidebar-room-${hiddenRoom.roomId}`)).toBeVisible();

		await page.getByTestId('settings-trigger').click();
		await expect(page.getByTestId('settings-panel')).toBeVisible();
		await page.getByTestId('settings-logout').click();
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByTestId('login-page')).toBeVisible();
	});

	test('keeps keyboard focus on the favorite toggle after enter-triggered API favorite changes', async ({ page }) => {
		const manifest = readSeedManifest();
		const hiddenRoom = manifest.rooms.privateHidden;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});

		await setConversationStarred(aliceSession, hiddenRoom.roomId, false);

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});

		const search = page.getByTestId('sidebar-search');
		await search.fill(hiddenRoom.title);
		await search.press('Enter');
		await waitForRoomLoadingToFinish(page);
		await expect(page).toHaveURL(new RegExp(`/app/rooms/${hiddenRoom.roomId}$`));

		const favoriteToggle = page.getByTestId('room-favorite-toggle');
		await favoriteToggle.focus();
		await expect(favoriteToggle).toBeFocused();
		await expect(favoriteToggle).toHaveAttribute('aria-pressed', 'false');

		await page.keyboard.press('Enter');
		await expect(favoriteToggle).toHaveAttribute('aria-pressed', 'true');
		await expect(favoriteToggle).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(favoriteToggle).toHaveAttribute('aria-pressed', 'false');
		await expect(favoriteToggle).toBeFocused();
	});

	test('marks an API-backed room as read after the user reaches the bottom', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.dmBob;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const bobSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		let firstUnreadMessageId = manifest.messages.dmBobUnread.messageId;

		for (let index = 0; index < 24; index += 1) {
			const response = await betterChatPostJson<{ message: { id: string } }>(
				bobSession,
				`/api/conversations/${room.roomId}/messages`,
				conversationMessageBody({
					text: `[betterchat][e2e] unread anchor filler ${index + 1} ${Date.now()}`,
				}),
			);
			if (index === 0) {
				firstUnreadMessageId = response.message.id;
			}
		}

		await markConversationRead(aliceSession, room.roomId);
		await markConversationUnread({
			conversationId: room.roomId,
			fromMessageId: firstUnreadMessageId,
			session: aliceSession,
		});
		await page.setViewportSize({
			width: 1280,
			height: 560,
		});

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId('timeline-unread-divider')).toBeVisible();
		await expect(page.getByTestId('timeline-unread-divider')).toHaveAttribute('data-state', 'live');
		await page.evaluate(() => {
			const timeline = document.querySelector('[data-testid="timeline"]');
			if (!timeline) {
				throw new Error('timeline container was unavailable');
			}

			const timelineRoot = timeline.parentElement ?? timeline;
			const observerWindow = window as Window & {
				__betterchatUnreadDividerSettlingSeen?: boolean;
				__betterchatUnreadDividerSettlingObserver?: MutationObserver;
			};
			const captureSettlingNode = (node: Node | null | undefined) => {
				if (!(node instanceof HTMLElement)) {
					return;
				}

				if (node.matches('[data-testid="timeline-unread-divider"][data-state="settling"]')) {
					observerWindow.__betterchatUnreadDividerSettlingSeen = true;
					return;
				}

				if (node.querySelector('[data-testid="timeline-unread-divider"][data-state="settling"]')) {
					observerWindow.__betterchatUnreadDividerSettlingSeen = true;
				}
			};
			observerWindow.__betterchatUnreadDividerSettlingSeen = false;
			captureSettlingNode(document.querySelector('[data-testid="timeline-unread-divider"]'));
			const observer = new MutationObserver((records) => {
				for (const record of records) {
					if (record.type === 'attributes') {
						captureSettlingNode(record.target);
					}

					for (const addedNode of Array.from(record.addedNodes)) {
						captureSettlingNode(addedNode);
					}
				}
			});
			observer.observe(timelineRoot, {
				attributes: true,
				childList: true,
				subtree: true,
			});
			observerWindow.__betterchatUnreadDividerSettlingObserver = observer;
		});

		await scrollTimelineToBottom(page);
		await expect
			.poll(() =>
				page.evaluate(() => {
					const observerWindow = window as Window & {
						__betterchatUnreadDividerSettlingSeen?: boolean;
					};
					return observerWindow.__betterchatUnreadDividerSettlingSeen ?? false;
				}),
			)
			.toBe(true);
		await expect.poll(async () => page.getByTestId('timeline-unread-divider').count()).toBe(0);
		await page.evaluate(() => {
			const observerWindow = window as Window & {
				__betterchatUnreadDividerSettlingObserver?: MutationObserver;
			};
			observerWindow.__betterchatUnreadDividerSettlingObserver?.disconnect();
		});

		await page.reload();
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId('timeline-unread-divider')).toHaveCount(0);
	});

	test('keeps the active room stable in the DM list after unread clears and settles once the user leaves', async ({ page }) => {
		const manifest = readSeedManifest();
		const activeRoom = manifest.rooms.dmBob;
		const comparisonRoom = manifest.rooms.dmCharlie;
		const neutralRoom = manifest.rooms.publicEmpty;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const bobSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		const charlieSession = await createBetterChatSession({
			login: 'charlie',
			password: 'CharliePass123!',
		});

		await markConversationRead(aliceSession, activeRoom.roomId);
		await markConversationRead(aliceSession, comparisonRoom.roomId);

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, neutralRoom.roomId);
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId(`sidebar-room-badge-${activeRoom.roomId}`)).toBeHidden();
		await expect(page.getByTestId(`sidebar-room-badge-${comparisonRoom.roomId}`)).toBeHidden();

		await betterChatPostJson(
			bobSession,
			`/api/conversations/${activeRoom.roomId}/messages`,
			conversationMessageBody({
				text: `[betterchat][e2e] active room hold ${Date.now()}`,
			}),
		);
		await expect(page.getByTestId(`sidebar-room-badge-${activeRoom.roomId}`)).toContainText('1', { timeout: 3_000 });

		await betterChatPostJson(
			charlieSession,
			`/api/conversations/${comparisonRoom.roomId}/messages`,
			conversationMessageBody({
				text: `[betterchat][e2e] quiet comparison room ${Date.now()}`,
			}),
		);
		await expect(page.getByTestId(`sidebar-room-badge-${comparisonRoom.roomId}`)).toContainText('1', { timeout: 3_000 });
		await markConversationRead(aliceSession, comparisonRoom.roomId);
		await expect(page.getByTestId(`sidebar-room-badge-${comparisonRoom.roomId}`)).toBeHidden({ timeout: 3_000 });

		await expect
			.poll(async () => {
				const order = await readSidebarSectionOrder(page, 'dms');
				return order.indexOf(`sidebar-room-${activeRoom.roomId}`) - order.indexOf(`sidebar-room-${comparisonRoom.roomId}`);
			})
			.toBeLessThan(0);

		await openRoom(page, activeRoom.roomId);
		await scrollTimelineToBottom(page);
		await expect(page.getByTestId(`sidebar-room-badge-${activeRoom.roomId}`)).toBeHidden({ timeout: 3_000 });

		await expect
			.poll(async () => {
				const order = await readSidebarSectionOrder(page, 'dms');
				return order.indexOf(`sidebar-room-${activeRoom.roomId}`) - order.indexOf(`sidebar-room-${comparisonRoom.roomId}`);
			})
			.toBeLessThan(0);

		await openRoom(page, comparisonRoom.roomId);
		await expect
			.poll(async () => {
				const order = await readSidebarSectionOrder(page, 'dms');
				return order.indexOf(`sidebar-room-${comparisonRoom.roomId}`) - order.indexOf(`sidebar-room-${activeRoom.roomId}`);
			})
			.toBeLessThan(0);
	});

	test('loads older originals through BetterChat message context when reply jump targets are outside the current slice', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.publicEmpty;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});

		const anchorText = `[betterchat][e2e] context anchor ${Date.now()}`;
		const anchorMessage = await betterChatPostJson<{ message: { id: string } }>(
			aliceSession,
			`/api/conversations/${room.roomId}/messages`,
			conversationMessageBody({
				text: anchorText,
			}),
		);

		for (let index = 0; index < 64; index += 1) {
			await betterChatPostJson(
				aliceSession,
				`/api/conversations/${room.roomId}/messages`,
				conversationMessageBody({
					text: `[betterchat][e2e] context filler ${index + 1} ${Date.now()}`,
				}),
			);
		}

		const replyText = `[betterchat][e2e] context reply ${Date.now()}`;
		const replyMessage = await betterChatPostJson<{ message: { id: string } }>(
			aliceSession,
			`/api/conversations/${room.roomId}/messages`,
			conversationMessageBody({
				replyToMessageId: anchorMessage.message.id,
				text: replyText,
			}),
		);

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);
		await expect(page.getByTestId(`timeline-message-${anchorMessage.message.id}`)).toHaveCount(0);

		await page.getByTestId(`reply-jump-${replyMessage.message.id}`).click();
		await expect(page.getByTestId(`timeline-message-${anchorMessage.message.id}`)).toContainText(anchorText);
	});

	test('receives realtime invalidations and stays pinned when the user is already at the bottom', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.dmCharlie;
		const charlieSession = await createBetterChatSession({
			login: 'charlie',
			password: 'CharliePass123!',
		});
		const liveText = `[betterchat][e2e] realtime bottom follow ${Date.now()}`;

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);
		await page.evaluate(() => {
			const timeline = document.querySelector('[data-testid="timeline"]');
			if (!timeline) {
				throw new Error('timeline container was unavailable');
			}

			const timelineRoot = timeline.parentElement ?? timeline;
			(window as Window & {
				__betterchatUnreadDividerSeen?: boolean;
				__betterchatUnreadDividerObserver?: MutationObserver;
			}).__betterchatUnreadDividerSeen = Boolean(document.querySelector('[data-testid="timeline-unread-divider"]'));
			const observer = new MutationObserver(() => {
				if (document.querySelector('[data-testid="timeline-unread-divider"]')) {
					(window as Window & {
						__betterchatUnreadDividerSeen?: boolean;
					}).__betterchatUnreadDividerSeen = true;
				}
			});
			observer.observe(timelineRoot, {
				attributes: true,
				childList: true,
				subtree: true,
			});
			(window as Window & {
				__betterchatUnreadDividerObserver?: MutationObserver;
			}).__betterchatUnreadDividerObserver = observer;
		});

		await betterChatPostJson(
			charlieSession,
			`/api/conversations/${room.roomId}/messages`,
			conversationMessageBody({
				text: liveText,
			}),
		);

		await expect(page.getByText(liveText)).toBeVisible();
		await expect.poll(async () => readTimelineBottomGap(page.getByTestId('timeline'))).toBeLessThan(12);
		await expect(page.getByTestId('timeline-unread-divider')).toHaveCount(0);
		expect(
			await page.evaluate(() => {
				const observerWindow = window as Window & {
					__betterchatUnreadDividerSeen?: boolean;
					__betterchatUnreadDividerObserver?: MutationObserver;
				};
				observerWindow.__betterchatUnreadDividerObserver?.disconnect();
				return observerWindow.__betterchatUnreadDividerSeen ?? false;
			}),
		).toBe(false);
	});

	test('refreshes unread badges for inactive rooms while another timeline is open', async ({ page }) => {
		const manifest = readSeedManifest();
		const targetRoom = manifest.rooms.dmCharlie;
		const visibleRoom = manifest.rooms.publicEmpty;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const charlieSession = await createBetterChatSession({
			login: 'charlie',
			password: 'CharliePass123!',
		});
		const liveText = `[betterchat][e2e] sidebar unread refresh ${Date.now()}`;

		await markConversationRead(aliceSession, targetRoom.roomId);

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, visibleRoom.roomId);
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId(`sidebar-room-badge-${targetRoom.roomId}`)).toBeHidden();

		await betterChatPostJson(
			charlieSession,
			`/api/conversations/${targetRoom.roomId}/messages`,
			conversationMessageBody({
				text: liveText,
			}),
		);

		await expect(page.getByTestId(`sidebar-room-badge-${targetRoom.roomId}`)).toContainText('1', { timeout: 3_000 });
	});

	test('surfaces inactive DM attention in the sidebar dock without requiring sidebar scrolling', async ({ page }) => {
		const manifest = readSeedManifest();
		const targetRoom = manifest.rooms.dmBob;
		const visibleRoom = manifest.rooms.publicEmpty;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const bobSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		const liveText = `[betterchat][e2e] sidebar attention dock ${Date.now()}`;

		const initialDirectory = await readDirectory(aliceSession);
		for (const entry of initialDirectory.entries) {
			await markConversationRead(aliceSession, entry.conversation.id);
		}

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, visibleRoom.roomId);
		await waitForRoomLoadingToFinish(page);

		const sidebarBody = page.getByTestId('sidebar-body');
		await sidebarBody.evaluate((node) => {
			node.scrollTop = 0;
		});
		await expect(page.getByTestId(`sidebar-attention-dock-item-${targetRoom.roomId}`)).toHaveCount(0);

		await betterChatPostJson(
			bobSession,
			`/api/conversations/${targetRoom.roomId}/messages`,
			conversationMessageBody({
				text: liveText,
			}),
		);

		const dockItem = page.getByTestId(`sidebar-attention-dock-item-${targetRoom.roomId}`);
		await expect(dockItem).toContainText('Bob Example', { timeout: 3_000 });
		await expect(dockItem).toContainText('1 条未读');
		await expect.poll(async () => sidebarBody.evaluate((node) => node.scrollTop)).toBe(0);

		await dockItem.click();
		await expect(page).toHaveURL(new RegExp(`/app/rooms/${targetRoom.roomId}$`));
		await waitForRoomLoadingToFinish(page);
	});

	test('refreshes sidebar attention signals for inactive public rooms while another timeline is open', async ({ page }) => {
		const manifest = readSeedManifest();
		const targetRoom = manifest.rooms.publicEmpty;
		const visibleRoom = manifest.rooms.dmCharlie;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const bobSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		const liveText = `[betterchat][e2e] public sidebar unread refresh ${Date.now()}`;

		await markConversationRead(aliceSession, targetRoom.roomId);

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, visibleRoom.roomId);
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId(`sidebar-room-badge-${targetRoom.roomId}`)).toBeHidden();

		await betterChatPostJson(
			bobSession,
			`/api/conversations/${targetRoom.roomId}/messages`,
			conversationMessageBody({
				text: liveText,
			}),
		);

		await expect
			.poll(async () => {
				const directory = await readDirectory(aliceSession);
				return resolveDirectoryAttention(directory.entries.find((entry) => entry.conversation.id === targetRoom.roomId)).level;
			})
			.not.toBe('none');

		const latestDirectory = await readDirectory(aliceSession);
		const targetEntry = latestDirectory.entries.find((entry) => entry.conversation.id === targetRoom.roomId);
		expect(targetEntry).toBeTruthy();
		if (!targetEntry) {
			throw new Error('target public room was missing from the directory snapshot');
		}

		const targetAttention = resolveDirectoryAttention(targetEntry);
		await expect(page.getByTestId(`sidebar-room-${targetRoom.roomId}`)).toHaveAttribute('data-attention-level', targetAttention.level);
		if (targetAttention.badgeCount !== undefined) {
			await expect(page.getByTestId(`sidebar-room-badge-${targetRoom.roomId}`)).toContainText(String(targetAttention.badgeCount), {
				timeout: 3_000,
			});
			return;
		}

		expect(targetAttention.level).toBe('activity');
		await expect(page.getByTestId(`sidebar-room-badge-${targetRoom.roomId}`)).toBeHidden();
	});

	test('refreshes sidebar unread state for the active room when the user is reading older content', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.dmCharlie;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const charlieSession = await createBetterChatSession({
			login: 'charlie',
			password: 'CharliePass123!',
		});
		const fillerPrefix = `[betterchat][e2e] active room sidebar filler ${Date.now()}`;
		const liveText = `[betterchat][e2e] active room sidebar unread ${Date.now()}`;

		for (let index = 0; index < 48; index += 1) {
			await betterChatPostJson(
				charlieSession,
				`/api/conversations/${room.roomId}/messages`,
				conversationMessageBody({
					text: `${fillerPrefix} ${index + 1}`,
				}),
			);
		}

		await markConversationRead(aliceSession, room.roomId);
		await page.setViewportSize({
			width: 1280,
			height: 560,
		});

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);
		await expect(page.getByTestId(`sidebar-room-badge-${room.roomId}`)).toBeHidden();

		const timeline = page.getByTestId('timeline');
		await timeline.evaluate((node) => {
			node.scrollTo({
				top: 0,
				behavior: 'auto',
			});
		});
		expect(await readTimelineBottomGap(timeline)).toBeGreaterThan(80);

		await betterChatPostJson(
			charlieSession,
			`/api/conversations/${room.roomId}/messages`,
			conversationMessageBody({
				text: liveText,
			}),
		);

		await expect(page.getByTestId(`sidebar-room-badge-${room.roomId}`)).toContainText('1', { timeout: 3_500 });
		await expect(page.getByTestId('timeline-unread-divider')).toBeVisible();
	});

	type NotificationScenario = {
		aliceSession: Awaited<ReturnType<typeof createBetterChatSession>>;
		bobSession: Awaited<ReturnType<typeof createBetterChatSession>>;
		channelRoom: ReturnType<typeof readSeedManifest>['rooms']['publicEmpty'];
		charlieSession: Awaited<ReturnType<typeof createBetterChatSession>>;
		dmRoom: ReturnType<typeof readSeedManifest>['rooms']['dmCharlie'];
	};
	type RoomAlertMenuOption = 'all' | 'mute' | 'personal';

	const prepareForegroundNotificationScenario = async (
		page: Page,
		channelRoomKey: 'publicEmpty' | 'publicQuiet' = 'publicEmpty',
	): Promise<NotificationScenario> => {
		const manifest = readSeedManifest();
		const channelRoom = manifest.rooms[channelRoomKey];
		const dmRoom = manifest.rooms.dmCharlie;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const bobSession = await createBetterChatSession({
			login: 'bob',
			password: 'BobPass123!',
		});
		const charlieSession = await createBetterChatSession({
			login: 'charlie',
			password: 'CharliePass123!',
		});

		await markConversationRead(aliceSession, channelRoom.roomId);
		await markConversationRead(aliceSession, dmRoom.roomId);
		await installNotificationRecorder(page);
		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await page.getByTestId('settings-trigger').click();
		await page.getByTestId('settings-browser-notifications-foreground').click();
		await page.getByTestId('settings-close').click();

		return {
			aliceSession,
			bobSession,
			channelRoom,
			charlieSession,
			dmRoom,
		};
	};

	const setRoomAlertPreference = async ({
		option,
		page,
		roomId,
	}: {
		option: RoomAlertMenuOption;
		page: Page;
		roomId: string;
	}) => {
		await openRoom(page, roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);
		await page.getByTestId('room-alert-toggle').click();
		await page.getByTestId(`room-alert-menu-${option}`).click();
	};

	test('keeps personal-only channels quiet for generic unread activity', async ({ page }) => {
		const { bobSession, channelRoom, dmRoom } = await prepareForegroundNotificationScenario(page);

		await setRoomAlertPreference({
			option: 'personal',
			page,
			roomId: channelRoom.roomId,
		});

		await openRoom(page, dmRoom.roomId);
		await waitForRoomLoadingToFinish(page);
		await clearRecordedNotifications(page);

		await betterChatPostJson(
			bobSession,
			`/api/conversations/${channelRoom.roomId}/messages`,
			conversationMessageBody({
				text: `[betterchat][e2e] personal channel generic quiet ${Date.now()}`,
			}),
		);

		await expect(page.getByTestId(`sidebar-room-badge-${channelRoom.roomId}`)).toContainText('1');
		await expect.poll(() => readRecordedNotifications(page)).toEqual([]);
	});

	test('notifies for personal mentions in personal-only channels', async ({ page }) => {
		const { bobSession, channelRoom, dmRoom } = await prepareForegroundNotificationScenario(page, 'publicQuiet');

		await setRoomAlertPreference({
			option: 'personal',
			page,
			roomId: channelRoom.roomId,
		});

		await openRoom(page, dmRoom.roomId);
		await waitForRoomLoadingToFinish(page);
		await clearRecordedNotifications(page);

		const mentionText = `[betterchat][e2e] personal channel mention ${Date.now()} @alice`;
		await betterChatPostJson(
			bobSession,
			`/api/conversations/${channelRoom.roomId}/messages`,
			conversationMessageBody({
				text: mentionText,
			}),
		);

		await expect.poll(async () => (await readRecordedNotifications(page)).length).toBe(1);
		const personalMentionNotification = (await readRecordedNotifications(page))[0];
		expect(personalMentionNotification?.title).toBe(channelRoom.title);
		expect(personalMentionNotification?.body).toContain('Bob Example');
		expect(personalMentionNotification?.body).toContain(mentionText);
	});

	test('preserves unread truth but suppresses muted room notifications', async ({ page }) => {
		const { bobSession, channelRoom, dmRoom } = await prepareForegroundNotificationScenario(page);

		await setRoomAlertPreference({
			option: 'mute',
			page,
			roomId: channelRoom.roomId,
		});

		await openRoom(page, dmRoom.roomId);
		await waitForRoomLoadingToFinish(page);
		await clearRecordedNotifications(page);

		await betterChatPostJson(
			bobSession,
			`/api/conversations/${channelRoom.roomId}/messages`,
			conversationMessageBody({
				text: `[betterchat][e2e] muted mention ${Date.now()} @alice`,
			}),
		);

		await expect(page.getByTestId(`sidebar-room-badge-${channelRoom.roomId}`)).toContainText('1');
		await expect.poll(() => readRecordedNotifications(page)).toEqual([]);
	});

	test('emits one browser notification per unseen message in all-message channels', async ({ page }) => {
		const { bobSession, channelRoom, dmRoom } = await prepareForegroundNotificationScenario(page);

		await setRoomAlertPreference({
			option: 'all',
			page,
			roomId: channelRoom.roomId,
		});

		await openRoom(page, dmRoom.roomId);
		await waitForRoomLoadingToFinish(page);
		await clearRecordedNotifications(page);

		const firstText = `[betterchat][e2e] all channel notification 1 ${Date.now()}`;
		const secondText = `[betterchat][e2e] all channel notification 2 ${Date.now()}`;
		await betterChatPostJson(
			bobSession,
			`/api/conversations/${channelRoom.roomId}/messages`,
			conversationMessageBody({
				text: firstText,
			}),
		);
		await betterChatPostJson(
			bobSession,
			`/api/conversations/${channelRoom.roomId}/messages`,
			conversationMessageBody({
				text: secondText,
			}),
		);

		await expect.poll(async () => (await readRecordedNotifications(page)).length).toBe(2);
		const allMessageNotifications = await readRecordedNotifications(page);
		expect(allMessageNotifications.map((notification) => notification.title)).toEqual([channelRoom.title, channelRoom.title]);
		expect(allMessageNotifications[0]?.body).toContain('Bob Example');
		expect(allMessageNotifications[0]?.body).toContain(firstText);
		expect(allMessageNotifications[1]?.body).toContain(secondText);
	});

	test('notifies for inactive direct messages with the default room policy', async ({ page }) => {
		const { channelRoom, charlieSession, dmRoom } = await prepareForegroundNotificationScenario(page);

		await openRoom(page, channelRoom.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);
		await clearRecordedNotifications(page);
		await betterChatPostJson(
			charlieSession,
			`/api/conversations/${dmRoom.roomId}/messages`,
			conversationMessageBody({
				text: `[betterchat][e2e] dm default notify ${Date.now()}`,
			}),
		);

		await expect.poll(async () => (await readRecordedNotifications(page)).length).toBe(1);
		const dmNotification = (await readRecordedNotifications(page))[0];
		expect(dmNotification?.title).toBe(dmRoom.title);
		expect(dmNotification?.body).toContain('Charlie Example');
	});

	test('keeps the active visible room quiet but still notifies once the page is hidden', async ({ page }) => {
		const { bobSession, channelRoom } = await prepareForegroundNotificationScenario(page);

		await setRoomAlertPreference({
			option: 'all',
			page,
			roomId: channelRoom.roomId,
		});

		await clearRecordedNotifications(page);
		await setRecordedNotificationPageAttention(page, {
			focused: true,
			visibilityState: 'visible',
		});
		const visibleText = `[betterchat][e2e] active visible quiet ${Date.now()}`;

		await betterChatPostJson(
			bobSession,
			`/api/conversations/${channelRoom.roomId}/messages`,
			conversationMessageBody({
				text: visibleText,
			}),
		);
		await expect.poll(() => readRecordedNotifications(page)).toEqual([]);
		await expect(page.getByText(visibleText, { exact: true })).toBeVisible();
		await clearRecordedNotifications(page);

		await setRecordedNotificationPageAttention(page, {
			focused: false,
			visibilityState: 'hidden',
		});
		const hiddenText = `[betterchat][e2e] active hidden notify ${Date.now()}`;
		await betterChatPostJson(
			bobSession,
			`/api/conversations/${channelRoom.roomId}/messages`,
			conversationMessageBody({
				text: hiddenText,
			}),
		);

		await expect.poll(async () => (await readRecordedNotifications(page)).length).toBe(1);
		const hiddenNotification = (await readRecordedNotifications(page))[0];
		expect(hiddenNotification?.body).toContain('Bob Example');
		expect(hiddenNotification?.body).toContain(hiddenText);
	});

	test('replaces the sendbox with a readonly notice in readonly rooms', async ({ page }) => {
		const manifest = readSeedManifest();
		const readonlyRoom = manifest.rooms.publicReadonly;

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, readonlyRoom.roomId);
		await waitForRoomLoadingToFinish(page);

		await expect(page.getByTestId('readonly-composer-notice')).toBeVisible();
		await expect(page.getByTestId('readonly-composer-notice')).toContainText('此房间不允许发送消息。');
		await expect(page.getByTestId('composer')).toHaveCount(0);
		await expect(page.getByTestId('composer-resize-handle')).toHaveCount(0);
		await expect(page.getByTestId('composer-textarea')).toHaveCount(0);
		await expect(page.getByTestId('composer-send')).toHaveCount(0);
		await expect(page.getByTestId('composer-image-trigger')).toHaveCount(0);
	});

	test('keeps the viewport anchored when folding an expanded long historical message in API mode', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.publicEmpty;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const longMessage = [
			`[betterchat][e2e] api fold anchor ${Date.now()}`,
			'',
			'```ts',
			"const snapshot = { room: 'api-mode-anchor', source: 'historical' };",
			'snapshot.room;',
			'snapshot.source;',
			'console.log(snapshot);',
			'```',
			'',
			'这里再补一段正文，确保消息在时间线里会被识别为需要折叠的历史长消息。',
		].join('\n');

		const sent = await betterChatPostJson<CreateConversationMessageResponse>(
			aliceSession,
			`/api/conversations/${room.roomId}/messages`,
			conversationMessageBody({ text: longMessage }),
		);
		const messageId = sent.message.id;
		if (!messageId) {
			throw new Error('Expected BetterChat send response to include a canonical message id.');
		}

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);

		const timeline = page.getByTestId('timeline');
		const message = page.getByTestId(`timeline-message-${messageId}`);
		const content = page.getByTestId(`timeline-message-content-${messageId}`);
		const toggle = page.getByTestId(`timeline-message-toggle-${messageId}`);

		await message.scrollIntoViewIfNeeded();
		await expect(content).toHaveAttribute('data-collapsed', 'true');
		await toggle.click();
		await expect(content).toHaveAttribute('data-collapsed', 'false');

		await timeline.evaluate((node, input: { anchorTopBias: number; targetTestId: string }) => {
			const target = node.querySelector<HTMLElement>(`[data-testid="${input.targetTestId}"]`);
			if (!target) {
				throw new Error(`missing target message: ${input.targetTestId}`);
			}

			const anchorWithinTargetPx = 48;
			node.scrollTop = Math.max(target.offsetTop - input.anchorTopBias + anchorWithinTargetPx, 0);
		}, {
			anchorTopBias: TIMELINE_VIEWPORT_ANCHOR_TOP_BIAS,
			targetTestId: `timeline-message-${messageId}`,
		});

		const beforeToggle = await readTimelineViewportStateForMessage(timeline, `timeline-message-${messageId}`);
		expect(beforeToggle.anchorMessageId).toBe(messageId);
		expect(beforeToggle.anchorOffset).not.toBeNull();

		await toggle.evaluate((node) => {
			(node as HTMLButtonElement).click();
		});
		await expect(content).toHaveAttribute('data-collapsed', 'true');

		const afterToggle = await readTimelineViewportStateForMessage(timeline, `timeline-message-${messageId}`);
		const expectedScrollTop = Math.max(
			afterToggle.targetTop +
				Math.min(beforeToggle.anchorOffset ?? 0, Math.max(afterToggle.targetHeight - 1, 0)) -
				TIMELINE_VIEWPORT_ANCHOR_TOP_BIAS,
			0,
		);

		expect(afterToggle.anchorMessageId).toBe(messageId);
		expect(Math.abs(afterToggle.scrollTop - expectedScrollTop)).toBeLessThanOrEqual(8);
	});

	test('uploads an image through BetterChat and renders it in the live shell', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.publicEmpty;
		const caption = `[betterchat][e2e] image upload ${Date.now()}`;

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		await page.getByTestId('composer-image-input').setInputFiles({
			buffer: tinyPngFixture.buffer,
			mimeType: tinyPngFixture.mimeType,
			name: tinyPngFixture.fileName,
		});
		await expect(page.getByTestId('composer-image-preview')).toBeVisible();

		await page.getByTestId('composer-textarea').fill(caption);
		await page.getByTestId('composer-send').click();

		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText(caption);
		await expect(newestMessage.locator('[data-testid^="timeline-message-toggle-"]')).toContainText('收起');
		await expect(newestMessage.getByRole('button', { name: `查看图片：${tinyPngFixture.fileName}` })).toBeVisible();
		await expect(page.getByTestId('composer-image-preview')).toHaveCount(0);
		await expect.poll(async () => readTimelineBottomGap(page.getByTestId('timeline'))).toBeLessThan(12);
		await expect(page.getByTestId('timeline-unread-divider')).toHaveCount(0);
	});

	test('uses preview assets in the timeline and original assets in the image viewer when BetterChat provides both', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.publicEmpty;
		const aliceSession = await createBetterChatSession({
			login: 'alice',
			password: 'AlicePass123!',
		});
		const largePngFixture = createLargePngFixture({
			width: 960,
			height: 720,
		});
		const caption = `[betterchat][e2e] preview source split ${Date.now()}`;
		const requestedMediaPaths = new Set<string>();

		const uploadResult = await betterChatUploadImage<{ message: { attachments?: Array<{ kind: 'image'; preview: { url: string }; source: { url: string }; title?: string }> } }>(
			aliceSession,
			`/api/conversations/${room.roomId}/media`,
			{
				buffer: largePngFixture.buffer,
				fileName: largePngFixture.fileName,
				mimeType: largePngFixture.mimeType,
				text: caption,
			},
		);

		const uploadedTimeline = await betterChatGetJson<ConversationTimelineSnapshot>(
			aliceSession,
			`/api/conversations/${room.roomId}/timeline?limit=20`,
		);
		const uploadedMessage = uploadedTimeline.messages.find((message) => message.content.text === caption);
		expect(uploadedMessage?.attachments?.[0]?.kind).toBe('image');
		const imageAttachment = uploadedMessage?.attachments?.[0];
		expect(imageAttachment).toBeTruthy();
		if (!imageAttachment || imageAttachment.kind !== 'image') {
			throw new Error('expected uploaded timeline image attachment');
		}

		expect(imageAttachment.preview.url).not.toBe(imageAttachment.source.url);
		expect(uploadResult.message.attachments?.[0]?.kind).toBe('image');

		await page.route(/\/api\/media\/file-upload\//, async (route) => {
			const requestUrl = new URL(route.request().url());
			requestedMediaPaths.add(requestUrl.pathname);
			await route.continue();
		});

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const newestMessage = page.locator('article[data-message-id]').filter({ hasText: caption }).last();
		const timelineImage = newestMessage.getByTestId(`timeline-image-${imageAttachment.id}`);
		await expect(newestMessage).toContainText(caption);
		await expect(timelineImage).toBeVisible();
		await expect.poll(() => requestedMediaPaths.has(imageAttachment.preview.url)).toBe(true);

		await timelineImage.evaluate((node) => {
			(node as HTMLImageElement).click();
		});
		await expect(page.getByTestId('image-viewer-close')).toBeVisible();
		await expect.poll(() => requestedMediaPaths.has(imageAttachment.source.url)).toBe(true);
	});

	test('keeps a failed API image upload in the timeline across polling and supports retry', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.publicEmpty;
		const caption = `[betterchat][e2e] image upload retry ${Date.now()}`;
		let failNextUpload = true;

		await page.route(new RegExp(`/api/conversations/${room.roomId}/media$`), async (route) => {
			if (route.request().method() !== 'POST' || !failNextUpload) {
				await route.continue();
				return;
			}

			failNextUpload = false;
			await route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({
					ok: false,
					error: {
						code: 'UPSTREAM_UNAVAILABLE',
						message: '图片发送失败，请重试。',
					},
				}),
			});
		});

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		await page.getByTestId('composer-image-input').setInputFiles({
			buffer: tinyPngFixture.buffer,
			mimeType: tinyPngFixture.mimeType,
			name: tinyPngFixture.fileName,
		});
		await page.getByTestId('composer-textarea').fill(caption);
		await page.getByTestId('composer-send').click();

		const failedMessage = page
			.locator('article[data-message-id][data-delivery-state="failed"]')
			.filter({ hasText: caption });
		await expect(failedMessage).toBeVisible();
		await expect(failedMessage.locator('[data-testid^="timeline-message-retry-"]')).toBeVisible();
		await page.waitForTimeout(1_700);
		await expect(failedMessage).toBeVisible();
		resetUnexpectedBrowserErrorGuard(page);

		await failedMessage.locator('[data-testid^="timeline-message-retry-"]').click();

		await expect(failedMessage).toHaveCount(0);
		const deliveredMessage = page.locator('article[data-message-id]').filter({ hasText: caption }).last();
		await expect(deliveredMessage).toContainText(caption);
		await expect(deliveredMessage).toHaveAttribute('data-delivery-state', 'sent');
		await expect(deliveredMessage.getByRole('button', { name: `查看图片：${tinyPngFixture.fileName}` })).toBeVisible();
		await expect.poll(async () => readTimelineBottomGap(page.getByTestId('timeline'))).toBeLessThan(12);
		await expect(page.getByTestId('timeline-unread-divider')).toHaveCount(0);
	});

	test('sends the original image file without browser-side transcoding or recompression', async ({ page }) => {
		test.setTimeout(75_000);
		const manifest = readSeedManifest();
		const room = manifest.rooms.publicEmpty;
		const caption = `[betterchat][e2e] large image upload ${Date.now()}`;
		const largeBmpFixture = createLargeBmpFixture({
			width: 1880,
			height: 1880,
		});
		let interceptedUploadBodyLatin1 = '';
		let interceptedContentType = '';

		await page.route(new RegExp(`/api/conversations/${room.roomId}/media$`), async (route) => {
			if (route.request().method() !== 'POST') {
				await route.continue();
				return;
			}

			interceptedUploadBodyLatin1 = route.request().postDataBuffer()?.toString('latin1') ?? '';
			interceptedContentType = route.request().headers()['content-type'] ?? '';

			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					ok: true,
					data: {
						message: {
							id: `raw-image-${Date.now()}`,
							conversationId: room.roomId,
							authoredAt: new Date().toISOString(),
							author: {
								id: 'alice',
								displayName: manifest.users.alice.displayName,
								username: manifest.users.alice.username,
							},
							content: {
								format: 'markdown',
								text: caption,
							},
							state: {
								edited: false,
								deleted: false,
							},
							attachments: [
								{
									kind: 'image',
									id: `raw-image-${Date.now()}-attachment`,
									title: largeBmpFixture.fileName,
									url: '/api/media/fixtures/ops-handoff-board.svg',
								},
							],
						},
					},
				}),
			});
		});

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await page.goto(`/app/rooms/${room.roomId}`);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		await page.getByTestId('composer-image-input').setInputFiles({
			buffer: largeBmpFixture.buffer,
			mimeType: largeBmpFixture.mimeType,
			name: largeBmpFixture.fileName,
		});
		await expect(page.getByTestId('composer-image-preview')).toBeVisible();

		await page.getByTestId('composer-textarea').fill(caption);
		await page.getByTestId('composer-send').click();

		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText(caption, {
			timeout: 10_000,
		});
		await expect(newestMessage.locator('[data-testid^="timeline-message-toggle-"]')).toContainText('收起');
		await expect(newestMessage.getByRole('button', { name: `查看图片：${largeBmpFixture.fileName}` })).toBeVisible();
			await expect(page.getByTestId('composer-image-preview')).toHaveCount(0);
			await expect.poll(async () => readTimelineBottomGap(page.getByTestId('timeline'))).toBeLessThan(12);
			expect(interceptedContentType).toContain('multipart/form-data');
			if (!interceptedUploadBodyLatin1) {
				throw new Error('expected the browser upload body to be intercepted');
			}
			expect(interceptedUploadBodyLatin1).toContain(`filename="${largeBmpFixture.fileName}"`);
			expect(interceptedUploadBodyLatin1).toContain(`Content-Type: ${largeBmpFixture.mimeType}`);
			expect(interceptedUploadBodyLatin1).not.toContain('filename="image.webp"');
			expect(interceptedUploadBodyLatin1).not.toContain('Content-Type: image/webp');
		});

	test('receives realtime image uploads and stays pinned when already at the bottom', async ({ page }) => {
		const manifest = readSeedManifest();
		const room = manifest.rooms.dmCharlie;
		const charlieSession = await createBetterChatSession({
			login: 'charlie',
			password: 'CharliePass123!',
		});
		const caption = `[betterchat][e2e] realtime image ${Date.now()}`;

		await loginAsApiUser(page, {
			login: 'alice',
			password: 'AlicePass123!',
		});
		await openRoom(page, room.roomId);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		await betterChatUploadImage(charlieSession, `/api/conversations/${room.roomId}/media`, {
			buffer: tinyPngFixture.buffer,
			fileName: tinyPngFixture.fileName,
			mimeType: tinyPngFixture.mimeType,
			text: caption,
		});

		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText(caption);
		await expect(newestMessage.locator('[data-testid^="timeline-message-toggle-"]')).toContainText('收起');
		await expect(newestMessage.getByRole('button', { name: `查看图片：${tinyPngFixture.fileName}` })).toBeVisible();
		await expect.poll(async () => readTimelineBottomGap(page.getByTestId('timeline'))).toBeLessThan(12);
		await expect(page.getByTestId('timeline-unread-divider')).toHaveCount(0);
	});
});
