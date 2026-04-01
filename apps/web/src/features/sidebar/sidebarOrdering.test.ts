import { describe, expect, it } from 'bun:test';
import type { RoomSummary } from '@/lib/chatModels';

import { buildSidebarGroups } from './sidebarModel';
import { deriveSidebarOrderingState } from './sidebarOrdering';

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

describe('deriveSidebarOrderingState', () => {
	it('holds the active room in its previous attention bucket after unread clears', () => {
		const previousEntries = [
			baseEntry({
				id: 'active-room',
				title: '当前房间',
				kind: 'dm',
				attention: { level: 'unread', badgeCount: 1 },
				lastActivityAt: '2026-03-27T09:00:00.000Z',
			}),
			baseEntry({
				id: 'quiet-room',
				title: '较新的安静房间',
				kind: 'dm',
				attention: { level: 'none' },
				lastActivityAt: '2026-03-27T09:10:00.000Z',
			}),
		];
		const nextEntries = [
			baseEntry({
				id: 'active-room',
				title: '当前房间',
				kind: 'dm',
				attention: { level: 'none' },
				lastActivityAt: '2026-03-27T09:00:00.000Z',
			}),
			baseEntry({
				id: 'quiet-room',
				title: '较新的安静房间',
				kind: 'dm',
				attention: { level: 'none' },
				lastActivityAt: '2026-03-27T09:10:00.000Z',
			}),
		];

		const orderingState = deriveSidebarOrderingState({
			activeRoomId: 'active-room',
			nextEntries,
			previousEntries,
		});
		const groups = buildSidebarGroups(nextEntries, '', {}, orderingState, 'active-room');

		expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(['active-room', 'quiet-room']);
	});

	it('lets genuinely newer unread rooms rise above a held active room', () => {
		const previousEntries = [
			baseEntry({
				id: 'active-room',
				title: '当前房间',
				kind: 'dm',
				attention: { level: 'unread', badgeCount: 1 },
				lastActivityAt: '2026-03-27T09:00:00.000Z',
			}),
			baseEntry({
				id: 'quiet-room',
				title: '较新的安静房间',
				kind: 'dm',
				attention: { level: 'none' },
				lastActivityAt: '2026-03-27T09:10:00.000Z',
			}),
		];
		const nextEntries = [
			baseEntry({
				id: 'active-room',
				title: '当前房间',
				kind: 'dm',
				attention: { level: 'none' },
				lastActivityAt: '2026-03-27T09:00:00.000Z',
			}),
			baseEntry({
				id: 'quiet-room',
				title: '较新的安静房间',
				kind: 'dm',
				attention: { level: 'none' },
				lastActivityAt: '2026-03-27T09:10:00.000Z',
			}),
			baseEntry({
				id: 'new-unread',
				title: '更新的未读房间',
				kind: 'dm',
				attention: { level: 'unread', badgeCount: 1 },
				lastActivityAt: '2026-03-27T09:20:00.000Z',
			}),
		];

		const orderingState = deriveSidebarOrderingState({
			activeRoomId: 'active-room',
			nextEntries,
			previousEntries,
		});
		const groups = buildSidebarGroups(nextEntries, '', {}, orderingState, 'active-room');

		expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(['new-unread', 'active-room', 'quiet-room']);
	});

	it('drops the hold once the user leaves the room and returns to true quiet ordering', () => {
		const previousEntries = [
			baseEntry({
				id: 'active-room',
				title: '当前房间',
				kind: 'dm',
				attention: { level: 'none' },
				lastActivityAt: '2026-03-27T09:00:00.000Z',
			}),
			baseEntry({
				id: 'quiet-room',
				title: '较新的安静房间',
				kind: 'dm',
				attention: { level: 'none' },
				lastActivityAt: '2026-03-27T09:10:00.000Z',
			}),
		];
		const heldState = deriveSidebarOrderingState({
			activeRoomId: 'active-room',
			nextEntries: previousEntries,
			previousEntries: [
				baseEntry({
					id: 'active-room',
					title: '当前房间',
					kind: 'dm',
					attention: { level: 'unread', badgeCount: 1 },
					lastActivityAt: '2026-03-27T09:00:00.000Z',
				}),
				baseEntry({
					id: 'quiet-room',
					title: '较新的安静房间',
					kind: 'dm',
					attention: { level: 'none' },
					lastActivityAt: '2026-03-27T09:10:00.000Z',
				}),
			],
		});
		const settledState = deriveSidebarOrderingState({
			activeRoomId: 'quiet-room',
			nextEntries: previousEntries,
			previousEntries,
			previousState: heldState,
		});
		const groups = buildSidebarGroups(previousEntries, '', {}, settledState, 'quiet-room');

		expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(['quiet-room', 'active-room']);
	});
});
