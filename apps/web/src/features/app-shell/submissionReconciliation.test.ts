import { describe, expect, it } from 'bun:test';

import type { TimelineMessage } from '@/lib/chatModels';

import { reconcileSubmissionTimeline } from './submissionReconciliation';

const createMessage = (
	id: string,
	overrides: Partial<TimelineMessage> = {},
): TimelineMessage => ({
	id,
	roomId: 'room-1',
	createdAt: '2026-04-02T12:00:00.000Z',
	author: {
		id: 'user-1',
		displayName: 'Alice',
		username: 'alice',
	},
	body: {
		rawMarkdown: id,
	},
	flags: {
		deleted: false,
		edited: false,
	},
	...overrides,
});

describe('reconcileSubmissionTimeline', () => {
	it('keeps unmatched local sends appended to the visible timeline', () => {
		const result = reconcileSubmissionTimeline({
			canonicalMessages: [createMessage('message-1')],
			localMessages: [
				{
					message: createMessage('submission-1', {
						body: {
							rawMarkdown: 'pending hello',
						},
						submissionId: 'submission-1',
					}),
					status: 'sending',
				},
			],
		});

		expect(result.messages.map((message) => message.id)).toEqual(['message-1', 'submission-1']);
		expect(result.messageDeliveryStates).toEqual({
			'submission-1': 'sending',
		});
		expect([...result.localOutgoingMessageIds]).toEqual(['submission-1']);
	});

	it('suppresses the extra local row and projects sending state onto the canonical row when ids differ but submission ids match', () => {
		const result = reconcileSubmissionTimeline({
			canonicalMessages: [
				createMessage('server-1', {
					body: {
						rawMarkdown: 'canonical copy',
					},
					submissionId: 'submission-1',
				}),
			],
			localMessages: [
				{
					message: createMessage('submission-1', {
						body: {
							rawMarkdown: 'optimistic copy',
						},
						replyTo: {
							messageId: 'parent-1',
							authorName: 'Bob',
							excerpt: 'quoted body',
							long: false,
						},
						submissionId: 'submission-1',
					}),
					status: 'sending',
				},
			],
		});

		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]).toEqual(
			expect.objectContaining({
				id: 'server-1',
				replyTo: {
					messageId: 'parent-1',
					authorName: 'Bob',
					excerpt: 'quoted body',
					long: false,
				},
				submissionId: 'submission-1',
			}),
		);
		expect(result.messageDeliveryStates).toEqual({
			'server-1': 'sending',
		});
		expect([...result.localOutgoingMessageIds]).toEqual(['server-1']);
	});

	it('keeps unmatched failed locals visible with retry metadata', () => {
		const result = reconcileSubmissionTimeline({
			canonicalMessages: [createMessage('message-1')],
			localMessages: [
				{
					errorMessage: '发送失败，请重试。',
					message: createMessage('submission-1', {
						body: {
							rawMarkdown: 'failed hello',
						},
						submissionId: 'submission-1',
					}),
					status: 'failed',
				},
			],
		});

		expect(result.messages.map((message) => message.id)).toEqual(['message-1', 'submission-1']);
		expect(result.messageDeliveryStates).toEqual({
			'submission-1': 'failed',
		});
		expect(result.failedMessageActions).toEqual({
			'submission-1': {
				errorMessage: '发送失败，请重试。',
			},
		});
	});

	it('lets canonical state win over stale failed local metadata when the submission already landed', () => {
		const result = reconcileSubmissionTimeline({
			canonicalMessages: [
				createMessage('server-1', {
					body: {
						rawMarkdown: 'canonical hello',
					},
					submissionId: 'submission-1',
				}),
			],
			localMessages: [
				{
					errorMessage: '发送失败，请重试。',
					message: createMessage('submission-1', {
						body: {
							rawMarkdown: 'failed hello',
						},
						submissionId: 'submission-1',
					}),
					status: 'failed',
				},
			],
		});

		expect(result.messages.map((message) => message.id)).toEqual(['server-1']);
		expect(result.messageDeliveryStates).toEqual({});
		expect(result.failedMessageActions).toEqual({});
		expect([...result.localOutgoingMessageIds]).toEqual([]);
	});
});
