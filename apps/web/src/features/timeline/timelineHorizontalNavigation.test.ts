import { describe, expect, it } from 'bun:test';

import { resolveTimelineHorizontalFocusTarget } from './timelineHorizontalNavigation';

describe('resolveTimelineHorizontalFocusTarget', () => {
	it('routes rightward message traversal through reply preview, then image, then actions', () => {
		expect(
			resolveTimelineHorizontalFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: 'message',
				hasImage: true,
				hasReplyPreview: true,
			}),
		).toBe('reply-preview');

		expect(
			resolveTimelineHorizontalFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: 'reply-preview',
				hasImage: true,
				hasReplyPreview: true,
			}),
		).toBe('image');

		expect(
			resolveTimelineHorizontalFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: 'image',
				hasImage: true,
				hasReplyPreview: true,
			}),
		).toBe('reply-action');

		expect(
			resolveTimelineHorizontalFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: 'reply-action',
				hasImage: true,
				hasReplyPreview: true,
			}),
		).toBe('forward-action');
	});

	it('lets image-only messages enter the image before actions', () => {
		expect(
			resolveTimelineHorizontalFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: 'message',
				hasImage: true,
				hasReplyPreview: false,
			}),
		).toBe('image');

		expect(
			resolveTimelineHorizontalFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: 'image',
				hasImage: true,
				hasReplyPreview: false,
			}),
		).toBe('reply-action');
	});

	it('unwinds leftward traversal back through the same intra-message stops', () => {
		expect(
			resolveTimelineHorizontalFocusTarget({
				canOpenActions: true,
				direction: 'left',
				from: 'forward-action',
				hasImage: true,
				hasReplyPreview: true,
			}),
		).toBe('reply-action');

		expect(
			resolveTimelineHorizontalFocusTarget({
				canOpenActions: true,
				direction: 'left',
				from: 'reply-action',
				hasImage: true,
				hasReplyPreview: true,
			}),
		).toBe('image');

		expect(
			resolveTimelineHorizontalFocusTarget({
				canOpenActions: true,
				direction: 'left',
				from: 'image',
				hasImage: true,
				hasReplyPreview: true,
			}),
		).toBe('reply-preview');

		expect(
			resolveTimelineHorizontalFocusTarget({
				canOpenActions: true,
				direction: 'left',
				from: 'reply-preview',
				hasImage: true,
				hasReplyPreview: true,
			}),
		).toBe('message');
	});

	it('stays action-free for local outgoing messages that have no reply/forward controls', () => {
		expect(
			resolveTimelineHorizontalFocusTarget({
				canOpenActions: false,
				direction: 'right',
				from: 'message',
				hasImage: true,
				hasReplyPreview: false,
			}),
		).toBe('image');

		expect(
			resolveTimelineHorizontalFocusTarget({
				canOpenActions: false,
				direction: 'right',
				from: 'image',
				hasImage: true,
				hasReplyPreview: false,
			}),
		).toBeNull();
	});
});
