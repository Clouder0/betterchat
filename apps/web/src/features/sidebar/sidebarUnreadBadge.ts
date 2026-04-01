const MAX_SIDEBAR_UNREAD_BADGE = 999;

export const formatSidebarUnreadBadgeCount = (count: number) => {
	if (count <= 0) {
		return null;
	}

	if (count > MAX_SIDEBAR_UNREAD_BADGE) {
		return `${MAX_SIDEBAR_UNREAD_BADGE}+`;
	}

	return String(count);
};

