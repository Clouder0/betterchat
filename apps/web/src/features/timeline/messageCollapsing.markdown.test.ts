import { describe, expect, it } from 'bun:test';
import type { TimelineMessage } from '@/lib/chatModels';

import { estimateMessageMayNeedCollapse, MESSAGE_COLLAPSE_MAX_HEIGHT_PX } from './messageCollapsing';

const createMessage = (rawMarkdown: string, overrides: Partial<TimelineMessage> = {}): TimelineMessage => ({
	id: overrides.id ?? 'message-1',
	roomId: overrides.roomId ?? 'room-1',
	createdAt: overrides.createdAt ?? '2026-03-25T09:00:00.000Z',
	author: overrides.author ?? {
		id: 'user-1',
		displayName: '林澈',
		username: 'linche',
	},
	body: { rawMarkdown },
	flags: overrides.flags ?? { edited: false, deleted: false },
	replyTo: overrides.replyTo,
	thread: overrides.thread,
	attachments: overrides.attachments,
});

describe('messageCollapsing - Markdown Content Interactions', () => {
	describe('Table Detection', () => {
		it('triggers collapse when table has 4+ rows', () => {
			const source = [
				'| Module | Status |',
				'|--------|--------|',
				'| auth   | done   |',
				'| sync   | wip    |',
				'| rooms  | done   |',
				'| thread | next   |',
			].join('\n');
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(true);
		});

		it('does NOT trigger collapse for small tables (< 4 rows)', () => {
			const source = [
				'| Module | Status |',
				'|--------|--------|',
				'| auth   | done   |',
			].join('\n');
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(false);
		});

		it('triggers collapse for wide tables that push total length past threshold', () => {
			const source = [
				'| Column A | Column B | Column C | Column D | Column E | Column F | Column G | Column H |',
				'|----------|----------|----------|----------|----------|----------|----------|----------|',
				'| val      | val      | val      | val      | val      | val      | val      | val      |',
			].join('\n');
			// Total length > 260 chars
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(true);
		});
	});

	describe('Blockquote Detection', () => {
		it('triggers collapse when blockquote has 5+ lines', () => {
			const source = [
				'> Line one of the quote',
				'> Line two continues',
				'> Line three with more',
				'> Line four still going',
				'> Line five completes',
			].join('\n');
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(true);
		});

		it('does NOT trigger collapse for short blockquotes (< 5 lines)', () => {
			const source = [
				'> Short quote',
				'> Two lines',
			].join('\n');
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(false);
		});

		it('triggers collapse for blockquote with nested list', () => {
			const source = [
				'> Summary:',
				'> - First point',
				'> - Second point',
				'> - Third point',
				'> - Fourth point',
				'>',
				'> Conclusion here.',
			].join('\n');
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(true);
		});
	});

	describe('Math Block Detection', () => {
		it('triggers collapse for messages with display math and enough lines', () => {
			const source = [
				'The queue model:',
				'',
				'$$',
				'W_q \\approx \\frac{\\rho}{\\mu(1-\\rho)}',
				'$$',
				'',
				'When rho approaches 1, wait time increases.',
			].join('\n');
			// displayMathBlockCount > 0 && lineCount >= 6
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(true);
		});

		it('does NOT trigger collapse for inline math only', () => {
			const source = 'The formula $x = 1$ is simple.';
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(false);
		});

		it('does NOT trigger collapse for short display math block alone', () => {
			// Only 5 lines, needs >= 6 for math trigger
			const source = [
				'Result:',
				'',
				'$$',
				'x = 1',
				'$$',
			].join('\n');
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(false);
		});

		it('documents that math height estimation does not account for KaTeX DOM expansion', () => {
			// This test documents a known limitation: estimateRenderedMessageHeight
			// calculates based on line count and text wrap, but KaTeX renders math
			// at much larger DOM height than the source text suggests.
			// A single-line $$...$$ expression might render as 40-80px in KaTeX
			// but the estimator treats it as ~28px (ESTIMATED_RENDER_LINE_HEIGHT_PX).
			const source = [
				'The model:',
				'',
				'$$',
				'W_q \\approx \\frac{\\rho}{\\mu(1-\\rho)}',
				'$$',
				'',
				'End.',
			].join('\n');
			// This triggers via lineCount >= 6 + displayMathBlockCount > 0,
			// but if the message were shorter, the height estimate would undercount.
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(true);
		});
	});

	describe('List Content Detection', () => {
		it('triggers collapse for long lists via line count', () => {
			const source = [
				'Check these items:',
				'',
				'- 登录态与 token 续期',
				'- 房间列表与 subscriptions',
				'- 历史消息拉取',
				'- thread 读取',
				'- mention 处理',
				'- 附件处理',
				'- 搜索功能',
				'- 实时同步',
			].join('\n');
			// lineCount > 10
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(true);
		});

		it('does NOT trigger collapse for short lists', () => {
			const source = [
				'Quick list:',
				'- item 1',
				'- item 2',
			].join('\n');
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(false);
		});

		it('triggers collapse for nested lists that exceed height estimate', () => {
			const source = [
				'- Level 1 item A',
				'  - Level 2 sub-item A1',
				'  - Level 2 sub-item A2',
				'    - Level 3 deep item',
				'- Level 1 item B',
				'  - Level 2 sub-item B1',
				'  - Level 2 sub-item B2',
				'- Level 1 item C',
				'  1. Ordered sub 1',
				'  2. Ordered sub 2',
				'  3. Ordered sub 3',
			].join('\n');
			// lineCount > 10
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(true);
		});
	});

	describe('Mixed Content Detection', () => {
		it('triggers collapse for message with code + list + blockquote', () => {
			const source = [
				'Implementation notes:',
				'',
				'```ts',
				'const draft = { rid: "GENERAL" };',
				'```',
				'',
				'> This is a key decision.',
				'',
				'- Step 1',
				'- Step 2',
				'- Step 3',
			].join('\n');
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(true);
		});

		it('triggers collapse for message with table + math', () => {
			const source = [
				'| Metric | Value |',
				'|--------|-------|',
				'| P50    | 120ms |',
				'| P99    | 890ms |',
				'',
				'$$',
				'T_{total} = T_{auth} + T_{sync}',
				'$$',
			].join('\n');
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(true);
		});

		it('triggers collapse for CJK-heavy message with wrapping prose', () => {
			const source = [
				'这段说明在实际时间线宽度里会自然换成很多行，但是原始 markdown 看起来并不算特别夸张。',
				'如果第一帧只按原始行数判断，就会先完整展开，再在测量回来以后突然收起。',
				'这种开房间时的折叠闪动会直接打断阅读秩序，所以初始估算需要更接近真实渲染高度。',
				'这里继续补一段，让它维持在中等长度、没有图片、没有代码块，但依然足够高。',
				'最终目标不是更激进地折叠，而是让本来就该折叠的消息从第一帧开始就稳定。',
			].join('\n');
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(true);
		});
	});

	describe('Edge Cases', () => {
		it('does NOT trigger collapse for empty message', () => {
			expect(estimateMessageMayNeedCollapse(createMessage(''))).toBe(false);
		});

		it('does NOT trigger collapse for single line', () => {
			expect(estimateMessageMayNeedCollapse(createMessage('Hello world'))).toBe(false);
		});

		it('triggers collapse for unclosed code fence (treated as very long content)', () => {
			const source = [
				'```',
				'line 1',
				'line 2',
				'line 3',
				'line 4',
				'line 5',
				'line 6',
				'line 7',
				'line 8',
				// No closing fence
			].join('\n');
			// lineCount > 10 or height estimate triggers
			expect(estimateMessageMayNeedCollapse(createMessage(source))).toBe(true);
		});

		it('triggers collapse for very long single line', () => {
			const longLine = 'A'.repeat(200);
			expect(estimateMessageMayNeedCollapse(createMessage(longLine))).toBe(true);
		});

		it('triggers collapse for message with markdown image', () => {
			expect(estimateMessageMayNeedCollapse(createMessage('![chart](/media/chart.png)'))).toBe(true);
		});

		it('triggers collapse for message with image attachment', () => {
			expect(
				estimateMessageMayNeedCollapse(
					createMessage('Caption text', {
						attachments: [
							{
								kind: 'image',
								id: 'att-1',
								preview: { url: '/thumb.png' },
								source: { url: '/full.png' },
							},
						],
					}),
				),
			).toBe(true);
		});
	});
});
