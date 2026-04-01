import { describe, expect, it } from 'bun:test';

import { resolvePreferredTimelineFocusTarget } from './timelineFocusTarget';

describe('resolvePreferredTimelineFocusTarget', () => {
	it('keeps the previous keyboard-selected message when re-entering the timeline', () => {
		expect(
			resolvePreferredTimelineFocusTarget({
				currentMessageIds: ['message-1', 'message-2', 'message-3'],
				focusedMessageId: 'message-2',
				interactionMode: 'keyboard',
				pointerAnchorMessageId: null,
				preferPointerAnchor: false,
				unreadFromMessageId: 'message-1',
				viewportAnchorMessageId: 'message-1',
			}),
		).toBe('message-2');
	});

	it('prefers the current viewport anchor before an older pointer-focused message', () => {
		expect(
			resolvePreferredTimelineFocusTarget({
				currentMessageIds: ['message-1', 'message-2', 'message-3'],
				focusedMessageId: 'message-3',
				interactionMode: 'pointer',
				pointerAnchorMessageId: null,
				preferPointerAnchor: false,
				unreadFromMessageId: 'message-1',
				viewportAnchorMessageId: 'message-2',
			}),
		).toBe('message-2');
	});

	it('prefers the hovered pointer anchor when the timeline is entered from a pointer handoff', () => {
		expect(
			resolvePreferredTimelineFocusTarget({
				currentMessageIds: ['message-1', 'message-2', 'message-3'],
				focusedMessageId: 'message-3',
				interactionMode: 'keyboard',
				pointerAnchorMessageId: 'message-2',
				preferPointerAnchor: true,
				unreadFromMessageId: 'message-1',
				viewportAnchorMessageId: 'message-1',
			}),
		).toBe('message-2');
	});

	it('falls back through unread and latest message when needed', () => {
		expect(
			resolvePreferredTimelineFocusTarget({
				currentMessageIds: ['message-1', 'message-2'],
				focusedMessageId: null,
				interactionMode: 'keyboard',
				pointerAnchorMessageId: null,
				preferPointerAnchor: false,
				unreadFromMessageId: 'message-1',
				viewportAnchorMessageId: null,
			}),
		).toBe('message-1');

		expect(
			resolvePreferredTimelineFocusTarget({
				currentMessageIds: ['message-1', 'message-2'],
				focusedMessageId: 'message-9',
				interactionMode: 'keyboard',
				pointerAnchorMessageId: null,
				preferPointerAnchor: false,
				unreadFromMessageId: 'message-8',
				viewportAnchorMessageId: null,
			}),
		).toBe('message-2');
	});
});
