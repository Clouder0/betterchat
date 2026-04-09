import { describe, expect, it } from 'bun:test';
import type { RoomSummary } from '@/lib/chatModels';

import {
	isBrowserNotificationDeliveryEnabled,
	isInterruptiveRoomAttentionAllowed,
	isNotificationMessageAllowedForPreference,
	resolveRoomNotificationEventClass,
	resolveRoomNotificationPreferencePriority,
} from './notificationPolicy';

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

const baseMessage = (markdown: string) => ({
	body: {
		rawMarkdown: markdown,
	},
});

describe('notificationPolicy', () => {
	it('classifies mentions and DMs as personal attention', () => {
		expect(resolveRoomNotificationEventClass(baseEntry({ kind: 'channel', attention: { level: 'mention', badgeCount: 1 } }))).toBe('personal');
		expect(resolveRoomNotificationEventClass(baseEntry({ kind: 'dm', attention: { level: 'unread', badgeCount: 2 } }))).toBe('personal');
		expect(resolveRoomNotificationEventClass(baseEntry({ kind: 'channel', attention: { level: 'unread', badgeCount: 2 } }))).toBe('general');
	});

	it('allows interruptive attention only when the room preference permits it', () => {
		expect(
			isInterruptiveRoomAttentionAllowed({
				entry: baseEntry({ kind: 'channel', attention: { level: 'mention', badgeCount: 1 } }),
				preference: 'personal',
			}),
		).toBe(true);
		expect(
			isInterruptiveRoomAttentionAllowed({
				entry: baseEntry({ kind: 'channel', attention: { level: 'unread', badgeCount: 3 } }),
				preference: 'personal',
			}),
		).toBe(false);
		expect(
			isInterruptiveRoomAttentionAllowed({
				entry: baseEntry({ kind: 'channel', attention: { level: 'unread', badgeCount: 3 } }),
				preference: 'all',
			}),
		).toBe(true);
		expect(
			isInterruptiveRoomAttentionAllowed({
				entry: baseEntry({ kind: 'dm', attention: { level: 'activity' } }),
				preference: 'personal',
			}),
		).toBe(true);
		expect(
			isInterruptiveRoomAttentionAllowed({
				entry: baseEntry({ kind: 'dm', attention: { level: 'activity' } }),
				preference: 'mute',
			}),
		).toBe(false);
	});

	it('filters message notifications according to room preference and mention content', () => {
		expect(
			isNotificationMessageAllowedForPreference({
				currentUser: { displayName: 'Alice Example', username: 'alice' },
				entry: baseEntry({ kind: 'channel' }),
				message: baseMessage('hello @alice'),
				preference: 'personal',
			}),
		).toBe(true);
		expect(
			isNotificationMessageAllowedForPreference({
				currentUser: { displayName: 'Alice Example', username: 'alice' },
				entry: baseEntry({ kind: 'channel' }),
				message: baseMessage('hello team'),
				preference: 'personal',
			}),
		).toBe(false);
		expect(
			isNotificationMessageAllowedForPreference({
				currentUser: { displayName: 'Alice Example', username: 'alice' },
				entry: baseEntry({ kind: 'dm' }),
				message: baseMessage('ping'),
				preference: 'personal',
			}),
		).toBe(true);
	});

	it('orders preferences from all to personal to mute', () => {
		expect(resolveRoomNotificationPreferencePriority('all')).toBeGreaterThan(resolveRoomNotificationPreferencePriority('personal'));
		expect(resolveRoomNotificationPreferencePriority('personal')).toBeGreaterThan(resolveRoomNotificationPreferencePriority('mute'));
	});

	it('only enables browser notifications when delivery is on and permission is granted', () => {
		expect(isBrowserNotificationDeliveryEnabled({ delivery: 'foreground', permission: 'granted' })).toBe(true);
		expect(isBrowserNotificationDeliveryEnabled({ delivery: 'off', permission: 'granted' })).toBe(false);
		expect(isBrowserNotificationDeliveryEnabled({ delivery: 'foreground', permission: 'denied' })).toBe(false);
	});
});
