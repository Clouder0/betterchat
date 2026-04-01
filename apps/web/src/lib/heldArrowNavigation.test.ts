import { describe, expect, it } from 'bun:test';

import {
	createHeldArrowNavigationState,
	HELD_ARROW_NAVIGATION_INTERVAL_MS,
	resolveHeldArrowNavigationAllowance,
} from './heldArrowNavigation';

describe('heldArrowNavigation', () => {
	it('allows the initial non-repeat arrow immediately', () => {
		const result = resolveHeldArrowNavigationAllowance({
			key: 'ArrowDown',
			lastState: createHeldArrowNavigationState(),
			now: 10,
			repeat: false,
		});

		expect(result.allow).toBe(true);
		expect(result.nextState).toEqual({
			key: 'ArrowDown',
			lastHandledAt: 10,
		});
	});

	it('throttles tightly spaced held repeats of the same arrow', () => {
		const first = resolveHeldArrowNavigationAllowance({
			key: 'ArrowDown',
			lastState: createHeldArrowNavigationState(),
			now: 10,
			repeat: true,
		});
		expect(first.allow).toBe(true);

		const second = resolveHeldArrowNavigationAllowance({
			key: 'ArrowDown',
			lastState: first.nextState,
			now: 10 + HELD_ARROW_NAVIGATION_INTERVAL_MS - 1,
			repeat: true,
		});
		expect(second.allow).toBe(false);

		const third = resolveHeldArrowNavigationAllowance({
			key: 'ArrowDown',
			lastState: first.nextState,
			now: 10 + HELD_ARROW_NAVIGATION_INTERVAL_MS,
			repeat: true,
		});
		expect(third.allow).toBe(true);
	});

	it('lets a different direction through immediately even while held', () => {
		const down = resolveHeldArrowNavigationAllowance({
			key: 'ArrowDown',
			lastState: createHeldArrowNavigationState(),
			now: 10,
			repeat: true,
		});

		const up = resolveHeldArrowNavigationAllowance({
			key: 'ArrowUp',
			lastState: down.nextState,
			now: 15,
			repeat: true,
		});

		expect(up.allow).toBe(true);
		expect(up.nextState.key).toBe('ArrowUp');
	});

	it('ignores non-vertical keys', () => {
		const state = createHeldArrowNavigationState();
		const result = resolveHeldArrowNavigationAllowance({
			key: 'ArrowLeft',
			lastState: state,
			now: 10,
			repeat: true,
		});

		expect(result.allow).toBe(true);
		expect(result.nextState).toBe(state);
	});
});
