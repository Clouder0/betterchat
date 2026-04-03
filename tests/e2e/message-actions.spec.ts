import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import {
	loginAsFixtureUser,
	scrollTimelineToBottom,
	waitForRoomLoadingToFinish,
} from './test-helpers';

const isApiMode = (process.env.BETTERCHAT_E2E_API_MODE ?? 'fixture').toLowerCase() === 'api';

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

const selectContextMenuAction = async (page: Page, actionTestId: string) => {
	const contextMenu = page.getByTestId('timeline-message-context-menu');
	await expect(contextMenu).toBeVisible();

	// Use keyboard navigation: Tab through menu items and press Enter on the target
	const targetItem = contextMenu.getByTestId(actionTestId);
	await targetItem.focus();
	await page.keyboard.press('Enter');
};

test.describe('message edit and delete', () => {
	test.skip(isApiMode, 'fixture-only suite');

	test('shows edit and delete options in context menu for own messages', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		// ops-006 is authored by linche (the logged-in user)
		const ownMessage = page.getByTestId('timeline-message-ops-006');
		await openMessageContextMenu(ownMessage);

		const contextMenu = page.getByTestId('timeline-message-context-menu');
		await expect(contextMenu).toBeVisible();
		await expect(contextMenu.getByTestId('message-context-action-edit')).toBeVisible();
		await expect(contextMenu.getByTestId('message-context-action-delete')).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(contextMenu).toHaveCount(0);
	});

	test('does not show edit and delete options for other users messages', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		// ops-005 is authored by 顾宁 (not the logged-in user)
		const otherMessage = page.getByTestId('timeline-message-ops-005');
		await openMessageContextMenu(otherMessage);

		const contextMenu = page.getByTestId('timeline-message-context-menu');
		await expect(contextMenu).toBeVisible();
		await expect(contextMenu.getByTestId('message-context-action-edit')).toHaveCount(0);
		await expect(contextMenu.getByTestId('message-context-action-delete')).toHaveCount(0);

		await page.keyboard.press('Escape');
	});

	test('edits own message via context menu and shows edited label', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const ownMessage = page.getByTestId('timeline-message-ops-006');
		await openMessageContextMenu(ownMessage);
		await selectContextMenuAction(page, 'message-context-action-edit');

		// Verify edit banner appears
		const editContext = page.getByTestId('composer-edit-context');
		await expect(editContext).toBeVisible({ timeout: 8000 });
		await expect(editContext).toContainText('编辑消息');

		// Verify composer is pre-filled
		const rawValue = page.getByTestId('composer-raw-value');
		await expect(rawValue).not.toHaveValue('');

		// Modify text and submit
		const composer = page.getByTestId('composer-textarea');
		await composer.fill('编辑后的消息内容');
		await page.getByTestId('composer-send').click();

		// Verify edit banner disappears
		await expect(editContext).toHaveCount(0, { timeout: 5000 });

		// Verify message shows "(已编辑)" label in the content area
		await expect(ownMessage).toContainText('(已编辑)', { timeout: 5000 });
	});

	test('cancels edit via cancel button', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const ownMessage = page.getByTestId('timeline-message-ops-006');
		await openMessageContextMenu(ownMessage);
		await selectContextMenuAction(page, 'message-context-action-edit');

		const editContext = page.getByTestId('composer-edit-context');
		await expect(editContext).toBeVisible({ timeout: 8000 });

		// Click cancel
		await page.getByTestId('composer-edit-cancel').click();
		await expect(editContext).toHaveCount(0);
	});

	test('deletes own message via context menu with confirmation', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const ownMessage = page.getByTestId('timeline-message-ops-006');
		await openMessageContextMenu(ownMessage);
		await selectContextMenuAction(page, 'message-context-action-delete');

		// Verify confirmation dialog
		const deleteDialog = page.getByTestId('delete-message-dialog');
		await expect(deleteDialog).toBeVisible({ timeout: 8000 });
		await expect(deleteDialog).toContainText('确定删除该消息');

		// Confirm
		await page.getByTestId('delete-message-confirm').click();

		// Verify dialog closes and message shows deleted state
		await expect(deleteDialog).toHaveCount(0, { timeout: 5000 });
		await expect(ownMessage).toContainText('该消息已删除。', { timeout: 5000 });
	});

	test('deleted message has no reply or forward action buttons', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const ownMessage = page.getByTestId('timeline-message-ops-006');
		await openMessageContextMenu(ownMessage);
		await selectContextMenuAction(page, 'message-context-action-delete');

		const deleteDialog = page.getByTestId('delete-message-dialog');
		await expect(deleteDialog).toBeVisible({ timeout: 8000 });
		await page.getByTestId('delete-message-confirm').click();
		await expect(deleteDialog).toHaveCount(0, { timeout: 5000 });
		await expect(ownMessage).toContainText('该消息已删除。', { timeout: 5000 });

		// Hover over deleted message — action buttons should not be present
		await ownMessage.hover();
		await expect(page.getByTestId(`message-actions-ops-006`)).toHaveCount(0);
	});

	test('deleted message has no context menu', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const ownMessage = page.getByTestId('timeline-message-ops-006');
		await openMessageContextMenu(ownMessage);
		await selectContextMenuAction(page, 'message-context-action-delete');

		const deleteDialog = page.getByTestId('delete-message-dialog');
		await expect(deleteDialog).toBeVisible({ timeout: 8000 });
		await page.getByTestId('delete-message-confirm').click();
		await expect(deleteDialog).toHaveCount(0, { timeout: 5000 });
		await expect(ownMessage).toContainText('该消息已删除。', { timeout: 5000 });

		// Try to open context menu on deleted message — should have no actionable items
		await openMessageContextMenu(ownMessage);
		const contextMenu = page.getByTestId('timeline-message-context-menu');
		await expect(contextMenu.getByTestId('message-context-action-reply')).toHaveCount(0);
		await expect(contextMenu.getByTestId('message-context-action-forward')).toHaveCount(0);
		await expect(contextMenu.getByTestId('message-context-action-edit')).toHaveCount(0);
		await expect(contextMenu.getByTestId('message-context-action-delete')).toHaveCount(0);
		await expect(contextMenu.getByTestId('message-context-action-copy-text')).toHaveCount(0);
		await expect(contextMenu.getByTestId('message-context-action-copy-markdown')).toHaveCount(0);
	});

	test('cancels delete via cancel button in confirmation dialog', async ({ page }) => {
		await loginAsFixtureUser(page);
		await waitForRoomLoadingToFinish(page);
		await scrollTimelineToBottom(page);

		const ownMessage = page.getByTestId('timeline-message-ops-006');
		await openMessageContextMenu(ownMessage);
		await selectContextMenuAction(page, 'message-context-action-delete');

		const deleteDialog = page.getByTestId('delete-message-dialog');
		await expect(deleteDialog).toBeVisible({ timeout: 8000 });

		// Cancel
		await page.getByTestId('delete-message-cancel').click();
		await expect(deleteDialog).toHaveCount(0);

		// Message should still be there
		await expect(ownMessage).not.toContainText('该消息已删除。');
	});
});
