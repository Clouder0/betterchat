import { expect, test } from '@playwright/test';

import { loginAsFixtureUser } from './test-helpers';

const isApiMode = (process.env.BETTERCHAT_E2E_API_MODE ?? 'fixture').toLowerCase() === 'api';

test.skip(isApiMode, 'fixture-only suite');

const dispatchViewerWheel = async (
	target: import('@playwright/test').Locator,
	{
		ctrlKey = false,
		deltaX = 0,
		deltaY,
	}: {
		ctrlKey?: boolean;
		deltaX?: number;
		deltaY: number;
	},
) => {
	const box = await target.boundingBox();
	expect(box).not.toBeNull();
	if (!box) {
		throw new Error('viewer target bounds were unavailable');
	}

	await target.evaluate(
		(node, payload) => {
			node.dispatchEvent(
				new WheelEvent('wheel', {
					bubbles: true,
					cancelable: true,
					clientX: payload.clientX,
					clientY: payload.clientY,
					ctrlKey: payload.ctrlKey,
					deltaMode: 0,
					deltaX: payload.deltaX,
					deltaY: payload.deltaY,
				}),
			);
		},
		{
			clientX: box.x + box.width / 2,
			clientY: box.y + box.height / 2,
			ctrlKey,
			deltaX,
			deltaY,
		},
	);
};

test.describe('image viewer', () => {
	test('opens markdown images with visible controls and non-looping navigation', async ({ page }) => {
		await loginAsFixtureUser(page);
		await page.getByTestId('timeline-message-toggle-ops-005').click();

		const attachmentImage = page.getByTestId('timeline-image-ops-005-image');
		const attachmentBox = await attachmentImage.boundingBox();
		expect(attachmentBox).not.toBeNull();
		if (!attachmentBox) {
			throw new Error('attachment image bounds were unavailable');
		}
		expect(attachmentBox.width).toBeGreaterThan(240);
		expect(attachmentBox.width).toBeLessThan(900);
		expect(attachmentBox.height).toBeGreaterThan(120);
		expect(attachmentBox.height).toBeLessThan(760);

		const markdownImageTrigger = page.getByRole('button', { name: '查看图片：兼容流程示意图' });
		await markdownImageTrigger.click();

		const viewer = page.locator('.pswp.pswp--open');
		await expect(viewer).toBeVisible();
		const counter = page.getByTestId('image-viewer-counter');
		const prevButton = page.getByTestId('image-viewer-prev');
		const nextButton = page.getByTestId('image-viewer-next');
		const closeButton = page.getByTestId('image-viewer-close');
		await expect(counter).toHaveText(/1\s*\/\s*2/);
		await expect(closeButton).toBeVisible();
		await expect(prevButton).toBeVisible();
		await expect(nextButton).toBeVisible();
		await expect(prevButton).toBeDisabled();
		await expect(nextButton).toBeEnabled();

		const dockBox = await counter.boundingBox();
		const imageBox = await viewer.getByRole('img', { name: '兼容流程示意图' }).boundingBox();
		expect(dockBox).not.toBeNull();
		expect(imageBox).not.toBeNull();
		if (!dockBox || !imageBox) {
			throw new Error('viewer dock or image bounds were unavailable');
		}
		expect(dockBox.y).toBeGreaterThan(imageBox.y + imageBox.height - 8);

		await nextButton.click();
		await expect(counter).toHaveText(/2\s*\/\s*2/);
		await expect(nextButton).toBeDisabled();
		await expect(prevButton).toBeEnabled();
		await closeButton.click();
		await expect(viewer).toHaveCount(0);
	});

	test('opens attachment images directly from the timeline', async ({ page }) => {
		await loginAsFixtureUser(page);
		await page.getByTestId('timeline-message-toggle-ops-005').click();

		await page.getByTestId('timeline-image-ops-005-image').click();
		await expect(page.locator('.pswp.pswp--open')).toBeVisible();
		await expect(page.getByTestId('image-viewer-counter')).toHaveText(/2\s*\/\s*2/);
	});

	test('reopens attachment images with the full source aspect after collapsing and re-expanding a long image message', async ({ page }) => {
		await loginAsFixtureUser(page);

		const previewImage = page.getByTestId('timeline-image-ops-005-image');
		const previewBox = await previewImage.boundingBox();
		expect(previewBox).not.toBeNull();
		if (!previewBox) {
			throw new Error('attachment preview bounds were unavailable');
		}
		expect(previewBox.width / previewBox.height).toBeLessThan(1.1);

		await previewImage.evaluate((node) => {
			(node as HTMLImageElement).click();
		});

		const viewer = page.locator('.pswp.pswp--open');
		const viewerImage = viewer.getByRole('img', { name: '交接结构图' });
		await expect(viewer).toBeVisible();
		await expect(viewerImage).toBeVisible();

		const initialOpenBox = await viewerImage.boundingBox();
		expect(initialOpenBox).not.toBeNull();
		if (!initialOpenBox) {
			throw new Error('viewer image bounds were unavailable on first open');
		}
		expect(initialOpenBox.width / initialOpenBox.height).toBeGreaterThan(1.45);

		await page.getByTestId('image-viewer-close').click();
		await expect(viewer).toHaveCount(0);

		const toggle = page.getByTestId('timeline-message-toggle-ops-005');
		await toggle.click();
		await expect(toggle).toContainText('收起');
		await toggle.click();
		await expect(toggle).toContainText('展开全文');
		await toggle.click();
		await expect(toggle).toContainText('收起');

		await page.getByTestId('timeline-image-ops-005-image').evaluate((node) => {
			(node as HTMLImageElement).click();
		});
		await expect(viewer).toBeVisible();
		await expect(viewerImage).toBeVisible();

		const reopenedBox = await viewerImage.boundingBox();
		expect(reopenedBox).not.toBeNull();
		if (!reopenedBox) {
			throw new Error('viewer image bounds were unavailable on reopen');
		}
		expect(reopenedBox.width / reopenedBox.height).toBeGreaterThan(1.45);

		await page.waitForTimeout(450);

		const settledBox = await viewerImage.boundingBox();
		expect(settledBox).not.toBeNull();
		if (!settledBox) {
			throw new Error('viewer image bounds were unavailable after settling');
		}

		expect(Math.abs(reopenedBox.width - settledBox.width)).toBeLessThanOrEqual(2);
		expect(Math.abs(reopenedBox.height - settledBox.height)).toBeLessThanOrEqual(2);
		expect(Math.abs(reopenedBox.x - settledBox.x)).toBeLessThanOrEqual(2);
		expect(Math.abs(reopenedBox.y - settledBox.y)).toBeLessThanOrEqual(2);
	});

	test('uses plain wheel for previous/next image and reserves ctrl-wheel for zooming', async ({ page }) => {
		await loginAsFixtureUser(page);
		await page.getByTestId('timeline-message-toggle-ops-005').click();
		await page.getByRole('button', { name: '查看图片：兼容流程示意图' }).click();

		const viewer = page.locator('.pswp.pswp--open');
		const counter = page.getByTestId('image-viewer-counter');
		const zoomLevel = page.getByTestId('image-viewer-zoom-level');

		await expect(viewer).toBeVisible();
		await expect(counter).toHaveText(/1\s*\/\s*2/);
		await expect(zoomLevel).toHaveText('100%');

		await dispatchViewerWheel(viewer, {
			deltaY: 120,
		});
		await expect(counter).toHaveText(/2\s*\/\s*2/);
		await expect(zoomLevel).toHaveText('100%');

		await dispatchViewerWheel(viewer, {
			deltaY: -120,
		});
		await expect(counter).toHaveText(/1\s*\/\s*2/);
		await expect(zoomLevel).toHaveText('100%');

		await dispatchViewerWheel(viewer, {
			ctrlKey: true,
			deltaY: -180,
		});
		await expect(counter).toHaveText(/1\s*\/\s*2/);
		await expect(zoomLevel).not.toHaveText('100%');
		await expect(viewer).toBeVisible();
	});

	test('keeps the viewer open when clicking the image itself and closes when clicking the background', async ({ page }) => {
		await loginAsFixtureUser(page);
		await page.getByTestId('timeline-message-toggle-ops-005').click();

		await page.getByRole('button', { name: '查看图片：兼容流程示意图' }).click();

		const viewer = page.locator('.pswp.pswp--open');
		await expect(viewer).toBeVisible();

		const image = viewer.getByRole('img', { name: '兼容流程示意图' });
		await expect(image).toBeVisible();
		await expect(image).toHaveCSS('cursor', 'grab');

		const imageBox = await image.boundingBox();
		expect(imageBox).not.toBeNull();
		if (!imageBox) {
			throw new Error('viewer image bounds were unavailable');
		}

		await page.mouse.click(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
		await expect(viewer).toBeVisible();

		const backgroundPoint = {
			x: imageBox.x - 28,
			y: imageBox.y + imageBox.height / 2,
		};
		expect(backgroundPoint.x).toBeGreaterThan(24);

		await page.mouse.click(backgroundPoint.x, backgroundPoint.y);
		await expect(viewer).toHaveCount(0);
	});

	test('closes when clicking empty backdrop space near the bottom edge of the viewer', async ({ page }) => {
		await loginAsFixtureUser(page);
		await page.getByTestId('timeline-message-toggle-ops-005').click();
		await page.getByRole('button', { name: '查看图片：兼容流程示意图' }).click();

		const viewer = page.locator('.pswp.pswp--open');
		const image = viewer.getByRole('img', { name: '兼容流程示意图' });
		const prevButton = page.getByTestId('image-viewer-prev');
		const closeButton = page.getByTestId('image-viewer-close');
		await expect(viewer).toBeVisible();
		await expect(image).toBeVisible();
		await expect(prevButton).toBeVisible();
		await expect(closeButton).toBeVisible();

		const bottomBackdropPoint = await page.evaluate(() => {
			const viewer = document.querySelector<HTMLElement>('.pswp.pswp--open');
			const image = document.querySelector<HTMLElement>('.pswp.pswp--open .pswp__img');
			const prevButton = document.querySelector<HTMLElement>('[data-testid="image-viewer-prev"]');
			const closeButton = document.querySelector<HTMLElement>('[data-testid="image-viewer-close"]');
			if (!viewer || !image || !prevButton || !closeButton) {
				return null;
			}

			const viewerRect = viewer.getBoundingClientRect();
			const imageRect = image.getBoundingClientRect();
			const prevRect = prevButton.getBoundingClientRect();
			const closeRect = closeButton.getBoundingClientRect();

			const candidates = [
				{ x: viewerRect.left + 28, y: prevRect.top + prevRect.height / 2 },
				{ x: viewerRect.right - 28, y: closeRect.top + closeRect.height / 2 },
				{ x: viewerRect.left + 28, y: viewerRect.bottom - 28 },
				{ x: viewerRect.right - 28, y: viewerRect.bottom - 28 },
			];

			const isOutsideRect = (point: { x: number; y: number }, rect: DOMRect) =>
				point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom;

			for (const point of candidates) {
				if (
					point.x <= viewerRect.left + 4 ||
					point.x >= viewerRect.right - 4 ||
					point.y <= viewerRect.top + 4 ||
					point.y >= viewerRect.bottom - 4
				) {
					continue;
				}

				if (!isOutsideRect(point, imageRect)) {
					continue;
				}

				if (!isOutsideRect(point, prevRect) || !isOutsideRect(point, closeRect)) {
					continue;
				}

				const target = document.elementFromPoint(point.x, point.y);
				if (!target) {
					continue;
				}

				return point;
			}

			return null;
		});
		expect(bottomBackdropPoint).not.toBeNull();
		if (!bottomBackdropPoint) {
			throw new Error('no lower-backdrop click point was available');
		}

		await page.mouse.click(bottomBackdropPoint.x, bottomBackdropPoint.y);
		await expect(viewer).toHaveCount(0);
	});

	test('does not open the image viewer when clicking timeline blank space beside an image', async ({ page }) => {
		await loginAsFixtureUser(page);
		await page.getByTestId('timeline-message-toggle-ops-005').click();

		const imageTrigger = page.getByTestId('timeline-image-ops-005-image');
		const messageBody = page.getByTestId('timeline-message-body-ops-005');
		const triggerBox = await imageTrigger.boundingBox();
		const imageBox = await imageTrigger.boundingBox();
		const messageBodyBox = await messageBody.boundingBox();
		expect(triggerBox).not.toBeNull();
		expect(imageBox).not.toBeNull();
		expect(messageBodyBox).not.toBeNull();
		if (!triggerBox || !imageBox || !messageBodyBox) {
			throw new Error('image trigger, image, or message body bounds were unavailable');
		}

		expect(Math.abs(triggerBox.width - imageBox.width)).toBeLessThan(1.5);
		expect(Math.abs(triggerBox.height - imageBox.height)).toBeLessThan(1.5);

		const candidatePoints = [
			{ x: triggerBox.x + triggerBox.width + 18, y: triggerBox.y + Math.min(triggerBox.height / 2, 48) },
			{ x: triggerBox.x + Math.min(triggerBox.width / 2, 48), y: triggerBox.y + triggerBox.height + 18 },
			{ x: triggerBox.x - 18, y: triggerBox.y + Math.min(triggerBox.height / 2, 48) },
			{ x: triggerBox.x + Math.min(triggerBox.width / 2, 48), y: triggerBox.y - 18 },
		];
		const blankPoint =
			candidatePoints.find(
				(point) =>
					point.x > messageBodyBox.x + 6 &&
					point.x < messageBodyBox.x + messageBodyBox.width - 6 &&
					point.y > messageBodyBox.y + 6 &&
					point.y < messageBodyBox.y + messageBodyBox.height - 6,
			) ?? null;
		expect(blankPoint).not.toBeNull();
		if (!blankPoint) {
			throw new Error('no message-body blank point was available');
		}

		await page.mouse.click(blankPoint.x, blankPoint.y);
		await expect(page.locator('.pswp.pswp--open')).toHaveCount(0);
	});
});
