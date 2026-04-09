export const shouldCancelBottomFollowOnViewportChange = ({
	bottomGap,
	previousBottomGap,
	programmaticScrollActive,
	scrollTop,
	previousScrollTop,
}: {
	bottomGap: number;
	previousBottomGap: number;
	programmaticScrollActive: boolean;
	scrollTop: number;
	previousScrollTop: number;
}) => {
	if (programmaticScrollActive || bottomGap <= 72) {
		return false;
	}

	const movedViewport = Math.abs(scrollTop - previousScrollTop) > 1;
	if (previousBottomGap <= 72 && movedViewport) {
		return true;
	}

	return scrollTop + 2 < previousScrollTop;
};
