import { describe, expect, it } from 'bun:test';

import { canApplyPendingComposerFocus } from './postNavigationFocus';

describe('canApplyPendingComposerFocus', () => {
	it('returns true only when the pending room is active, loaded, and the composer is ready', () => {
		expect(
			canApplyPendingComposerFocus({
				activeRoomId: 'room-1',
				composerReady: true,
				composerReadyRoomId: 'room-1',
				pendingRoomId: 'room-1',
				roomLoading: false,
			}),
		).toBe(true);
	});

	it('returns false while the room is still loading', () => {
		expect(
			canApplyPendingComposerFocus({
				activeRoomId: 'room-1',
				composerReady: true,
				composerReadyRoomId: 'room-1',
				pendingRoomId: 'room-1',
				roomLoading: true,
			}),
		).toBe(false);
	});

	it('returns false while the composer is not ready yet', () => {
		expect(
			canApplyPendingComposerFocus({
				activeRoomId: 'room-1',
				composerReady: false,
				composerReadyRoomId: null,
				pendingRoomId: 'room-1',
				roomLoading: false,
			}),
		).toBe(false);
	});

	it('returns false when the active room does not match the pending target', () => {
		expect(
			canApplyPendingComposerFocus({
				activeRoomId: 'room-2',
				composerReady: true,
				composerReadyRoomId: 'room-2',
				pendingRoomId: 'room-1',
				roomLoading: false,
			}),
		).toBe(false);
	});

	it('returns false when the ready composer still belongs to a previous room scope', () => {
		expect(
			canApplyPendingComposerFocus({
				activeRoomId: 'room-2',
				composerReady: true,
				composerReadyRoomId: 'room-1',
				pendingRoomId: 'room-2',
				roomLoading: false,
			}),
		).toBe(false);
	});
});
