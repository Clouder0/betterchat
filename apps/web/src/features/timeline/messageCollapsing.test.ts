import { describe, expect, it } from 'bun:test';
import type { TimelineMessage } from '@/lib/chatModels';

import {
	estimateMessageMayNeedCollapse,
	findAppendedMessageIds,
	findMessageIdTransfers,
	resolveMeasuredMessageCollapsible,
	resolveMessageExpandedState,
	resolveTransferredAppendedMessageIds,
	resolveNextMessageExpansionOverride,
	resolveNextAppendedMessageExpansionDefaults,
	transferMessageStateById,
} from './messageCollapsing';

const createMessage = (overrides: Partial<TimelineMessage> = {}): TimelineMessage => ({
	id: overrides.id ?? 'message-1',
	roomId: overrides.roomId ?? 'room-1',
	createdAt: overrides.createdAt ?? '2026-03-25T09:00:00.000Z',
	author: overrides.author ?? {
		id: 'user-1',
		displayName: '林澈',
		username: 'linche',
	},
	body: overrides.body ?? {
		rawMarkdown: '短消息',
	},
	flags: overrides.flags ?? {
		edited: false,
		deleted: false,
	},
	replyTo: overrides.replyTo,
	thread: overrides.thread,
	attachments: overrides.attachments,
});

describe('messageCollapsing', () => {
	it('treats fenced code blocks as potentially long even without an explicit language', () => {
		const message = createMessage({
			body: {
				rawMarkdown: ['这里贴一段实现草稿：', '', '```', 'const room = createRoom();', 'await room.sync();', 'await room.render();', 'return room;', '```'].join('\n'),
			},
		});

		expect(estimateMessageMayNeedCollapse(message)).toBe(true);
	});

	it('treats image-bearing messages as potentially long', () => {
		const markdownImageMessage = createMessage({
			body: {
				rawMarkdown: '![结构图](/api/media/fixtures/ops-handoff-board.svg)',
			},
		});
		const attachmentImageMessage = createMessage({
			attachments: [
				{
					kind: 'image',
					id: 'attachment-image-1',
					preview: {
						url: '/api/media/fixtures/ops-handoff-board.svg',
					},
					source: {
						url: '/api/media/fixtures/ops-handoff-board.svg',
					},
				},
			],
		});

		expect(estimateMessageMayNeedCollapse(markdownImageMessage)).toBe(true);
		expect(estimateMessageMayNeedCollapse(attachmentImageMessage)).toBe(true);
	});

	it('treats wrapped prose blocks as potentially long before DOM measurement arrives', () => {
		const message = createMessage({
			body: {
				rawMarkdown: [
					'这段说明在实际时间线宽度里会自然换成很多行，但是原始 markdown 看起来并不算特别夸张。',
					'如果第一帧只按原始行数判断，就会先完整展开，再在测量回来以后突然收起。',
					'这种开房间时的折叠闪动会直接打断阅读秩序，所以初始估算需要更接近真实渲染高度。',
					'这里继续补一段，让它维持在中等长度、没有图片、没有代码块，但依然足够高。',
					'最终目标不是更激进地折叠，而是让本来就该折叠的消息从第一帧开始就稳定。',
				].join('\n'),
			},
		});

		expect(estimateMessageMayNeedCollapse(message)).toBe(true);
	});

	it('keeps medium multiline prose expanded when the estimated rendered height stays modest', () => {
		const message = createMessage({
			body: {
				rawMarkdown: ['先记三点：', '一是侧栏宽度可调。', '二是跳转保持快速。', '三是视觉继续收紧。'].join('\n'),
			},
		});

		expect(estimateMessageMayNeedCollapse(message)).toBe(false);
	});

	it('prefers measured rendered height when available', () => {
		const shortMessage = createMessage();

		expect(resolveMeasuredMessageCollapsible(128, shortMessage)).toBe(false);
		expect(resolveMeasuredMessageCollapsible(252, shortMessage)).toBe(true);
	});

	it('keeps visual-media messages collapsible even when the hydrated measurement becomes compact', () => {
		const imageMessage = createMessage({
			attachments: [
				{
					kind: 'image',
					id: 'attachment-image-1',
					preview: {
						url: '/api/media/fixtures/ops-handoff-board.svg',
					},
					source: {
						url: '/api/media/fixtures/ops-handoff-board.svg',
					},
				},
			],
		});

		expect(resolveMeasuredMessageCollapsible(96, imageMessage)).toBe(true);
	});

	it('detects only newly appended messages as live additions', () => {
		expect(findAppendedMessageIds(['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e'])).toEqual(new Set(['d', 'e']));
		expect(findAppendedMessageIds(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(new Set(['d']));
		expect(findAppendedMessageIds([], ['first-message'])).toEqual(new Set(['first-message']));
		expect(findAppendedMessageIds(['a', 'b', 'c'], ['x', 'a', 'b', 'c'])).toEqual(new Set());
		expect(findAppendedMessageIds(['a', 'b', 'c'], ['a', 'x', 'b', 'c'])).toEqual(new Set());
		expect(findAppendedMessageIds(['a', 'b', 'c'], ['a', 'b', 'd'])).toEqual(new Set());
	});

	it('still treats hydrated server messages as appended when they arrive before trailing optimistic local sends', () => {
		expect(
			findAppendedMessageIds(
				['message-1', 'message-2', 'room-1-optimistic-local-image'],
				['message-1', 'message-2', 'server-image-1', 'room-1-optimistic-local-image'],
			),
		).toEqual(new Set(['server-image-1']));

		expect(
			findAppendedMessageIds(
				['message-1', 'room-1-optimistic-a', 'room-1-optimistic-b'],
				['message-1', 'server-image-a', 'server-image-b', 'room-1-optimistic-a', 'room-1-optimistic-b'],
			),
		).toEqual(new Set(['server-image-a', 'server-image-b']));
	});

	it('keeps appended expansion defaults stable after later measured reflows', () => {
		const appendedDefaults = resolveNextAppendedMessageExpansionDefaults({
			appendedMessageIds: ['message-2'],
			currentDefaults: {},
			currentMessageIds: ['message-1', 'message-2'],
			expandByDefault: true,
		});

		expect(appendedDefaults).toEqual({
			'message-2': true,
		});

		expect(
			resolveNextAppendedMessageExpansionDefaults({
				appendedMessageIds: [],
				currentDefaults: appendedDefaults,
				currentMessageIds: ['message-1', 'message-2'],
				expandByDefault: false,
			}),
		).toEqual({
			'message-2': true,
		});
	});

	it('preserves transferred appended ids while a local-send expansion default is still pending', () => {
		expect(
			resolveTransferredAppendedMessageIds({
				appendedMessageIds: [],
				messageIdTransfers: [
					{
						fromId: 'message-optimistic',
						toId: 'message-local',
					},
				],
				preserveTransferredIds: true,
			}),
		).toEqual(new Set(['message-local']));

		expect(
			resolveTransferredAppendedMessageIds({
				appendedMessageIds: [],
				messageIdTransfers: [
					{
						fromId: 'message-optimistic',
						toId: 'message-local',
					},
				],
				preserveTransferredIds: false,
			}),
		).toEqual(new Set());
	});

	it('expands collapsible messages only when persisted or appended-bottom defaults say so', () => {
		expect(
			resolveMessageExpandedState({
				appendedExpandedByDefault: true,
				collapsible: true,
			}),
		).toBe(true);

		expect(
			resolveMessageExpandedState({
				appendedExpandedByDefault: false,
				collapsible: true,
			}),
		).toBe(false);

		expect(
			resolveMessageExpandedState({
				collapsible: false,
				persistedExpanded: false,
			}),
		).toBe(true);
	});

	it('stores only explicit user overrides when toggling expansion state', () => {
		expect(
			resolveNextMessageExpansionOverride({
				appendedExpandedByDefault: false,
				collapsible: true,
				currentExpanded: false,
			}),
		).toBe(true);

		expect(
			resolveNextMessageExpansionOverride({
				appendedExpandedByDefault: false,
				collapsible: true,
				currentExpanded: true,
			}),
		).toBeUndefined();

		expect(
			resolveNextMessageExpansionOverride({
				appendedExpandedByDefault: true,
				collapsible: true,
				currentExpanded: true,
			}),
		).toBe(false);

		expect(
			resolveNextMessageExpansionOverride({
				appendedExpandedByDefault: true,
				collapsible: true,
				currentExpanded: false,
			}),
		).toBeUndefined();
	});

	it('detects optimistic-to-hydrated message id replacements for state transfer', () => {
		const previousMessages = [
			createMessage({
				id: 'old-id',
				body: {
					rawMarkdown: '同步后的长消息',
				},
			}),
		];
		const nextMessages = [
			createMessage({
				id: 'new-id',
				body: {
					rawMarkdown: '同步后的长消息',
				},
			}),
		];

		expect(findMessageIdTransfers(previousMessages, nextMessages)).toEqual([
			{
				fromId: 'old-id',
				toId: 'new-id',
			},
		]);
	});

	it('detects optimistic-to-hydrated image upload replacements even when attachment URLs change', () => {
		const previousMessages = [
			createMessage({
				id: 'room-1-optimistic-upload',
				attachments: [
					{
						kind: 'image',
						id: 'attachment-1',
						title: 'betterchat-e2e-upload.png',
						preview: {
							url: 'blob:http://127.0.0.1/local-preview',
						},
						source: {
							url: 'blob:http://127.0.0.1/local-preview',
						},
					},
				],
				body: {
					rawMarkdown: '附上一张截图',
				},
			}),
		];
		const nextMessages = [
			createMessage({
				id: 'room-1-hydrated-upload',
				attachments: [
					{
						kind: 'image',
						id: 'attachment-2',
						title: 'betterchat-e2e-upload.png',
						preview: {
							url: '/api/media/messages/uploaded-image-thumb',
							width: 360,
							height: 270,
						},
						source: {
							url: '/api/media/messages/uploaded-image',
						},
					},
				],
				body: {
					rawMarkdown: '附上一张截图',
				},
			}),
		];

		expect(findMessageIdTransfers(previousMessages, nextMessages)).toEqual([
			{
				fromId: 'room-1-optimistic-upload',
				toId: 'room-1-hydrated-upload',
			},
		]);
	});

	it('detects optimistic-to-hydrated replacements when the hydrated author id differs but username stays stable', () => {
		const previousMessages = [
			createMessage({
				id: 'room-1-optimistic-upload',
				author: {
					id: 'user-1',
					displayName: 'Alice Example',
					username: 'alice',
				},
				attachments: [
					{
						kind: 'image',
						id: 'attachment-1',
						title: 'betterchat-large.bmp',
						preview: {
							url: 'blob:http://127.0.0.1/local-preview',
						},
						source: {
							url: 'blob:http://127.0.0.1/local-preview',
						},
					},
				],
				body: {
					rawMarkdown: '发送一张大图',
				},
			}),
		];
		const nextMessages = [
			createMessage({
				id: 'room-1-hydrated-upload',
				author: {
					id: 'alice',
					displayName: 'Alice Example',
					username: 'alice',
				},
				attachments: [
					{
						kind: 'image',
						id: 'attachment-2',
						title: 'betterchat-large.bmp',
						preview: {
							url: '/api/media/messages/uploaded-image-thumb',
							width: 360,
							height: 270,
						},
						source: {
							url: '/api/media/messages/uploaded-image',
						},
					},
				],
				body: {
					rawMarkdown: '发送一张大图',
				},
			}),
		];

		expect(findMessageIdTransfers(previousMessages, nextMessages)).toEqual([
			{
				fromId: 'room-1-optimistic-upload',
				toId: 'room-1-hydrated-upload',
			},
		]);
	});

	it('transfers message state entries across optimistic-to-hydrated ids', () => {
		expect(
			transferMessageStateById(
				{
					'old-id': true,
				},
				[
					{
						fromId: 'old-id',
						toId: 'new-id',
					},
				],
			),
		).toEqual({
			'new-id': true,
		});
	});
});
