export type SidebarSearchKeyAction =
	| 'clear-search'
	| 'focus-fallback-room'
	| 'focus-first-room'
	| 'focus-header'
	| 'open-first-result'
	| null;

export const resolveSidebarSearchKeyAction = ({
	hasFallbackRoom,
	hasFirstSearchResult,
	hasVisibleSidebarRooms,
	key,
	searchValue,
}: {
	hasFallbackRoom: boolean;
	hasFirstSearchResult: boolean;
	hasVisibleSidebarRooms: boolean;
	key: string;
	searchValue: string;
}): SidebarSearchKeyAction => {
	if (key === 'Enter' && hasFirstSearchResult) {
		return 'open-first-result';
	}

	if (key === 'ArrowDown' && hasVisibleSidebarRooms) {
		return 'focus-first-room';
	}

	if (key === 'ArrowRight') {
		return 'focus-header';
	}

	if (key !== 'Escape') {
		return null;
	}

	if (searchValue) {
		return 'clear-search';
	}

	return hasFallbackRoom ? 'focus-fallback-room' : null;
};
