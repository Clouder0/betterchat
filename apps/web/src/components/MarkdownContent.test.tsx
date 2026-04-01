import { describe, expect, it } from 'bun:test';

import { areMarkdownContentPropsEqual } from './MarkdownContent';

describe('areMarkdownContentPropsEqual', () => {
	it('treats image tab-index changes as a meaningful rerender boundary', () => {
		expect(
			areMarkdownContentPropsEqual(
				{
					dense: true,
					imageInteraction: {
						tabIndex: 0,
						timelineMessageId: 'message-1',
					},
					source: '![demo](/demo.png)',
				},
				{
					dense: true,
					imageInteraction: {
						tabIndex: -1,
						timelineMessageId: 'message-1',
					},
					source: '![demo](/demo.png)',
				},
			),
		).toBe(false);
	});

	it('treats mention-interaction target changes as a meaningful rerender boundary', () => {
		expect(
			areMarkdownContentPropsEqual(
				{
					dense: true,
					mentionInteraction: {
						focusKeyPrefix: 'message-1',
						tabIndex: 0,
						users: [
							{
								displayName: '林澈',
								id: 'user-linche',
								username: 'linche',
							},
						],
					},
					source: '@linche 请看一下',
				},
				{
					dense: true,
					mentionInteraction: {
						focusKeyPrefix: 'message-1',
						tabIndex: 0,
						users: [
							{
								displayName: '周岚',
								id: 'user-zhou',
								username: 'zhoulan',
							},
						],
					},
					source: '@linche 请看一下',
				},
			),
		).toBe(false);
	});
});
