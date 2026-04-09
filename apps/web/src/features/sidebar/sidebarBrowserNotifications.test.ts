import { describe, expect, it } from 'bun:test';
import type { RoomSummary } from '@/lib/chatModels';

import {
	didSidebarEntryActivityAdvance,
	resolveSidebarBrowserNotificationBody,
	resolveSidebarBrowserNotificationMessageBody,
	resolveSidebarNotificationFetchCount,
	resolveSidebarNotificationMessages,
	shouldFallbackNotifyForSidebarEntry,
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
	it('emits browser notifications for all-message rooms when unread activity increases outside the active room', () => {
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-2',
				nextEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 3 } }),
				previousEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 2 } }),
				preference: 'all',
			}),
		).toBe(true);
	});

	it('stays quiet for personal-only channels when unread activity is not personal', () => {
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-2',
				nextEntry: baseEntry({ id: 'room-1', kind: 'channel', attention: { level: 'unread', badgeCount: 3 } }),
				previousEntry: baseEntry({ id: 'room-1', kind: 'channel', attention: { level: 'unread', badgeCount: 2 } }),
				preference: 'personal',
			}),
		).toBe(false);
	});

	it('still notifies for personal-only mentions and DMs', () => {
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-2',
				nextEntry: baseEntry({ id: 'room-1', kind: 'channel', attention: { level: 'mention', badgeCount: 1 } }),
				previousEntry: baseEntry({ id: 'room-1', kind: 'channel', attention: { level: 'unread', badgeCount: 1 } }),
				preference: 'personal',
			}),
		).toBe(true);
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-2',
				nextEntry: baseEntry({ id: 'dm-1', kind: 'dm', attention: { level: 'unread', badgeCount: 3 } }),
				previousEntry: baseEntry({ id: 'dm-1', kind: 'dm', attention: { level: 'unread', badgeCount: 2 } }),
				preference: 'personal',
			}),
		).toBe(true);
	});

	it('stays quiet for muted rooms and the focused visible active room', () => {
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-2',
				nextEntry: baseEntry({ id: 'room-1', attention: { level: 'mention', badgeCount: 1 } }),
				previousEntry: baseEntry({ id: 'room-1', attention: { level: 'none' } }),
				preference: 'mute',
			}),
		).toBe(false);
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-1',
				pageFocused: true,
				pageVisible: true,
				nextEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 3 } }),
				previousEntry: baseEntry({ id: 'room-1', attention: { level: 'unread', badgeCount: 2 } }),
				preference: 'all',
			}),
		).toBe(false);
	});

	it('leaves active-room hidden notifications to the timeline path instead of the sidebar path', () => {
		expect(
			shouldNotifyForSidebarEntry({
				currentRoomId: 'room-1',
				pageFocused: false,
				pageVisible: false,
				nextEntry: baseEntry({
					id: 'room-1',
					kind: 'channel',
					attention: { level: 'none' },
					lastActivityAt: '2026-03-31T12:01:00.000Z',
				}),
				previousEntry: baseEntry({
					id: 'room-1',
					kind: 'channel',
					attention: { level: 'none' },
					lastActivityAt: '2026-03-31T12:00:00.000Z',
				}),
				preference: 'personal',
			}),
		).toBe(false);
		expect(
			shouldFallbackNotifyForSidebarEntry({
				currentRoomId: 'room-1',
				pageFocused: false,
				pageVisible: false,
				nextEntry: baseEntry({
					id: 'room-1',
					kind: 'channel',
					attention: { level: 'none' },
					lastActivityAt: '2026-03-31T12:01:00.000Z',
				}),
				previousEntry: baseEntry({
					id: 'room-1',
					kind: 'channel',
					attention: { level: 'none' },
					lastActivityAt: '2026-03-31T12:00:00.000Z',
				}),
				preference: 'personal',
			}),
		).toBe(false);
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

	it('returns every unseen message after a known notification baseline, even when the fetch limit is smaller', () => {
		expect(
			resolveSidebarNotificationMessages({
				currentUser: { id: 'alice', displayName: 'Alice', username: 'alice' },
				entry: baseEntry({ kind: 'channel' }),
				lastNotifiedMessageId: 'message-1',
				limit: 2,
				messages: [
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-1', text: '@alice 旧消息' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-2', text: '@alice 第二条' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-3', text: '@alice 第三条' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-4', text: '@alice 第四条' }),
				],
				preference: 'personal',
			}).map((message) => message.id),
		).toEqual(['message-2', 'message-3', 'message-4']);
	});

	it('caps notification delivery to the newest messages when no baseline exists yet', () => {
		expect(
			resolveSidebarNotificationMessages({
				currentUser: { id: 'alice', displayName: 'Alice', username: 'alice' },
				entry: baseEntry({ kind: 'channel' }),
				lastNotifiedMessageId: null,
				limit: 2,
				messages: [
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-1', text: '第一条' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-2', text: '第二条' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-3', text: '第三条' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-4', text: '第四条' }),
				],
				preference: 'all',
			}).map((message) => message.id),
		).toEqual(['message-3', 'message-4']);
	});

	it('filters out self-authored and non-personal channel messages before composing notifications', () => {
		expect(
			resolveSidebarNotificationMessages({
				currentUser: { id: 'alice', displayName: 'Alice', username: 'alice' },
				entry: baseEntry({ kind: 'channel' }),
				lastNotifiedMessageId: null,
				limit: 5,
				messages: [
					buildMessage({ authorId: 'alice', displayName: 'Alice', id: 'message-1', text: '@alice 自己发的' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-2', text: '普通消息' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-3', text: '@alice 需要你' }),
				],
				preference: 'personal',
			}).map((message) => message.id),
		).toEqual(['message-3']);
	});

	it('keeps direct-message payloads eligible for personal mode', () => {
		expect(
			resolveSidebarNotificationMessages({
				currentUser: { id: 'alice', displayName: 'Alice', username: 'alice' },
				entry: baseEntry({ kind: 'dm' }),
				lastNotifiedMessageId: null,
				limit: 2,
				messages: [
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-1', text: '第一条' }),
					buildMessage({ authorId: 'bob', displayName: 'Bob', id: 'message-2', text: '第二条' }),
				],
				preference: 'personal',
			}).map((message) => message.id),
		).toEqual(['message-1', 'message-2']);
	});

	it('uses sender plus a normalized plain-text excerpt', () => {
		expect(
			resolveSidebarBrowserNotificationMessageBody(
				buildMessage({ authorId: 'bob', displayName: 'Bob Example', id: 'message-9', text: 'Hello **world**' }),
			),
		).toContain('Bob Example · Hello world');
	});
});
