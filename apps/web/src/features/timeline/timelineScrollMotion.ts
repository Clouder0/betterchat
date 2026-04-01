const TIMELINE_SCROLL_DURATION_MIN_MS = 96;
const TIMELINE_SCROLL_DURATION_MAX_MS = 184;
const TIMELINE_SCROLL_DURATION_DISTANCE_PX = 1120;
const TIMELINE_CENTER_MIN_TOP_PADDING_PX = 28;
const TIMELINE_SCROLL_INTERRUPT_TOLERANCE_PX = 1.5;
const TIMELINE_SCROLL_FORWARD_DRIFT_TOLERANCE_PX = 24;
const TIMELINE_SCROLL_EASE_OUT_POWER = 2.35;

const clampUnitInterval = (value: number) => Math.min(Math.max(value, 0), 1);

export const resolveTimelineScrollDuration = (distancePx: number) => {
	const normalizedDistance = clampUnitInterval(Math.abs(distancePx) / TIMELINE_SCROLL_DURATION_DISTANCE_PX);
	return Math.round(
		TIMELINE_SCROLL_DURATION_MIN_MS +
			(TIMELINE_SCROLL_DURATION_MAX_MS - TIMELINE_SCROLL_DURATION_MIN_MS) * Math.pow(normalizedDistance, 0.74),
	);
};

export const easeTimelineScrollProgress = (progress: number) => {
	const clampedProgress = clampUnitInterval(progress);
	return 1 - Math.pow(1 - clampedProgress, TIMELINE_SCROLL_EASE_OUT_POWER);
};

export const resolveTimelineAnimatedScrollTop = ({
	from,
	progress,
	to,
}: {
	from: number;
	progress: number;
	to: number;
}) => from + (to - from) * easeTimelineScrollProgress(progress);

export const shouldAnimateTimelineScroll = ({
	behavior,
	distancePx,
	reducedMotion,
}: {
	behavior: ScrollBehavior;
	distancePx: number;
	reducedMotion: boolean;
}) => behavior === 'smooth' && !reducedMotion && Math.abs(distancePx) > 8;

export const shouldCancelTimelineScrollAnimation = ({
	actualScrollTop,
	animatedScrollActive,
	expectedScrollTop,
	previousScrollTop,
	targetScrollTop,
}: {
	actualScrollTop: number;
	animatedScrollActive: boolean;
	expectedScrollTop: number | null;
	previousScrollTop: number;
	targetScrollTop: number | null;
}) =>
	animatedScrollActive &&
	expectedScrollTop !== null &&
	!(
		targetScrollTop !== null &&
		Math.abs(actualScrollTop - expectedScrollTop) <= TIMELINE_SCROLL_FORWARD_DRIFT_TOLERANCE_PX &&
		Math.sign(targetScrollTop - expectedScrollTop) !== 0 &&
		Math.sign(actualScrollTop - previousScrollTop) === Math.sign(targetScrollTop - expectedScrollTop) &&
		Math.sign(actualScrollTop - previousScrollTop) !== 0
	) &&
	Math.abs(actualScrollTop - expectedScrollTop) > TIMELINE_SCROLL_INTERRUPT_TOLERANCE_PX;

export const shouldDeferTimelineViewportStateSync = ({
	animatedScrollActive,
	programmaticScrollActive,
}: {
	animatedScrollActive: boolean;
	programmaticScrollActive: boolean;
}) => animatedScrollActive && programmaticScrollActive;

export const resolveCenteredMessageScrollTop = ({
	containerHeight,
	targetHeight,
	targetTop,
}: {
	containerHeight: number;
	targetHeight: number;
	targetTop: number;
}) => Math.max(targetTop - Math.max((containerHeight - targetHeight) / 2, TIMELINE_CENTER_MIN_TOP_PADDING_PX), 0);
