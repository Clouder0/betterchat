import { describe, expect, it } from 'bun:test';

import type { TimelineMessage } from '@/lib/chatModels';

import {
	collectAuthorNavigableMessageIds,
	resolveAdjacentTimelineMessageId,
	resolveAdjacentAuthorNavigableMessageId,
	shouldVisuallyGroupTimelineMessages,
} from './authorQuickPanelNavigation';

const createMessage = ({
	authorId,
	createdAt,
	id,
}: {
	authorId: string;
	createdAt: string;
	id: string;
}) =>
	({
		author: {
			displayName: authorId,
			id: authorId,
		},
		body: {
			rawMarkdown: id,
		},
		createdAt,
		flags: {
			deleted: false,
			edited: false,
		},
		id,
		roomId: 'room-1',
	}) satisfies TimelineMessage;

describe('authorQuickPanelNavigation', () => {
	it('groups consecutive messages from the same author inside the grouping window', () => {
		expect(
			shouldVisuallyGroupTimelineMessages(
				createMessage({
					authorId: 'user-a',
					createdAt: '2026-03-28T09:00:00.000Z',
					id: 'message-1',
				}),
				createMessage({
					authorId: 'user-a',
					createdAt: '2026-03-28T09:04:00.000Z',
					id: 'message-2',
				}),
			),
		).toBe(true);
	});

	it('collects only visible author anchors and skips grouped continuations', () => {
		const messages = [
			createMessage({
				authorId: 'user-a',
				createdAt: '2026-03-28T09:00:00.000Z',
				id: 'message-1',
			}),
			createMessage({
				authorId: 'user-a',
				createdAt: '2026-03-28T09:03:00.000Z',
				id: 'message-2',
			}),
			createMessage({
				authorId: 'user-b',
				createdAt: '2026-03-28T09:05:00.000Z',
				id: 'message-3',
			}),
			createMessage({
				authorId: 'current-user',
				createdAt: '2026-03-28T09:06:00.000Z',
				id: 'message-4',
			}),
		];

		expect(
			collectAuthorNavigableMessageIds({
				authorQuickPanelEnabled: true,
				currentUserId: 'current-user',
				messages,
			}),
		).toEqual(['message-1', 'message-3']);
	});

	it('breaks grouping at the unread divider so the anchor remains visible there', () => {
		const messages = [
			createMessage({
				authorId: 'user-a',
				createdAt: '2026-03-28T09:00:00.000Z',
				id: 'message-1',
			}),
			createMessage({
				authorId: 'user-a',
				createdAt: '2026-03-28T09:03:00.000Z',
				id: 'message-2',
			}),
		];

		expect(
			collectAuthorNavigableMessageIds({
				authorQuickPanelEnabled: true,
				currentUserId: 'current-user',
				messages,
				unreadAnchorMessageId: 'message-2',
			}),
		).toEqual(['message-1', 'message-2']);
	});

	it('keeps a deleted message visually grouped with a same-author predecessor inside the grouping window', () => {
		expect(
			shouldVisuallyGroupTimelineMessages(
				createMessage({
					authorId: 'user-a',
					createdAt: '2026-03-28T09:00:00.000Z',
					id: 'message-1',
				}),
				{
					...createMessage({
						authorId: 'user-a',
						createdAt: '2026-03-28T09:01:00.000Z',
						id: 'message-2',
					}),
					flags: { edited: false, deleted: true },
				},
			),
		).toBe(true);
	});

	it('keeps a same-author message visually grouped after a deleted predecessor inside the grouping window', () => {
		expect(
			shouldVisuallyGroupTimelineMessages(
				{
					...createMessage({
						authorId: 'user-a',
						createdAt: '2026-03-28T09:00:00.000Z',
						id: 'message-1',
					}),
					flags: { edited: false, deleted: true },
				},
				createMessage({
					authorId: 'user-a',
					createdAt: '2026-03-28T09:01:00.000Z',
					id: 'message-2',
				}),
			),
		).toBe(true);
	});

	it('does not let a deleted same-author continuation split the author-navigable visual group', () => {
		const messages = [
			createMessage({
				authorId: 'user-a',
				createdAt: '2026-03-28T09:00:00.000Z',
				id: 'message-1',
			}),
			{
				...createMessage({
					authorId: 'user-a',
					createdAt: '2026-03-28T09:01:00.000Z',
					id: 'message-2',
				}),
				flags: { edited: false, deleted: true },
			},
			createMessage({
				authorId: 'user-a',
				createdAt: '2026-03-28T09:02:00.000Z',
				id: 'message-3',
			}),
		];

		expect(
			collectAuthorNavigableMessageIds({
				authorQuickPanelEnabled: true,
				currentUserId: 'current-user',
				messages,
			}),
		).toEqual(['message-1']);
	});

	it('resolves author-lane travel across grouped messages instead of landing on continuations', () => {
		const navigableMessageIds = ['message-1', 'message-3', 'message-5'];

		expect(
			resolveAdjacentAuthorNavigableMessageId({
				direction: 'previous',
				messageId: 'message-3',
				navigableMessageIds,
			}),
		).toBe('message-1');
		expect(
			resolveAdjacentAuthorNavigableMessageId({
				direction: 'next',
				messageId: 'message-3',
				navigableMessageIds,
			}),
		).toBe('message-5');
	});

	it('resolves quick-panel vertical exits against immediate timeline neighbors', () => {
		const messageIds = ['message-1', 'message-2', 'message-3', 'message-4'];

		expect(
			resolveAdjacentTimelineMessageId({
				direction: 'previous',
				messageId: 'message-3',
				messageIds,
			}),
		).toBe('message-2');
		expect(
			resolveAdjacentTimelineMessageId({
				direction: 'next',
				messageId: 'message-3',
				messageIds,
			}),
		).toBe('message-4');
		expect(
			resolveAdjacentTimelineMessageId({
				direction: 'previous',
				messageId: 'message-1',
				messageIds,
			}),
		).toBeNull();
		expect(
			resolveAdjacentTimelineMessageId({
				direction: 'next',
				messageId: 'message-4',
				messageIds,
			}),
		).toBeNull();
	});
});
