import { describe, expect, it } from 'bun:test';
import type { RoomSummary } from '@/lib/chatModels';

import { buildSidebarGroups, getDefaultRoomId } from './sidebarModel';

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

describe('buildSidebarGroups', () => {
	it('groups favorites separately and sorts entries by notification priority, attention severity, and latest activity within each group', () => {
		const entries: RoomSummary[] = [
			baseEntry({
				id: 'general',
				title: '综合频道',
				attention: { level: 'unread', badgeCount: 8 },
				lastActivityAt: '2026-03-25T09:35:00.000Z',
			}),
			baseEntry({
				id: 'urgent',
				title: '值班告警',
				attention: { level: 'mention', badgeCount: 1 },
				lastActivityAt: '2026-03-25T09:10:00.000Z',
			}),
			baseEntry({
				id: 'fav-dm',
				title: '周岚',
				kind: 'dm',
				favorite: true,
				attention: { level: 'unread', badgeCount: 1 },
				lastActivityAt: '2026-03-25T09:30:00.000Z',
			}),
			baseEntry({ id: 'dm-read', title: '顾宁', kind: 'dm', attention: { level: 'none' }, lastActivityAt: '2026-03-25T09:15:00.000Z' }),
		];

		const groups = buildSidebarGroups(entries, '', {
			general: 'mute',
		});

		expect(groups.map((group) => group.key)).toEqual(['favorites', 'rooms', 'dms']);
		expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(['fav-dm']);
		expect(groups[1]?.entries.map((entry) => entry.id)).toEqual(['urgent', 'general']);
		expect(groups[2]?.entries.map((entry) => entry.id)).toEqual(['dm-read']);
	});

	it('matches simple Chinese substring queries without needing fuzzy logic', () => {
		const entries: RoomSummary[] = [
			baseEntry({ id: 'handoff', title: '交接同步', subtitle: '夜班切换' }),
			baseEntry({ id: 'ops', title: '运营协调', subtitle: 'Platform Handoff' }),
			baseEntry({ id: 'dm', title: 'Mia 张', kind: 'dm', subtitle: '设计评审' }),
		];

		const groups = buildSidebarGroups(entries, '交接');

		expect(groups).toHaveLength(1);
		expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(['handoff']);
	});

	it('sorts by notification priority first, then attention severity, then latest activity', () => {
		const entries: RoomSummary[] = [
			baseEntry({
				id: 'all-mentioned',
				title: '所有消息提及',
				attention: { level: 'mention', badgeCount: 1 },
				lastActivityAt: '2026-03-25T09:10:00.000Z',
			}),
			baseEntry({
				id: 'mute-newest',
				title: '静音最新',
				attention: { level: 'unread', badgeCount: 9 },
				lastActivityAt: '2026-03-25T09:40:00.000Z',
			}),
			baseEntry({
				id: 'all-newer',
				title: '所有消息较新',
				attention: { level: 'activity' },
				lastActivityAt: '2026-03-25T09:30:00.000Z',
			}),
			baseEntry({
				id: 'all-older',
				title: '所有消息较早',
				attention: { level: 'unread', badgeCount: 4 },
				lastActivityAt: '2026-03-25T09:20:00.000Z',
			}),
			baseEntry({
				id: 'personal-mentioned',
				title: '个人相关提及',
				attention: { level: 'mention', badgeCount: 2 },
				lastActivityAt: '2026-03-25T09:25:00.000Z',
			}),
		];

		const groups = buildSidebarGroups(entries, '', {
			'all-mentioned': 'all',
			'all-newer': 'all',
			'all-older': 'all',
			'mute-newest': 'mute',
		});

		expect(groups[0]?.entries.map((entry) => entry.id)).toEqual([
			'all-mentioned',
			'all-older',
			'all-newer',
			'personal-mentioned',
			'mute-newest',
		]);
	});
});

describe('getDefaultRoomId', () => {
	it('prefers the first visible room in grouped unread-first order', () => {
		const entries: RoomSummary[] = [
			baseEntry({
				id: 'closed-top',
				title: '隐藏房间',
				visibility: 'hidden',
				attention: { level: 'unread', badgeCount: 5 },
				lastActivityAt: '2026-03-25T10:00:00.000Z',
			}),
			baseEntry({
				id: 'open-next',
				title: '当前值班',
				visibility: 'visible',
				attention: { level: 'unread', badgeCount: 2 },
				lastActivityAt: '2026-03-25T09:00:00.000Z',
			}),
			baseEntry({ id: 'fallback', title: '归档频道', visibility: 'visible', attention: { level: 'none' }, lastActivityAt: '2026-03-25T08:00:00.000Z' }),
		];

		expect(getDefaultRoomId(entries)).toBe('open-next');
	});

	it('keeps the default room anchored to attention-first room ordering instead of notification-delivery priority', () => {
		const entries: RoomSummary[] = [
			baseEntry({
				id: 'dm-urgentish',
				kind: 'dm',
				title: 'Mia 张',
				favorite: true,
				attention: { level: 'unread', badgeCount: 1 },
				lastActivityAt: '2026-03-25T09:18:00.000Z',
			}),
			baseEntry({
				id: 'ops-handoff',
				title: '运营协调',
				favorite: true,
				attention: { level: 'mention', badgeCount: 4 },
				lastActivityAt: '2026-03-25T09:26:00.000Z',
			}),
		];

		expect(getDefaultRoomId(entries)).toBe('ops-handoff');
	});
});
