import { describe, expect, it } from 'bun:test';

import { resolveSidebarMentionSignal } from './sidebarMentionSignal';

describe('resolveSidebarMentionSignal', () => {
	it('shows a dedicated mention signal whenever the room mentioned the current user', () => {
		expect(
			resolveSidebarMentionSignal({
				mentioned: true,
				unreadCount: 0,
			}),
		).toEqual({
			badgeAriaPrefix: null,
			showSignal: true,
			title: '提及我',
		});

		expect(
			resolveSidebarMentionSignal({
				mentioned: true,
				unreadCount: 6,
			}),
		).toEqual({
			badgeAriaPrefix: '提及我，',
			showSignal: true,
			title: '提及我',
		});
	});

	it('keeps the signal hidden for ordinary unread rooms', () => {
		expect(
			resolveSidebarMentionSignal({
				mentioned: false,
				unreadCount: 8,
			}),
		).toEqual({
			badgeAriaPrefix: null,
			showSignal: false,
			title: null,
		});
	});
});
