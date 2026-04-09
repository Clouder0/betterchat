export const resolveSidebarRoomRevealScrollTop = ({
	currentScrollTop,
	roomBottom,
	roomTop,
	viewportHeight,
}: {
	currentScrollTop: number;
	roomBottom: number;
	roomTop: number;
	viewportHeight: number;
}) => {
	const viewportTop = currentScrollTop;
	const viewportBottom = viewportTop + viewportHeight;

	if (roomTop >= viewportTop && roomBottom <= viewportBottom) {
		return null;
	}

	if (roomTop < viewportTop) {
		return Math.max(roomTop, 0);
	}

	return Math.max(roomBottom - viewportHeight, 0);
};

export const revealSidebarRoomInContainer = ({
	container,
	motionDisabled,
	roomButton,
}: {
	container: HTMLElement;
	motionDisabled: boolean;
	roomButton: HTMLElement;
}) => {
	const containerRect = container.getBoundingClientRect();
	const roomRect = roomButton.getBoundingClientRect();
	const roomTop = roomRect.top - containerRect.top + container.scrollTop;
	const roomBottom = roomTop + roomRect.height;
	const nextScrollTop = resolveSidebarRoomRevealScrollTop({
		currentScrollTop: container.scrollTop,
		roomBottom,
		roomTop,
		viewportHeight: container.clientHeight,
	});

	if (nextScrollTop === null) {
		return false;
	}

	container.scrollTo({
		behavior: motionDisabled ? 'instant' : 'smooth',
		top: nextScrollTop,
	});
	return true;
};
