import { describe, expect, it } from 'bun:test';
import type { SessionUser } from '@betterchat/contracts';
import type { TimelineMessage } from '@/lib/chatModels';

import { messageMentionsCurrentUser, resolveLoadedMentionTargetMessageId } from './mentionNavigation';

const currentUser: SessionUser = {
	id: 'user-alice',
	displayName: 'Alice Chen',
	username: 'alice',
};

const createMessage = (overrides: Partial<TimelineMessage> & Pick<TimelineMessage, 'id'>): TimelineMessage => ({
	id: overrides.id,
	roomId: overrides.roomId ?? 'room-1',
	createdAt: overrides.createdAt ?? '2026-03-26T10:00:00.000Z',
	author: overrides.author ?? {
		id: 'user-bob',
		displayName: 'Bob',
		username: 'bob',
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
	updatedAt: overrides.updatedAt,
});

describe('resolveLoadedMentionTargetMessageId', () => {
	it('recognizes direct mentions at the very start of a message', () => {
		const message = createMessage({
			id: 'message-1',
			body: {
				rawMarkdown: '@alice 请先确认这一条。',
			},
		});

		expect(
			messageMentionsCurrentUser({
				currentUser,
				message,
			}),
		).toBe(true);
	});

	it('returns the first unread loaded mention for the current user', () => {
		const messages = [
			createMessage({ id: 'message-1', body: { rawMarkdown: '普通消息' } }),
			createMessage({ id: 'message-2', body: { rawMarkdown: '请 @alice 看一下这里。' } }),
			createMessage({ id: 'message-3', body: { rawMarkdown: '@Alice Chen 也需要同步。' } }),
		];

		expect(
			resolveLoadedMentionTargetMessageId({
				currentUser,
				messages,
				roomMentioned: true,
				unreadFromMessageId: 'message-2',
			}),
		).toBe('message-2');
	});

	it('ignores mention-like text before the unread anchor', () => {
		const messages = [
			createMessage({ id: 'message-1', body: { rawMarkdown: '更早的 @alice 提醒' } }),
			createMessage({ id: 'message-2', body: { rawMarkdown: '真正的未读开始' } }),
			createMessage({ id: 'message-3', body: { rawMarkdown: '后面的 @alice 提醒' } }),
		];

		expect(
			resolveLoadedMentionTargetMessageId({
				currentUser,
				messages,
				roomMentioned: true,
				unreadFromMessageId: 'message-2',
			}),
		).toBe('message-3');
	});

	it('ignores the current user self-mentions and deleted messages', () => {
		const messages = [
			createMessage({
				id: 'message-1',
				author: {
					id: 'user-alice',
					displayName: 'Alice Chen',
					username: 'alice',
				},
				body: { rawMarkdown: '我自己写一条 @alice' },
			}),
			createMessage({
				id: 'message-2',
				body: { rawMarkdown: '别人写的 @alice 但消息已删除' },
				flags: { edited: false, deleted: true },
			}),
			createMessage({
				id: 'message-3',
				body: { rawMarkdown: '最后这条 @alice 才是有效提醒' },
			}),
		];

		expect(
			resolveLoadedMentionTargetMessageId({
				currentUser,
				messages,
				roomMentioned: true,
			}),
		).toBe('message-3');
	});

	it('returns null when the room is not in mentioned state or the loaded slice has no mention target', () => {
		const messages = [createMessage({ id: 'message-1', body: { rawMarkdown: '普通消息' } })];

		expect(
			resolveLoadedMentionTargetMessageId({
				currentUser,
				messages,
				roomMentioned: false,
			}),
		).toBeNull();
		expect(
			resolveLoadedMentionTargetMessageId({
				currentUser,
				messages,
				roomMentioned: true,
			}),
		).toBeNull();
	});
});
