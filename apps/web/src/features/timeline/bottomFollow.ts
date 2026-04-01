export const shouldCancelBottomFollowOnViewportChange = ({
	bottomGap,
	programmaticScrollActive,
	scrollTop,
	previousScrollTop,
}: {
	bottomGap: number;
	programmaticScrollActive: boolean;
	scrollTop: number;
	previousScrollTop: number;
}) => bottomGap > 72 && !programmaticScrollActive && scrollTop + 2 < previousScrollTop;
