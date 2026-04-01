import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import {
	createLargeBmpFixture,
	dragImageIntoComposer,
	loginAsFixtureUser,
	openRoom,
	pasteImageIntoComposer,
	readTimelineBottomGap,
	scrollTimelineToBottom,
	tinyPngFixture,
	waitForRoomLoadingToFinish,
} from './test-helpers';

const commandOrControl = process.platform === 'darwin' ? 'Meta' : 'Control';
const isApiMode = (process.env.BETTERCHAT_E2E_API_MODE ?? 'fixture').toLowerCase() === 'api';

test.skip(isApiMode, 'fixture-only suite');

const readElementHeight = async (locator: Locator) => locator.evaluate((node) => node.getBoundingClientRect().height);

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

const openMessageContextMenu = async (message: Locator) => {
	const messageBox = await message.boundingBox();
	if (!messageBox) {
		throw new Error('message bounds were unavailable');
	}

	await message.dispatchEvent('contextmenu', {
		button: 2,
		clientX: messageBox.x + Math.max(Math.min(messageBox.width * 0.68, messageBox.width - 16), 16),
		clientY: messageBox.y + Math.max(Math.min(messageBox.height * 0.42, messageBox.height - 12), 12),
	});
};

const prepareReplyJumpScenario = async (page: Page) => {
	await page.setViewportSize({
		width: 1280,
		height: 520,
	});
	await loginAsFixtureUser(page);

	const timeline = page.getByTestId('timeline');
	await timeline.evaluate((node) => {
		const sourceMessage = node.querySelector<HTMLElement>('[data-testid="timeline-message-ops-006"]');
		if (!sourceMessage) {
			return;
		}

		const desiredTop = Math.max(sourceMessage.offsetTop - Math.max(node.clientHeight - sourceMessage.offsetHeight - 20, 0), 0);
		node.scrollTo({
			top: desiredTop,
			behavior: 'auto',
		});
	});

	const sourceMessage = page.getByTestId('timeline-message-ops-006');
	const targetMessage = page.getByTestId('timeline-message-ops-004');
	const sourceReplyJump = page.getByTestId('reply-jump-ops-006');
	await expect(sourceMessage).toBeInViewport();
	await expect(targetMessage).not.toBeInViewport();

	return {
		sourceMessage,
		sourceReplyJump,
		targetMessage,
		timeline,
	};
};

test.describe('timeline behavior', () => {
	test('supports keyboard-first timeline navigation and message shortcuts', async ({ page }) => {
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		const keyboardFocusedMessage = page.locator('article[data-message-id][data-keyboard-focused="true"]');
		await expect(keyboardFocusedMessage).toBeFocused();
		await expect(keyboardFocusedMessage).toHaveAttribute('data-keyboard-visible', 'true');

		await page.getByTestId('timeline-message-ops-004').hover();
		await expect(page.locator('article[data-message-id][data-keyboard-visible="true"]')).toHaveCount(0);

		await page.keyboard.press('End');
		await expect(page.getByTestId('timeline-message-ops-006')).toBeFocused();
		await expect(page.getByTestId('timeline-message-ops-006')).toHaveAttribute('data-keyboard-visible', 'true');

		await page.keyboard.press('ArrowRight');
		await expect(page.getByTestId('reply-jump-ops-006')).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(page.getByTestId('message-action-reply-ops-006')).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(page.getByTestId('message-action-forward-ops-006')).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('message-action-reply-ops-006')).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('reply-jump-ops-006')).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('timeline-message-ops-006')).toBeFocused();

		await page.keyboard.press('Enter');
		const quickMenu = page.getByTestId('timeline-message-context-menu');
		await expect(quickMenu).toBeVisible();
		await expect(quickMenu.getByTestId('message-context-action-reply')).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(quickMenu).toHaveCount(0);
		await expect(page.getByTestId('timeline-message-ops-006')).toBeFocused();

		await page.keyboard.press('j');
		await expect(page.getByTestId('timeline-message-ops-004')).toHaveAttribute('data-highlighted', 'true');
		await expect(page.getByTestId('timeline-message-ops-004')).toBeFocused();

		await expect(page.getByTestId('timeline-message-content-ops-004')).toHaveAttribute('data-collapsed', 'true');
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('timeline-message-content-ops-004')).toHaveAttribute('data-collapsed', 'false');
		await expect(page.getByTestId('timeline-message-context-menu')).toHaveCount(0);
		await expect(page.getByTestId('timeline-message-ops-004')).toBeFocused();

		await page.keyboard.press('e');
		await expect(page.getByTestId('timeline-message-content-ops-004')).toHaveAttribute('data-collapsed', 'true');
		await page.keyboard.press('e');
		await expect(page.getByTestId('timeline-message-content-ops-004')).toHaveAttribute('data-collapsed', 'false');

		await page.keyboard.press('c');
		await expect(page.getByTestId('timeline-toast')).toContainText('已复制文本');
		await expect
			.poll(async () => page.evaluate(() => navigator.clipboard.readText()), {
				timeout: 2_000,
			})
			.toContain('顺手把接口草稿也贴进来');

		await page.keyboard.press('r');
		await expect(page.getByTestId('composer-reply-context')).toContainText('回复 周岚');
		await expect(page.getByTestId('composer-textarea')).toBeFocused();
	});

	test('supports keyboard-opened message context menu navigation and focus restoration', async ({ page }) => {
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();
		await page.keyboard.press('End');
		const sourceMessage = page.getByTestId('timeline-message-ops-006');
		const sourceMessageBody = page.getByTestId('timeline-message-body-ops-006');
		await expect(sourceMessage).toBeFocused();

		await page.keyboard.press('Shift+F10');
		const menu = page.getByTestId('timeline-message-context-menu');
		await expect(menu).toBeVisible();
		await expect(menu.getByTestId('message-context-action-reply')).toBeFocused();
		await expect(sourceMessage).toHaveAttribute('data-context-open', 'true');
		await expect(sourceMessage).toHaveAttribute('data-keyboard-visible', 'false');
		const sourceMessageBodyBox = await sourceMessageBody.boundingBox();
		const menuBox = await menu.boundingBox();
		expect(sourceMessageBodyBox).not.toBeNull();
		expect(menuBox).not.toBeNull();
		if (!sourceMessageBodyBox || !menuBox) {
			throw new Error('message context menu bounds were unavailable');
		}
		expect(menuBox.x).toBeGreaterThanOrEqual(sourceMessageBodyBox.x + 12);
		expect(menuBox.x).toBeLessThanOrEqual(sourceMessageBodyBox.x + sourceMessageBodyBox.width * 0.58);

		await page.keyboard.press('ArrowDown');
		await expect(menu.getByTestId('message-context-action-forward')).toBeFocused();
		await expect(sourceMessage).toHaveAttribute('data-keyboard-focused', 'true');
		await expect(page.locator('article[data-message-id][data-keyboard-visible="true"]')).toHaveCount(0);
		await page.keyboard.press('ArrowDown');
		await expect(menu.getByTestId('message-context-action-jump-to-original')).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(menu.getByTestId('message-context-action-copy-text')).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(menu).toHaveCount(0);
		await expect(page.getByTestId('timeline-toast')).toContainText('已复制文本');
		await expect(sourceMessage).toBeFocused();
		await expect(sourceMessage).toHaveAttribute('data-keyboard-visible', 'true');

		await page.keyboard.press('Shift+F10');
		await expect(menu).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(sourceMessage).toBeFocused();
		await expect(sourceMessage).toHaveAttribute('data-keyboard-visible', 'true');
	});

	test('lets enter-opened message context menus capture immediate arrow navigation', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		const sourceMessage = page.getByTestId('timeline-message-ops-006');
		await expect(sourceMessage).toBeFocused();

		await page.keyboard.press('Enter');
		const menu = page.getByTestId('timeline-message-context-menu');
		await expect(menu).toBeVisible();
		await expect(menu.getByTestId('message-context-action-reply')).toBeFocused();

		await sourceMessage.focus();
		await expect(sourceMessage).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(menu.getByTestId('message-context-action-forward')).toBeFocused();

		await page.keyboard.press('ArrowUp');
		await expect(menu.getByTestId('message-context-action-reply')).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(sourceMessage).toBeFocused();
	});

	test('moves keyboard reply actions from the context menu directly into the composer', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		const sourceMessage = page.getByTestId('timeline-message-ops-006');
		await expect(sourceMessage).toBeFocused();

		await page.keyboard.press('Enter');
		const menu = page.getByTestId('timeline-message-context-menu');
		await expect(menu).toBeVisible();
		await expect(menu.getByTestId('message-context-action-reply')).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(menu).toHaveCount(0);
		await expect(page.getByTestId('composer-reply-context')).toContainText('回复 林澈');
		await expect(page.getByTestId('composer-textarea')).toBeFocused();
	});

	test('keeps keyboard-opened message context menus crisp under rapid arrow travel and uses background-only active styling', async ({
		page,
	}) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');

		const menu = page.getByTestId('timeline-message-context-menu');
		const replyAction = menu.getByTestId('message-context-action-reply');
		await expect(menu).toBeVisible();
		await expect(replyAction).toBeFocused();
		await expect(replyAction).toHaveAttribute('data-active', 'true');
		await expect
			.poll(async () => replyAction.evaluate((node) => getComputedStyle(node, '::before').content))
			.toBe('none');

		await page.evaluate(() => {
			const dispatchArrow = (key: 'ArrowDown' | 'ArrowUp') => {
				const target = document.activeElement;
				if (!(target instanceof HTMLElement)) {
					throw new Error('expected an active context-menu action');
				}

				target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
				target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key }));
			};

			dispatchArrow('ArrowDown');
			dispatchArrow('ArrowDown');
		});

		await expect(menu.getByTestId('message-context-action-jump-to-original')).toBeFocused();
		await expect(menu.getByTestId('message-context-action-jump-to-original')).toHaveAttribute('data-active', 'true');
	});

	test('keeps keyboard-opened message context menus keyboard-owned even if the pointer moves away', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		const sourceMessage = page.getByTestId('timeline-message-ops-006');
		await expect(sourceMessage).toBeFocused();

		await page.keyboard.press('Enter');
		const menu = page.getByTestId('timeline-message-context-menu');
		await expect(menu).toBeVisible();
		await expect(menu).toHaveAttribute('data-source', 'keyboard');
		await expect(menu.getByTestId('message-context-action-reply')).toBeFocused();
		await expect(menu.getByTestId('message-context-action-reply')).toHaveAttribute('data-active', 'true');
		await expect(sourceMessage).toHaveAttribute('data-context-source', 'keyboard');

		const pointerTarget = page.getByTestId('timeline-message-ops-003');
		const pointerTargetBox = await pointerTarget.boundingBox();
		expect(pointerTargetBox).not.toBeNull();
		if (!pointerTargetBox) {
			throw new Error('pointer target bounds were unavailable');
		}

		await page.mouse.move(pointerTargetBox.x + pointerTargetBox.width * 0.5, pointerTargetBox.y + pointerTargetBox.height * 0.5);
		await page.keyboard.press('ArrowDown');
		await expect(menu.getByTestId('message-context-action-forward')).toBeFocused();
		await expect(sourceMessage).toHaveAttribute('data-context-open', 'true');
		await expect(sourceMessage).toHaveAttribute('data-keyboard-focused', 'true');
		await expect(page.locator('article[data-message-id][data-keyboard-visible=\"true\"]')).toHaveCount(0);

		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(sourceMessage).toBeFocused();
		await expect(sourceMessage).toHaveAttribute('data-keyboard-visible', 'true');
	});

	test('keeps keyboard-opened message context menus on the current item after unrelated timeline rerenders', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');

		const menu = page.getByTestId('timeline-message-context-menu');
		const replyAction = menu.getByTestId('message-context-action-reply');
		const forwardAction = menu.getByTestId('message-context-action-forward');
		const jumpAction = menu.getByTestId('message-context-action-jump-to-original');
		const copyTextAction = menu.getByTestId('message-context-action-copy-text');
		await expect(menu).toBeVisible();
		await expect(replyAction).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(forwardAction).toBeFocused();
		await expect(menu).toHaveAttribute('data-active-key', 'forward');

		const rerenderHoverTarget = page.getByTestId('timeline-author-avatar-trigger-ops-005');
		await expect(rerenderHoverTarget).toBeVisible();
		await rerenderHoverTarget.hover();
		await page.waitForTimeout(120);
		await expect(menu).toHaveAttribute('data-active-key', 'forward');
		await expect
			.poll(async () =>
				page.evaluate(
					() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName ?? null,
				),
			)
			.toBe('message-context-action-forward');

		await page.keyboard.press('ArrowDown');
		await expect(menu).toHaveAttribute('data-active-key', 'jump-to-original');
		await expect(jumpAction).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(menu).toHaveAttribute('data-active-key', 'copy-text');
		await expect(copyTextAction).toBeFocused();
	});

	test('closes a keyboard-opened message context menu at arrow boundaries and continues timeline travel', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		const sourceMessage = page.getByTestId('timeline-message-ops-003');
		await expect(sourceMessage).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(page.getByTestId('timeline-message-context-menu')).toBeVisible();
		await expect(page.getByTestId('message-context-action-reply')).toBeFocused();

		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('timeline-message-context-menu')).toHaveCount(0);
		await expect(page.getByTestId('timeline-message-ops-002')).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(sourceMessage).toBeFocused();
		await page.keyboard.press('Enter');
		const menu = page.getByTestId('timeline-message-context-menu');
		await expect(menu).toBeVisible();
		await expect(menu.getByTestId('message-context-action-reply')).toBeFocused();
		await page.keyboard.press('End');
		await expect(menu.getByRole('menuitem').last()).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(menu).toHaveCount(0);
		await expect(page.getByTestId('timeline-message-ops-004')).toBeFocused();
	});

	test('left arrow closes a keyboard-opened message context menu back to the current message', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		const sourceMessage = page.getByTestId('timeline-message-ops-006');
		await expect(sourceMessage).toBeFocused();

		await page.keyboard.press('Enter');
		const menu = page.getByTestId('timeline-message-context-menu');
		await expect(menu).toBeVisible();
		await page.keyboard.press('ArrowDown');
		await expect(menu.getByTestId('message-context-action-forward')).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(menu).toHaveCount(0);
		await expect(sourceMessage).toBeFocused();
		await expect(sourceMessage).toHaveAttribute('data-keyboard-visible', 'true');
	});

	test('right arrow also closes a keyboard-opened message context menu back to the current message', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		const sourceMessage = page.getByTestId('timeline-message-ops-006');
		await expect(sourceMessage).toBeFocused();

		await page.keyboard.press('Enter');
		const menu = page.getByTestId('timeline-message-context-menu');
		await expect(menu).toBeVisible();
		await page.keyboard.press('ArrowDown');
		await expect(menu.getByTestId('message-context-action-forward')).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(menu).toHaveCount(0);
		await expect(sourceMessage).toBeFocused();
		await expect(sourceMessage).toHaveAttribute('data-keyboard-visible', 'true');
	});

	test('returns from the composer to the bottom visible message in the current viewport', async ({ page }) => {
		await page.setViewportSize({
			width: 1280,
			height: 520,
		});
		await loginAsFixtureUser(page);

		const timeline = page.getByTestId('timeline');
		await timeline.evaluate((node) => {
			const nextScrollTop = Math.max((node.scrollHeight - node.clientHeight) * 0.42, 0);
			node.scrollTo({
				top: nextScrollTop,
				behavior: 'auto',
			});
		});

		const bottomGapBefore = await readTimelineBottomGap(timeline);
		expect(bottomGapBefore).toBeGreaterThan(96);

		const expectedBottomVisibleMessageId = await timeline.evaluate((node) => {
			const viewportTop = node.scrollTop;
			const viewportBottom = viewportTop + node.clientHeight;
			let selectedMessageId: string | null = null;

			for (const messageNode of node.querySelectorAll<HTMLElement>('article[data-message-id]')) {
				const messageTop = messageNode.offsetTop;
				const messageBottom = messageTop + messageNode.offsetHeight;
				if (messageTop < viewportBottom - 12 && messageBottom > viewportTop + 12) {
					selectedMessageId = messageNode.dataset.messageId ?? null;
				}
			}

			return selectedMessageId;
		});

		expect(expectedBottomVisibleMessageId).not.toBeNull();
		if (!expectedBottomVisibleMessageId) {
			throw new Error('expected bottom visible message id was unavailable');
		}

		const scrollTopBeforeFocusJump = await timeline.evaluate((node) => node.scrollTop);
		await page.keyboard.press('Alt+3');
		await expect(page.getByTestId('composer-textarea')).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(page.locator(`article[data-message-id="${expectedBottomVisibleMessageId}"]`)).toBeFocused();

		const scrollTopAfterFocusJump = await timeline.evaluate((node) => node.scrollTop);
		expect(Math.abs(scrollTopAfterFocusJump - scrollTopBeforeFocusJump)).toBeLessThanOrEqual(8);
	});

	test('loads older history pages when scrolling a long room to the top and preserves the reading anchor', async ({ page }) => {
		await page.setViewportSize({
			width: 1280,
			height: 560,
		});
		await loginAsFixtureUser(page);
		await openRoom(page, 'history-archive');

		const timeline = page.getByTestId('timeline');
		await expect.poll(async () => timeline.locator('article[data-message-id]').count()).toBe(50);
		await expect(page.getByTestId('timeline-message-history-001')).toHaveCount(0);
		await expect(page.getByTestId('timeline-message-history-011')).toHaveCount(0);
		await expect(page.getByTestId('timeline-message-history-110')).toBeVisible();

		await timeline.evaluate((node) => {
			node.scrollTo({
				top: 0,
				behavior: 'auto',
			});
		});

		await expect.poll(async () => timeline.locator('article[data-message-id]').count()).toBe(100);
		await expect(page.getByTestId('timeline-message-history-011')).toHaveCount(1);
		const scrollTopAfterFirstLoad = await timeline.evaluate((node) => node.scrollTop);
		expect(scrollTopAfterFirstLoad).toBeGreaterThan(48);

		await timeline.evaluate((node) => {
			node.scrollTo({
				top: 0,
				behavior: 'auto',
			});
		});

		await expect.poll(async () => timeline.locator('article[data-message-id]').count()).toBe(110);
		await expect(page.getByTestId('timeline-message-history-001')).toHaveCount(1);
		await expect(page.getByTestId('timeline-message-history-110')).toHaveCount(1);
	});

	test('keeps prepend history restoration stable after long older messages finish reflowing', async ({ page }) => {
		await page.setViewportSize({
			width: 1280,
			height: 560,
		});
		await loginAsFixtureUser(page);
		await openRoom(page, 'history-archive');

		const timeline = page.getByTestId('timeline');
		await expect.poll(async () => timeline.locator('article[data-message-id]').count()).toBe(50);

		await timeline.evaluate((node) => {
			node.scrollTo({
				top: 0,
				behavior: 'auto',
			});
		});

		await expect.poll(async () => timeline.locator('article[data-message-id]').count()).toBe(100);
		const firstLoadSettledTop = await timeline.evaluate((node) => node.scrollTop);
		const firstLoadDrift = await sampleTimelineScrollTopDrift(timeline);
		expect(firstLoadSettledTop).toBeGreaterThan(48);
		expect(firstLoadDrift.max - firstLoadDrift.min).toBeLessThanOrEqual(8);
		expect(Math.abs(firstLoadDrift.final - firstLoadSettledTop)).toBeLessThanOrEqual(6);

		await timeline.evaluate((node) => {
			node.scrollTo({
				top: 0,
				behavior: 'auto',
			});
		});

		await expect.poll(async () => timeline.locator('article[data-message-id]').count()).toBe(110);
		const secondLoadSettledTop = await timeline.evaluate((node) => node.scrollTop);
		const secondLoadDrift = await sampleTimelineScrollTopDrift(timeline);
		expect(secondLoadSettledTop).toBeGreaterThan(24);
		expect(secondLoadDrift.max - secondLoadDrift.min).toBeLessThanOrEqual(8);
		expect(Math.abs(secondLoadDrift.final - secondLoadSettledTop)).toBeLessThanOrEqual(6);
	});

	test('lets users disable global motion and makes jump-to-latest settle immediately', async ({ page }) => {
		await loginAsFixtureUser(page);
		await openRoom(page, 'history-archive');

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

	test('adds quiet hover feedback to markdown links in the main timeline', async ({ page }) => {
		await loginAsFixtureUser(page);
		await openRoom(page, 'delivery-room');

		const link = page.getByRole('link', { name: '交付手册' });
		await expect(link).toBeVisible();

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

	test('keeps grouped code-only messages visually separated from the reply and forward action lane', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const probeA = `overlapProbe${Date.now()}A`;
		const probeB = `overlapProbe${Date.now()}B`;
		const firstCodeBlock = `\`\`\`ts\nconst ${probeA} = true;\n\`\`\``;
		const secondCodeBlock = `\`\`\`ts\nconst ${probeB} = true;\n\`\`\``;

		await page.getByTestId('composer-textarea').fill(firstCodeBlock);
		await page.getByTestId('composer-send').click();
		const firstMessage = page.locator('article[data-message-id][data-delivery-state="sent"]').filter({ hasText: probeA }).last();
		await expect(firstMessage).toBeVisible();

		await page.getByTestId('composer-textarea').fill(secondCodeBlock);
		await page.getByTestId('composer-send').click();
		const secondMessage = page.locator('article[data-message-id][data-delivery-state="sent"]').filter({ hasText: probeB }).last();
		await expect(secondMessage).toBeVisible();
		await expect(secondMessage).toHaveAttribute('data-grouped-prev', 'true');

		await secondMessage.hover();

		const replyAction = secondMessage.locator('[data-testid^="message-action-reply-"]');
		const codeBlock = secondMessage.locator('figure').first();
		await expect(replyAction).toBeVisible();
		await expect(codeBlock).toBeVisible();

		const replyActionBox = await replyAction.boundingBox();
		const codeBlockBox = await codeBlock.boundingBox();
		expect(replyActionBox).not.toBeNull();
		expect(codeBlockBox).not.toBeNull();
		if (!replyActionBox || !codeBlockBox) {
			throw new Error('grouped code-only message bounds were unavailable');
		}

		expect(replyActionBox.y + replyActionBox.height).toBeLessThanOrEqual(codeBlockBox.y - 6);
	});

	test('keeps mouse-opened message context menus pointer-neutral until the user chooses an action', async ({ page }) => {
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const sourceMessage = page.getByTestId('timeline-message-ops-006');
		await openMessageContextMenu(sourceMessage);

		const menu = page.getByTestId('timeline-message-context-menu');
		await expect(menu).toBeVisible();
		await expect(menu.locator('[data-active="true"]')).toHaveCount(0);
		await expect(menu.getByTestId('message-context-action-reply')).not.toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(menu.getByTestId('message-context-action-reply')).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await expect(menu.getByTestId('message-context-action-copy-text')).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('timeline-toast')).toContainText('已复制文本');
		await expect(menu).toHaveCount(0);
	});

	test('reply jumps highlight the original briefly and then clear', async ({ page }) => {
		await loginAsFixtureUser(page);

		const targetMessage = page.getByTestId('timeline-message-ops-004');
		await page.getByTestId('reply-jump-ops-006').click();
		await expect(targetMessage).toHaveAttribute('data-highlighted', 'true');
		await expect
			.poll(async () => targetMessage.getAttribute('data-highlighted'), {
				timeout: 2_000,
			})
			.toBe('false');
	});

	test('reply jumps offer a quick return path back to the previous reading position', async ({ page }) => {
		const { sourceReplyJump, targetMessage, timeline } = await prepareReplyJumpScenario(page);
		const initialScrollTop = await timeline.evaluate((node) => node.scrollTop);
		expect(initialScrollTop).toBeGreaterThan(0);

		await sourceReplyJump.click();
		await expect(page.getByTestId('timeline-return-button')).toBeVisible();
		await expect(targetMessage).toHaveAttribute('data-highlighted', 'true');

		await expect
			.poll(async () => timeline.evaluate((node) => node.scrollTop), {
				timeout: 2_000,
			})
			.not.toBe(initialScrollTop);

		await page.getByTestId('timeline-return-button').click();
		await expect(page.getByTestId('timeline-return-button')).toHaveCount(0);
		await expect
			.poll(async () => timeline.evaluate((node) => node.scrollTop), {
				timeout: 2_000,
			})
			.toBeGreaterThan(initialScrollTop - 72);
		await expect
			.poll(async () => timeline.evaluate((node) => node.scrollTop), {
				timeout: 2_000,
			})
			.toBeLessThan(initialScrollTop + 72);
	});

	test('supports keyboard reply-preview travel, escape return, and End-to-latest during a reply jump session', async ({ page }) => {
		const { sourceMessage, targetMessage, timeline } = await prepareReplyJumpScenario(page);
		const initialScrollTop = await timeline.evaluate((node) => node.scrollTop);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		await expect(sourceMessage).toBeFocused();

		await page.keyboard.press('ArrowRight');
		const replyPreview = page.getByTestId('reply-jump-ops-006');
		await expect(replyPreview).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(page.getByTestId('message-action-reply-ops-006')).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(replyPreview).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(targetMessage).toHaveAttribute('data-highlighted', 'true');
		await expect(targetMessage).toBeFocused();
		await expect(page.getByTestId('timeline-return-button')).toBeVisible();
		await expect(page.getByTestId('timeline-jump-button')).toHaveCount(0);

		await page.keyboard.press('Escape');
		await expect(page.getByTestId('timeline-return-button')).toHaveCount(0);
		await expect(sourceMessage).toBeFocused();
		await expect
			.poll(async () => timeline.evaluate((node) => node.scrollTop), {
				timeout: 2_000,
			})
			.toBeGreaterThan(initialScrollTop - 72);
		await expect
			.poll(async () => timeline.evaluate((node) => node.scrollTop), {
				timeout: 2_000,
			})
			.toBeLessThan(initialScrollTop + 72);

		await page.keyboard.press('ArrowRight');
		await expect(replyPreview).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(targetMessage).toBeFocused();
		await expect(page.getByTestId('timeline-return-button')).toBeVisible();

		await page.keyboard.press('End');
		await expect(page.getByTestId('timeline-return-button')).toHaveCount(0);
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(12);
	});

	test('reply jumps settle without a late viewport rebound', async ({ page }) => {
		const { sourceReplyJump, targetMessage, timeline } = await prepareReplyJumpScenario(page);

		await sourceReplyJump.click();
		await expect(page.getByTestId('timeline-return-button')).toBeVisible();
		await expect(targetMessage).toHaveAttribute('data-highlighted', 'true');

		await page.waitForTimeout(460);
		const settledScrollTop = await timeline.evaluate((node) => node.scrollTop);
		await page.waitForTimeout(280);
		const finalScrollTop = await timeline.evaluate((node) => node.scrollTop);

		expect(Math.abs(finalScrollTop - settledScrollTop)).toBeLessThanOrEqual(4);
	});

	test('reply jumps stay stable when layout reflow lands during the programmatic scroll', async ({ page }) => {
		const { sourceReplyJump, targetMessage, timeline } = await prepareReplyJumpScenario(page);

		await sourceReplyJump.click();
		await expect(page.getByTestId('timeline-return-button')).toBeVisible();
		await expect(targetMessage).toHaveAttribute('data-highlighted', 'true');

		await page.waitForTimeout(110);
		await page.setViewportSize({
			width: 1120,
			height: 520,
		});

		await expect(targetMessage).toBeInViewport();
		await page.waitForTimeout(420);
		const settledScrollTop = await timeline.evaluate((node) => node.scrollTop);
		await page.waitForTimeout(260);
		const finalScrollTop = await timeline.evaluate((node) => node.scrollTop);

		expect(Math.abs(finalScrollTop - settledScrollTop)).toBeLessThanOrEqual(4);
	});

	test('reply jumps from the latest bottom do not snap back down during reflow', async ({ page }) => {
		await loginAsFixtureUser(page);
		await openRoom(page, 'platform-duty');
		await waitForRoomLoadingToFinish(page);

		const timeline = page.getByTestId('timeline');
		await expect(page.getByTestId('timeline-jump-button')).toContainText('未读');
		await page.getByTestId('timeline-jump-button').click();
		await expect(page.getByTestId('timeline-jump-button')).toContainText('最新');
		await page.getByTestId('timeline-jump-button').click();
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(12);

		const targetMessage = page.getByTestId('timeline-message-platform-002');
		await targetMessage.hover();
		await page.getByTestId('message-action-reply-platform-002').click();
		await page.getByTestId('composer-textarea').fill('值班群里这条我接住。');
		await page.getByTestId('composer-send').click();
		await page.setViewportSize({
			width: 1280,
			height: 420,
		});
		await expect(targetMessage).not.toBeInViewport();

		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toHaveAttribute('data-delivery-state', 'sent');
		const newestReplyJump = newestMessage.locator('button[data-testid^="reply-jump-"]');
		await expect(newestReplyJump).toBeVisible();
		await newestReplyJump.focus();
		await newestReplyJump.press('Enter');
		await expect(targetMessage).toHaveAttribute('data-highlighted', 'true');

		await page.waitForTimeout(420);
		const settledScrollTop = await timeline.evaluate((node) => node.scrollTop);
		const settledBottomGap = await readTimelineBottomGap(timeline);
		expect(settledBottomGap).toBeGreaterThan(120);

		await page.waitForTimeout(260);
		const finalScrollTop = await timeline.evaluate((node) => node.scrollTop);
		const finalBottomGap = await readTimelineBottomGap(timeline);

		expect(finalBottomGap).toBeGreaterThan(120);
		expect(Math.abs(finalScrollTop - settledScrollTop)).toBeLessThanOrEqual(4);
	});

	test('reply return button dismisses itself once the previous reading area is naturally regained', async ({ page }) => {
		const { sourceMessage, sourceReplyJump } = await prepareReplyJumpScenario(page);

		await sourceReplyJump.click();
		await expect(page.getByTestId('timeline-return-button')).toBeVisible();

		await sourceMessage.scrollIntoViewIfNeeded();
		await expect(sourceMessage).toBeInViewport();
		await expect(page.getByTestId('timeline-return-button')).toHaveCount(0);
	});

	test('reply return button fades away after a short idle pause', async ({ page }) => {
		const { sourceReplyJump } = await prepareReplyJumpScenario(page);

		await sourceReplyJump.click();
		await expect(page.getByTestId('timeline-return-button')).toBeVisible();
		await expect(page.getByTestId('timeline-jump-button')).toHaveCount(0);

		await page.waitForTimeout(4_800);
		await expect(page.getByTestId('timeline-return-button')).toHaveCount(0);
		await expect(page.getByTestId('timeline-jump-button')).toHaveCount(0);
	});

	test('keeps latest hidden right after a reply jump and only reveals it after manual scrolling begins', async ({ page }) => {
		const { sourceReplyJump, timeline } = await prepareReplyJumpScenario(page);

		await sourceReplyJump.click();
		await expect(page.getByTestId('timeline-return-button')).toBeVisible();
		await expect(page.getByTestId('timeline-jump-button')).toHaveCount(0);

		await page.waitForTimeout(420);
		await expect(page.getByTestId('timeline-jump-button')).toHaveCount(0);

		await page.keyboard.press('PageDown');
		await expect(page.getByTestId('timeline-jump-button')).toContainText('最新');
		await expect(page.getByTestId('timeline-return-button')).toBeVisible();

		await page.getByTestId('timeline-jump-button').click();
		await expect(page.getByTestId('timeline-return-button')).toHaveCount(0);
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(12);
		await page.waitForTimeout(220);
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(12);
	});

	test('uses a quiet hover affordance on messages without shifting layout', async ({ page }) => {
		await loginAsFixtureUser(page);

		const message = page.getByTestId('timeline-message-ops-004');
		const messageBody = page.getByTestId('timeline-message-body-ops-004');
		const messageActions = page.getByTestId('message-actions-ops-004');
		await message.scrollIntoViewIfNeeded();
		await page.mouse.move(8, 8);

		const beforeHover = await message.evaluate((node) => {
			const style = window.getComputedStyle(node);
			const rect = node.getBoundingClientRect();
			return {
				backgroundColor: style.backgroundColor,
				boxShadow: style.boxShadow,
				height: rect.height,
				width: rect.width,
				x: rect.x,
				y: rect.y,
			};
		});
		const beforeHoverSurfaceOpacity = await messageBody.evaluate((node) => window.getComputedStyle(node, '::before').opacity);
		const beforeHoverActionsOpacity = await messageActions.evaluate((node) => window.getComputedStyle(node).opacity);
		const hoverSurfaceInsets = await messageBody.evaluate((node) => {
			const style = window.getComputedStyle(node, '::before');
			return {
				top: Number.parseFloat(style.top),
				right: Number.parseFloat(style.right),
				bottom: Number.parseFloat(style.bottom),
				left: Number.parseFloat(style.left),
			};
		});

		await message.hover();
		await expect
			.poll(async () => Number(await messageActions.evaluate((node) => window.getComputedStyle(node).opacity)))
			.toBeGreaterThan(0.5);
		await expect
			.poll(async () => Number(await messageBody.evaluate((node) => window.getComputedStyle(node, '::before').opacity)))
			.toBeGreaterThan(0.6);

		const afterHover = await message.evaluate((node) => {
			const style = window.getComputedStyle(node);
			const rect = node.getBoundingClientRect();
			return {
				backgroundColor: style.backgroundColor,
				boxShadow: style.boxShadow,
				height: rect.height,
				width: rect.width,
				x: rect.x,
				y: rect.y,
			};
		});
		const afterHoverSurfaceOpacity = await messageBody.evaluate((node) => window.getComputedStyle(node, '::before').opacity);
		const afterHoverActionsOpacity = await messageActions.evaluate((node) => window.getComputedStyle(node).opacity);

		expect(afterHover.backgroundColor).toBe(beforeHover.backgroundColor);
		expect(afterHover.boxShadow).toBe(beforeHover.boxShadow);
		expect(Number(afterHoverSurfaceOpacity)).toBeGreaterThan(Number(beforeHoverSurfaceOpacity));
		expect(Number(afterHoverActionsOpacity)).toBeGreaterThan(Number(beforeHoverActionsOpacity));
		expect(hoverSurfaceInsets.top).toBeLessThanOrEqual(-4);
		expect(hoverSurfaceInsets.right).toBeLessThanOrEqual(-5);
		expect(hoverSurfaceInsets.bottom).toBeLessThanOrEqual(-4);
		expect(hoverSurfaceInsets.left).toBeLessThanOrEqual(-4);
		expect(Math.abs(afterHover.x - beforeHover.x)).toBeLessThan(0.5);
		expect(Math.abs(afterHover.y - beforeHover.y)).toBeLessThan(0.5);
		expect(Math.abs(afterHover.width - beforeHover.width)).toBeLessThan(0.5);
		expect(Math.abs(afterHover.height - beforeHover.height)).toBeLessThan(0.5);
	});

	test('uses a consistent clickable cursor for common interactive controls', async ({ page }) => {
		await loginAsFixtureUser(page);
		await page.getByTestId('timeline-message-toggle-ops-005').click();

		const interactiveControls = [
			page.getByTestId('sidebar-room-ops-handoff'),
			page.getByTestId('room-favorite-toggle'),
			page.getByTestId('room-info-trigger'),
			page.getByTestId('settings-trigger'),
			page.getByTestId('reply-jump-ops-006'),
			page.getByTestId('timeline-jump-button'),
		];

		for (const control of interactiveControls) {
			await expect(control).toBeVisible();
			expect(await control.evaluate((node) => window.getComputedStyle(node).cursor)).toBe('pointer');
		}

		const imageTrigger = page.getByTestId('timeline-image-ops-005-image');
		await expect(imageTrigger).toBeVisible();
		expect(await imageTrigger.evaluate((node) => window.getComputedStyle(node).cursor)).toBe('zoom-in');
	});

	test('keeps the viewport anchored when switching rooms away and back', async ({ page }) => {
		await loginAsFixtureUser(page);

		const timeline = page.getByTestId('timeline');
		await page.getByTestId('timeline-message-ops-004').scrollIntoViewIfNeeded();
		const scrollTopBefore = await timeline.evaluate((node) => node.scrollTop);
		expect(scrollTopBefore).toBeGreaterThan(0);

		await openRoom(page, 'platform-duty');
		await waitForRoomLoadingToFinish(page);
		await openRoom(page, 'ops-handoff');
		await waitForRoomLoadingToFinish(page);

		const scrollTopAfter = await timeline.evaluate((node) => node.scrollTop);
		expect(Math.abs(scrollTopAfter - scrollTopBefore)).toBeLessThan(72);
	});

	test('supports quick unread-then-bottom consecutive jump clicks', async ({ page }) => {
		await page.setViewportSize({
			width: 1280,
			height: 520,
		});
		await loginAsFixtureUser(page);
		await openRoom(page, 'platform-duty');
		await waitForRoomLoadingToFinish(page);

		const timeline = page.getByTestId('timeline');
		const jumpButton = page.getByTestId('timeline-jump-button');

		await expect(jumpButton).toContainText('未读');
		await jumpButton.click();
		await expect(jumpButton).toContainText('最新');
		await jumpButton.click();

		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(8);
	});

	test('prioritizes jumping to a loaded mention before generic unread navigation', async ({ page }) => {
		await loginAsFixtureUser(page);

		const timeline = page.getByTestId('timeline');
		const mentionedMessage = page.getByTestId('timeline-message-ops-005');
		const inlineMention = mentionedMessage.locator('[data-mention-token="true"]').first();
		await timeline.evaluate((node) => {
			node.scrollTo({
				top: 0,
				behavior: 'auto',
			});
		});

		await expect(inlineMention).toContainText('@linche');
		await expect(mentionedMessage).not.toBeInViewport();
		await expect(page.getByTestId('timeline-jump-button')).toContainText('提及');

		await page.getByTestId('timeline-jump-button').click();
		await expect(mentionedMessage).toBeInViewport();
		await expect(mentionedMessage).toHaveAttribute('data-highlighted', 'true');
		await expect
			.poll(async () => {
				const jumpButton = page.getByTestId('timeline-jump-button');
				return (await jumpButton.count()) > 0 ? ((await jumpButton.textContent()) ?? '').trim() : '';
			})
			.not.toContain('提及');
	});

	test('local sends jump to the latest bottom even when reading older messages', async ({ page }) => {
		await loginAsFixtureUser(page);

		const timeline = page.getByTestId('timeline');
		await timeline.evaluate((node) => {
			node.scrollTo({
				top: 0,
				behavior: 'auto',
			});
		});
		expect(await readTimelineBottomGap(timeline)).toBeGreaterThan(120);

		await page.getByTestId('composer-textarea').fill('从中段发送后也应直接跳到底部');
		await page.getByTestId('composer-send').click();

		const newestMessage = page.locator('[data-message-id]').last();
		await expect(newestMessage).toContainText('从中段发送后也应直接跳到底部');
		expect(await readTimelineBottomGap(timeline)).toBeLessThan(8);
	});

	test('shows live markdown styling while preserving raw markdown editing', async ({ page }) => {
		await loginAsFixtureUser(page);

		const editor = page.getByTestId('composer-textarea');
		await editor.click();
		await expect(page.getByTestId('composer-editor-shell')).toHaveAttribute('data-focused', 'true');

		await editor.fill(['**强调内容**', '', '*斜体内容*', '', '```', 'const value = 1', '```'].join('\n'));

		await expect(page.getByTestId('composer-raw-value')).toHaveValue(['**强调内容**', '', '*斜体内容*', '', '```', 'const value = 1', '```'].join('\n'));
		await expect(page.locator('[data-live-markdown="strong"]')).toContainText('强调内容');
		await expect(page.locator('[data-live-markdown="emphasis"]')).toContainText('斜体内容');
		await expect(page.locator('[data-live-markdown="delimiter"]').first()).toContainText('**');
		await expect(page.locator('[data-live-markdown-line="code"]')).toHaveCount(3);
	});

	test('offers quiet @mention suggestions and accepts them by keyboard before sending', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const textarea = page.getByTestId('composer-textarea');
		await textarea.fill('请 @zh');

		const mentionMenu = page.getByTestId('composer-mention-menu');
		const mentionOption = page.getByTestId('composer-mention-option-user-zhoulan');
		await expect(mentionMenu).toBeVisible();
		await expect(mentionOption).toContainText('周岚');
		await expect(mentionOption).toContainText('@zhoulan');

		await textarea.press('Enter');
		await expect(page.getByTestId('composer-raw-value')).toHaveValue('请 @zhoulan ');
		await expect(mentionMenu).toHaveCount(0);

		await textarea.press('Enter');
		await expect(page.locator('article[data-message-id]').last()).toContainText('@zhoulan');
	});

	test('supports Chinese mention query, escape dismissal, and mouse selection', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const textarea = page.getByTestId('composer-textarea');
		const mentionMenu = page.getByTestId('composer-mention-menu');
		await textarea.fill('联系 @周');
		await expect(mentionMenu).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(mentionMenu).toHaveCount(0);

		await textarea.fill('');
		await textarea.fill('联系 @周');
		await expect(mentionMenu).toBeVisible();
		await page.getByTestId('composer-mention-option-user-zhoulan').click();

		await expect(page.getByTestId('composer-raw-value')).toHaveValue('联系 @zhoulan ');
		await expect(mentionMenu).toHaveCount(0);
	});

	test('shows room-member mention suggestions even when the target user has not posted in the loaded fixture timeline', async ({ page }) => {
		await loginAsFixtureUser(page);
		await openRoom(page, 'compat-lab');
		await waitForRoomLoadingToFinish(page);

		const textarea = page.getByTestId('composer-textarea');
		await textarea.fill('请 @周');

		const mentionMenu = page.getByTestId('composer-mention-menu');
		const mentionOption = page.getByTestId('composer-mention-option-user-zhoulan');
		await expect(mentionMenu).toBeVisible();
		await expect(mentionOption).toContainText('周岚');
		await expect(mentionOption).toContainText('@zhoulan');
	});

	test('opens a participant-backed inline mention even when the target user never authored in the loaded fixture timeline', async ({
		page,
	}) => {
		await loginAsFixtureUser(page);
		await openRoom(page, 'compat-lab');
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const mentionedMessage = page.getByTestId('timeline-message-compat-002');
		const inlineMention = mentionedMessage.locator('[data-mention-interactive="true"][data-mention-token-value="@zhoulan"]');
		await expect(inlineMention).toHaveCount(1);

		await inlineMention.click();
		const quickPanel = page.getByTestId('timeline-author-quick-panel');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-name')).toContainText('周岚');
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-handle')).toContainText('@zhoulan');
	});

	test('shows special mentions in group rooms and omits them in direct messages', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const textarea = page.getByTestId('composer-textarea');
		await textarea.fill('@');
		await expect(page.getByTestId('composer-mention-option-special-all')).toBeVisible();
		await expect(page.getByTestId('composer-mention-option-special-here')).toBeVisible();

		await openRoom(page, 'dm-mia');
		await waitForRoomLoadingToFinish(page);
		await page.getByTestId('composer-textarea').fill('@');
		await expect(page.getByTestId('composer-mention-option-special-all')).toHaveCount(0);
		await expect(page.getByTestId('composer-mention-option-special-here')).toHaveCount(0);
	});

	test('auto-completes fenced code blocks and keeps tab inside the editor', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.getByTestId('settings-trigger').click();
		await page.getByTestId('settings-send-mode-ctrl-enter-send').click();
		await page.keyboard.press('Escape');

		const textarea = page.getByTestId('composer-textarea');
		await textarea.fill('```ts');
		await textarea.press('Enter');

		await expect(page.getByTestId('composer-raw-value')).toHaveValue('```ts\n\n```');

		await textarea.press('Tab');
		await textarea.type('const answer = 42;');

		await expect(page.getByTestId('composer-raw-value')).toHaveValue('```ts\n\tconst answer = 42;\n```');
		await expect(page.locator('[data-live-markdown-line="code"]')).toHaveCount(3);
		await expect(textarea).toBeFocused();
	});

	test('lets the second quote-line enter exit back to a normal line', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.getByTestId('settings-trigger').click();
		await page.getByTestId('settings-send-mode-ctrl-enter-send').click();
		await page.keyboard.press('Escape');

		const textarea = page.getByTestId('composer-textarea');
		await textarea.fill('> 引用说明');
		await textarea.press('Enter');
		await expect(page.getByTestId('composer-raw-value')).toHaveValue('> 引用说明\n> ');

		await textarea.press('Enter');
		await expect(page.getByTestId('composer-raw-value')).toHaveValue('> 引用说明\n');

		await textarea.type('普通行');
		await expect(page.getByTestId('composer-raw-value')).toHaveValue('> 引用说明\n普通行');
	});

	test('keeps the composer responsive and preserves rapid consecutive sends', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const timeline = page.getByTestId('timeline');
		const textarea = page.getByTestId('composer-textarea');
		const messageRows = page.locator('article[data-message-id]');
		const initialCount = await messageRows.count();

		await textarea.fill('第一条快速消息');
		await textarea.press('Enter');
		await expect(textarea).toBeEnabled();

		await textarea.fill('第二条快速消息');
		await textarea.press('Enter');
		await expect(textarea).toBeEnabled();

		await textarea.fill('第三条快速消息');
		await textarea.press('Enter');

		await expect.poll(async () => await messageRows.count()).toBe(initialCount + 3);
		await expect(page.getByText('发送失败')).toHaveCount(0);

		const lastThreeTexts = await messageRows.evaluateAll((nodes) => nodes.slice(-3).map((node) => node.textContent ?? ''));
		expect(lastThreeTexts[0]).toContain('第一条快速消息');
		expect(lastThreeTexts[1]).toContain('第二条快速消息');
		expect(lastThreeTexts[2]).toContain('第三条快速消息');
		expect(await readTimelineBottomGap(timeline)).toBeLessThan(8);
	});

	test('keeps short text messages visually stable while sending resolves', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);
		const timeline = page.getByTestId('timeline');
		const text = `发送稳定性文本 ${Date.now()}`;

		await page.getByTestId('composer-textarea').fill(text);
		await page.getByTestId('composer-send').click();

		const sendingMessage = page.locator('article[data-message-id][data-delivery-state="sending"]').filter({ hasText: text });
		await expect(sendingMessage).toBeVisible();
		const sendingHeight = await readElementHeight(sendingMessage);

		const deliveredMessage = page.locator('article[data-message-id][data-delivery-state="sent"]').filter({ hasText: text }).last();
		await expect(deliveredMessage).toBeVisible();
		const deliveredHeight = await readElementHeight(deliveredMessage);

		expect(Math.abs(deliveredHeight - sendingHeight)).toBeLessThan(3);
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(8);
	});

	test('supports selecting and sending an image with an optional caption', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);
		const timeline = page.getByTestId('timeline');

		await page.getByTestId('composer-image-input').setInputFiles({
			buffer: tinyPngFixture.buffer,
			mimeType: tinyPngFixture.mimeType,
			name: tinyPngFixture.fileName,
		});
		await expect(page.getByTestId('composer-image-preview')).toBeVisible();
		await expect(page.getByTestId('composer-send')).toBeEnabled();

		await page.getByTestId('composer-textarea').fill('附上一张核对截图。');
		await page.getByTestId('composer-send').click();

		await expect(page.getByTestId('composer-image-preview')).toHaveCount(0);
		await expect(page.getByTestId('composer-raw-value')).toHaveValue('');

		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText('附上一张核对截图。');
		await expect(newestMessage.locator('[data-testid^="timeline-message-toggle-"]')).toContainText('收起');
		await expect(newestMessage.getByRole('button', { name: `查看图片：${tinyPngFixture.fileName}` })).toBeVisible();
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(8);
	});

	test('keeps optimistic image layout stable while upload delivery resolves', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);
		const timeline = page.getByTestId('timeline');
		const mediumBmpFixture = createLargeBmpFixture({
			width: 240,
			height: 160,
		});
		const caption = `图片发送稳定性 ${Date.now()}`;

		await page.getByTestId('composer-image-input').setInputFiles({
			buffer: mediumBmpFixture.buffer,
			mimeType: mediumBmpFixture.mimeType,
			name: mediumBmpFixture.fileName,
		});
		await page.getByTestId('composer-textarea').fill(caption);
		await page.getByTestId('composer-send').click();

		const sendingMessage = page.locator('article[data-message-id][data-delivery-state="sending"]').filter({ hasText: caption });
		await expect(sendingMessage).toBeVisible();
		const sendingHeight = await readElementHeight(sendingMessage);
		const sendingImage = sendingMessage.getByRole('button', { name: `查看图片：${mediumBmpFixture.fileName}` });
		await expect(sendingImage).toBeVisible();
		const sendingImageHeight = await readElementHeight(sendingImage);

		const deliveredMessage = page.locator('article[data-message-id][data-delivery-state="sent"]').filter({ hasText: caption }).last();
		await expect(deliveredMessage).toBeVisible();
		const deliveredHeight = await readElementHeight(deliveredMessage);
		const deliveredImage = deliveredMessage.getByRole('button', { name: `查看图片：${mediumBmpFixture.fileName}` });
		await expect(deliveredImage).toBeVisible();
		const deliveredImageHeight = await readElementHeight(deliveredImage);

		expect(Math.abs(deliveredHeight - sendingHeight)).toBeLessThan(4);
		expect(Math.abs(deliveredImageHeight - sendingImageHeight)).toBeLessThan(4);
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(8);
	});

	test('supports pasting an image directly into the composer', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);
		const timeline = page.getByTestId('timeline');

		await pasteImageIntoComposer(page, tinyPngFixture);
		await expect(page.getByTestId('composer-image-preview')).toBeVisible();
		await expect(page.getByTestId('composer-send')).toBeEnabled();

		await page.getByTestId('composer-textarea').fill('这张图直接来自剪贴板。');
		await page.getByTestId('composer-send').click();

		await expect(page.getByTestId('composer-image-preview')).toHaveCount(0);
		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText('这张图直接来自剪贴板。');
		await expect(newestMessage.locator('[data-testid^="timeline-message-toggle-"]')).toContainText('收起');
		await expect(newestMessage.getByRole('button', { name: `查看图片：${tinyPngFixture.fileName}` })).toBeVisible();
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(8);
	});

	test('supports dragging an image directly into the composer', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);
		const timeline = page.getByTestId('timeline');

		await dragImageIntoComposer(page, tinyPngFixture);
		await expect(page.getByTestId('composer-image-preview')).toBeVisible();
		await expect(page.getByTestId('composer-send')).toBeEnabled();

		await page.getByTestId('composer-textarea').fill('这张图直接拖进发送框。');
		await page.getByTestId('composer-send').click();

		await expect(page.getByTestId('composer-image-preview')).toHaveCount(0);
		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText('这张图直接拖进发送框。');
		await expect(newestMessage.locator('[data-testid^="timeline-message-toggle-"]')).toContainText('收起');
		await expect(newestMessage.getByRole('button', { name: `查看图片：${tinyPngFixture.fileName}` })).toBeVisible();
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(8);
	});

	test('keeps a failed image send in the timeline and supports one-click retry', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);
		const timeline = page.getByTestId('timeline');
		const caption = `失败后应保留并可重发 ${Date.now()}`;

		await page.evaluate(() => {
			window.localStorage.setItem('betterchat.fixture.fail-next-image-upload', '1');
		});

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
		await expect(failedMessage.locator('[data-testid^="timeline-message-error-"]')).toContainText('图片发送失败，请重试。');
		await expect(failedMessage.locator('[data-testid^="timeline-message-retry-"]')).toBeVisible();
		await expect(failedMessage.locator('[data-testid^="timeline-message-remove-"]')).toBeVisible();
		await expect(failedMessage.getByRole('button', { name: `查看图片：${tinyPngFixture.fileName}` })).toBeVisible();
		await page.waitForTimeout(1_600);
		await expect(failedMessage).toBeVisible();

		await failedMessage.locator('[data-testid^="timeline-message-retry-"]').click();

		await expect(failedMessage).toHaveCount(0);
		const deliveredMessage = page.locator('article[data-message-id]').filter({ hasText: caption }).last();
		await expect(deliveredMessage).toContainText(caption);
		await expect(deliveredMessage).toHaveAttribute('data-delivery-state', 'sent');
		await expect(deliveredMessage.getByRole('button', { name: `查看图片：${tinyPngFixture.fileName}` })).toBeVisible();
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(8);
	});

	test('dedupes rapid retries for a permanently failing image upload and returns to failed state', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);
		const caption = `快速重发去重 ${Date.now()}`;

		await page.evaluate(() => {
			window.localStorage.setItem('betterchat.fixture.fail-image-upload-always', '1');
		});

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

		await page.evaluate(() => {
			const retryButton = document.querySelector('[data-testid^="timeline-message-retry-"]');
			if (!(retryButton instanceof HTMLButtonElement)) {
				throw new Error('retry button was unavailable');
			}

			for (let index = 0; index < 6; index += 1) {
				retryButton.click();
			}
		});

		const sendingMessage = page
			.locator('article[data-message-id][data-delivery-state="sending"]')
			.filter({ hasText: caption });
		const sentMessage = page
			.locator('article[data-message-id][data-delivery-state="sent"]')
			.filter({ hasText: caption });

		await expect.poll(async () => sendingMessage.count()).toBe(0);
		await expect.poll(async () => failedMessage.count()).toBe(1);
		await expect(failedMessage).toBeVisible();
		await expect(failedMessage.locator('[data-testid^="timeline-message-retry-"]')).toBeVisible();
		await expect(failedMessage.locator('[data-testid^="timeline-message-error-"]')).toContainText('图片发送失败，请重试。');
		await expect(sentMessage).toHaveCount(0);
	});

	test('lets the user remove a failed image send from the timeline locally', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);
		const caption = `失败后移除 ${Date.now()}`;

		await page.evaluate(() => {
			window.localStorage.setItem('betterchat.fixture.fail-next-image-upload', '1');
		});

		await pasteImageIntoComposer(page, tinyPngFixture);
		await page.getByTestId('composer-textarea').fill(caption);
		await page.getByTestId('composer-send').click();

		const failedMessage = page
			.locator('article[data-message-id][data-delivery-state="failed"]')
			.filter({ hasText: caption });
		await expect(failedMessage).toBeVisible();

		await failedMessage.locator('[data-testid^="timeline-message-remove-"]').click();

		await expect(failedMessage).toHaveCount(0);
		await expect(page.getByText(caption)).toHaveCount(0);
	});

	test('opens a quiet right-click message panel for reply and forward actions', async ({ page }) => {
		await loginAsFixtureUser(page);

		const message = page.getByTestId('timeline-message-ops-004');
		await openMessageContextMenu(message);

		const menu = page.getByTestId('timeline-message-context-menu');
		await expect(menu).toBeVisible();
		await expect(menu.getByTestId('message-context-action-reply')).toBeVisible();
		await expect(menu.getByTestId('message-context-action-forward')).toBeVisible();

		await menu.getByTestId('message-context-action-reply').dispatchEvent('click');
		await expect(menu).toHaveCount(0);
		await expect(page.getByTestId('composer-reply-context')).toContainText('回复 周岚');

		await openMessageContextMenu(message);
		await expect(menu).toBeVisible();
		await menu.getByTestId('message-context-action-forward').dispatchEvent('click');
		await expect(page.getByTestId('forward-dialog')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('forward-dialog')).toHaveCount(0);
	});

	test('supports right-click panel copy and jump-to-original actions', async ({ page }) => {
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
		await loginAsFixtureUser(page);

		const sourceMessage = page.getByTestId('timeline-message-ops-006');
		await openMessageContextMenu(sourceMessage);

		const menu = page.getByTestId('timeline-message-context-menu');
		const copyMarkdownAction = menu.getByTestId('message-context-action-copy-markdown');
		await expect(menu).toBeVisible();
		await copyMarkdownAction.dispatchEvent('click');
		await expect(menu).toHaveCount(0);
		await expect(page.getByTestId('timeline-toast')).toContainText('已复制 Markdown');
		await expect
			.poll(async () => page.evaluate(() => navigator.clipboard.readText()), {
				timeout: 2_000,
			})
			.toContain('**收藏、房间、私信**');
		await expect(page.getByTestId('timeline-toast')).toHaveCount(0);

		await openMessageContextMenu(sourceMessage);
		await menu.getByTestId('message-context-action-jump-to-original').dispatchEvent('click');
		await expect(page.getByTestId('timeline-message-ops-004')).toHaveAttribute('data-highlighted', 'true');
	});

	test('supports right-click panel long-message toggle and outside close', async ({ page }) => {
		await loginAsFixtureUser(page);

		const timeline = page.getByTestId('timeline');
		const menu = page.getByTestId('timeline-message-context-menu');
		const longMessage = page.getByTestId('timeline-message-ops-004');
		await longMessage.scrollIntoViewIfNeeded();
		const scrollTopBeforeToggle = await timeline.evaluate((node) => node.scrollTop);

		await openMessageContextMenu(longMessage);
		await expect(menu).toBeVisible();
		await expect(menu.getByTestId('message-context-action-toggle-expanded')).toContainText('展开全文');
		await menu.getByTestId('message-context-action-toggle-expanded').dispatchEvent('click');
		await expect(menu).toHaveCount(0);
		await expect(page.getByTestId('timeline-message-content-ops-004')).toHaveAttribute('data-collapsed', 'false');
		const scrollTopAfterToggle = await timeline.evaluate((node) => node.scrollTop);
		expect(Math.abs(scrollTopAfterToggle - scrollTopBeforeToggle)).toBeLessThan(8);

		await openMessageContextMenu(longMessage);
		await expect(menu).toBeVisible();
		await page.mouse.click(24, 24);
		await expect(menu).toHaveCount(0);
	});

	test('supports replying to a message from timeline actions', async ({ page }) => {
		await loginAsFixtureUser(page);

		await page.getByTestId('message-action-reply-ops-004').click();
		await expect(page.getByTestId('composer-reply-context')).toContainText('回复 周岚');
		await expect(page.getByTestId('composer-reply-context')).toContainText('顺手把接口草稿也贴进来');

		await page.getByTestId('composer-textarea').fill('我来跟一下这条接口说明。');
		await page.getByTestId('composer-send').click();

		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText('我来跟一下这条接口说明。');
		await expect(newestMessage).toContainText('回复周岚');
		await expect(page.getByTestId('composer-reply-context')).toHaveCount(0);
	});

	test('supports forwarding a message to another room and renders it as a forwarded card', async ({ page }) => {
		await loginAsFixtureUser(page);

		await page.getByTestId('message-action-forward-ops-005').click();
		const forwardDialog = page.getByTestId('forward-dialog');
		await expect(forwardDialog).toBeVisible();
		await expect(page.getByTestId('forward-preview-summary')).toBeVisible();
		await expect(page.getByTestId('forward-preview-body')).toContainText('交接结构图');
		await expect(page.getByTestId('forward-preview-summary').getByRole('img')).toHaveCount(0);
		expect(await page.getByTestId('forward-preview-body').evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(44);
		expect(
			await forwardDialog.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight)),
		).toBeLessThanOrEqual(1);
		await expect(page.getByTestId('forward-room-platform-duty')).toContainText(/频道|群组|私信/);
		const roomListBounds = await page.getByTestId('forward-room-list').boundingBox();
		const noteBounds = await page.getByTestId('forward-note').boundingBox();
		expect(roomListBounds).not.toBeNull();
		expect(noteBounds).not.toBeNull();
		if (!roomListBounds || !noteBounds) {
			throw new Error('forward dialog geometry was unavailable');
		}
		expect(noteBounds.y).toBeGreaterThanOrEqual(roomListBounds.y + roomListBounds.height - 1);
		expect(
			await page.getByTestId('forward-room-platform-duty').evaluate((node) => node.getBoundingClientRect().height),
		).toBeGreaterThanOrEqual(48);

		await page.getByTestId('forward-search').fill('platform');
		await page.getByTestId('forward-room-platform-duty').click();
		await page.getByTestId('forward-note').fill('同步给平台值班。');
		await page.getByTestId('forward-submit').click();
		await expect(page.getByTestId('forward-dialog')).toHaveCount(0);
		await expect(page.getByTestId('forward-toast')).toContainText('已转发到');
		await expect(page.getByTestId('forward-toast')).toContainText(/platform\s*值班/i);
		await expect(page.getByTestId('forward-toast-jump')).toBeFocused();
		await expect(page.getByTestId('forward-toast-jump-key')).toContainText('Enter');
		await page.keyboard.press('Enter');

		await expect(page.getByTestId('forward-toast')).toHaveCount(0);
		await expect(page).toHaveURL(/\/app\/rooms\/platform-duty$/);
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId('composer-textarea')).toBeFocused();

		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText('同步给平台值班。');
		await expect(newestMessage.getByTestId('forwarded-message-card')).toBeVisible();
		await expect(newestMessage.getByTestId('forwarded-message-card')).toContainText('顾宁');
		await expect(newestMessage.getByTestId('forwarded-message-card')).toContainText('运营协调');
		const forwardedMessageId = await newestMessage.getAttribute('data-message-id');
		if (forwardedMessageId) {
			const expandToggle = page.getByTestId(`timeline-message-toggle-${forwardedMessageId}`);
			if ((await expandToggle.count()) > 0) {
				await expandToggle.click();
			}
		}
		await expect(newestMessage.getByTestId('forwarded-message-card').getByRole('button', { name: '查看图片：交接结构图' })).toBeVisible();
	});

	test('supports keyboard-first forward dialog selection flow and note submit shortcut', async ({ page }) => {
		await loginAsFixtureUser(page);

		await page.getByTestId('message-action-forward-ops-004').click();
		await expect(page.getByTestId('forward-dialog')).toBeVisible();

		const search = page.getByTestId('forward-search');
		const room = page.getByTestId('forward-room-platform-duty');
		const note = page.getByTestId('forward-note');

		await expect(search).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(search).toBeFocused();
		await search.fill('platform');
		await page.keyboard.press('ArrowDown');
		await expect(room).toBeFocused();
		await expect(room).toHaveAttribute('data-active', 'true');

		await page.keyboard.press('ArrowUp');
		await expect(search).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(search).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(room).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(note).toBeFocused();

		await note.fill('键盘路径转发验证。');
		await note.press('Home');
		await page.keyboard.press('ArrowUp');
		await expect(room).toBeFocused();

		await page.keyboard.press('ArrowUp');
		await expect(search).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(room).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(note).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('forward-submit')).toBeFocused();

		await page.keyboard.press('ArrowUp');
		await expect(note).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('forward-submit')).toBeFocused();
		await page.keyboard.press('Enter');

		await expect(page.getByTestId('forward-dialog')).toHaveCount(0);
		await expect(page.getByTestId('forward-toast')).toContainText('已转发到');
		await expect(page.getByTestId('forward-toast-jump')).toBeFocused();
		await expect(page.getByTestId('forward-toast-jump-key')).toContainText('Enter');
		await expect(page).toHaveURL(/\/app\/rooms\/ops-handoff$/);
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('forward-toast')).toHaveCount(0);
		await expect(page).toHaveURL(/\/app\/rooms\/platform-duty$/);
		await waitForRoomLoadingToFinish(page);
		await expect(page.locator('article[data-message-id]').last()).toContainText('键盘路径转发验证。');
	});

	test('sends multiline messages, stays at bottom when already there, and merges consecutive author messages', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const timeline = page.getByTestId('timeline');
		const textarea = page.getByTestId('composer-textarea');
		await textarea.fill('第一行\n第二行');
		await page.getByTestId('composer-send').click();

		const newestMessage = page.locator('[data-message-id]').last();
		await expect(newestMessage).toContainText('第一行');
		await expect(newestMessage).toContainText('第二行');
		expect(await readTimelineBottomGap(timeline)).toBeLessThan(8);

		await textarea.fill('紧接着补一句');
		await page.getByTestId('composer-send').click();

		const latestMessage = page.locator('[data-message-id]').last();
		await expect(latestMessage).toContainText('紧接着补一句');
		await expect(latestMessage).toHaveAttribute('data-grouped-prev', 'true');
		const groupedTopOffset = await latestMessage.evaluate((node) => {
			const content = node.querySelector('[data-testid^="timeline-message-content-"]');
			if (!content) {
				return null;
			}

			return content.getBoundingClientRect().top - node.getBoundingClientRect().top;
		});
		expect(groupedTopOffset).not.toBeNull();
		expect(groupedTopOffset ?? 0).toBeLessThan(18);
		expect(await readTimelineBottomGap(timeline)).toBeLessThan(8);
	});

	test('folds long historical messages by default and persists manual expansion after reload', async ({ page }) => {
		await loginAsFixtureUser(page);

		const historicalLongMessage = page.getByTestId('timeline-message-ops-005');
		await historicalLongMessage.scrollIntoViewIfNeeded();

		const content = page.getByTestId('timeline-message-content-ops-005');
		const toggle = page.getByTestId('timeline-message-toggle-ops-005');
		await expect(toggle).toContainText('展开全文');
		await expect(content).toHaveAttribute('data-collapsed', 'true');

		await toggle.click();
		await expect(toggle).toHaveText('收起');
		await expect(content).toHaveAttribute('data-collapsed', 'false');

		await page.reload();
		await waitForRoomLoadingToFinish(page);
		await page.getByTestId('timeline-message-ops-005').scrollIntoViewIfNeeded();
		await expect(page.getByTestId('timeline-message-toggle-ops-005')).toHaveText('收起');
		await expect(page.getByTestId('timeline-message-content-ops-005')).toHaveAttribute('data-collapsed', 'false');
	});

	test('uses the collapsed preview itself as the expand target and does not open images before expansion', async ({ page }) => {
		await loginAsFixtureUser(page);

		const content = page.getByTestId('timeline-message-content-ops-005');
		await content.scrollIntoViewIfNeeded();
		await expect(content).toHaveAttribute('data-collapsed', 'true');

		const previewImage = page.locator('img[alt="兼容流程示意图"]').first();
		const previewBox = await previewImage.boundingBox();
		expect(previewBox).not.toBeNull();
		if (!previewBox) {
			throw new Error('collapsed preview image bounds were unavailable');
		}

		await page.mouse.click(previewBox.x + previewBox.width / 2, previewBox.y + Math.min(previewBox.height / 2, 72));

		await expect(content).toHaveAttribute('data-collapsed', 'false');
		await expect(page.locator('.pswp.pswp--open')).toHaveCount(0);
		await expect(page.getByTestId('timeline-message-toggle-ops-005')).toHaveText('收起');
	});

	test('keeps newly added long messages expanded while actively chatting', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const longMessage = [
			'新的长消息在实时聊天里应默认展开。',
			'',
			'```',
			'const panel = createTimelinePanel();',
			'panel.measure();',
			'panel.persist();',
			'panel.render();',
			'panel.flush();',
			'panel.done();',
			'```',
		].join('\n');

		await page.getByTestId('composer-textarea').fill(longMessage);
		await page.getByTestId('composer-send').click();

		const newestMessage = page.locator('[data-message-id]').last();
		await expect(newestMessage).toContainText('新的长消息在实时聊天里应默认展开');
		await expect(newestMessage.locator('[data-testid^="timeline-message-toggle-"]')).toContainText('收起');
		await expect(newestMessage.locator('[data-testid^="timeline-message-content-"]')).toHaveAttribute('data-collapsed', 'false');
	});

	test('keeps newly sent images expanded and jumps to bottom even when the send starts from historical context', async ({ page }) => {
		await loginAsFixtureUser(page);

		const timeline = page.getByTestId('timeline');
		await timeline.evaluate((node) => {
			node.scrollTo({
				top: 0,
				behavior: 'auto',
			});
		});
		expect(await readTimelineBottomGap(timeline)).toBeGreaterThan(120);

		const mediumBmpFixture = createLargeBmpFixture({
			width: 240,
			height: 160,
		});
		await page.getByTestId('composer-image-input').setInputFiles({
			buffer: mediumBmpFixture.buffer,
			mimeType: mediumBmpFixture.mimeType,
			name: mediumBmpFixture.fileName,
		});
		await page.getByTestId('composer-textarea').fill('从历史位置发送的图片也应直接展开。');
		await page.getByTestId('composer-send').click();

		const newestMessage = page.locator('[data-message-id]').last();
		await expect(newestMessage).toContainText('从历史位置发送的图片也应直接展开。');
		await expect(newestMessage.locator('[data-testid^="timeline-message-toggle-"]')).toContainText('收起');
		await expect(newestMessage.locator('[data-testid^="timeline-message-content-"]')).toHaveAttribute('data-collapsed', 'false');
		await expect(newestMessage.getByRole('button', { name: `查看图片：${mediumBmpFixture.fileName}` })).toBeVisible();
		await expect.poll(async () => readTimelineBottomGap(timeline)).toBeLessThan(8);
	});

	test('supports ctrl-enter send mode from settings while keeping plain enter for line breaks', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.getByTestId('settings-trigger').click();
		await page.getByTestId('settings-send-mode-ctrl-enter-send').click();
		await page.keyboard.press('Escape');

		const textarea = page.getByTestId('composer-textarea');
		await textarea.fill('第一行');
		await textarea.press('Enter');
		await textarea.type('第二行');
		await expect(page.getByTestId('composer-raw-value')).toHaveValue('第一行\n第二行');

		await textarea.press('Control+Enter');

		const newestMessage = page.locator('[data-message-id]').last();
		await expect(newestMessage).toContainText('第一行');
		await expect(newestMessage).toContainText('第二行');
		await expect(page.getByTestId('composer-raw-value')).toHaveValue('');
	});

	test('restores the previous timeline keyboard position when returning from the sidebar with right arrow', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		await expect(page.getByTestId('timeline-message-ops-006')).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('timeline-message-ops-005')).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('timeline-author-trigger-ops-005')).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();

		await page.getByTestId('timeline-message-ops-004').hover();
		await page.keyboard.press('ArrowRight');
		await expect(page.getByTestId('timeline-message-ops-005')).toBeFocused();
		await expect(page.getByTestId('timeline-message-ops-005')).toHaveAttribute('data-keyboard-visible', 'true');
	});

	test('opens an existing direct conversation from the timeline author quick panel and focuses the composer', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.getByTestId('timeline-author-avatar-trigger-ops-004').click();
		const quickPanel = page.getByTestId('timeline-author-quick-panel');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-name')).toContainText('周岚');
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-handle')).toContainText('@zhoulan');
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-primary-action')).toContainText('打开私信');

		await quickPanel.getByTestId('timeline-author-quick-panel-primary-action').click();
		await expect(page).toHaveURL(/\/app\/rooms\/dm-zhoulan$/);
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId('room-title')).toContainText('周岚');
		await expect(page.getByTestId('composer-textarea')).toBeFocused();
	});

	test('warms the author quick panel lookup on hover so opening stays resolved instead of flashing a loading state', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const authorTrigger = page.getByTestId('timeline-author-avatar-trigger-ops-004');
		await authorTrigger.hover();
		await page.waitForTimeout(180);
		await authorTrigger.click();

		const quickPanel = page.getByTestId('timeline-author-quick-panel');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-status')).not.toContainText('正在加载用户信息');
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-primary-action')).toBeEnabled();
	});

	test('shows explicit avatar feedback when hovering a timeline author avatar', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const avatar = page.getByTestId('timeline-author-avatar-ops-004');
		const avatarTrigger = page.getByTestId('timeline-author-avatar-trigger-ops-004');
		const initialShadow = await avatar.evaluate((node) => getComputedStyle(node).boxShadow);

		await avatarTrigger.hover();

		await expect
			.poll(async () => avatar.evaluate((node) => getComputedStyle(node).boxShadow))
			.not.toBe(initialShadow);
	});

	test('creates a new direct conversation from the timeline author quick panel and inserts it into the sidebar', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await expect(page.getByTestId('sidebar-room-dm-mingyuan')).toHaveCount(0);
		await page.getByTestId('timeline-author-trigger-ops-002').click();
		const quickPanel = page.getByTestId('timeline-author-quick-panel');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-name')).toContainText('欧阳明远');
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-primary-action')).toContainText('发起私信');

		await quickPanel.getByTestId('timeline-author-quick-panel-primary-action').click();
		await expect(page).toHaveURL(/\/app\/rooms\/dm-mingyuan$/);
		await waitForRoomLoadingToFinish(page);
		await expect(page.getByTestId('room-title')).toContainText('欧阳明远');
		await expect(page.getByTestId('sidebar-room-dm-mingyuan')).toBeVisible();
		await expect(page.getByTestId('composer-textarea')).toBeFocused();
	});

	test('opens inline mentions through the timeline user quick panel and restores mention focus on keyboard escape', async ({
		page,
	}) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const mentionedMessage = page.getByTestId('timeline-message-ops-005');
		const mentionedMessageContent = page.getByTestId('timeline-message-content-ops-005');
		const inlineMention = mentionedMessage.locator(
			'[data-mention-interactive="true"][data-mention-token-value="@zhoulan"]',
		);
		await expect(inlineMention).toHaveCount(1);
		if ((await mentionedMessageContent.getAttribute('data-collapsed')) === 'true') {
			await page.getByTestId('timeline-message-toggle-ops-005').click();
			await expect(mentionedMessageContent).toHaveAttribute('data-collapsed', 'false');
		}

		await inlineMention.click();
		const quickPanel = page.getByTestId('timeline-author-quick-panel');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-name')).toContainText('周岚');
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-handle')).toContainText('@zhoulan');
		await page.mouse.click(16, 16);
		await expect(quickPanel).toHaveCount(0);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowUp');
		await expect(mentionedMessage).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(inlineMention).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-primary-action')).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(quickPanel).toHaveCount(0);
		await expect(inlineMention).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(mentionedMessage.locator('img[data-timeline-interactive-image="true"]').first()).toBeFocused();
	});

	test('supports keyboard-first author quick panel travel and restores focus correctly', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('timeline-message-ops-004')).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		const authorTrigger = page.getByTestId('timeline-author-trigger-ops-004');
		const authorRow = page.getByTestId('timeline-message-ops-004');
		const authorAvatar = page.getByTestId('timeline-author-avatar-ops-004');
		await expect(authorTrigger).toBeFocused();
		await expect(authorRow).toHaveAttribute('data-author-focus-mode', 'avatar');
		await expect
			.poll(async () => authorAvatar.evaluate((node) => getComputedStyle(node).boxShadow))
			.not.toBe('none');

		await page.keyboard.press('Enter');
		const quickPanel = page.getByTestId('timeline-author-quick-panel');
		const quickPanelPrimaryAction = quickPanel.getByTestId('timeline-author-quick-panel-primary-action');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanelPrimaryAction).toBeFocused();
		await expect(authorRow).toHaveAttribute('data-keyboard-focused', 'true');
		await page.evaluate(() => window.dispatchEvent(new Event('resize')));
		await page.waitForTimeout(80);
		await expect(authorRow).toHaveAttribute('data-keyboard-focused', 'true');

		await page.keyboard.press('ArrowUp');
		await expect(quickPanel).toHaveCount(0);
		await expect(page.getByTestId('timeline-message-ops-003')).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(authorRow).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(authorTrigger).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanelPrimaryAction).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(quickPanel).toHaveCount(0);
		await expect(authorTrigger).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(page.getByTestId('timeline-message-ops-004')).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(authorTrigger).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(page.getByTestId('timeline-message-ops-004')).toBeFocused();
		await expect(page.getByTestId('timeline-message-ops-004')).toHaveAttribute('data-keyboard-visible', 'true');
	});

	test('routes keyboard-opened author quick panel exits by arrow direction', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');

		const sourceMessage = page.getByTestId('timeline-message-ops-004');
		const authorTrigger = page.getByTestId('timeline-author-trigger-ops-004');
		await expect(sourceMessage).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(authorTrigger).toBeFocused();
		await page.keyboard.press('Enter');

		const quickPanel = page.getByTestId('timeline-author-quick-panel');
		const quickPanelPrimaryAction = quickPanel.getByTestId('timeline-author-quick-panel-primary-action');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanelPrimaryAction).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(quickPanel).toHaveCount(0);
		await expect(sourceMessage).toBeFocused();
		await expect(sourceMessage).toHaveAttribute('data-keyboard-visible', 'true');

		await page.keyboard.press('ArrowLeft');
		await expect(authorTrigger).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanelPrimaryAction).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(quickPanel).toHaveCount(0);
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();
	});

	test('routes quick-panel vertical arrows to immediate timeline neighbors instead of author anchors', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('timeline-message-ops-004')).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('timeline-author-trigger-ops-004')).toBeFocused();
		await page.keyboard.press('Enter');

		const quickPanel = page.getByTestId('timeline-author-quick-panel');
		await expect(quickPanel).toBeVisible();
		await expect(quickPanel.getByTestId('timeline-author-quick-panel-primary-action')).toBeFocused();

		await page.keyboard.press('ArrowUp');
		await expect(quickPanel).toHaveCount(0);
		await expect(page.getByTestId('timeline-message-ops-003')).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('timeline-message-ops-004')).toBeFocused();
	});

	test('hands off vertical keyboard navigation to the hovered timeline message before moving again', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();
		await page.getByTestId('timeline-message-ops-004').hover();

		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('timeline-message-ops-004')).toBeFocused();
		await expect(page.getByTestId('timeline-message-ops-004')).toHaveAttribute('data-keyboard-visible', 'true');

		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('timeline-message-ops-005')).toBeFocused();

		await page.getByTestId('timeline-message-ops-003').hover();
		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('timeline-message-ops-003')).toBeFocused();
		await expect(page.getByTestId('timeline-message-ops-003')).toHaveAttribute('data-keyboard-visible', 'true');

		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('timeline-message-ops-002')).toBeFocused();
	});

	test('honors Home and End when timeline keyboard entry starts from the hovered main timeline area', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();
		await page.getByTestId('timeline-message-ops-004').hover();

		await page.keyboard.press('End');
		await expect(page.getByTestId('timeline-message-ops-006')).toBeFocused();
		await expect(page.getByTestId('timeline-message-ops-006')).toHaveAttribute('data-keyboard-visible', 'true');

		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();

		await page.getByTestId('timeline-message-ops-004').hover();
		await page.keyboard.press('Home');
		await expect(page.locator('article[data-message-id]').first()).toBeFocused();
		await expect(page.locator('article[data-message-id]').first()).toHaveAttribute('data-keyboard-visible', 'true');
	});

	test('uses End in unread rooms as unread-first then latest for timeline keyboard travel', async ({ page }) => {
		await loginAsFixtureUser(page);
		await openRoom(page, 'platform-duty');
		await waitForRoomLoadingToFinish(page);

		await page.getByTestId('timeline-message-platform-000').hover();
		await page.keyboard.press('Home');
		await expect(page.getByTestId('timeline-message-platform-000')).toBeFocused();

		await page.keyboard.press('End');
		await expect(page.getByTestId('timeline-message-platform-002')).toBeFocused();
		await expect(page.getByTestId('timeline-jump-button')).toContainText('最新');

		await page.keyboard.press('End');
		await expect(page.getByTestId('timeline-message-platform-003')).toBeFocused();
		await expect.poll(async () => readTimelineBottomGap(page.getByTestId('timeline'))).toBeLessThan(12);
	});

	test('starts timeline keyboard movement from a newly hovered message after the last room switch click came from the sidebar', async ({
		page,
	}) => {
		await loginAsFixtureUser(page);
		await openRoom(page, 'dm-mia');
		await waitForRoomLoadingToFinish(page);
		await openRoom(page, 'ops-handoff');
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();
		await page.getByTestId('timeline-message-ops-004').hover();

		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('timeline-message-ops-004')).toBeFocused();
		await expect(page.getByTestId('timeline-message-ops-004')).toHaveAttribute('data-keyboard-visible', 'true');

		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('timeline-message-ops-005')).toBeFocused();
	});

	test('keeps sidebar arrow navigation local after leaving the timeline even if the pointer still rests on the timeline', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		await expect(page.getByTestId('timeline-message-ops-006')).toBeFocused();
		await page.getByTestId('timeline-message-ops-004').hover();

		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('sidebar-room-dm-mia')).toBeFocused();
		await expect(page.locator('article[data-message-id][data-keyboard-visible="true"]')).toHaveCount(0);

		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();
	});

	test('keeps rapid sidebar arrow traversal local immediately after moving left from the timeline', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		await page.keyboard.press('Alt+2');
		await page.keyboard.press('End');
		await expect(page.getByTestId('timeline-message-ops-006')).toBeFocused();

		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('sidebar-room-dm-mia')).toBeFocused();
		await expect(page.locator('article[data-message-id][data-keyboard-visible="true"]')).toHaveCount(0);

		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();
		await expect(page.locator('article[data-message-id][data-keyboard-visible="true"]')).toHaveCount(0);
	});
});
