import { describe, expect, it } from 'bun:test';
import type { RoomSummary } from '@/lib/chatModels';

import {
	didSidebarEntryActivityAdvance,
	resolveSidebarBrowserNotificationBody,
	resolveSidebarBrowserNotificationMessageBody,
	resolveSidebarNotificationFetchCount,
	resolveSidebarNotificationMessages,
	shouldNotifyForSidebarEntry,
} from './sidebarBrowserNotifications';

const baseEntry = (overrides: Partial<RoomSummary>): RoomSummary => ({
	id: overrides.id ?? 'room-1',
	kind: overrides.kind ?? 'channel',
	title: overrides.title ?? '默认房间',
	subtitle: overrides.subtitle,
	presence: overrides.presence,
	avatarUrl: overrides.avatarUrl,
	favorite: overrides.favorite ?? false,
	visibility: overrides.visibility ?? 'visible',
	attention: overrides.attention ?? { level: 'none' },
	lastActivityAt: overrides.lastActivityAt,
});

describe('shouldNotifyForSidebarEntry', () => {
	it('emits browser notifications for subscribed rooms when unread activity increases outside the active room', () => {
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-2',
				nextEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 3 } }),
				previousEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 2 } }),
				priority: 'subscribed',
			}),
		).toBe(true);
	});

	it('stays quiet for normal rooms even when unread activity increases', () => {
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-2',
				nextEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 3 } }),
				previousEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 2 } }),
				priority: 'normal',
			}),
		).toBe(false);
	});

	it('stays quiet for the active room to avoid redundant browser notifications', () => {
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-1',
				pageFocused: true,
				pageVisible: true,
				nextEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 3 } }),
				previousEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 2 } }),
				priority: 'subscribed',
			}),
		).toBe(false);
	});

	it('still notifies for the active room when the tab is hidden or unfocused', () => {
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-1',
				pageFocused: false,
				pageVisible: false,
				nextEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 3 } }),
				previousEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 2 } }),
				priority: 'subscribed',
			}),
		).toBe(true);
	});

	it('treats background activity on the active room as notification-worthy even when unread counters stay quiet', () => {
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-1',
				pageFocused: false,
				pageVisible: false,
				nextEntry: baseEntry({
					id: 'room-1',
					attention: { level: 'none' },
					lastActivityAt: '2026-03-31T12:01:00.000Z',
				}),
				previousEntry: baseEntry({
					id: 'room-1',
					attention: { level: 'none' },
					lastActivityAt: '2026-03-31T12:00:00.000Z',
				}),
				priority: 'subscribed',
			}),
		).toBe(true);
	});

	it('notifies when a room becomes mentioned even if the unread badge count did not rise further', () => {
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-2',
				nextEntry: baseEntry({ id: 'room-1', attention: { level: 'mention', badgeCount: 3 } }),
				previousEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 3 } }),
				priority: 'subscribed',
			}),
		).toBe(true);
	});

	it('notifies when a room moves from quiet to activity-only attention without fabricating a badge', () => {
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-2',
				nextEntry: baseEntry({ id: 'room-1', attention: { level: 'activity' } }),
				previousEntry: baseEntry({ id: 'room-1', attention: { level: 'none' } }),
				priority: 'subscribed',
			}),
		).toBe(true);
	});
});

describe('resolveSidebarBrowserNotificationBody', () => {
	it('uses mention wording for mention attention', () => {
		expect(resolveSidebarBrowserNotificationBody(baseEntry({ attention: { level: 'mention', badgeCount: 2 }, subtitle: '@bob' }))).toBe(
			'有人提及你 · @bob',
		);
	});

	it('uses unread wording when the backend provides a badge count', () => {
		expect(resolveSidebarBrowserNotificationBody(baseEntry({ attention: { level: 'unread', badgeCount: 2 }, subtitle: '#ops' }))).toBe(
			'2 条未读 · #ops',
		);
	});

	it('uses activity wording when the backend only signals activity', () => {
		expect(resolveSidebarBrowserNotificationBody(baseEntry({ attention: { level: 'activity' }, subtitle: '#ops' }))).toBe('有新动态 · #ops');
	});
});

describe('resolveSidebarNotificationFetchCount', () => {
	it('uses unread growth as the fetch count when the badge increases', () => {
		expect(
			resolveSidebarNotificationFetchCount({
				nextEntry: baseEntry({ attention: { level: 'unread', badgeCount: 5 } }),
				previousEntry: baseEntry({ attention: { level: 'unread', badgeCount: 2 } }),
			}),
		).toBe(3);
	});

	it('falls back to one message when attention escalates without a numeric unread delta', () => {
		expect(
			resolveSidebarNotificationFetchCount({
				nextEntry: baseEntry({ attention: { level: 'activity' } }),
				previousEntry: baseEntry({ attention: { level: 'none' } }),
			}),
		).toBe(1);
	});
});

describe('didSidebarEntryActivityAdvance', () => {
	it('detects when a room summary advances its latest activity timestamp', () => {
		expect(
			didSidebarEntryActivityAdvance({
				nextEntry: baseEntry({ lastActivityAt: '2026-03-31T12:01:00.000Z' }),
				previousEntry: baseEntry({ lastActivityAt: '2026-03-31T12:00:00.000Z' }),
			}),
		).toBe(true);

		expect(
			didSidebarEntryActivityAdvance({
				nextEntry: baseEntry({ lastActivityAt: '2026-03-31T12:00:00.000Z' }),
				previousEntry: baseEntry({ lastActivityAt: '2026-03-31T12:00:00.000Z' }),
			}),
		).toBe(false);
	});
});

describe('resolveSidebarNotificationMessages', () => {
	const buildMessage = ({
		authorId,
		displayName,
		id,
		text,
	}: {
		authorId: string;
		displayName: string;
		id: string;
		text: string;
	}) => ({
		author: {
			avatarUrl: undefined,
			displayName,
			id: authorId,
			username: undefined,
		},
		attachments: undefined,
		body: {
			rawMarkdown: text,
		},
		id,
	});

	it('returns only the newest unseen messages up to the requested limit', () => {
		expect(
			resolveSidebarNotificationMessages({
				currentUserId: 'alice',
				lastNotifiedMessageId: 'message-1',
				limit: 2,
				messages: [
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-1', text: '旧消息' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-2', text: '第二条' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-3', text: '第三条' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-4', text: '第四条' }),
				],
			}).map((message) => message.id),
		).toEqual(['message-3', 'message-4']);
	});

	it('filters out self-authored messages before composing notifications', () => {
		expect(
			resolveSidebarNotificationMessages({
				currentUserId: 'alice',
				lastNotifiedMessageId: null,
				limit: 3,
				messages: [
					buildMessage({ authorId: 'alice', displayName: 'Alice', id: 'message-1', text: '我自己发的' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-2', text: '别人发的' }),
				],
			}).map((message) => message.id),
		).toEqual(['message-2']);
	});
});

describe('resolveSidebarBrowserNotificationMessageBody', () => {
	it('uses sender plus a normalized plain-text excerpt', () => {
		expect(
			resolveSidebarBrowserNotificationMessageBody({
				author: {
					avatarUrl: undefined,
					displayName: 'Bob Example',
					id: 'bob',
					username: 'bob',
				},
				attachments: undefined,
				body: {
					rawMarkdown: '## 标题\n\n请看一下 `demo`',
				},
				id: 'message-1',
			}),
		).toBe('Bob Example · 标题 请看一下 demo');
	});
});
