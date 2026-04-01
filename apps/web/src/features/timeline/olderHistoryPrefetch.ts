const HISTORY_PREFETCH_VIEWPORT_RATIO = 0.85;
const HISTORY_PREFETCH_MAX_DISTANCE_PX = 320;
const HISTORY_PREFETCH_READY_LOAD_VIEWPORT_RATIO = 0.4;
const HISTORY_PREFETCH_READY_LOAD_MAX_DISTANCE_PX = 192;

export const resolveOlderHistoryPrefetchThreshold = ({
	loadThresholdPx,
	viewportHeight,
}: {
	loadThresholdPx: number;
	viewportHeight: number;
}) => Math.max(loadThresholdPx, Math.min(Math.round(viewportHeight * HISTORY_PREFETCH_VIEWPORT_RATIO), HISTORY_PREFETCH_MAX_DISTANCE_PX));

export const resolveOlderHistoryReadyLoadThreshold = ({
	loadThresholdPx,
	viewportHeight,
}: {
	loadThresholdPx: number;
	viewportHeight: number;
}) =>
	Math.max(
		loadThresholdPx,
		Math.min(Math.round(viewportHeight * HISTORY_PREFETCH_READY_LOAD_VIEWPORT_RATIO), HISTORY_PREFETCH_READY_LOAD_MAX_DISTANCE_PX),
	);

export const shouldPrefetchOlderHistory = ({
	hasOlderHistory,
	isLoadingOlderHistory,
	loadThresholdPx,
	prefetchPending,
	scrollingUp,
	scrollTop,
	viewportHeight,
}: {
	hasOlderHistory: boolean;
	isLoadingOlderHistory: boolean;
	loadThresholdPx: number;
	prefetchPending: boolean;
	scrollingUp: boolean;
	scrollTop: number;
	viewportHeight: number;
}) => {
	if (!hasOlderHistory || isLoadingOlderHistory || prefetchPending || !scrollingUp) {
		return false;
	}

	const prefetchThreshold = resolveOlderHistoryPrefetchThreshold({
		loadThresholdPx,
		viewportHeight,
	});
	return scrollTop > loadThresholdPx && scrollTop <= prefetchThreshold;
};

export const shouldLoadOlderHistory = ({
	hasOlderHistory,
	isLoadingOlderHistory,
	loadInFlight,
	loadThresholdPx,
	prefetchedPageReady,
	programmaticScrollActive,
	scrollingUp,
	scrollTop,
	viewportHeight,
}: {
	hasOlderHistory: boolean;
	isLoadingOlderHistory: boolean;
	loadInFlight: boolean;
	loadThresholdPx: number;
	prefetchedPageReady: boolean;
	programmaticScrollActive: boolean;
	scrollingUp: boolean;
	scrollTop: number;
	viewportHeight: number;
}) => {
	if (
		!hasOlderHistory ||
		isLoadingOlderHistory ||
		loadInFlight ||
		programmaticScrollActive ||
		!scrollingUp
	) {
		return false;
	}

	const effectiveLoadThreshold = prefetchedPageReady
		? resolveOlderHistoryReadyLoadThreshold({
				loadThresholdPx,
				viewportHeight,
		  })
		: loadThresholdPx;

	return scrollTop <= effectiveLoadThreshold;
};
