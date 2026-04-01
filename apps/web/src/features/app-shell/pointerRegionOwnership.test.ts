import { describe, expect, it } from 'bun:test';

import { shouldIgnorePointerRegionMove, shouldRefreshTimelinePointerEpoch } from './pointerRegionOwnership';

describe('pointerRegionOwnership', () => {
	it('ignores same-region pointer moves outside the timeline', () => {
		expect(
			shouldIgnorePointerRegionMove({
				eventType: 'pointermove',
				lastSidebarFocusEpoch: 4,
				lastTimelinePointerEpoch: 3,
				nextRegion: 'sidebar-list',
				previousRegion: 'sidebar-list',
			}),
		).toBe(true);
	});

	it('keeps same-region timeline moves ignorable while timeline pointer ownership is already fresh', () => {
		expect(
			shouldIgnorePointerRegionMove({
				eventType: 'pointermove',
				lastSidebarFocusEpoch: 4,
				lastTimelinePointerEpoch: 5,
				nextRegion: 'timeline',
				previousRegion: 'timeline',
			}),
		).toBe(true);
	});

	it('lets a same-region timeline hover refresh pointer ownership after sidebar focus became newer', () => {
		expect(
			shouldIgnorePointerRegionMove({
				eventType: 'pointermove',
				lastSidebarFocusEpoch: 5,
				lastTimelinePointerEpoch: 4,
				nextRegion: 'timeline',
				previousRegion: 'timeline',
			}),
		).toBe(false);
		expect(
			shouldRefreshTimelinePointerEpoch({
				eventType: 'pointermove',
				lastSidebarFocusEpoch: 5,
				lastTimelinePointerEpoch: 4,
				nextRegion: 'timeline',
				previousRegion: 'timeline',
			}),
		).toBe(true);
	});
});
