import { describe, expect, it } from 'bun:test';

import { resolveTimelinePointerHandoffTarget } from './pointerHandoff';

describe('resolveTimelinePointerHandoffTarget', () => {
	it('prefers the hovered pointer anchor when pointer mode is active and the anchor changed', () => {
		expect(
			resolveTimelinePointerHandoffTarget({
				currentMessageId: 'message-5',
				pointerAnchorMessageId: 'message-3',
				timelineInteractionMode: 'pointer',
			}),
		).toBe('message-3');
	});

	it('ignores the pointer anchor when timeline keyboard mode already owns movement', () => {
		expect(
			resolveTimelinePointerHandoffTarget({
				currentMessageId: 'message-5',
				pointerAnchorMessageId: 'message-3',
				timelineInteractionMode: 'keyboard',
			}),
		).toBeNull();
	});

	it('ignores unchanged or missing pointer anchors', () => {
		expect(
			resolveTimelinePointerHandoffTarget({
				currentMessageId: 'message-5',
				pointerAnchorMessageId: 'message-5',
				timelineInteractionMode: 'pointer',
			}),
		).toBeNull();

		expect(
			resolveTimelinePointerHandoffTarget({
				currentMessageId: 'message-5',
				pointerAnchorMessageId: null,
				timelineInteractionMode: 'pointer',
			}),
		).toBeNull();
	});
});
