import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { loginAsFixtureUser, openRoom, scrollTimelineToBottom, waitForRoomLoadingToFinish } from './test-helpers';

const isApiMode = (process.env.BETTERCHAT_E2E_API_MODE ?? 'fixture').toLowerCase() === 'api';

test.skip(isApiMode, 'fixture-only suite');

const readComputedStyle = async (locator: Locator, property: string) =>
	locator.evaluate((node, prop) => window.getComputedStyle(node).getPropertyValue(prop), property);

const readComputedNumericStyle = async (locator: Locator, property: string) =>
	Number.parseFloat(await readComputedStyle(locator, property));

test.describe('markdown rendering in timeline', () => {
	test('renders list indentation with proper padding-left', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		// Send a message with a list
		const textarea = page.getByTestId('composer-textarea');
		const listMessage = '验证列表缩进：\n\n- 第一项\n- 第二项\n  - 嵌套项';
		await textarea.fill(listMessage);
		await page.getByTestId('composer-send').click();

		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText('第一项');

		const ul = newestMessage.locator('ul').first();
		await expect(ul).toBeVisible();
		const paddingLeft = await readComputedNumericStyle(ul, 'padding-left');
		expect(paddingLeft).toBeGreaterThanOrEqual(16); // 1.4rem ≈ 22px
	});

	test('renders tables with horizontal scroll wrapper', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const tableMessage = [
			'| Module | Target | Status | Owner | Priority |',
			'|--------|--------|--------|-------|----------|',
			'| auth   | 7.6.0  | done   | Chen  | high     |',
			'| sync   | 7.6.0  | wip    | Zhou  | high     |',
		].join('\n');
		await page.getByTestId('composer-textarea').fill(tableMessage);
		await page.getByTestId('composer-send').click();

		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText('auth');

		const table = newestMessage.locator('table').first();
		await expect(table).toBeVisible();

		// Table should be wrapped in a div with overflow-x: auto
		const tableParent = table.locator('..');
		const overflowX = await readComputedStyle(tableParent, 'overflow-x');
		expect(overflowX).toBe('auto');
	});

	test('renders blockquotes with left border rail', async ({ page }) => {
		await loginAsFixtureUser(page);

		// ops-003 has a blockquote
		const message = page.getByTestId('timeline-message-ops-003');
		await message.scrollIntoViewIfNeeded();

		const blockquote = message.locator('blockquote').first();
		await expect(blockquote).toBeVisible();

		const borderLeftWidth = await readComputedNumericStyle(blockquote, 'border-left-width');
		expect(borderLeftWidth).toBeGreaterThan(0);

		const borderLeftStyle = await readComputedStyle(blockquote, 'border-left-style');
		expect(borderLeftStyle).toBe('solid');
	});

	test('renders code blocks with figure wrapper and copy button', async ({ page }) => {
		await loginAsFixtureUser(page);

		// ops-004 has a code block
		const message = page.getByTestId('timeline-message-ops-004');
		await message.scrollIntoViewIfNeeded();

		// Expand if collapsed
		const content = page.getByTestId('timeline-message-content-ops-004');
		if ((await content.getAttribute('data-collapsed')) === 'true') {
			await page.getByTestId('timeline-message-toggle-ops-004').click();
			await expect(content).toHaveAttribute('data-collapsed', 'false');
		}

		const figure = message.locator('figure').first();
		await expect(figure).toBeVisible();

		// Should have a copy button
		const copyButton = figure.locator('button').filter({ hasText: '复制' });
		await expect(copyButton).toBeVisible();
	});

	test('renders dense mode headers distinguishable from bold text', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		// Send a message with h2 and bold text side by side
		const source = '## Header Text\n\n**Bold Text**';
		await page.getByTestId('composer-textarea').fill(source);
		await page.getByTestId('composer-send').click();

		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText('Header Text');

		const h2 = newestMessage.locator('h2').first();
		const strong = newestMessage.locator('strong').first();
		await expect(h2).toBeVisible();
		await expect(strong).toBeVisible();

		const h2FontSize = await readComputedNumericStyle(h2, 'font-size');
		const strongFontSize = await readComputedNumericStyle(strong, 'font-size');

		// In dense mode, h2 is 1.06rem and body is 0.985rem
		// h2 should be noticeably larger than bold body text
		expect(h2FontSize).toBeGreaterThan(strongFontSize);
	});

	test('expands a collapsed message and renders its code block correctly', async ({ page }) => {
		await loginAsFixtureUser(page);

		const message = page.getByTestId('timeline-message-ops-004');
		await message.scrollIntoViewIfNeeded();

		const content = page.getByTestId('timeline-message-content-ops-004');
		await expect(content).toHaveAttribute('data-collapsible', 'true');

		// If collapsed, expand it
		if ((await content.getAttribute('data-collapsed')) === 'true') {
			await page.getByTestId('timeline-message-toggle-ops-004').click();
		}

		await expect(content).toHaveAttribute('data-collapsed', 'false');

		// Code block should be fully visible after expansion
		const figure = message.locator('figure').first();
		await expect(figure).toBeVisible();

		const code = message.locator('pre code').first();
		await expect(code).toContainText('snapshot');
	});

	test('renders inline code with distinct styling from surrounding text', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const source = 'Check the `loadHistory` endpoint and verify `rooms.get` behavior';
		await page.getByTestId('composer-textarea').fill(source);
		await page.getByTestId('composer-send').click();

		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText('loadHistory');

		const inlineCode = newestMessage.locator('code').first();
		await expect(inlineCode).toBeVisible();

		// Inline code should have a background color distinct from transparent
		const bg = await readComputedStyle(inlineCode, 'background-color');
		expect(bg).not.toBe('rgba(0, 0, 0, 0)');
		expect(bg).not.toBe('transparent');
	});

	test('renders mixed markdown message preserving all element types', async ({ page }) => {
		await loginAsFixtureUser(page);
		await scrollTimelineToBottom(page);

		const source = [
			'## Summary',
			'',
			'Key points:',
			'- First item with `code`',
			'- Second item',
			'',
			'| Col A | Col B |',
			'|-------|-------|',
			'| val 1 | val 2 |',
			'',
			'> Important note here.',
		].join('\n');
		await page.getByTestId('composer-textarea').fill(source);
		await page.getByTestId('composer-send').click();

		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText('Summary');

		// Expand if collapsed
		const toggleSelector = newestMessage.locator('[data-testid^="timeline-message-toggle-"]');
		if ((await toggleSelector.count()) > 0 && (await toggleSelector.textContent())?.includes('展开')) {
			await toggleSelector.click();
		}

		// All elements should be present
		await expect(newestMessage.locator('h2').first()).toBeVisible();
		await expect(newestMessage.locator('ul').first()).toBeVisible();
		await expect(newestMessage.locator('li').first()).toBeVisible();
		await expect(newestMessage.locator('code').first()).toBeVisible();
		await expect(newestMessage.locator('table').first()).toBeVisible();
		await expect(newestMessage.locator('blockquote').first()).toBeVisible();
	});

	test('renders forwarded message card with dense markdown styling', async ({ page }) => {
		await loginAsFixtureUser(page);

		// Forward a message with code to another room
		await page.getByTestId('message-action-forward-ops-004').click();
		const forwardDialog = page.getByTestId('forward-dialog');
		await expect(forwardDialog).toBeVisible();

		await page.getByTestId('forward-search').fill('platform');
		await page.getByTestId('forward-room-platform-duty').click();
		await page.getByTestId('forward-note').fill('确认转发里的代码块样式。');
		await page.getByTestId('forward-submit').click();

		await expect(page.getByTestId('forward-toast')).toContainText('已转发到');
		await page.keyboard.press('Enter');
		await waitForRoomLoadingToFinish(page);

		// Find the forwarded message
		const newestMessage = page.locator('article[data-message-id]').last();
		await expect(newestMessage).toContainText('确认转发里的代码块样式。');

		const forwardedCard = newestMessage.getByTestId('forwarded-message-card');
		await expect(forwardedCard).toBeVisible();

		// The card should contain the original message's code block
		await expect(forwardedCard).toContainText('snapshot');
	});

	test('keeps markdown link hover feedback consistent with timeline styling', async ({ page }) => {
		await loginAsFixtureUser(page);
		await openRoom(page, 'delivery-room');

		// delivery-003 has a markdown link
		const link = page.getByRole('link', { name: '交付手册' });
		await expect(link).toBeVisible();

		const beforeColor = await readComputedStyle(link, 'color');
		await link.hover();

		await expect
			.poll(async () => readComputedStyle(link, 'color'))
			.not.toBe(beforeColor);
	});
});
