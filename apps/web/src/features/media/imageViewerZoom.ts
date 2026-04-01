const IMAGE_VIEWER_WHEEL_ZOOM_PIXEL_SCALE = 0.0028;
const IMAGE_VIEWER_WHEEL_ZOOM_LINE_SCALE = 0.058;
const IMAGE_VIEWER_WHEEL_ZOOM_PAGE_SCALE = 0.22;
const IMAGE_VIEWER_WHEEL_ZOOM_MIN_STEP = 0.018;
const IMAGE_VIEWER_WHEEL_ZOOM_MAX_STEP = 0.24;
const IMAGE_VIEWER_WHEEL_NAVIGATION_LINE_HEIGHT_PX = 18;
const IMAGE_VIEWER_WHEEL_NAVIGATION_PAGE_HEIGHT_PX = 120;
const IMAGE_VIEWER_WHEEL_NAVIGATION_THRESHOLD_PX = 56;

export const normalizeImageViewerWheelZoomDelta = ({
	deltaMode,
	deltaY,
}: {
	deltaMode: number;
	deltaY: number;
}) => {
	let zoomDelta = -deltaY;

	if (deltaMode === 1) {
		zoomDelta *= IMAGE_VIEWER_WHEEL_ZOOM_LINE_SCALE;
	} else if (deltaMode === 2) {
		zoomDelta *= IMAGE_VIEWER_WHEEL_ZOOM_PAGE_SCALE;
	} else {
		zoomDelta *= deltaMode === 0 ? IMAGE_VIEWER_WHEEL_ZOOM_PIXEL_SCALE : IMAGE_VIEWER_WHEEL_ZOOM_PAGE_SCALE;
	}

	return zoomDelta;
};

export const resolveImageViewerWheelZoomFactor = (zoomDelta: number) => {
	if (!Number.isFinite(zoomDelta) || zoomDelta === 0) {
		return 1;
	}

	const direction = Math.sign(zoomDelta);
	const magnitude = Math.min(
		Math.max(Math.abs(zoomDelta), IMAGE_VIEWER_WHEEL_ZOOM_MIN_STEP),
		IMAGE_VIEWER_WHEEL_ZOOM_MAX_STEP,
	);

	return 2 ** (direction * magnitude);
};

export const normalizeImageViewerWheelNavigationDelta = ({
	deltaMode,
	deltaX,
	deltaY,
}: {
	deltaMode: number;
	deltaX: number;
	deltaY: number;
}) => {
	const dominantDelta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;

	if (deltaMode === 1) {
		return dominantDelta * IMAGE_VIEWER_WHEEL_NAVIGATION_LINE_HEIGHT_PX;
	}

	if (deltaMode === 2) {
		return dominantDelta * IMAGE_VIEWER_WHEEL_NAVIGATION_PAGE_HEIGHT_PX;
	}

	return dominantDelta;
};

export const resolveImageViewerWheelNavigationDirection = (deltaPx: number) => {
	if (Math.abs(deltaPx) < IMAGE_VIEWER_WHEEL_NAVIGATION_THRESHOLD_PX) {
		return null;
	}

	return deltaPx > 0 ? 'next' : 'prev';
};

export const formatImageViewerZoomPercent = ({
	currZoomLevel,
	initialZoomLevel,
}: {
	currZoomLevel: number;
	initialZoomLevel: number;
}) => {
	if (!Number.isFinite(currZoomLevel) || !Number.isFinite(initialZoomLevel) || initialZoomLevel <= 0) {
		return '100%';
	}

	return `${Math.max(1, Math.round((currZoomLevel / initialZoomLevel) * 100))}%`;
};
