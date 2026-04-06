import { describe, expect, it } from 'bun:test';

import {
	loadSidebarCollapsedPreference,
	shouldSnapToCollapsed,
} from './sidebarCollapsePreference';

describe('sidebarCollapsePreference', () => {
	it('returns false when no stored value exists', () => {
		expect(loadSidebarCollapsedPreference()).toBe(false);
	});

	it('snaps to collapsed when raw width is below threshold', () => {
		expect(shouldSnapToCollapsed({ rawWidth: 80, threshold: 120 })).toBe(true);
		expect(shouldSnapToCollapsed({ rawWidth: 0, threshold: 120 })).toBe(true);
		expect(shouldSnapToCollapsed({ rawWidth: -50, threshold: 120 })).toBe(true);
		expect(shouldSnapToCollapsed({ rawWidth: 119, threshold: 120 })).toBe(true);
	});

	it('does not snap to collapsed when raw width is at or above threshold', () => {
		expect(shouldSnapToCollapsed({ rawWidth: 120, threshold: 120 })).toBe(false);
		expect(shouldSnapToCollapsed({ rawWidth: 200, threshold: 120 })).toBe(false);
		expect(shouldSnapToCollapsed({ rawWidth: 292, threshold: 120 })).toBe(false);
	});
});
