import { describe, expect, it } from 'bun:test';

import { resolveSidebarScrollBehavior } from './sidebarRoomScroll';

describe('resolveSidebarScrollBehavior', () => {
	it('uses smooth scrolling when motion is enabled', () => {
		expect(resolveSidebarScrollBehavior({ motionDisabled: false })).toEqual({
			block: 'nearest',
			behavior: 'smooth',
		});
	});

	it('uses instant scrolling when motion is disabled', () => {
		expect(resolveSidebarScrollBehavior({ motionDisabled: true })).toEqual({
			block: 'nearest',
			behavior: 'instant',
		});
	});
});
