export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'betterchat.sidebar-collapsed.v1';
export const SIDEBAR_COLLAPSE_SNAP_THRESHOLD_PX = 120;

const isStoredCollapsedValue = (value: unknown): value is boolean => typeof value === 'boolean';

export const loadSidebarCollapsedPreference = (): boolean => {
	if (typeof window === 'undefined') {
		return false;
	}

	const rawValue = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
	if (!rawValue) {
		return false;
	}

	try {
		const parsedValue: unknown = JSON.parse(rawValue);
		return isStoredCollapsedValue(parsedValue) ? parsedValue : false;
	} catch {
		return false;
	}
};

export const saveSidebarCollapsedPreference = (collapsed: boolean): void => {
	if (typeof window === 'undefined') {
		return;
	}

	window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, JSON.stringify(collapsed));
};

export const shouldSnapToCollapsed = ({ rawWidth, threshold }: { rawWidth: number; threshold: number }): boolean =>
	rawWidth < threshold;
