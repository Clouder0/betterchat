import { describe, expect, it } from 'bun:test';

import { shouldCancelBottomFollowOnViewportChange } from './bottomFollow';

describe('shouldCancelBottomFollowOnViewportChange', () => {
	it('cancels follow-bottom when the user scrolls upward away from bottom', () => {
		expect(
			shouldCancelBottomFollowOnViewportChange({
				bottomGap: 168,
				previousBottomGap: 40,
				programmaticScrollActive: false,
				scrollTop: 820,
				previousScrollTop: 908,
			}),
		).toBe(true);
	});

	it('keeps follow-bottom during programmatic latest jumps', () => {
		expect(
			shouldCancelBottomFollowOnViewportChange({
				bottomGap: 168,
				previousBottomGap: 40,
				programmaticScrollActive: true,
				scrollTop: 820,
				previousScrollTop: 908,
			}),
		).toBe(false);
	});

	it('keeps follow-bottom when the viewport is still effectively at bottom', () => {
		expect(
			shouldCancelBottomFollowOnViewportChange({
				bottomGap: 40,
				previousBottomGap: 18,
				programmaticScrollActive: false,
				scrollTop: 820,
				previousScrollTop: 908,
			}),
		).toBe(false);
	});

	it('cancels follow-bottom as soon as the user leaves the bottom zone even before a large upward delta accumulates', () => {
		expect(
			shouldCancelBottomFollowOnViewportChange({
				bottomGap: 148,
				previousBottomGap: 24,
				programmaticScrollActive: false,
				scrollTop: 864,
				previousScrollTop: 868,
			}),
		).toBe(true);
	});

	it('does not cancel follow-bottom when the bottom gap only grows because layout changed without viewport movement', () => {
		expect(
			shouldCancelBottomFollowOnViewportChange({
				bottomGap: 148,
				previousBottomGap: 24,
				programmaticScrollActive: false,
				scrollTop: 868,
				previousScrollTop: 868,
			}),
		).toBe(false);
	});
});
