import { describe, expect, it } from 'bun:test';

import { resolveRevealScrollTop } from './keyboardViewport';

describe('resolveRevealScrollTop', () => {
	it('does not scroll when the target is already comfortably visible', () => {
		expect(
			resolveRevealScrollTop({
				targetHeight: 56,
				targetTop: 128,
				viewportHeight: 420,
				viewportTop: 80,
			}),
		).toBeNull();
	});

	it('scrolls upward when the target is above the padded viewport', () => {
		expect(
			resolveRevealScrollTop({
				targetHeight: 52,
				targetTop: 96,
				viewportHeight: 360,
				viewportTop: 140,
			}),
		).toBe(84);
	});

	it('scrolls downward when the target is below the padded viewport', () => {
		expect(
			resolveRevealScrollTop({
				targetHeight: 68,
				targetTop: 472,
				viewportHeight: 320,
				viewportTop: 180,
			}),
		).toBe(244);
	});

	it('aligns oversized targets from the top edge instead of oscillating', () => {
		expect(
			resolveRevealScrollTop({
				targetHeight: 340,
				targetTop: 520,
				viewportHeight: 280,
				viewportTop: 420,
			}),
		).toBe(508);
	});
});
