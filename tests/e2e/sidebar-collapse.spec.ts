import { expect, test } from '@playwright/test';

import {
	collapseSidebar,
	expandSidebar,
	isSidebarCollapsed,
	loginAsFixtureUser,
	readSidebarShellState,
	waitForRoomLoadingToFinish,
	waitForSidebarCollapsedSettle,
	waitForSidebarExpandedPreview,
	waitForSidebarPreviewState,
	waitForSidebarTransitionEnd,
} from './test-helpers';

const commandOrControl = process.platform === 'darwin' ? 'Meta' : 'Control';
const isApiMode = (process.env.BETTERCHAT_E2E_API_MODE ?? 'fixture').toLowerCase() === 'api';

test.skip(isApiMode, 'fixture-only suite');

test.describe('sidebar collapse', () => {
	test('toggles sidebar visibility with keyboard shortcut', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		const sidebar = page.getByTestId('app-sidebar');
		const beforeBox = await sidebar.boundingBox();
		expect(beforeBox).not.toBeNull();
		expect(beforeBox!.width).toBeGreaterThan(200);

		await collapseSidebar(page);
		expect(await isSidebarCollapsed(page)).toBe(true);

		await expandSidebar(page);
		expect(await isSidebarCollapsed(page)).toBe(false);

		const afterBox = await sidebar.boundingBox();
		expect(afterBox).not.toBeNull();
		expect(afterBox!.width).toBeGreaterThan(200);
		expect(Math.abs(afterBox!.width - beforeBox!.width)).toBeLessThan(16);
	});

	test('toggles sidebar visibility with double-click on resize rail', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		const resizeHandle = page.getByTestId('sidebar-resize-handle');
		const sidebar = page.getByTestId('app-sidebar');
		const beforeBox = await sidebar.boundingBox();
		expect(beforeBox).not.toBeNull();

		await resizeHandle.dblclick();
		await waitForSidebarTransitionEnd(page);
		expect(await isSidebarCollapsed(page)).toBe(true);

		await resizeHandle.dblclick();
		await waitForSidebarTransitionEnd(page);
		expect(await isSidebarCollapsed(page)).toBe(false);

		const afterBox = await sidebar.boundingBox();
		expect(afterBox).not.toBeNull();
		expect(afterBox!.width).toBeGreaterThan(200);
	});

	test('persists collapse state across page reloads', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		const sidebar = page.getByTestId('app-sidebar');
		const widthBeforeCollapse = (await sidebar.boundingBox())!.width;

		await collapseSidebar(page);
		expect(await isSidebarCollapsed(page)).toBe(true);

		await page.reload();
		await waitForRoomLoadingToFinish(page);
		expect(await isSidebarCollapsed(page)).toBe(true);

		await expandSidebar(page);
		expect(await isSidebarCollapsed(page)).toBe(false);

		await page.reload();
		await waitForRoomLoadingToFinish(page);
		expect(await isSidebarCollapsed(page)).toBe(false);

		const widthAfterExpand = (await page.getByTestId('app-sidebar').boundingBox())!.width;
		expect(Math.abs(widthAfterExpand - widthBeforeCollapse)).toBeLessThan(16);
	});

	test('moves focus to timeline when collapsing with sidebar focused', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();

		await collapseSidebar(page);
		expect(await isSidebarCollapsed(page)).toBe(true);
		await expect(page.locator('article[data-message-id][data-keyboard-focused="true"]')).toBeFocused();
	});

	test('auto-expands sidebar on Alt+1 when collapsed', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		await collapseSidebar(page);
		expect(await isSidebarCollapsed(page)).toBe(true);

		await page.keyboard.press('Alt+1');
		await waitForSidebarTransitionEnd(page);
		expect(await isSidebarCollapsed(page)).toBe(false);
		await expect(page.getByTestId('sidebar-room-ops-handoff')).toBeFocused();
	});

	test('auto-expands sidebar on Cmd/Ctrl+K when collapsed', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		await collapseSidebar(page);
		expect(await isSidebarCollapsed(page)).toBe(true);

		await page.keyboard.press(`${commandOrControl}+k`);
		await waitForSidebarTransitionEnd(page);
		expect(await isSidebarCollapsed(page)).toBe(false);
		await expect(page.getByTestId('sidebar-search')).toBeFocused();
	});

	test('keeps resize rail visible when sidebar is collapsed', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		await collapseSidebar(page);
		expect(await isSidebarCollapsed(page)).toBe(true);

		const resizeHandle = page.getByTestId('sidebar-resize-handle');
		await expect(resizeHandle).toBeVisible();
		const handleBox = await resizeHandle.boundingBox();
		expect(handleBox).not.toBeNull();
		expect(handleBox!.width).toBeGreaterThan(0);
	});

	test('collapses sidebar by dragging resize rail past snap threshold', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		const sidebar = page.getByTestId('app-sidebar');
		const resizeHandle = page.getByTestId('sidebar-resize-handle');
		const handleBox = await resizeHandle.boundingBox();
		expect(handleBox).not.toBeNull();
		const sidebarBox = await sidebar.boundingBox();
		expect(sidebarBox).not.toBeNull();
		const handleCenterX = handleBox!.x + handleBox!.width / 2;
		const handleCenterY = handleBox!.y + handleBox!.height / 2;
		const intermediateCloseX = handleCenterX - (sidebarBox!.width - 160);

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

	test('expands sidebar by dragging resize rail right from collapsed state', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);

		await collapseSidebar(page);
		expect(await isSidebarCollapsed(page)).toBe(true);

		const resizeHandle = page.getByTestId('sidebar-resize-handle');
		const handleBox = await resizeHandle.boundingBox();
		expect(handleBox).not.toBeNull();
		const handleCenterX = handleBox!.x + handleBox!.width / 2;
		const handleCenterY = handleBox!.y + handleBox!.height / 2;
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
		await page.mouse.move(handleBox!.x + 300, handleCenterY, { steps: 12 });

		await waitForSidebarExpandedPreview(page);
		await page.mouse.move(20, handleCenterY, { steps: 12 });
		await waitForSidebarPreviewState(page, {
			collapsed: true,
			maxWidth: 104,
			minWidth: 0,
			searchVisible: false,
		});
		await page.mouse.move(handleBox!.x + 300, handleCenterY, { steps: 12 });
		await waitForSidebarExpandedPreview(page);

		await page.mouse.up();

		expect(await isSidebarCollapsed(page)).toBe(false);
		const sidebar = page.getByTestId('app-sidebar');
		const sidebarBox = await sidebar.boundingBox();
		expect(sidebarBox).not.toBeNull();
		expect(sidebarBox!.width).toBeGreaterThan(200);
	});

	test('expands the collapsed sidebar on single click and reveals sidebar content', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 980 });
		await loginAsFixtureUser(page);
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
});
