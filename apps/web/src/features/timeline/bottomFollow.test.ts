import { describe, expect, it } from 'bun:test';

import { shouldCancelBottomFollowOnViewportChange } from './bottomFollow';

describe('shouldCancelBottomFollowOnViewportChange', () => {
	it('cancels follow-bottom when the user scrolls upward away from bottom', () => {
		expect(
			shouldCancelBottomFollowOnViewportChange({
				bottomGap: 168,
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
				programmaticScrollActive: false,
				scrollTop: 820,
				previousScrollTop: 908,
			}),
		).toBe(false);
	});
});
