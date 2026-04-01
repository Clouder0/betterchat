type RevealTargetOptions = {
	paddingBottom?: number;
	paddingTop?: number;
	targetHeight: number;
	targetTop: number;
	viewportHeight: number;
	viewportTop: number;
};

export const resolveRevealScrollTop = ({
	paddingBottom = 24,
	paddingTop = 12,
	targetHeight,
	targetTop,
	viewportHeight,
	viewportTop,
}: RevealTargetOptions) => {
	const normalizedViewportHeight = Math.max(viewportHeight, 0);
	const normalizedTargetHeight = Math.max(targetHeight, 0);
	const targetBottom = targetTop + normalizedTargetHeight;
	const visibleTop = viewportTop + paddingTop;
	const visibleBottom = viewportTop + normalizedViewportHeight - paddingBottom;
	const usableViewportHeight = Math.max(normalizedViewportHeight - paddingTop - paddingBottom, 1);

	if (normalizedTargetHeight >= usableViewportHeight) {
		const alignedTop = Math.max(targetTop - paddingTop, 0);
		return alignedTop === viewportTop ? null : alignedTop;
	}

	if (targetTop >= visibleTop && targetBottom <= visibleBottom) {
		return null;
	}

	if (targetTop < visibleTop) {
		return Math.max(targetTop - paddingTop, 0);
	}

	return Math.max(targetBottom - normalizedViewportHeight + paddingBottom, 0);
};
