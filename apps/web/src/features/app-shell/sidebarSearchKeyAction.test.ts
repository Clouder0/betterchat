import { describe, expect, it } from 'bun:test';

import { resolveSidebarSearchKeyAction } from './sidebarSearchKeyAction';

describe('resolveSidebarSearchKeyAction', () => {
	it('moves focus to the header on right arrow', () => {
		expect(
			resolveSidebarSearchKeyAction({
				hasFallbackRoom: true,
				hasFirstSearchResult: false,
				hasVisibleSidebarRooms: true,
				key: 'ArrowRight',
				searchValue: '',
			}),
		).toBe('focus-header');
	});

	it('keeps the existing enter, down, and escape semantics', () => {
		expect(
			resolveSidebarSearchKeyAction({
				hasFallbackRoom: true,
				hasFirstSearchResult: true,
				hasVisibleSidebarRooms: true,
				key: 'Enter',
				searchValue: 'ops',
			}),
		).toBe('open-first-result');

		expect(
			resolveSidebarSearchKeyAction({
				hasFallbackRoom: true,
				hasFirstSearchResult: false,
				hasVisibleSidebarRooms: true,
				key: 'ArrowDown',
				searchValue: '',
			}),
		).toBe('focus-first-room');

		expect(
			resolveSidebarSearchKeyAction({
				hasFallbackRoom: true,
				hasFirstSearchResult: false,
				hasVisibleSidebarRooms: false,
				key: 'Escape',
				searchValue: 'handoff',
			}),
		).toBe('clear-search');

		expect(
			resolveSidebarSearchKeyAction({
				hasFallbackRoom: true,
				hasFirstSearchResult: false,
				hasVisibleSidebarRooms: false,
				key: 'Escape',
				searchValue: '',
			}),
		).toBe('focus-fallback-room');
	});
});
