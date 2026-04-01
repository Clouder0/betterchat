import { describe, expect, it } from 'bun:test';
import type { RoomSummary } from '@/lib/chatModels';

import { resolveSidebarSecondaryMeta } from './sidebarPresence';

const baseEntry = (overrides: Partial<RoomSummary>): RoomSummary => ({
	id: overrides.id ?? 'dm-room',
	kind: overrides.kind ?? 'dm',
	title: overrides.title ?? 'Bob Example',
	subtitle: overrides.subtitle,
	presence: overrides.presence,
	avatarUrl: overrides.avatarUrl,
	favorite: overrides.favorite ?? false,
	visibility: overrides.visibility ?? 'visible',
	attention: overrides.attention ?? { level: 'none' },
	lastActivityAt: overrides.lastActivityAt,
});

describe('resolveSidebarSecondaryMeta', () => {
	it('prefers structured dm presence from the contract over subtitle parsing', () => {
		expect(
			resolveSidebarSecondaryMeta(
				baseEntry({
					subtitle: '@bob',
					presence: 'busy',
				}),
			),
		).toEqual({
			presence: { label: '忙碌', tone: 'busy' },
			presenceLabel: '忙碌',
			text: '@bob',
		});
	});

	it('keeps online status concise while still exposing the dot state', () => {
		expect(
			resolveSidebarSecondaryMeta(
				baseEntry({
					subtitle: '平台同学 · 在线',
				}),
			),
		).toEqual({
			presence: { label: '在线', tone: 'online' },
			presenceLabel: null,
			text: '平台同学',
		});
	});

	it('keeps structured presence concise by stripping duplicated status text from the subtitle', () => {
		expect(
			resolveSidebarSecondaryMeta(
				baseEntry({
					subtitle: '平台同学 · 在线',
					presence: 'online',
				}),
			),
		).toEqual({
			presence: { label: '在线', tone: 'online' },
			presenceLabel: null,
			text: '平台同学',
		});
	});
});
