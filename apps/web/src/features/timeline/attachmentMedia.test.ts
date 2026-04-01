import { describe, expect, it } from 'bun:test';

import { resolveTimelineImageAttachmentMedia } from './attachmentMedia';

describe('resolveTimelineImageAttachmentMedia', () => {
	it('keeps preview media in the timeline and source media in the viewer', () => {
		expect(
			resolveTimelineImageAttachmentMedia({
				kind: 'image',
				id: 'attachment-1',
				title: '交接结构图',
				preview: {
					url: '/api/media/fixtures/ops-handoff-board-preview.svg',
					width: 480,
					height: 480,
				},
				source: {
					url: '/api/media/fixtures/ops-handoff-board.svg',
					width: 1600,
					height: 900,
				},
			}),
		).toEqual({
			src: '/api/media/fixtures/ops-handoff-board-preview.svg',
			width: 480,
			height: 480,
			viewerSrc: '/api/media/fixtures/ops-handoff-board.svg',
			viewerWidth: 1600,
			viewerHeight: 900,
		});
	});

	it('does not fall back to preview dimensions when the source dimensions are missing', () => {
		expect(
			resolveTimelineImageAttachmentMedia({
				kind: 'image',
				id: 'attachment-2',
				title: '交接结构图',
				preview: {
					url: '/api/media/fixtures/ops-handoff-board-preview.svg',
					width: 480,
					height: 480,
				},
				source: {
					url: '/api/media/fixtures/ops-handoff-board.svg',
				},
			}),
		).toEqual({
			src: '/api/media/fixtures/ops-handoff-board-preview.svg',
			width: 480,
			height: 480,
			viewerSrc: '/api/media/fixtures/ops-handoff-board.svg',
			viewerWidth: undefined,
			viewerHeight: undefined,
		});
	});
});
