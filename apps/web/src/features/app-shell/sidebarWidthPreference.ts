export const SIDEBAR_WIDTH_STORAGE_KEY = 'betterchat.sidebar-width.v1';
export const DEFAULT_SIDEBAR_WIDTH_PX = 292;
export const MIN_SIDEBAR_WIDTH_PX = 248;
export const MAX_SIDEBAR_WIDTH_PX = 560;
export const SIDEBAR_RESIZE_DESKTOP_BREAKPOINT_PX = 980;
export const INLINE_INFO_SIDEBAR_BREAKPOINT_PX = 1260;

const MIN_MAIN_PANEL_WIDTH_PX = 560;
const WORKSPACE_EDGE_RESERVE_PX = 56;
const INFO_SIDEBAR_WIDTH_PX = 272;

const isStoredSidebarWidth = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const clampSidebarWidth = (value: number, bounds: { max: number; min: number }) =>
	Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));

export const clampSidebarPreviewWidth = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value)));

export const formatSidebarWidthCssValue = (value: number) => `${Math.round(value)}px`;

export const resolveSidebarResizeWidth = ({
	bounds,
	currentX,
	startWidth,
	startX,
}: {
	bounds: { max: number; min: number };
	currentX: number;
	startWidth: number;
	startX: number;
}) => clampSidebarWidth(startWidth + (currentX - startX), bounds);

export const resolveSidebarPreviewWidth = ({
	currentX,
	max,
	startWidth,
	startX,
}: {
	currentX: number;
	max: number;
	startWidth: number;
	startX: number;
}) => clampSidebarPreviewWidth(startWidth + (currentX - startX), max);

export const resolveSidebarWidthBounds = ({
	infoSidebarOpen,
	viewportWidth,
}: {
	infoSidebarOpen: boolean;
	viewportWidth: number;
}) => {
	const reservedInlineInfoWidth =
		infoSidebarOpen && viewportWidth > INLINE_INFO_SIDEBAR_BREAKPOINT_PX ? INFO_SIDEBAR_WIDTH_PX : 0;
	const computedMax = viewportWidth - reservedInlineInfoWidth - MIN_MAIN_PANEL_WIDTH_PX - WORKSPACE_EDGE_RESERVE_PX;
	const max = Math.max(MIN_SIDEBAR_WIDTH_PX, Math.min(MAX_SIDEBAR_WIDTH_PX, computedMax));

	return {
		min: MIN_SIDEBAR_WIDTH_PX,
		max,
	};
};

export const loadSidebarWidthPreference = () => {
	if (typeof window === 'undefined') {
		return DEFAULT_SIDEBAR_WIDTH_PX;
	}

	const rawValue = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
	if (!rawValue) {
		return DEFAULT_SIDEBAR_WIDTH_PX;
	}

	try {
		const parsedValue: unknown = JSON.parse(rawValue);
		return isStoredSidebarWidth(parsedValue) ? parsedValue : DEFAULT_SIDEBAR_WIDTH_PX;
	} catch {
		return DEFAULT_SIDEBAR_WIDTH_PX;
	}
};

export const saveSidebarWidthPreference = (value: number) => {
	if (typeof window === 'undefined') {
		return;
	}

	window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, JSON.stringify(Math.round(value)));
};
