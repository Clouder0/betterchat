import { describe, expect, it } from 'bun:test';

import type { RoomSummary } from '@/lib/chatModels';
import { buildSidebarGroups } from '@/features/sidebar/sidebarModel';
import { deriveSidebarOrderingState } from '@/features/sidebar/sidebarOrdering';

import { buildRoomSelectionGroups } from './roomSelectionGroups';

const createEntry = ({
	attentionLevel = 'none',
	favorite = false,
	id,
	kind = 'channel',
	lastActivityAt = '2026-03-30T12:00:00.000Z',
	title,
}: {
	attentionLevel?: RoomSummary['attention']['level'];
	favorite?: boolean;
	id: string;
	kind?: RoomSummary['kind'];
	lastActivityAt?: string;
	title: string;
}): RoomSummary => ({
	id,
	kind,
	title,
	favorite,
	visibility: 'visible',
	attention: {
		level: attentionLevel,
	},
	lastActivityAt,
});

describe('buildRoomSelectionGroups', () => {
	it('uses the same ordering inputs as the sidebar, including held attention for the active room', () => {
		const previousEntries = [
			createEntry({
				attentionLevel: 'mention',
				id: 'room-active',
				lastActivityAt: '2026-03-30T12:10:00.000Z',
				title: '当前房间',
			}),
			createEntry({
				attentionLevel: 'none',
				id: 'room-other',
				lastActivityAt: '2026-03-30T12:09:00.000Z',
				title: '另一个房间',
			}),
		];
		const nextEntries = [
			createEntry({
				attentionLevel: 'none',
				id: 'room-active',
				lastActivityAt: '2026-03-30T12:10:00.000Z',
				title: '当前房间',
			}),
			createEntry({
				attentionLevel: 'none',
				id: 'room-other',
				lastActivityAt: '2026-03-30T12:09:00.000Z',
				title: '另一个房间',
			}),
		];
		const orderingState = deriveSidebarOrderingState({
			activeRoomId: 'room-active',
			nextEntries,
			now: () => Date.parse('2026-03-30T12:10:30.000Z'),
			previousEntries,
		});
		const alertPreferences = {
			'room-active': 'normal' as const,
			'room-other': 'normal' as const,
		};

		expect(
			buildRoomSelectionGroups({
				activeRoomId: 'room-active',
				alertPreferences,
				entries: nextEntries,
				orderingState,
				query: '',
			}),
		).toEqual(
			buildSidebarGroups(nextEntries, '', alertPreferences, orderingState, 'room-active'),
		);
	});
});
