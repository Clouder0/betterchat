export const resolveSidebarMentionSignal = ({
	mentioned,
	unreadCount,
}: {
	mentioned: boolean;
	unreadCount: number;
}) => {
	if (!mentioned) {
		return {
			badgeAriaPrefix: null,
			showSignal: false,
			title: null,
		} as const;
	}

	return {
		badgeAriaPrefix: unreadCount > 0 ? '提及我，' : null,
		showSignal: true,
		title: '提及我',
	} as const;
};
