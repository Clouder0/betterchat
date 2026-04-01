export const resolveSidebarScrollBehavior = ({
	motionDisabled,
}: {
	motionDisabled: boolean;
}): ScrollIntoViewOptions => ({
	block: 'nearest',
	behavior: motionDisabled ? 'instant' : 'smooth',
});
