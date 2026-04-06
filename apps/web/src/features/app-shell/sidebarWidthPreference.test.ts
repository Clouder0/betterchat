import { describe, expect, it } from 'bun:test';

import {
	clampSidebarPreviewWidth,
	clampSidebarWidth,
	formatSidebarWidthCssValue,
	resolveSidebarPreviewWidth,
	resolveSidebarResizeWidth,
	resolveSidebarWidthBounds,
} from './sidebarWidthPreference';

describe('sidebarWidthPreference', () => {
	it('clamps dragged widths inside the current bounds', () => {
		const bounds = { min: 248, max: 420 };

		expect(
			resolveSidebarResizeWidth({
				bounds,
				currentX: 360,
				startWidth: 292,
				startX: 300,
			}),
		).toBe(352);
		expect(
			resolveSidebarResizeWidth({
				bounds,
				currentX: 120,
				startWidth: 292,
				startX: 300,
			}),
		).toBe(248);
		expect(
			resolveSidebarResizeWidth({
				bounds,
				currentX: 560,
				startWidth: 292,
				startX: 300,
			}),
		).toBe(420);
	});

	it('allows continuous preview widths between zero and the settled minimum while dragging', () => {
		expect(
			resolveSidebarPreviewWidth({
				currentX: 168,
				max: 420,
				startWidth: 292,
				startX: 300,
			}),
		).toBe(160);
		expect(
			resolveSidebarPreviewWidth({
				currentX: 20,
				max: 420,
				startWidth: 0,
				startX: 0,
			}),
		).toBe(20);
		expect(clampSidebarPreviewWidth(-32, 420)).toBe(0);
		expect(clampSidebarPreviewWidth(999, 420)).toBe(420);
	});

	it('formats sidebar widths as pixel CSS values', () => {
		expect(formatSidebarWidthCssValue(292)).toBe('292px');
		expect(formatSidebarWidthCssValue(292.4)).toBe('292px');
		expect(formatSidebarWidthCssValue(292.6)).toBe('293px');
	});

	it('reduces the maximum width when the inline room info sidebar is open', () => {
		const closedBounds = resolveSidebarWidthBounds({
			infoSidebarOpen: false,
			viewportWidth: 1440,
		});
		const openBounds = resolveSidebarWidthBounds({
			infoSidebarOpen: true,
			viewportWidth: 1440,
		});

		expect(openBounds.max).toBeLessThan(closedBounds.max);
		expect(clampSidebarWidth(999, openBounds)).toBe(openBounds.max);
	});

	it('allows a meaningfully wider sidebar on desktop before the cap kicks in', () => {
		const wideDesktopBounds = resolveSidebarWidthBounds({
			infoSidebarOpen: false,
			viewportWidth: 1440,
		});
		const mediumDesktopBounds = resolveSidebarWidthBounds({
			infoSidebarOpen: false,
			viewportWidth: 1100,
		});

		expect(wideDesktopBounds).toEqual({
			min: 248,
			max: 560,
		});
		expect(mediumDesktopBounds.max).toBe(484);
		expect(mediumDesktopBounds.max).toBeGreaterThan(420);
	});
});
