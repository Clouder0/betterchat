import { describe, expect, it } from 'vitest';

import { formatSidebarUnreadBadgeCount } from './sidebarUnreadBadge';

describe('formatSidebarUnreadBadgeCount', () => {
	it('returns null when there is no unread count', () => {
		expect(formatSidebarUnreadBadgeCount(0)).toBeNull();
		expect(formatSidebarUnreadBadgeCount(-3)).toBeNull();
	});

	it('returns the exact count when it fits in the reserved badge lane', () => {
		expect(formatSidebarUnreadBadgeCount(1)).toBe('1');
		expect(formatSidebarUnreadBadgeCount(57)).toBe('57');
		expect(formatSidebarUnreadBadgeCount(999)).toBe('999');
	});

	it('caps large counts to 999+', () => {
		expect(formatSidebarUnreadBadgeCount(1_000)).toBe('999+');
		expect(formatSidebarUnreadBadgeCount(20_500)).toBe('999+');
	});
});
