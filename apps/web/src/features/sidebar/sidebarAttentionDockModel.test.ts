import { describe, expect, it } from 'bun:test';
import type { RoomSummary } from '@/lib/chatModels';

import { buildSidebarAttentionDock, resolveSidebarAttentionDockLabel } from './sidebarAttentionDockModel';

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

describe('buildSidebarAttentionDock', () => {
	it('excludes the active room, hidden rooms, and quiet rooms before sorting by real attention severity and recency', () => {
		const state = buildSidebarAttentionDock(
			[
				baseEntry({
					id: 'active-mentioned',
					title: '当前房间',
					attention: { badgeCount: 1, level: 'mention' },
					lastActivityAt: '2026-04-09T08:00:00.000Z',
				}),
				baseEntry({
					id: 'hidden-mentioned',
					title: '隐藏提及',
					attention: { badgeCount: 1, level: 'mention' },
					lastActivityAt: '2026-04-09T09:00:00.000Z',
					visibility: 'hidden',
				}),
				baseEntry({
					id: 'activity-room',
					title: '有动态',
					attention: { level: 'activity' },
					lastActivityAt: '2026-04-09T10:00:00.000Z',
				}),
				baseEntry({
					id: 'unread-room',
					title: '未读房间',
					attention: { badgeCount: 3, level: 'unread' },
					lastActivityAt: '2026-04-09T09:30:00.000Z',
				}),
				baseEntry({
					id: 'mention-room',
					title: '提及房间',
					attention: { badgeCount: 1, level: 'mention' },
					lastActivityAt: '2026-04-09T08:30:00.000Z',
				}),
				baseEntry({
					id: 'quiet-room',
					title: '安静房间',
					attention: { level: 'none' },
					lastActivityAt: '2026-04-09T11:00:00.000Z',
				}),
			],
			{
				activeRoomId: 'active-mentioned',
			},
		);

		expect(state.entries.map((entry) => entry.id)).toEqual(['mention-room', 'unread-room', 'activity-room']);
		expect(state.overflowCount).toBe(0);
	});

	it('breaks ties by latest activity and then by locale title for deterministic ordering', () => {
		const state = buildSidebarAttentionDock([
			baseEntry({
				id: 'zebra',
				title: '张三',
				attention: { badgeCount: 1, level: 'unread' },
				lastActivityAt: '2026-04-09T09:00:00.000Z',
			}),
			baseEntry({
				id: 'alpha',
				title: '阿尔法',
				attention: { badgeCount: 1, level: 'unread' },
				lastActivityAt: '2026-04-09T09:00:00.000Z',
			}),
			baseEntry({
				id: 'newer',
				title: '较新未读',
				attention: { badgeCount: 1, level: 'unread' },
				lastActivityAt: '2026-04-09T10:00:00.000Z',
			}),
		]);

		expect(state.entries.map((entry) => entry.id)).toEqual(['newer', 'alpha', 'zebra']);
	});

	it('caps the visible entries and reports the overflow count', () => {
		const state = buildSidebarAttentionDock(
			[
				baseEntry({
					id: 'room-1',
					title: '房间 1',
					attention: { badgeCount: 1, level: 'mention' },
					lastActivityAt: '2026-04-09T10:00:00.000Z',
				}),
				baseEntry({
					id: 'room-2',
					title: '房间 2',
					attention: { badgeCount: 1, level: 'unread' },
					lastActivityAt: '2026-04-09T09:00:00.000Z',
				}),
				baseEntry({
					id: 'room-3',
					title: '房间 3',
					attention: { level: 'activity' },
					lastActivityAt: '2026-04-09T08:00:00.000Z',
				}),
				baseEntry({
					id: 'room-4',
					title: '房间 4',
					attention: { level: 'activity' },
					lastActivityAt: '2026-04-09T07:00:00.000Z',
				}),
			],
			{
				maxVisible: 2,
			},
		);

		expect(state.entries.map((entry) => entry.id)).toEqual(['room-1', 'room-2']);
		expect(state.overflowCount).toBe(2);
	});
});

describe('resolveSidebarAttentionDockLabel', () => {
	it('uses explicit copy for mention, unread, unread-without-count, and activity states', () => {
		expect(resolveSidebarAttentionDockLabel(baseEntry({ attention: { badgeCount: 1, level: 'mention' } }))).toBe('提及你');
		expect(resolveSidebarAttentionDockLabel(baseEntry({ attention: { badgeCount: 3, level: 'unread' } }))).toBe('3 条未读');
		expect(resolveSidebarAttentionDockLabel(baseEntry({ attention: { level: 'unread' } }))).toBe('有未读消息');
		expect(resolveSidebarAttentionDockLabel(baseEntry({ attention: { level: 'activity' } }))).toBe('有新动态');
		expect(resolveSidebarAttentionDockLabel(baseEntry({ attention: { level: 'none' } }))).toBeNull();
	});
});
