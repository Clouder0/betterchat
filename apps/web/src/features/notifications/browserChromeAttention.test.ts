import { describe, expect, it } from 'bun:test';

import type { RoomSummary } from '@/lib/chatModels';

import {
	createBrowserChromeFaviconHref,
	formatBrowserChromeTitle,
	resolveBrowserChromeAttention,
} from './browserChromeAttention';

const baseRoom = (overrides: Partial<RoomSummary> & Pick<RoomSummary, 'id'>): RoomSummary => ({
	attention: {
		level: 'none',
	},
	favorite: false,
	kind: 'channel',
	title: overrides.id,
	visibility: 'visible',
	...overrides,
});

describe('browserChromeAttention', () => {
	it('counts visible attention-worthy unread and mention messages while respecting room notification preferences', () => {
		const attention = resolveBrowserChromeAttention([
			baseRoom({
				id: 'generic-channel',
				attention: { level: 'unread', badgeCount: 5 },
			}),
			baseRoom({
				id: 'mentioned-channel',
				attention: { level: 'mention', badgeCount: 2 },
			}),
			baseRoom({
				id: 'dm-alice',
				kind: 'dm',
				attention: { level: 'unread', badgeCount: 3 },
			}),
			baseRoom({
				id: 'muted-room',
				attention: { level: 'mention', badgeCount: 9 },
			}),
			baseRoom({
				id: 'hidden-dm',
				kind: 'dm',
				visibility: 'hidden',
				attention: { level: 'unread', badgeCount: 10 },
			}),
		], {
			preferences: {
				'muted-room': 'mute',
			},
		});

		expect(attention.count).toBe(5);
		expect(attention.badgeLabel).toBe('5');
		expect(attention.hasAttention).toBe(true);
		expect(attention.hasMention).toBe(true);
		expect(attention.hasUncountedActivity).toBe(false);
		expect(attention.tone).toBe('mention');
	});

	it('uses explicit all-message room preferences for generic channel unread', () => {
		const attention = resolveBrowserChromeAttention([
			baseRoom({
				id: 'all-channel',
				attention: { level: 'unread', badgeCount: 7 },
			}),
		], {
			preferences: {
				'all-channel': 'all',
			},
		});

		expect(attention.count).toBe(7);
		expect(attention.tone).toBe('unread');
	});

	it('keeps uncounted activity visible without fabricating a message count', () => {
		const attention = resolveBrowserChromeAttention([
			baseRoom({
				id: 'thread-activity',
				attention: { level: 'activity' },
			}),
		], {
			defaults: {
				dms: 'all',
				rooms: 'all',
			},
			preferences: {},
		});

		expect(attention.count).toBe(0);
		expect(attention.badgeLabel).toBeNull();
		expect(attention.hasAttention).toBe(true);
		expect(attention.hasUncountedActivity).toBe(true);
		expect(attention.tone).toBe('activity');
		expect(formatBrowserChromeTitle('BetterChat', attention)).toBe('\u2022 BetterChat');
	});

	it('formats counted titles and caps browser chrome badge labels', () => {
		const attention = resolveBrowserChromeAttention([
			baseRoom({
				id: 'dm-busy',
				kind: 'dm',
				attention: { level: 'unread', badgeCount: 120 },
			}),
		]);

		expect(attention.count).toBe(120);
		expect(attention.badgeLabel).toBe('99+');
		expect(formatBrowserChromeTitle('BetterChat', attention)).toBe('(99+) BetterChat');
	});

	it('generates a badged favicon data URL only when browser chrome attention exists', () => {
		const emptyAttention = resolveBrowserChromeAttention([]);
		expect(createBrowserChromeFaviconHref(emptyAttention)).toBeNull();

		const mentionAttention = resolveBrowserChromeAttention([
			baseRoom({
				id: 'mention',
				attention: { level: 'mention', badgeCount: 1 },
			}),
		], {
			defaults: {
				dms: 'all',
				rooms: 'all',
			},
			preferences: {},
		});
		const faviconHref = createBrowserChromeFaviconHref(mentionAttention);
		expect(faviconHref).toStartWith('data:image/svg+xml;charset=utf-8,');

		const svg = decodeURIComponent(faviconHref!.slice(faviconHref!.indexOf(',') + 1));
		expect(svg).toContain('data-browser-chrome-badge="mention"');
		expect(svg).toContain('>1<');
		expect(svg).toContain('fill="#101826"');
	});
});
