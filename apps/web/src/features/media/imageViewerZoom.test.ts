import { describe, expect, it } from 'bun:test';

import {
	formatImageViewerZoomPercent,
	normalizeImageViewerWheelZoomDelta,
	normalizeImageViewerWheelNavigationDelta,
	resolveImageViewerWheelNavigationDirection,
	resolveImageViewerWheelZoomFactor,
} from './imageViewerZoom';

describe('imageViewerZoom', () => {
	it('normalizes ctrl-wheel zoom deltas across delta modes', () => {
		expect(
			normalizeImageViewerWheelZoomDelta({
				deltaMode: 0,
				deltaY: -100,
			}),
		).toBeGreaterThan(0.2);

		expect(
			normalizeImageViewerWheelZoomDelta({
				deltaMode: 1,
				deltaY: -3,
			}),
		).toBeGreaterThan(0.14);
	});

	it('clamps wheel zoom intensity so tiny deltas stay responsive and large bursts stay controlled', () => {
		expect(resolveImageViewerWheelZoomFactor(0.004)).toBeGreaterThan(1.01);
		expect(resolveImageViewerWheelZoomFactor(0.4)).toBeLessThan(1.2);
		expect(resolveImageViewerWheelZoomFactor(-0.4)).toBeGreaterThan(0.84);
	});

	it('normalizes wheel navigation using the dominant axis and current delta mode', () => {
		expect(
			normalizeImageViewerWheelNavigationDelta({
				deltaMode: 0,
				deltaX: 18,
				deltaY: 72,
			}),
		).toBe(72);

		expect(
			normalizeImageViewerWheelNavigationDelta({
				deltaMode: 1,
				deltaX: -4,
				deltaY: 1,
			}),
		).toBe(-72);

		expect(
			normalizeImageViewerWheelNavigationDelta({
				deltaMode: 2,
				deltaX: 0,
				deltaY: -1,
			}),
		).toBe(-120);
	});

	it('resolves previous/next navigation only after the wheel threshold is crossed', () => {
		expect(resolveImageViewerWheelNavigationDirection(40)).toBeNull();
		expect(resolveImageViewerWheelNavigationDirection(-40)).toBeNull();
		expect(resolveImageViewerWheelNavigationDirection(72)).toBe('next');
		expect(resolveImageViewerWheelNavigationDirection(-72)).toBe('prev');
	});

	it('formats zoom percentages relative to the fit zoom level', () => {
		expect(
			formatImageViewerZoomPercent({
				currZoomLevel: 1,
				initialZoomLevel: 1,
			}),
		).toBe('100%');

		expect(
			formatImageViewerZoomPercent({
				currZoomLevel: 1.25,
				initialZoomLevel: 1,
			}),
		).toBe('125%');

		expect(
			formatImageViewerZoomPercent({
				currZoomLevel: 0.875,
				initialZoomLevel: 0.7,
			}),
		).toBe('125%');
	});
});
