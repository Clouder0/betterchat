import { describe, expect, it } from 'bun:test';

import {
	resolveForwardDialogNoteKeyAction,
	resolveForwardDialogRoomKeyAction,
	resolveForwardDialogSearchKeyAction,
	resolveForwardDialogSubmitKeyAction,
} from './forwardDialogNavigation';

describe('forwardDialogNavigation', () => {
	it('keeps upward travel from the search field clamped instead of wrapping to the final room', () => {
		expect(
			resolveForwardDialogSearchKeyAction({
				hasActiveRoom: true,
				key: 'ArrowUp',
			}),
		).toBeNull();

		expect(
			resolveForwardDialogSearchKeyAction({
				hasActiveRoom: true,
				key: 'ArrowDown',
			}),
		).toBe('focus-active-room');
	});

	it('keeps room-list vertical travel bounded by the search field above and note field below', () => {
		expect(
			resolveForwardDialogRoomKeyAction({
				currentIndex: 0,
				key: 'ArrowUp',
				roomCount: 3,
			}),
		).toEqual({ kind: 'focus-search' });

		expect(
			resolveForwardDialogRoomKeyAction({
				currentIndex: 2,
				key: 'ArrowDown',
				roomCount: 3,
			}),
		).toEqual({ kind: 'focus-note' });
	});

	it('routes note and submit vertical travel through the lower part of the panel without wrapping', () => {
		expect(
			resolveForwardDialogNoteKeyAction({
				hasActiveRoom: true,
				isOnFirstLine: true,
				isOnLastLine: false,
				key: 'ArrowUp',
				submitModifierPressed: false,
			}),
		).toBe('focus-active-room');

		expect(
			resolveForwardDialogNoteKeyAction({
				hasActiveRoom: true,
				isOnFirstLine: false,
				isOnLastLine: true,
				key: 'ArrowDown',
				submitModifierPressed: false,
			}),
		).toBe('focus-submit');

		expect(
			resolveForwardDialogSubmitKeyAction({
				key: 'ArrowUp',
			}),
		).toBe('focus-note');
	});

	it('preserves the existing selection and submit shortcuts', () => {
		expect(
			resolveForwardDialogRoomKeyAction({
				currentIndex: 1,
				key: 'Enter',
				roomCount: 3,
			}),
		).toEqual({ kind: 'select-room-and-focus-note' });

		expect(
			resolveForwardDialogRoomKeyAction({
				currentIndex: 1,
				key: ' ',
				roomCount: 3,
			}),
		).toEqual({ kind: 'select-room' });

		expect(
			resolveForwardDialogNoteKeyAction({
				hasActiveRoom: true,
				isOnFirstLine: false,
				isOnLastLine: false,
				key: 'Enter',
				submitModifierPressed: true,
			}),
		).toBe('submit');
	});
});
