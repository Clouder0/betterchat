import { describe, expect, it } from 'bun:test';
import type { TimelineMessage } from '@/lib/chatModels';

import {
	buildForwardedMessageMarkdown,
	createReplyPreviewFromMessage,
	parseForwardedMessageMarkdown,
	stripMarkdownToPlainText,
} from './messageCompose';

const createMessage = (overrides: Partial<TimelineMessage> = {}): TimelineMessage => ({
	id: 'message-1',
	roomId: 'ops-handoff',
	createdAt: '2026-03-25T09:09:00.000Z',
	author: {
		id: 'user-gu',
		displayName: '顾宁',
		username: 'guning',
	},
	body: {
		rawMarkdown: '这是 **原始消息**。\n\n![流程图](/media/flow.png)',
	},
	flags: {
		edited: false,
		deleted: false,
	},
	attachments: [
		{
			kind: 'image',
			id: 'attachment-1',
			title: '附件图',
			preview: {
				url: '/media/board-thumb.png',
				width: 360,
				height: 240,
			},
			source: {
				url: '/media/board.png',
			},
		},
	],
	...overrides,
});

describe('messageCompose', () => {
	it('creates a reply preview excerpt from markdown content', () => {
		const preview = createReplyPreviewFromMessage(
			createMessage({
				body: {
					rawMarkdown: '先看 `rooms.get`，再补一张图说明。',
				},
				attachments: undefined,
			}),
		);

		expect(preview.authorName).toBe('顾宁');
		expect(preview.excerpt).toBe('先看 rooms.get，再补一张图说明。');
		expect(preview.long).toBe(false);
	});

	it('builds and parses forwarded markdown with lead text and attachments', () => {
		const markdown = buildForwardedMessageMarkdown({
			leadText: '请看这条同步',
			message: createMessage(),
			roomTitle: '运营协调',
		});

		const parsed = parseForwardedMessageMarkdown(markdown);

		expect(parsed).not.toBeNull();
		expect(parsed).toMatchObject({
			authorName: '顾宁',
			roomTitle: '运营协调',
			timeLabel: '09:09',
			leadMarkdown: '请看这条同步',
		});
		expect(parsed?.bodyMarkdown).toContain('这是 **原始消息**');
		expect(parsed?.bodyMarkdown).toContain('![流程图](/media/flow.png)');
		expect(parsed?.bodyMarkdown).toContain('![附件图](/media/board.png)');
	});

	it('ignores ordinary blockquotes when parsing forwarded markdown', () => {
		expect(
			parseForwardedMessageMarkdown(`这里是说明\n\n> 普通引用\n>\n> 只是一段 blockquote`),
		).toBeNull();
	});

	it('normalizes markdown into plain text', () => {
		expect(stripMarkdownToPlainText('## 标题\n\n- `code`\n- [链接](https://example.com)\n> 引用')).toBe('标题 code 链接 引用');
	});
});
