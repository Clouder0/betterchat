import { describe, expect, it } from 'bun:test';

import { shouldPreserveTimelineBottom } from './bottomPreservation';

describe('shouldPreserveTimelineBottom', () => {
	it('preserves bottom when the timeline is sticky or already effectively at bottom', () => {
		expect(
			shouldPreserveTimelineBottom({
				autoScrollBottomThreshold: 72,
				bottomGap: 120,
				followBottomThroughReflow: false,
				pendingLocalSendExpansion: false,
				stickyToBottom: true,
			}),
		).toBe(true);

		expect(
			shouldPreserveTimelineBottom({
				autoScrollBottomThreshold: 72,
				bottomGap: 24,
				followBottomThroughReflow: false,
				pendingLocalSendExpansion: false,
				stickyToBottom: false,
			}),
		).toBe(true);
	});

	it('preserves bottom when an explicit follow-through or pending local send requests it', () => {
		expect(
			shouldPreserveTimelineBottom({
				autoScrollBottomThreshold: 72,
				bottomGap: 240,
				followBottomThroughReflow: true,
				pendingLocalSendExpansion: false,
				stickyToBottom: false,
			}),
		).toBe(true);

		expect(
			shouldPreserveTimelineBottom({
				autoScrollBottomThreshold: 72,
				bottomGap: 240,
				followBottomThroughReflow: false,
				pendingLocalSendExpansion: true,
				stickyToBottom: false,
			}),
		).toBe(true);
	});

	it('does not force bottom preservation for historical reading positions', () => {
		expect(
			shouldPreserveTimelineBottom({
				autoScrollBottomThreshold: 72,
				bottomGap: 240,
				followBottomThroughReflow: false,
				pendingLocalSendExpansion: false,
				stickyToBottom: false,
			}),
		).toBe(false);
	});
});
