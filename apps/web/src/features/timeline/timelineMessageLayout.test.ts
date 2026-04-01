import { describe, expect, it } from 'bun:test';

import { resolveTimelineMessageLayout } from './timelineMessageLayout';

describe('timelineMessageLayout', () => {
	it('treats a standalone fenced code block as a leading standalone surface', () => {
		expect(
			resolveTimelineMessageLayout({
				attachments: [],
				forwardedMessage: null,
				rawMarkdown: '```ts\nconst overlapProbe = true;\n```',
			}),
		).toEqual({
			leadingSurface: true,
			surfaceOnly: true,
		});
	});

	it('keeps mixed prose and code as leading surface but not surface-only when prose remains', () => {
		expect(
			resolveTimelineMessageLayout({
				attachments: [],
				forwardedMessage: null,
				rawMarkdown: '```ts\nconst overlapProbe = true;\n```\n\n后面还有解释文本。',
			}),
		).toEqual({
			leadingSurface: true,
			surfaceOnly: false,
		});
	});

	it('treats attachment-only image messages as leading standalone surfaces', () => {
		expect(
			resolveTimelineMessageLayout({
				attachments: [
					{
						kind: 'image',
						id: 'attachment-image',
						preview: {
							height: 320,
							url: '/preview.png',
							width: 320,
						},
						source: {
							url: '/full.png',
						},
						title: '结构图',
					},
				],
				forwardedMessage: null,
				rawMarkdown: '   \n\n',
			}),
		).toEqual({
			leadingSurface: true,
			surfaceOnly: true,
		});
	});

	it('treats forwarded cards without lead text as leading standalone surfaces', () => {
		expect(
			resolveTimelineMessageLayout({
				attachments: [],
				forwardedMessage: {
					authorName: '顾宁',
					bodyMarkdown: '```ts\nconst forwarded = true;\n```',
					leadMarkdown: null,
					roomTitle: '兼容验证',
					timeLabel: '09:12',
				},
				rawMarkdown: '> **转发自 顾宁 · 兼容验证 · 09:12**',
			}),
		).toEqual({
			leadingSurface: true,
			surfaceOnly: true,
		});
	});

	it('keeps ordinary prose messages on the compact text-led path', () => {
		expect(
			resolveTimelineMessageLayout({
				attachments: [],
				forwardedMessage: null,
				rawMarkdown: '这是普通文本，不需要额外的动作分隔带。',
			}),
		).toEqual({
			leadingSurface: false,
			surfaceOnly: false,
		});
	});
});
