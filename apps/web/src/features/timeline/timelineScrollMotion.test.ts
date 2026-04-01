import { describe, expect, it } from 'bun:test';

import {
	easeTimelineScrollProgress,
	resolveCenteredMessageScrollTop,
	resolveTimelineAnimatedScrollTop,
	resolveTimelineScrollDuration,
	shouldDeferTimelineViewportStateSync,
	shouldCancelTimelineScrollAnimation,
	shouldAnimateTimelineScroll,
} from './timelineScrollMotion';

describe('timelineScrollMotion', () => {
	it('keeps scroll durations fast while scaling for larger jumps', () => {
		expect(resolveTimelineScrollDuration(0)).toBe(96);
		expect(resolveTimelineScrollDuration(240)).toBeGreaterThan(96);
		expect(resolveTimelineScrollDuration(240)).toBeLessThan(resolveTimelineScrollDuration(960));
		expect(resolveTimelineScrollDuration(9_999)).toBe(184);
	});

	it('uses a fast ease-out curve without dragging the tail too long', () => {
		expect(easeTimelineScrollProgress(0)).toBe(0);
		expect(easeTimelineScrollProgress(1)).toBe(1);
		expect(easeTimelineScrollProgress(0.5)).toBeGreaterThan(0.5);
		expect(easeTimelineScrollProgress(0.5)).toBeLessThan(0.86);
		expect(
			resolveTimelineAnimatedScrollTop({
				from: 120,
				progress: 0.5,
				to: 520,
			}),
		).toBeGreaterThan(300);
	});

	it('centers a target while keeping a minimum top breathing room', () => {
		expect(
			resolveCenteredMessageScrollTop({
				containerHeight: 640,
				targetHeight: 84,
				targetTop: 720,
			}),
		).toBe(442);
		expect(
			resolveCenteredMessageScrollTop({
				containerHeight: 640,
				targetHeight: 620,
				targetTop: 720,
			}),
		).toBe(692);
	});

	it('disables animated motion for reduced-motion or tiny jumps', () => {
		expect(
			shouldAnimateTimelineScroll({
				behavior: 'smooth',
				distancePx: 72,
				reducedMotion: false,
			}),
		).toBe(true);
		expect(
			shouldAnimateTimelineScroll({
				behavior: 'smooth',
				distancePx: 4,
				reducedMotion: false,
			}),
		).toBe(false);
		expect(
			shouldAnimateTimelineScroll({
				behavior: 'smooth',
				distancePx: 72,
				reducedMotion: true,
			}),
		).toBe(false);
		expect(
			shouldAnimateTimelineScroll({
				behavior: 'auto',
				distancePx: 72,
				reducedMotion: false,
			}),
		).toBe(false);
	});

	it('cancels animated motion when an external scroll overrides the expected track', () => {
		expect(
			shouldCancelTimelineScrollAnimation({
				actualScrollTop: 320,
				animatedScrollActive: false,
				expectedScrollTop: 320,
				previousScrollTop: 320,
				targetScrollTop: 520,
			}),
		).toBe(false);

		expect(
			shouldCancelTimelineScrollAnimation({
				actualScrollTop: 321,
				animatedScrollActive: true,
				expectedScrollTop: 320,
				previousScrollTop: 320,
				targetScrollTop: 520,
			}),
		).toBe(false);

		expect(
			shouldCancelTimelineScrollAnimation({
				actualScrollTop: 356,
				animatedScrollActive: true,
				expectedScrollTop: 320,
				previousScrollTop: 320,
				targetScrollTop: 520,
			}),
		).toBe(true);
	});

	it('keeps the animation alive when scroll drift is still moving toward the same target', () => {
		expect(
			shouldCancelTimelineScrollAnimation({
				actualScrollTop: 684,
				animatedScrollActive: true,
				expectedScrollTop: 668,
				previousScrollTop: 668,
				targetScrollTop: 1_293,
			}),
		).toBe(false);

		expect(
			shouldCancelTimelineScrollAnimation({
				actualScrollTop: 652,
				animatedScrollActive: true,
				expectedScrollTop: 668,
				previousScrollTop: 668,
				targetScrollTop: 1_293,
			}),
		).toBe(true);
	});

	it('defers heavy viewport sync while a programmatic animated scroll is still in flight', () => {
		expect(
			shouldDeferTimelineViewportStateSync({
				animatedScrollActive: true,
				programmaticScrollActive: true,
			}),
		).toBe(true);

		expect(
			shouldDeferTimelineViewportStateSync({
				animatedScrollActive: false,
				programmaticScrollActive: true,
			}),
		).toBe(false);

		expect(
			shouldDeferTimelineViewportStateSync({
				animatedScrollActive: true,
				programmaticScrollActive: false,
			}),
		).toBe(false);
	});
});
