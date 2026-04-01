import { describe, expect, it } from 'bun:test';

import { resolveTimelineChildFocusTarget } from './timelineChildFocus';

describe('resolveTimelineChildFocusTarget', () => {
	it('walks through every image in a message before actions', () => {
		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: {
					kind: 'message',
				},
				hasReplyPreview: true,
				mentionCount: 0,
				imageCount: 2,
			}),
		).toEqual({
			kind: 'reply-preview',
		});

		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: {
					kind: 'reply-preview',
				},
				hasReplyPreview: true,
				mentionCount: 0,
				imageCount: 2,
			}),
		).toEqual({
			kind: 'image',
			index: 0,
		});

		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: {
					kind: 'image',
					index: 0,
				},
				hasReplyPreview: true,
				mentionCount: 0,
				imageCount: 2,
			}),
		).toEqual({
			kind: 'image',
			index: 1,
		});

		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: {
					kind: 'image',
					index: 1,
				},
				hasReplyPreview: true,
				mentionCount: 0,
				imageCount: 2,
			}),
		).toEqual({
			kind: 'reply-action',
		});
	});

	it('unwinds back through all image targets on leftward travel', () => {
		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'left',
				from: {
					kind: 'forward-action',
				},
				hasReplyPreview: true,
				mentionCount: 0,
				imageCount: 2,
			}),
		).toEqual({
			kind: 'reply-action',
		});

		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'left',
				from: {
					kind: 'reply-action',
				},
				hasReplyPreview: true,
				mentionCount: 0,
				imageCount: 2,
			}),
		).toEqual({
			kind: 'image',
			index: 1,
		});

		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'left',
				from: {
					kind: 'image',
					index: 1,
				},
				hasReplyPreview: true,
				mentionCount: 0,
				imageCount: 2,
			}),
		).toEqual({
			kind: 'image',
			index: 0,
		});

		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'left',
				from: {
					kind: 'image',
					index: 0,
				},
				hasReplyPreview: true,
				mentionCount: 0,
				imageCount: 2,
			}),
		).toEqual({
			kind: 'reply-preview',
		});
	});

	it('stops after the last image when local outgoing messages have no actions', () => {
		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: false,
				direction: 'right',
				from: {
					kind: 'image',
					index: 0,
				},
				hasReplyPreview: false,
				mentionCount: 0,
				imageCount: 1,
			}),
		).toBeNull();
	});

	it('routes through inline mentions before images and actions', () => {
		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: {
					kind: 'reply-preview',
				},
				hasReplyPreview: true,
				mentionCount: 2,
				imageCount: 1,
			}),
		).toEqual({
			kind: 'mention',
			index: 0,
		});

		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: {
					kind: 'mention',
					index: 0,
				},
				hasReplyPreview: true,
				mentionCount: 2,
				imageCount: 1,
			}),
		).toEqual({
			kind: 'mention',
			index: 1,
		});

		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'right',
				from: {
					kind: 'mention',
					index: 1,
				},
				hasReplyPreview: true,
				mentionCount: 2,
				imageCount: 1,
			}),
		).toEqual({
			kind: 'image',
			index: 0,
		});

		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'left',
				from: {
					kind: 'image',
					index: 0,
				},
				hasReplyPreview: true,
				mentionCount: 2,
				imageCount: 1,
			}),
		).toEqual({
			kind: 'mention',
			index: 1,
		});

		expect(
			resolveTimelineChildFocusTarget({
				canOpenActions: true,
				direction: 'left',
				from: {
					kind: 'mention',
					index: 0,
				},
				hasReplyPreview: true,
				mentionCount: 2,
				imageCount: 1,
			}),
		).toEqual({
			kind: 'reply-preview',
		});
	});
});
