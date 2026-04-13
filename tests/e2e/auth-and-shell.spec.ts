import { expect, test, type Page } from '@playwright/test';

import { loginAsFixtureUser, openRoom, readTimelineBottomGap, scrollTimelineToBottom, waitForRoomLoadingToFinish } from './test-helpers';

const commandOrControl = process.platform === 'darwin' ? 'Meta' : 'Control';
const isApiMode = (process.env.BETTERCHAT_E2E_API_MODE ?? 'fixture').toLowerCase() === 'api';

const readComposerScrollMetrics = (page: Page) =>
	page.getByTestId('composer-textarea').evaluate((node) => {
		const scrollElement =
			node instanceof HTMLTextAreaElement
				? node
				: node.closest('.cm-editor')?.querySelector('.cm-scroller');
		if (!(scrollElement instanceof HTMLElement)) {
			return null;
		}

		const style = window.getComputedStyle(scrollElement);
		return {
			clientHeight: scrollElement.clientHeight,
			clientWidth: scrollElement.clientWidth,
			editorKind: node.getAttribute('data-live-editor') ?? '',
			overflowY: style.overflowY,
			paddingInlineEnd: style.paddingInlineEnd,
			scrollHeight: scrollElement.scrollHeight,
			scrollbarGutter: style.scrollbarGutter,
		};
	});

test.skip(isApiMode, 'fixture-only suite');

test.describe('auth and shell', () => {
	test('redirects unauthenticated app visits to login', async ({ page }) => {
		await page.goto('/app');

		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByTestId('login-page')).toBeVisible();
	});

	test('shows validation feedback and then enters the default room', async ({ page }) => {
		await page.goto('/login');
		await expect(page.getByTestId('login-page')).toBeVisible();

		await page.getByTestId('login-input').fill('');
		await page.getByTestId('password-input').fill('');
		await page.getByRole('button', { name: '登录' }).click();
		await expect(page.getByTestId('login-error')).toContainText('请输入账号和密码');

		await page.getByTestId('login-input').fill('linche');
		await page.getByTestId('password-input').fill('demo');
		await page.getByRole('button', { name: '登录' }).click();

		await expect(page).toHaveURL(/\/app\/rooms\/ops-handoff$/);
		await expect(page.getByTestId('current-user')).toContainText('linche');
		await expect(page.getByTestId('current-user-status')).toContainText('在线');
		await expect(page.getByTestId('current-user-status-dot')).toBeVisible();
		await expect(page.getByTestId('sidebar-section-favorites')).toBeVisible();
		await expect(page.getByTestId('sidebar-section-rooms')).toBeVisible();
		await expect(page.getByTestId('sidebar-section-dms')).toBeVisible();
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toHaveAttribute('data-active', 'true');
		await expect(page.getByTestId('sidebar-room-badge-ops-handoff')).toHaveAttribute('data-mentioned', 'true');
		await expect(page.getByTestId('sidebar-room-badge-ops-handoff')).toHaveAttribute('data-priority', 'personal');
		await expect(page.getByTestId('sidebar-room-presence-dm-mia')).toHaveAttribute('data-status', 'away');
		await expect(page.getByTestId('sidebar-room-presence-dm-zhoulan')).toHaveAttribute('data-status', 'online');
		await expect(page.getByTestId('sidebar-room-presence-dm-guning')).toHaveAttribute('data-status', 'busy');
		await expect(page.getByTestId('sidebar-room-presence-dm-achen')).toHaveAttribute('data-status', 'offline');
		await expect(page.getByTestId('sidebar-room-dm-zhoulan')).toContainText('平台同学');
		await expect(page.getByTestId('sidebar-room-dm-zhoulan')).not.toContainText('在线');
		await expect(page.getByTestId('sidebar-room-dm-mia')).toContainText('离开');
		await expect(page.getByTestId('sidebar-room-dm-guning')).toContainText('忙碌');
		await expect(page.getByTestId('sidebar-room-dm-achen')).toContainText('离线');
		await expect(page.getByTestId('room-favorite-toggle')).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('[data-testid^="sidebar-room-activity-"][data-visible="true"]')).toHaveCount(0);

		const timeline = page.getByTestId('timeline');
		const unreadDivider = page.getByTestId('timeline-unread-divider');
		await expect(unreadDivider).toBeVisible();

		const [timelineBox, unreadBox] = await Promise.all([timeline.boundingBox(), unreadDivider.boundingBox()]);
		expect(timelineBox).not.toBeNull();
		expect(unreadBox).not.toBeNull();
		if (!timelineBox || !unreadBox) {
			throw new Error('timeline or unread divider bounds were unavailable');
		}

		const dividerOffset = unreadBox.y - timelineBox.y;
		expect(dividerOffset).toBeGreaterThan(32);
		expect(dividerOffset).toBeLessThan(timelineBox.height - unreadBox.height - 24);

		const mentionBadge = page.getByTestId('sidebar-room-mention-ops-handoff');
		const unreadBadge = page.getByTestId('sidebar-room-badge-ops-handoff');
		const [mentionBox, badgeBox] = await Promise.all([mentionBadge.boundingBox(), unreadBadge.boundingBox()]);
		expect(mentionBox).not.toBeNull();
		expect(badgeBox).not.toBeNull();
		if (!mentionBox || !badgeBox) {
			throw new Error('mention or unread badge bounds were unavailable');
		}

		expect(mentionBox.x + mentionBox.width / 2).toBeLessThan(badgeBox.x + badgeBox.width / 2);
		expect(Math.abs(mentionBox.y + mentionBox.height / 2 - (badgeBox.y + badgeBox.height / 2))).toBeLessThanOrEqual(2);

		const singleDigitBadge = await page.getByTestId('sidebar-room-badge-dm-mia').boundingBox();
		expect(singleDigitBadge).not.toBeNull();
		if (!singleDigitBadge) {
			throw new Error('single-digit unread badge bounds were unavailable');
		}

		const singleDigitBadgeAspectRatio = singleDigitBadge.width / singleDigitBadge.height;
		expect(singleDigitBadgeAspectRatio).toBeGreaterThan(0.94);
		expect(singleDigitBadgeAspectRatio).toBeLessThan(1.18);

		const searchShortcut = page.getByTestId('sidebar-search-shortcut');
		const modifierKeycap = page.getByTestId('sidebar-search-shortcut-modifier');
		const letterKeycap = page.getByTestId('sidebar-search-shortcut-key');
		await expect(searchShortcut).toBeVisible();
		await expect(modifierKeycap).toHaveText(/Ctrl|⌘/);
		await expect(letterKeycap).toHaveText('K');
		const [modifierKeycapBox, letterKeycapBox] = await Promise.all([modifierKeycap.boundingBox(), letterKeycap.boundingBox()]);
		expect(modifierKeycapBox).not.toBeNull();
		expect(letterKeycapBox).not.toBeNull();
		if (!modifierKeycapBox || !letterKeycapBox) {
			throw new Error('sidebar search shortcut keycaps were unavailable');
		}

		expect(modifierKeycapBox.width).toBeGreaterThan(modifierKeycapBox.height * 0.9);
		expect(letterKeycapBox.width).toBeGreaterThan(letterKeycapBox.height * 0.9);
	});

	test('keeps the main workspace tight to tall desktop viewports without page scrolling', async ({ page }) => {
		await page.setViewportSize({
			width: 1440,
			height: 1320,
		});
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		const workspace = page.getByTestId('app-workspace');
		const composer = page.getByTestId('composer');
		const viewport = page.viewportSize();
		const [workspaceBox, composerBox, pageScrollOverflow] = await Promise.all([
			workspace.boundingBox(),
			composer.boundingBox(),
			page.evaluate(() => Math.max(document.documentElement.scrollHeight - window.innerHeight, 0)),
		]);
		expect(viewport).not.toBeNull();
		expect(workspaceBox).not.toBeNull();
		expect(composerBox).not.toBeNull();
		if (!viewport || !workspaceBox || !composerBox) {
			throw new Error('workspace, composer, or viewport bounds were unavailable');
		}

		const bottomGap = viewport.height - (workspaceBox.y + workspaceBox.height);
		expect(pageScrollOverflow).toBeLessThan(2);
		expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(viewport.height - 8);
		expect(bottomGap).toBeGreaterThan(12);
		expect(bottomGap).toBeLessThan(40);
	});

	test('keeps the sidebar free of horizontal overflow and persists desktop resize width', async ({ page }) => {
		await page.setViewportSize({
			width: 1440,
			height: 980,
		});
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		const sidebar = page.getByTestId('app-sidebar');
		const resizeHandle = page.getByTestId('sidebar-resize-handle');
		const readOverflowMetrics = async () =>
			page.evaluate(() => {
				const sidebar = document.querySelector('[data-testid="app-sidebar"]');
				const sidebarBody = document.querySelector('[data-testid="sidebar-body"]');
				if (!(sidebar instanceof HTMLElement) || !(sidebarBody instanceof HTMLElement)) {
					return null;
				}

				return {
					sidebarClientWidth: sidebar.clientWidth,
					sidebarScrollWidth: sidebar.scrollWidth,
					sidebarBodyClientWidth: sidebarBody.clientWidth,
					sidebarBodyScrollWidth: sidebarBody.scrollWidth,
				};
			});

		const beforeDragMetrics = await readOverflowMetrics();
		const beforeDragBox = await sidebar.boundingBox();
		expect(beforeDragMetrics).not.toBeNull();
		expect(beforeDragBox).not.toBeNull();
		if (!beforeDragMetrics || !beforeDragBox) {
			throw new Error('sidebar metrics or bounds were unavailable');
		}

		expect(beforeDragMetrics.sidebarScrollWidth - beforeDragMetrics.sidebarClientWidth).toBeLessThanOrEqual(1);
		expect(beforeDragMetrics.sidebarBodyScrollWidth - beforeDragMetrics.sidebarBodyClientWidth).toBeLessThanOrEqual(1);

		const resizeHandleBox = await resizeHandle.boundingBox();
		expect(resizeHandleBox).not.toBeNull();
		if (!resizeHandleBox) {
			throw new Error('sidebar resize handle bounds were unavailable');
		}

		await page.mouse.move(resizeHandleBox.x + resizeHandleBox.width / 2, resizeHandleBox.y + resizeHandleBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(resizeHandleBox.x + resizeHandleBox.width / 2 + 220, resizeHandleBox.y + resizeHandleBox.height / 2, {
			steps: 10,
		});
		await page.mouse.up();

		const afterDragMetrics = await readOverflowMetrics();
		const afterDragBox = await sidebar.boundingBox();
		expect(afterDragMetrics).not.toBeNull();
		expect(afterDragBox).not.toBeNull();
		if (!afterDragMetrics || !afterDragBox) {
			throw new Error('sidebar metrics or bounds were unavailable after resize');
		}

		expect(afterDragBox.width).toBeGreaterThan(beforeDragBox.width + 160);
		expect(afterDragMetrics.sidebarScrollWidth - afterDragMetrics.sidebarClientWidth).toBeLessThanOrEqual(1);
		expect(afterDragMetrics.sidebarBodyScrollWidth - afterDragMetrics.sidebarBodyClientWidth).toBeLessThanOrEqual(1);

		await page.reload();
		await waitForRoomLoadingToFinish(page);

		const reloadedBox = await page.getByTestId('app-sidebar').boundingBox();
		expect(reloadedBox).not.toBeNull();
		if (!reloadedBox) {
			throw new Error('sidebar bounds were unavailable after reload');
		}

		expect(reloadedBox.width).toBeGreaterThan(afterDragBox.width - 18);
		expect(reloadedBox.width).toBeLessThan(afterDragBox.width + 18);

		await resizeHandle.focus();
		await expect(resizeHandle).toHaveAttribute('data-keyboard-adjusting', 'false');
		await page.keyboard.press('Enter');
		await expect(resizeHandle).toHaveAttribute('data-keyboard-adjusting', 'true');

		const sidebarWidthBeforeKeyboardAdjust = (await page.getByTestId('app-sidebar').boundingBox())?.width;
		expect(sidebarWidthBeforeKeyboardAdjust).toBeTruthy();
		if (!sidebarWidthBeforeKeyboardAdjust) {
			throw new Error('sidebar width was unavailable before keyboard resize');
		}

		await page.keyboard.press('ArrowLeft');
		const sidebarWidthAfterKeyboardAdjust = (await page.getByTestId('app-sidebar').boundingBox())?.width;
		expect(sidebarWidthAfterKeyboardAdjust).toBeTruthy();
		if (!sidebarWidthAfterKeyboardAdjust) {
			throw new Error('sidebar width was unavailable after keyboard resize');
		}

		expect(sidebarWidthAfterKeyboardAdjust).toBeLessThan(sidebarWidthBeforeKeyboardAdjust - 8);
		await page.keyboard.press('Enter');
		await expect(resizeHandle).toHaveAttribute('data-keyboard-adjusting', 'false');

		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();

		await resizeHandle.focus();
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();
	});

	test('supports simple room search and room info toggle behavior', async ({ page }) => {
		await loginAsFixtureUser(page);

		const search = page.getByTestId('sidebar-search');
		await search.fill('交付');
		await expect(page.getByTestId('sidebar-room-delivery-room')).toBeVisible();
		await search.press('Enter');
		await waitForRoomLoadingToFinish(page);
		await expect(page).toHaveURL(/\/app\/rooms\/delivery-room$/);
		await expect(search).toHaveValue('');
		await expect(page.getByTestId('room-title')).toContainText('客户交付');
		await expect(page.getByTestId('room-favorite-toggle')).toHaveAttribute('aria-pressed', 'false');

		await search.fill('platform');
		await expect(page.getByTestId('sidebar-room-platform-duty')).toBeVisible();
		await search.press('Enter');
		await waitForRoomLoadingToFinish(page);
		await expect(page).toHaveURL(/\/app\/rooms\/platform-duty$/);
		await expect(search).toHaveValue('');
		await expect(page.getByTestId('room-favorite-toggle')).toHaveAttribute('aria-pressed', 'false');

		const roomInfoTrigger = page.getByTestId('room-info-trigger');
		await roomInfoTrigger.click();
		await expect(page.getByTestId('room-info-sidebar')).toBeVisible();
		await expect(roomInfoTrigger).toHaveAttribute('aria-expanded', 'true');
		await roomInfoTrigger.click();
		await expect(page.getByTestId('room-info-sidebar')).toHaveCount(0);
		await expect(roomInfoTrigger).toHaveAttribute('aria-expanded', 'false');

		await roomInfoTrigger.click();
		await expect(page.getByTestId('room-info-sidebar')).toBeVisible();
		await page.getByTestId('room-info-close').click();
		await expect(page.getByTestId('room-info-sidebar')).toHaveCount(0);

		await openRoom(page, 'ops-handoff');
	});

	test('persists local mute overrides and reorders rooms by notification priority, mention, and latest activity', async ({
		page,
	}) => {
		await loginAsFixtureUser(page);

		const roomsSection = page.getByTestId('sidebar-section-rooms');
		const roomOrder = async () =>
			roomsSection.locator('button[data-testid^="sidebar-room-"]').evaluateAll((nodes) =>
				nodes.map((node) => node.getAttribute('data-testid') ?? ''),
			);

		await expect(page.getByTestId('sidebar-room-badge-platform-duty')).toHaveAttribute('data-priority', 'personal');
		expect((await roomOrder()).slice(0, 3)).toEqual([
			'sidebar-room-platform-duty',
			'sidebar-room-delivery-room',
			'sidebar-room-compat-lab',
		]);

		await openRoom(page, 'platform-duty');
		await waitForRoomLoadingToFinish(page);
		const roomAlertToggle = page.getByTestId('room-alert-toggle');
		await expect(roomAlertToggle).toHaveAttribute('data-active', 'personal');
		await roomAlertToggle.click();
		await page.getByTestId('room-alert-menu-mute').click();

		await expect(roomAlertToggle).toHaveAttribute('data-active', 'mute');
		await expect(page.getByTestId('sidebar-room-badge-platform-duty')).toHaveAttribute('data-priority', 'mute');
		await expect(page.getByTestId('sidebar-room-badge-platform-duty')).toContainText('2');
		expect((await roomOrder()).slice(0, 3)).toEqual([
			'sidebar-room-delivery-room',
			'sidebar-room-compat-lab',
			'sidebar-room-readonly-updates',
		]);

		await page.reload();
		await waitForRoomLoadingToFinish(page);

		await expect(page.getByTestId('room-title')).toBeVisible();
		await expect(page.getByTestId('room-alert-toggle')).toHaveAttribute('data-active', 'mute');
		await expect(page.getByTestId('sidebar-room-badge-platform-duty')).toHaveAttribute('data-priority', 'mute');
		expect((await roomOrder()).slice(0, 3)).toEqual([
			'sidebar-room-delivery-room',
			'sidebar-room-compat-lab',
			'sidebar-room-readonly-updates',
		]);
	});

	test('shows DM presence in the room header while keeping sidebar labels concise', async ({ page }) => {
		await loginAsFixtureUser(page);

		await expect(page.getByTestId('sidebar-room-dm-guning')).toContainText('忙碌');

		await openRoom(page, 'dm-guning');
		await waitForRoomLoadingToFinish(page);
		const busyPresence = page.getByTestId('room-header-presence');
		await expect(busyPresence).toHaveAttribute('data-status', 'busy');
		await expect(busyPresence).toHaveAttribute('aria-label', '当前状态：忙碌，@guning');
		await expect(page.getByTestId('room-header-presence-text')).toHaveText(/忙碌\s*[·•・]\s*@guning/);

		await openRoom(page, 'dm-zhoulan');
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId('room-header-presence')).toHaveAttribute('data-status', 'online');
		await expect(page.getByTestId('room-header-presence')).toHaveAttribute('aria-label', '当前状态：在线，@zhoulan');
		await expect(page.getByTestId('room-header-presence-text')).toHaveText('@zhoulan');
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const presenceText = document.querySelector('[data-testid="room-header-presence-text"]');
					if (!(presenceText instanceof HTMLElement)) {
						return false;
					}

					const style = window.getComputedStyle(presenceText);
					const fontSize = Number.parseFloat(style.fontSize || '0');
					const lineHeight = Number.parseFloat(style.lineHeight || '0');
					const paddingBottom = Number.parseFloat(style.paddingBottom || '0');
					const rect = presenceText.getBoundingClientRect();

					return paddingBottom > 0 && lineHeight >= fontSize * 1.15 && rect.height >= fontSize * 1.15;
				}),
			)
			.toBe(true);
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const favorite = document.querySelector('[data-testid="room-favorite-toggle"]');
					const title = document.querySelector('[data-testid="room-title"]');
					const presence = document.querySelector('[data-testid="room-header-presence"]');
					const info = document.querySelector('[data-testid="room-info-trigger"]');
					if (!(favorite instanceof HTMLElement) || !(title instanceof HTMLElement) || !(presence instanceof HTMLElement) || !(info instanceof HTMLElement)) {
						return null;
					}

					const favoritePosition = title.compareDocumentPosition(favorite) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before';
					const infoPosition = favorite.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before';
					const presencePosition = title.compareDocumentPosition(presence) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before';
					return `${favoritePosition}/${infoPosition}/${presencePosition}`;
				}),
			)
			.toBe('after/after/after');
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const title = document.querySelector('[data-testid="room-title-text"]');
					const favorite = document.querySelector('[data-testid="room-favorite-toggle"]');
					const presence = document.querySelector('[data-testid="room-header-presence"]');
					const presenceDot = document.querySelector('[data-testid="room-header-presence-dot"]');
					const info = document.querySelector('[data-testid="room-info-trigger"]');
					if (!(title instanceof HTMLElement) || !(favorite instanceof HTMLElement) || !(presence instanceof HTMLElement) || !(info instanceof HTMLElement)) {
						return false;
					}
					if (!(presenceDot instanceof HTMLElement)) {
						return false;
					}

					const titleRect = title.getBoundingClientRect();
					const favoriteRect = favorite.getBoundingClientRect();
					const presenceRect = presence.getBoundingClientRect();
					const presenceDotRect = presenceDot.getBoundingClientRect();
					const infoRect = info.getBoundingClientRect();
					const favoriteDelta = Math.abs(titleRect.top + titleRect.height / 2 - (favoriteRect.top + favoriteRect.height / 2));
					const infoDelta = Math.abs(titleRect.top + titleRect.height / 2 - (infoRect.top + infoRect.height / 2));
					const titleToFavoriteGap = favoriteRect.left - titleRect.right;
					const alertToggle = document.querySelector('[data-testid="room-alert-toggle"]');
					const actionGap = alertToggle instanceof HTMLElement
						? infoRect.left - (alertToggle.getBoundingClientRect().left + alertToggle.getBoundingClientRect().width)
						: infoRect.left - (favoriteRect.left + favoriteRect.width);
					const actionWidthDelta = Math.abs(infoRect.width - favoriteRect.width);
					const actionHeightDelta = Math.abs(infoRect.height - favoriteRect.height);
					const dotShape = Math.abs(presenceDotRect.width - presenceDotRect.height) <= 1;
					const titleBottom = titleRect.top + titleRect.height;
					const presenceCenterY = presenceRect.top + presenceRect.height / 2;
					return (
						favoriteDelta <= 1 &&
						infoDelta <= 1 &&
						titleToFavoriteGap >= -1 &&
						titleToFavoriteGap <= 14 &&
						actionGap >= -1 &&
						actionGap <= 10 &&
						actionWidthDelta <= 1 &&
						actionHeightDelta <= 1 &&
						dotShape &&
						Math.abs(presenceRect.left - titleRect.left) <= 8 &&
						presenceCenterY >= titleBottom + 2 &&
						presenceCenterY <= titleBottom + 18 &&
						infoRect.left > favoriteRect.left
					);
				}),
			)
			.toBe(true);
		await expect(page.getByTestId('sidebar-room-dm-zhoulan')).not.toContainText('在线');
		await expect(page.getByTestId('room-header-presence-trigger')).toHaveCount(0);
		await expect(page.getByTestId('room-header-presence-tooltip')).toHaveCount(0);

		await openRoom(page, 'dm-achen');
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId('room-header-presence')).toHaveAttribute('data-status', 'offline');
		await expect(page.getByTestId('room-header-presence')).toHaveAttribute('aria-label', '当前状态：离线，@achen');
		await expect(page.getByTestId('room-header-presence-text')).toHaveText(/离线\s*[·•・]\s*@achen/);
	});

	test('keeps forward dialog DM presence concise and aligned with sidebar semantics', async ({ page }) => {
		await loginAsFixtureUser(page);

		await page.getByTestId('message-action-forward-ops-004').click();
		await expect(page.getByTestId('forward-dialog')).toBeVisible();
		await expect(page.getByTestId('forward-room-presence-dm-zhoulan')).toHaveAttribute('data-status', 'online');
		await expect(page.getByTestId('forward-room-presence-dm-mia')).toHaveAttribute('data-status', 'away');
		await expect(page.getByTestId('forward-room-dm-zhoulan')).toContainText('平台同学');
		await expect(page.getByTestId('forward-room-dm-zhoulan')).not.toContainText('在线');
		await expect(page.getByTestId('forward-room-dm-mia')).not.toContainText('离开');
	});

	test('opens settings and persists theme plus composer preferences', async ({ page }) => {
		await loginAsFixtureUser(page);

		await page.getByTestId('settings-trigger').click();
		await expect(page.getByTestId('settings-panel')).toBeVisible();
		await expect(page.getByTestId('settings-theme-light')).toBeVisible();
		await expect(page.getByTestId('settings-theme-dark')).toBeVisible();
		await expect(page.getByTestId('settings-theme-auto')).toBeVisible();

		await page.getByTestId('settings-theme-dark').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme-switching', 'true');
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const panel = document.querySelector<HTMLElement>('[data-testid="settings-panel"]');
					const title = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((node) => node.textContent === '设置');
					if (!panel || !title) {
						return null;
					}

					const panelStyle = window.getComputedStyle(panel);
					const titleStyle = window.getComputedStyle(title);
					return {
						panelDuration: panelStyle.transitionDuration,
						panelProperty: panelStyle.transitionProperty,
						titleDuration: titleStyle.transitionDuration,
						titleProperty: titleStyle.transitionProperty,
					};
				}),
			)
			.toMatchObject({
				panelDuration: '0.18s',
				panelProperty: expect.stringContaining('background-color'),
				titleDuration: '0.18s',
				titleProperty: expect.stringContaining('color'),
			});
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
		await expect(page.locator('html')).not.toHaveAttribute('data-theme-switching', 'true');

		await page.getByTestId('settings-send-mode-ctrl-enter-send').click();
		await expect(page.getByTestId('composer-shortcut-hint')).toContainText('Ctrl + Enter 发送');

		await page.reload();
		await waitForRoomLoadingToFinish(page);

		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
		await expect(page.getByTestId('composer-shortcut-hint')).toContainText('Ctrl + Enter 发送');

		await page.getByTestId('settings-trigger').click();
		await expect(page.getByTestId('settings-send-mode-ctrl-enter-send')).toHaveAttribute('data-active', 'true');
	});

	test('keeps the composer editor and footer separated with a shell-style action row', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		const composer = page.getByTestId('composer');
		const resizeHandle = page.getByTestId('composer-resize-handle');
		const editorShell = page.getByTestId('composer-editor-shell');
		const footer = page.getByTestId('composer-footer');
		const imageTrigger = page.getByTestId('composer-image-trigger');
		const shortcutHint = page.getByTestId('composer-shortcut-hint');
		const sendButton = page.getByTestId('composer-send');
		const textarea = page.getByTestId('composer-textarea');

		const [
			resizeHandleBox,
			resizeHandleLineColor,
			editorBox,
			footerBox,
			imageTriggerBox,
			shortcutHintBox,
			sendButtonBox,
			composerHeight,
		] =
			await Promise.all([
				resizeHandle.boundingBox(),
				resizeHandle.evaluate((node) => window.getComputedStyle(node, '::before').backgroundColor),
				editorShell.boundingBox(),
				footer.boundingBox(),
				imageTrigger.boundingBox(),
				shortcutHint.boundingBox(),
				sendButton.boundingBox(),
				composer.evaluate((node) => node.getBoundingClientRect().height),
			]);
		expect(resizeHandleBox).not.toBeNull();
		expect(resizeHandleLineColor).not.toBe('rgba(0, 0, 0, 0)');
		expect(editorBox).not.toBeNull();
		expect(footerBox).not.toBeNull();
		expect(imageTriggerBox).not.toBeNull();
		expect(shortcutHintBox).not.toBeNull();
		expect(sendButtonBox).not.toBeNull();
		if (!resizeHandleBox || !editorBox || !footerBox || !imageTriggerBox || !shortcutHintBox || !sendButtonBox) {
			throw new Error('composer bounds were unavailable');
		}

		const editorFooterGap = footerBox.y - (editorBox.y + editorBox.height);
		expect(resizeHandleBox.height).toBeGreaterThanOrEqual(8);
		expect(composerHeight).toBeGreaterThan(220);
		expect(editorBox.height).toBeGreaterThan(170);
		expect(editorFooterGap).toBeGreaterThanOrEqual(6);
		expect(editorFooterGap).toBeLessThan(24);
		expect(Math.abs(imageTriggerBox.y + imageTriggerBox.height / 2 - (shortcutHintBox.y + shortcutHintBox.height / 2))).toBeLessThanOrEqual(4);
		expect(Math.abs(sendButtonBox.y + sendButtonBox.height / 2 - (imageTriggerBox.y + imageTriggerBox.height / 2))).toBeLessThanOrEqual(4);
		expect(sendButtonBox.x).toBeGreaterThan(shortcutHintBox.x + shortcutHintBox.width - 8);
		expect(imageTriggerBox.height).toBeGreaterThanOrEqual(34);
		expect(sendButtonBox.height).toBeGreaterThanOrEqual(40);

		const idleSendBackground = await sendButton.evaluate((node) => window.getComputedStyle(node).backgroundColor);
		await textarea.fill('新的发送栏布局验证');
		await expect(sendButton).toHaveAttribute('data-ready', 'true');
		const readySendBackground = await sendButton.evaluate((node) => window.getComputedStyle(node).backgroundColor);
		expect(readySendBackground).not.toBe(idleSendBackground);
	});

	test('keeps the composer typing width stable when the input first overflows and starts scrolling', async ({ page }) => {
		await page.setViewportSize({
			width: 1440,
			height: 980,
		});
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		await expect.poll(async () => (await readComposerScrollMetrics(page))?.editorKind ?? '').toBe('true');

		const textarea = page.getByTestId('composer-textarea');
		await textarea.fill('输入区滚动条布局验证');

		const beforeOverflow = await readComposerScrollMetrics(page);
		expect(beforeOverflow).not.toBeNull();
		if (!beforeOverflow) {
			throw new Error('composer scroll metrics were unavailable before overflow');
		}

		expect(beforeOverflow.overflowY).toBe('auto');
		expect(beforeOverflow.scrollHeight).toBeLessThanOrEqual(beforeOverflow.clientHeight + 1);
		expect(beforeOverflow.scrollbarGutter).toContain('stable');
		expect(Number.parseFloat(beforeOverflow.paddingInlineEnd)).toBeGreaterThan(0);

		const overflowingText = Array.from({ length: 48 }, (_, index) => `第 ${index + 1} 行：用于触发输入区内部滚动而不让整体页面发生滚动。`).join('\n');
		await textarea.fill(overflowingText);

		await expect.poll(async () => {
			const metrics = await readComposerScrollMetrics(page);
			if (!metrics) {
				return 0;
			}

			return metrics.scrollHeight - metrics.clientHeight;
		}).toBeGreaterThan(40);

		const afterOverflow = await readComposerScrollMetrics(page);
		expect(afterOverflow).not.toBeNull();
		if (!afterOverflow) {
			throw new Error('composer scroll metrics were unavailable after overflow');
		}

		const pageScrollOverflow = await page.evaluate(() => Math.max(document.documentElement.scrollHeight - window.innerHeight, 0));
		expect(Math.abs(afterOverflow.clientWidth - beforeOverflow.clientWidth)).toBeLessThanOrEqual(1);
		expect(afterOverflow.scrollbarGutter).toContain('stable');
		expect(Number.parseFloat(afterOverflow.paddingInlineEnd)).toBeGreaterThan(0);
		expect(pageScrollOverflow).toBeLessThan(2);
	});

	test('replaces the sendbox with a compact readonly notice in fixture readonly rooms', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);
		await openRoom(page, 'readonly-updates');
		await waitForRoomLoadingToFinish(page);

		await expect(page.getByTestId('readonly-composer-notice')).toBeVisible();
		await expect(page.getByTestId('readonly-composer-notice')).toContainText('此房间不允许发送消息。');
		await expect(page.getByTestId('composer')).toHaveCount(0);
		await expect(page.getByTestId('composer-resize-handle')).toHaveCount(0);
		await expect(page.getByTestId('composer-textarea')).toHaveCount(0);
		await expect(page.getByTestId('composer-send')).toHaveCount(0);
		await expect(page.getByTestId('composer-image-trigger')).toHaveCount(0);
	});

	test('keeps the loading bottom lane neutral when switching from a readonly room into a normal room', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);
		await openRoom(page, 'readonly-updates');
		await waitForRoomLoadingToFinish(page);

		await expect(page.getByTestId('readonly-composer-notice')).toBeVisible();

		await page.getByTestId('sidebar-room-platform-duty').click();
		await expect(page).toHaveURL(/\/app\/rooms\/platform-duty$/);
		await expect(page.getByTestId('room-loading-skeleton')).toBeVisible();
		await expect(page.getByTestId('room-loading-bottom-lane')).toHaveAttribute('data-mode', 'quiet');
		await expect(page.getByTestId('readonly-composer-notice')).toHaveCount(0);
		await expect(page.getByTestId('composer')).toHaveCount(0);

		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId('composer')).toBeVisible();
		await expect(page.getByTestId('readonly-composer-notice')).toHaveCount(0);
	});

	test('supports dragging the composer boundary to resize the send area and persists the height after reload', async ({ page }) => {
		await page.setViewportSize({
			width: 1440,
			height: 980,
		});
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		const readHeight = async (testId: string) =>
			page.getByTestId(testId).evaluate((node) => node.getBoundingClientRect().height);

		const resizeHandle = page.getByTestId('composer-resize-handle');

		const editorHeightBefore = await readHeight('composer-editor-shell');
		const timelineHeightBefore = await readHeight('timeline');
		await expect(resizeHandle).toHaveAttribute('aria-orientation', 'horizontal');

		const handleBox = await resizeHandle.boundingBox();
		expect(handleBox).not.toBeNull();
		if (!handleBox) {
			throw new Error('composer resize handle bounds were unavailable');
		}

		await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + Math.max(handleBox.height / 2, 2));
		await page.mouse.down();
		await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + Math.max(handleBox.height / 2, 2) - 96, {
			steps: 12,
		});
		await page.mouse.up();

		const editorHeightAfterDrag = await readHeight('composer-editor-shell');
		const timelineHeightAfterDrag = await readHeight('timeline');
		expect(editorHeightAfterDrag).toBeGreaterThan(editorHeightBefore + 52);
		expect(timelineHeightAfterDrag).toBeLessThan(timelineHeightBefore - 40);
		const storedHeightAfterDrag = await page.evaluate(() => window.localStorage.getItem('betterchat.composer-editor-height.v1'));
		expect(storedHeightAfterDrag).not.toBeNull();
		expect(Number.parseFloat(JSON.parse(storedHeightAfterDrag ?? '0'))).toBeGreaterThan(220);

		await page.reload();
		await waitForRoomLoadingToFinish(page);

		const editorHeightAfterReload = await readHeight('composer-editor-shell');
		const timelineHeightAfterReload = await readHeight('timeline');
		expect(editorHeightAfterReload).toBeGreaterThan(editorHeightAfterDrag - 12);
		expect(editorHeightAfterReload).toBeLessThan(editorHeightAfterDrag + 12);
		expect(timelineHeightAfterReload).toBeGreaterThan(140);

		await resizeHandle.focus();
		await expect(resizeHandle).toHaveAttribute('data-keyboard-adjusting', 'false');
		await page.keyboard.press('Enter');
		await expect(resizeHandle).toHaveAttribute('data-keyboard-adjusting', 'true');
		await page.keyboard.press('ArrowUp');

		const editorHeightAfterKeyboardAdjust = await readHeight('composer-editor-shell');
		expect(editorHeightAfterKeyboardAdjust).toBeGreaterThan(editorHeightAfterReload + 12);

		await page.keyboard.press('Enter');
		await expect(resizeHandle).toHaveAttribute('data-keyboard-adjusting', 'false');
		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('composer-textarea')).toBeFocused();

		await resizeHandle.focus();
		await page.keyboard.press('ArrowUp');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();
	});

	test('keeps the latest bottom pinned while dragging the composer boundary from the bottom state', async ({ page }) => {
		await page.setViewportSize({
			width: 1440,
			height: 980,
		});
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const timeline = page.getByTestId('timeline');
		const resizeHandle = page.getByTestId('composer-resize-handle');
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(8);

		const handleBox = await resizeHandle.boundingBox();
		expect(handleBox).not.toBeNull();
		if (!handleBox) {
			throw new Error('composer resize handle bounds were unavailable');
		}

		await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + Math.max(handleBox.height / 2, 2));
		await page.mouse.down();
		await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + Math.max(handleBox.height / 2, 2) - 112, {
			steps: 14,
		});
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(8);
		await page.mouse.up();
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(8);
	});

	test('keeps the composer resize handle keyboard-adjustable even when the pointer last hovered the timeline', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		const timelineMessage = page.getByTestId('timeline-message-ops-004');
		const resizeHandle = page.getByTestId('composer-resize-handle');
		const readEditorHeight = () => page.getByTestId('composer-editor-shell').evaluate((node) => node.getBoundingClientRect().height);

		await timelineMessage.hover();
		await resizeHandle.focus();
		await expect(resizeHandle).toBeFocused();
		await expect(resizeHandle).toHaveAttribute('data-keyboard-adjusting', 'false');

		await page.keyboard.press('Enter');
		await expect(resizeHandle).toHaveAttribute('data-keyboard-adjusting', 'true');

		const editorHeightBeforeAdjust = await readEditorHeight();
		await page.keyboard.press('ArrowUp');
		await expect(resizeHandle).toBeFocused();
		await expect(resizeHandle).toHaveAttribute('data-keyboard-adjusting', 'true');
		const editorHeightAfterAdjust = await readEditorHeight();
		expect(editorHeightAfterAdjust).toBeGreaterThan(editorHeightBeforeAdjust + 12);

		await page.keyboard.press('Enter');
		await expect(resizeHandle).toHaveAttribute('data-keyboard-adjusting', 'false');

		await page.keyboard.press('ArrowUp');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();

		await resizeHandle.focus();
		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('composer-textarea')).toBeFocused();
	});

	test('supports keyboard-first sidebar navigation, region shortcuts, and settings access', async ({ page }) => {
		await loginAsFixtureUser(page);
		const topSidebarRoom = page.getByTestId('sidebar-body').locator('button[data-testid^="sidebar-room-"]').first();
		const secondSidebarRoom = page.getByTestId('sidebar-body').locator('button[data-testid^="sidebar-room-"]').nth(1);
		const thirdSidebarRoom = page.getByTestId('sidebar-body').locator('button[data-testid^="sidebar-room-"]').nth(2);

		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toHaveAttribute('data-keyboard-visible', 'false');

		await page.keyboard.press('ArrowRight');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toHaveAttribute('data-keyboard-visible', 'false');

		await page.keyboard.press('Home');
		await expect(page.locator('article[data-message-id]').first()).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('room-favorite-toggle')).toBeFocused();
		await expect(page.locator('article[data-message-id][data-keyboard-visible="true"]')).toHaveCount(0);

			await page.keyboard.press('ArrowDown');
			await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();
			await page.keyboard.press('ArrowLeft');
			await expect(page.getByTestId('timeline-author-trigger-ops-001')).toBeFocused();
			await page.keyboard.press('ArrowLeft');
			await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();
			await expect(page.locator('article[data-message-id][data-keyboard-visible="true"]')).toHaveCount(0);

		await page.keyboard.press(`Alt+1`);
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toHaveAttribute('data-keyboard-visible', 'true');
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const avatarShell = document.querySelector('[data-testid="sidebar-room-avatar-shell-ops-handoff"]');
					if (!(avatarShell instanceof HTMLElement)) {
						return null;
					}

					const beforeStyle = window.getComputedStyle(avatarShell, '::before');
					return beforeStyle.content;
				}),
			)
			.toBe('none');

		await page.keyboard.press('Home');
		await expect(topSidebarRoom).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('sidebar-search')).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('sidebar-search')).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(topSidebarRoom).toBeFocused();

		await page.getByTestId('sidebar-room-dm-mia').hover();
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toHaveAttribute('data-keyboard-visible', 'false');

		await page.keyboard.press(`Alt+1`);
		await expect(topSidebarRoom).toHaveAttribute('data-keyboard-visible', 'true');

		await page.keyboard.press('ArrowRight');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();
		await expect(topSidebarRoom).toHaveAttribute('data-keyboard-visible', 'false');

		await page.keyboard.press('Home');
		await expect(page.locator('article[data-message-id]').first()).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('room-favorite-toggle')).toBeFocused();
		await expect(page.locator('article[data-message-id][data-keyboard-visible="true"]')).toHaveCount(0);
		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('sidebar-search')).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(topSidebarRoom).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('room-favorite-toggle')).toBeFocused();

		await page.keyboard.press('ArrowRight');
		if (await page.getByTestId('room-alert-toggle').count() > 0) {
			await expect(page.getByTestId('room-alert-toggle')).toBeFocused();
			await page.keyboard.press('ArrowRight');
		}
		await expect(page.getByTestId('room-info-trigger')).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(page.getByTestId('room-info-sidebar')).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page.getByTestId('room-info-sidebar')).toHaveCount(0);
		await expect(page.getByTestId('room-info-trigger')).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();

		await page.keyboard.press('End');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();
		await expect(page.getByTestId('timeline-jump-button')).toContainText('最新');
		await page.keyboard.press('End');
		await expect(page.getByTestId('timeline-message-ops-006')).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('composer-textarea')).toBeFocused();
		await expect(page.locator('article[data-message-id][data-keyboard-visible="true"]')).toHaveCount(0);

		await page.keyboard.press('ArrowUp');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(topSidebarRoom).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('room-favorite-toggle')).toBeFocused();

		await page.keyboard.press(`Alt+1`);
		await expect(topSidebarRoom).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(secondSidebarRoom).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(thirdSidebarRoom).toBeFocused();

		const thirdSidebarRoomTestId = await thirdSidebarRoom.getAttribute('data-testid');
		const thirdSidebarRoomId = thirdSidebarRoomTestId?.replace('sidebar-room-', '');
		if (!thirdSidebarRoomId) {
			throw new Error('third sidebar room id was unavailable');
		}

		await page.keyboard.press('Enter');
		await waitForRoomLoadingToFinish(page);
		await expect(page).toHaveURL(new RegExp(`/app/rooms/${thirdSidebarRoomId}$`));

		await page.keyboard.press(`${commandOrControl}+K`);
		const search = page.getByTestId('sidebar-search');
		await expect(search).toBeFocused();
		await search.fill('周');
		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('sidebar-room-dm-zhoulan')).toBeFocused();

		await page.keyboard.press('Enter');
		await waitForRoomLoadingToFinish(page);
		await expect(page).toHaveURL(/\/app\/rooms\/dm-zhoulan$/);

		await page.keyboard.press(`${commandOrControl}+K`);
		await expect(search).toBeFocused();
		await search.fill('');
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('sidebar-room-dm-zhoulan')).toBeFocused();

		await page.keyboard.press('Alt+3');
		await expect(page.getByTestId('composer-textarea')).toBeFocused();

		await page.keyboard.press(`${commandOrControl}+,`);
		await expect(page.getByTestId('settings-panel')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('settings-panel')).toHaveCount(0);
	});

	test('caps held vertical arrow navigation speed in the sidebar and main timeline', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const dispatchHeldArrowRepeats = async (key: 'ArrowDown' | 'ArrowUp', count: number) => {
			await page.evaluate(
				({ count: repeatCount, key: repeatKey }) => {
					for (let index = 0; index < repeatCount; index += 1) {
						const activeElement = document.activeElement;
						if (!(activeElement instanceof HTMLElement)) {
							break;
						}

						activeElement.dispatchEvent(
							new KeyboardEvent('keydown', {
								bubbles: true,
								cancelable: true,
								key: repeatKey,
								repeat: true,
							}),
						);
					}
				},
				{ count, key },
			);
		};

		const readActiveTestId = () =>
			page.evaluate(() => {
				const activeElement = document.activeElement;
				return activeElement instanceof HTMLElement ? activeElement.dataset.testid ?? null : null;
			});

		const sidebarRoomTestIds = await page
			.locator('button[data-testid^="sidebar-room-"]')
			.evaluateAll((nodes) =>
				nodes
					.map((node) => (node instanceof HTMLElement ? node.dataset.testid ?? null : null))
					.filter((value): value is string => Boolean(value)),
			);
		expect(sidebarRoomTestIds.length).toBeGreaterThan(4);
		const sidebarStartIndex = Math.floor(sidebarRoomTestIds.length / 2);
		const sidebarStartTestId = sidebarRoomTestIds[sidebarStartIndex]!;
		await page.getByTestId(sidebarStartTestId).focus();
		await expect(page.getByTestId(sidebarStartTestId)).toBeFocused();

		await dispatchHeldArrowRepeats('ArrowDown', 8);
		const sidebarEndTestId = await readActiveTestId();
		const sidebarEndIndex = sidebarRoomTestIds.indexOf(sidebarEndTestId ?? '');
		expect(sidebarEndIndex).toBeLessThanOrEqual(Math.min(sidebarStartIndex + 1, sidebarRoomTestIds.length - 1));

		await page.keyboard.press('ArrowRight');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();
		await page.keyboard.press('End');

		const timelineMessageTestIds = await page
			.locator('article[data-message-id]')
			.evaluateAll((nodes) =>
				nodes
					.map((node) => (node instanceof HTMLElement ? node.dataset.testid ?? null : null))
					.filter((value): value is string => Boolean(value)),
			);
		const timelineStartTestId = await readActiveTestId();
		expect(timelineStartTestId).not.toBeNull();
		const timelineStartIndex = timelineMessageTestIds.indexOf(timelineStartTestId ?? '');
		expect(timelineStartIndex).toBeGreaterThan(0);

		await dispatchHeldArrowRepeats('ArrowUp', 8);
		const timelineEndTestId = await readActiveTestId();
		const timelineEndIndex = timelineMessageTestIds.indexOf(timelineEndTestId ?? '');
		expect(timelineEndIndex).toBe(Math.max(timelineStartIndex - 1, 0));
	});

	test('moves from the composer editor into the footer controls at the bottom boundary', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		await page.keyboard.press('Alt+3');
		await expect(page.getByTestId('composer-textarea')).toBeFocused();

		await page.keyboard.type('键盘发送路径');
		await expect(page.getByTestId('composer-send')).toBeEnabled();

		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('composer-image-trigger')).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(page.getByTestId('composer-send')).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('composer-image-trigger')).toBeFocused();

		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('composer-textarea')).toBeFocused();
	});

	test('bootstraps plain arrow navigation from neutral body focus into the shell', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		await page.evaluate(() => {
			const active = document.activeElement;
			if (active instanceof HTMLElement) {
				active.blur();
			}
		});
		await expect
			.poll(() => page.evaluate(() => document.activeElement?.tagName ?? null))
			.toBe('BODY');

		await page.keyboard.press('ArrowDown');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();

		await page.evaluate(() => {
			const active = document.activeElement;
			if (active instanceof HTMLElement) {
				active.blur();
			}
		});
		await expect
			.poll(() => page.evaluate(() => document.activeElement?.tagName ?? null))
			.toBe('BODY');

		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toHaveAttribute('data-keyboard-visible', 'true');
	});

	test('routes timeline keyboard focus through inline mentions, every image, then reply and forward actions', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		await page.getByTestId('timeline-message-toggle-ops-005').click();

		const message = page.getByTestId('timeline-message-ops-005');
		const mention = message.locator('[data-mention-interactive="true"][data-mention-token-value="@zhoulan"]');
		const markdownImage = message.getByRole('button', { name: '查看图片：兼容流程示意图' });
		const attachmentImage = page.getByTestId('timeline-image-ops-005-image');
		const replyButton = page.getByTestId('message-action-reply-ops-005');
		const forwardButton = page.getByTestId('message-action-forward-ops-005');

		await message.focus();
		await expect(message).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(mention).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(markdownImage).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(attachmentImage).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(replyButton).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(forwardButton).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(replyButton).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(attachmentImage).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(markdownImage).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(mention).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(message).toBeFocused();
	});

	test('uses visible but quiet hover feedback in the sidebar', async ({ page }) => {
		await loginAsFixtureUser(page);

		const room = page.getByTestId('sidebar-room-dm-mia');
		await page.mouse.move(8, 8);

		const beforeHover = await room.evaluate((node) => {
			const style = window.getComputedStyle(node);
			return {
				backgroundColor: style.backgroundColor,
				borderColor: style.borderColor,
				boxShadow: style.boxShadow,
			};
		});

		await room.hover();

		const afterHover = await room.evaluate((node) => {
			const style = window.getComputedStyle(node);
			return {
				backgroundColor: style.backgroundColor,
				borderColor: style.borderColor,
				boxShadow: style.boxShadow,
			};
		});

		expect(afterHover.backgroundColor).not.toBe(beforeHover.backgroundColor);
		expect(afterHover.borderColor).not.toBe(beforeHover.borderColor);
		expect(afterHover.boxShadow).toBe(beforeHover.boxShadow);
	});

	test('toggles room favorites locally and persists regrouping after reload', async ({ page }) => {
		await loginAsFixtureUser(page);

		const favoriteToggle = page.getByTestId('room-favorite-toggle');
		const favoritesSection = page.getByTestId('sidebar-section-favorites');
		const roomsSection = page.getByTestId('sidebar-section-rooms');

		await expect(favoriteToggle).toHaveAttribute('aria-pressed', 'true');
		await expect(favoritesSection.getByTestId('sidebar-room-ops-handoff')).toBeVisible();

		await favoriteToggle.click();

		await expect(favoriteToggle).toHaveAttribute('aria-pressed', 'false');
		await expect(favoritesSection.getByTestId('sidebar-room-ops-handoff')).toHaveCount(0);
		await expect(roomsSection.getByTestId('sidebar-room-ops-handoff')).toBeVisible();

		await page.reload();
		await waitForRoomLoadingToFinish(page);

		await expect(page.getByTestId('room-favorite-toggle')).toHaveAttribute('aria-pressed', 'false');
		await expect(page.getByTestId('sidebar-section-favorites').getByTestId('sidebar-room-ops-handoff')).toHaveCount(0);
		await expect(page.getByTestId('sidebar-section-rooms').getByTestId('sidebar-room-ops-handoff')).toBeVisible();

		await page.getByTestId('room-favorite-toggle').click();

		await expect(page.getByTestId('room-favorite-toggle')).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByTestId('sidebar-section-favorites').getByTestId('sidebar-room-ops-handoff')).toBeVisible();
	});

	test('keeps keyboard focus on the favorite toggle after enter-triggered favorite changes', async ({ page }) => {
		await loginAsFixtureUser(page);

		const favoriteToggle = page.getByTestId('room-favorite-toggle');
		await favoriteToggle.focus();
		await expect(favoriteToggle).toBeFocused();
		await expect(favoriteToggle).toHaveAttribute('aria-pressed', 'true');

		await page.keyboard.press('Enter');
		await expect(favoriteToggle).toHaveAttribute('aria-pressed', 'false');
		await expect(favoriteToggle).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(favoriteToggle).toHaveAttribute('aria-pressed', 'true');
		await expect(favoriteToggle).toBeFocused();
	});

	test('scrolls the sidebar to reveal the new DM room when opening a direct conversation', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 640 });
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		const sidebarBody = page.getByTestId('sidebar-body');
		await sidebarBody.evaluate((node) => {
			node.scrollTop = 0;
		});

		const authorTrigger = page.getByTestId('timeline-author-trigger-ops-002');
		await expect(authorTrigger).toBeVisible();
		await authorTrigger.click();

		const quickPanel = page.getByTestId('timeline-author-quick-panel');
		await expect(quickPanel).toBeVisible();

		const dmButton = page.getByTestId('timeline-author-quick-panel-primary-action');
		await expect(dmButton).toBeEnabled();
		await dmButton.click();

		await expect(page).toHaveURL(/\/app\/rooms\/dm-mingyuan$/);
		await waitForRoomLoadingToFinish(page);

		const dmRoomButton = page.getByTestId('sidebar-room-dm-mingyuan');
		await expect(dmRoomButton).toHaveAttribute('data-active', 'true');
		await expect(dmRoomButton).toBeInViewport();
	});
});
