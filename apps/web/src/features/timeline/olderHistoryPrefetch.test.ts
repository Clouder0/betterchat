import { describe, expect, it } from 'bun:test';

import {
	resolveOlderHistoryPrefetchThreshold,
	resolveOlderHistoryReadyLoadThreshold,
	shouldLoadOlderHistory,
	shouldPrefetchOlderHistory,
} from './olderHistoryPrefetch';

describe('olderHistoryPrefetch', () => {
	it('prefetches within an upper top band before the hard load threshold', () => {
		expect(
			shouldPrefetchOlderHistory({
				hasOlderHistory: true,
				isLoadingOlderHistory: false,
				loadThresholdPx: 72,
				prefetchPending: false,
				scrollingUp: true,
				scrollTop: 180,
				viewportHeight: 560,
			}),
		).toBe(true);
	});

	it('does not prefetch once the viewport has already reached the hard load threshold', () => {
		expect(
			shouldPrefetchOlderHistory({
				hasOlderHistory: true,
				isLoadingOlderHistory: false,
				loadThresholdPx: 72,
				prefetchPending: false,
				scrollingUp: true,
				scrollTop: 64,
				viewportHeight: 560,
			}),
		).toBe(false);
	});

	it('stays quiet when loading or a prior prefetch is already pending', () => {
		expect(
			shouldPrefetchOlderHistory({
				hasOlderHistory: true,
				isLoadingOlderHistory: true,
				loadThresholdPx: 72,
				prefetchPending: false,
				scrollingUp: true,
				scrollTop: 160,
				viewportHeight: 560,
			}),
		).toBe(false);
		expect(
			shouldPrefetchOlderHistory({
				hasOlderHistory: true,
				isLoadingOlderHistory: false,
				loadThresholdPx: 72,
				prefetchPending: true,
				scrollingUp: true,
				scrollTop: 160,
				viewportHeight: 560,
			}),
		).toBe(false);
	});

	it('does not prefetch when the viewport is moving downward or merely settling after a restore', () => {
		expect(
			shouldPrefetchOlderHistory({
				hasOlderHistory: true,
				isLoadingOlderHistory: false,
				loadThresholdPx: 72,
				prefetchPending: false,
				scrollingUp: false,
				scrollTop: 160,
				viewportHeight: 560,
			}),
		).toBe(false);
	});

	it('caps the prefetch band so taller viewports do not eagerly preload far too early', () => {
		expect(
			resolveOlderHistoryPrefetchThreshold({
				loadThresholdPx: 72,
				viewportHeight: 1200,
			}),
		).toBe(320);
	});

	it('reveals a ready prefetched page before the hard top threshold, but not as early as the prefetch band', () => {
		expect(
			resolveOlderHistoryReadyLoadThreshold({
				loadThresholdPx: 72,
				viewportHeight: 560,
			}),
		).toBeGreaterThan(72);
		expect(
			resolveOlderHistoryReadyLoadThreshold({
				loadThresholdPx: 72,
				viewportHeight: 560,
			}),
		).toBeLessThan(resolveOlderHistoryPrefetchThreshold({ loadThresholdPx: 72, viewportHeight: 560 }));
	});

	it('loads older history only for deliberate upward travel into the hard top threshold', () => {
		expect(
			shouldLoadOlderHistory({
				hasOlderHistory: true,
				isLoadingOlderHistory: false,
				loadInFlight: false,
				loadThresholdPx: 72,
				prefetchedPageReady: false,
				programmaticScrollActive: false,
				scrollingUp: true,
				scrollTop: 48,
				viewportHeight: 560,
			}),
		).toBe(true);

		expect(
			shouldLoadOlderHistory({
				hasOlderHistory: true,
				isLoadingOlderHistory: false,
				loadInFlight: false,
				loadThresholdPx: 72,
				prefetchedPageReady: false,
				programmaticScrollActive: true,
				scrollingUp: true,
				scrollTop: 48,
				viewportHeight: 560,
			}),
		).toBe(false);

		expect(
			shouldLoadOlderHistory({
				hasOlderHistory: true,
				isLoadingOlderHistory: false,
				loadInFlight: false,
				loadThresholdPx: 72,
				prefetchedPageReady: false,
				programmaticScrollActive: false,
				scrollingUp: false,
				scrollTop: 48,
				viewportHeight: 560,
			}),
		).toBe(false);
	});

	it('loads a ready prefetched page before reaching the hard top threshold', () => {
		expect(
			shouldLoadOlderHistory({
				hasOlderHistory: true,
				isLoadingOlderHistory: false,
				loadInFlight: false,
				loadThresholdPx: 72,
				prefetchedPageReady: true,
				programmaticScrollActive: false,
				scrollingUp: true,
				scrollTop: 132,
				viewportHeight: 560,
			}),
		).toBe(true);

		expect(
			shouldLoadOlderHistory({
				hasOlderHistory: true,
				isLoadingOlderHistory: false,
				loadInFlight: false,
				loadThresholdPx: 72,
				prefetchedPageReady: false,
				programmaticScrollActive: false,
				scrollingUp: true,
				scrollTop: 132,
				viewportHeight: 560,
			}),
		).toBe(false);
	});
});
