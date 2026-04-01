type KeyboardFocusRegion = 'composer' | 'header' | 'sidebar-list' | 'sidebar-search' | 'timeline' | null;

export const shouldIgnorePointerRegionMove = ({
	eventType,
	lastSidebarFocusEpoch,
	lastTimelinePointerEpoch,
	nextRegion,
	previousRegion,
}: {
	eventType: 'pointerdown' | 'pointermove';
	lastSidebarFocusEpoch: number;
	lastTimelinePointerEpoch: number;
	nextRegion: KeyboardFocusRegion;
	previousRegion: KeyboardFocusRegion;
}) => {
	if (eventType !== 'pointermove' || nextRegion !== previousRegion) {
		return false;
	}

	if (nextRegion !== 'timeline') {
		return true;
	}

	return lastTimelinePointerEpoch > lastSidebarFocusEpoch;
};

export const shouldRefreshTimelinePointerEpoch = ({
	eventType,
	lastSidebarFocusEpoch,
	lastTimelinePointerEpoch,
	nextRegion,
	previousRegion,
}: {
	eventType: 'pointerdown' | 'pointermove';
	lastSidebarFocusEpoch: number;
	lastTimelinePointerEpoch: number;
	nextRegion: KeyboardFocusRegion;
	previousRegion: KeyboardFocusRegion;
}) =>
	nextRegion === 'timeline' &&
	(eventType === 'pointerdown' ||
		nextRegion !== previousRegion ||
		lastTimelinePointerEpoch <= lastSidebarFocusEpoch);
