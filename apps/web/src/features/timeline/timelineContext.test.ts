import { describe, expect, it } from 'bun:test';
import type { MessageContextSnapshot, RoomTimelineSnapshot, TimelineMessage } from '@/lib/chatModels';

import {
	mergeMessageContextIntoTimeline,
	mergeTimelineMessages,
	mergeTimelineMessagesPreferIncoming,
} from './timelineContext';

const createMessage = (overrides: Partial<TimelineMessage> & Pick<TimelineMessage, 'id'>): TimelineMessage => ({
	id: overrides.id,
	roomId: overrides.roomId ?? 'room-1',
	createdAt: overrides.createdAt ?? '2026-03-26T10:00:00.000Z',
	author: overrides.author ?? {
		id: 'user-1',
		displayName: 'Alice',
		username: 'alice',
	},
	body: overrides.body ?? {
		rawMarkdown: overrides.id,
	},
	flags: overrides.flags ?? {
		edited: false,
		deleted: false,
	},
	replyTo: overrides.replyTo,
	thread: overrides.thread,
	attachments: overrides.attachments,
	reactions: overrides.reactions,
	submissionId: overrides.submissionId,
	updatedAt: overrides.updatedAt,
});

describe('mergeTimelineMessages', () => {
	it('merges missing context messages and keeps chronological order', () => {
		const currentMessages = [
			createMessage({ id: 'message-3', createdAt: '2026-03-26T10:03:00.000Z' }),
			createMessage({ id: 'message-4', createdAt: '2026-03-26T10:04:00.000Z' }),
		];
		const contextMessages = [
			createMessage({ id: 'message-1', createdAt: '2026-03-26T10:01:00.000Z' }),
			createMessage({ id: 'message-2', createdAt: '2026-03-26T10:02:00.000Z' }),
			createMessage({ id: 'message-3', createdAt: '2026-03-26T10:03:00.000Z' }),
		];

		expect(mergeTimelineMessages(currentMessages, contextMessages).map((message) => message.id)).toEqual([
			'message-1',
			'message-2',
			'message-3',
			'message-4',
		]);
	});

	it('keeps the existing message object when the id already exists in the live timeline', () => {
		const currentMessages = [createMessage({ id: 'message-1', body: { rawMarkdown: 'live copy' } })];
		const contextMessages = [createMessage({ id: 'message-1', body: { rawMarkdown: 'older copy' } })];

		expect(mergeTimelineMessages(currentMessages, contextMessages)[0]?.body.rawMarkdown).toBe('live copy');
	});

	it('can prefer the incoming duplicate when the incoming window is fresher', () => {
		const currentMessages = [createMessage({ id: 'message-1', body: { rawMarkdown: 'older copy' } })];
		const contextMessages = [createMessage({ id: 'message-1', body: { rawMarkdown: 'newer copy' } })];

		expect(mergeTimelineMessagesPreferIncoming(currentMessages, contextMessages)[0]?.body.rawMarkdown).toBe('newer copy');
	});

	it('preserves BetterChat submission identity when polling refreshes the same canonical message id', () => {
		const currentMessages = [createMessage({ id: 'message-1', submissionId: 'submission-1' })];
		const contextMessages = [createMessage({ id: 'message-1', body: { rawMarkdown: 'server copy' } })];

		expect(mergeTimelineMessagesPreferIncoming(currentMessages, contextMessages)[0]).toMatchObject({
			body: {
				rawMarkdown: 'server copy',
			},
			id: 'message-1',
			submissionId: 'submission-1',
		});
	});
});

describe('mergeMessageContextIntoTimeline', () => {
	it('preserves the outer room timeline fields while expanding the loaded message window', () => {
		const currentTimeline: RoomTimelineSnapshot = {
			version: 'timeline-v1',
			roomId: 'room-1',
			messages: [
				createMessage({ id: 'message-3', createdAt: '2026-03-26T10:03:00.000Z' }),
				createMessage({ id: 'message-4', createdAt: '2026-03-26T10:04:00.000Z' }),
			],
			unreadAnchorMessageId: 'message-4',
		};

		const context: MessageContextSnapshot = {
			version: 'context-v1',
			roomId: 'room-1',
			anchorMessageId: 'message-2',
			anchorIndex: 1,
			messages: [
				createMessage({ id: 'message-1', createdAt: '2026-03-26T10:01:00.000Z' }),
				createMessage({ id: 'message-2', createdAt: '2026-03-26T10:02:00.000Z' }),
				createMessage({ id: 'message-3', createdAt: '2026-03-26T10:03:00.000Z' }),
			],
			hasBefore: false,
			hasAfter: true,
		};

		const mergedTimeline = mergeMessageContextIntoTimeline(currentTimeline, context);
		expect(mergedTimeline.version).toBe('timeline-v1');
		expect(mergedTimeline.unreadAnchorMessageId).toBe('message-4');
		expect(mergedTimeline.messages.map((message) => message.id)).toEqual([
			'message-1',
			'message-2',
			'message-3',
			'message-4',
		]);
	});
});
