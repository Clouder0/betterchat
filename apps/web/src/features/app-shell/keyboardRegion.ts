export type KeyboardFocusRegion = 'sidebar-list' | 'timeline' | 'header' | 'composer' | null;

export const resolveElementKeyboardRegion = (element: Element | null): KeyboardFocusRegion => {
	if (!element) {
		return null;
	}

	if (element.closest('[data-testid="sidebar-resize-handle"]')) {
		return 'sidebar-list';
	}

	if (element.closest('[data-testid="composer-resize-handle"]')) {
		return 'composer';
	}

	if (
		element.closest('[data-testid="sidebar-body"]') ||
		element.closest('[data-testid="sidebar-search"]') ||
		element.closest('[data-testid="app-sidebar"]')
	) {
		return 'sidebar-list';
	}

	if (
		element.closest('[data-testid="timeline"]') ||
		element.closest('[data-testid="timeline-message-context-menu"]') ||
		element.closest('[data-testid="timeline-author-quick-panel"]')
	) {
		return 'timeline';
	}

	if (element.closest('[data-testid="composer"]')) {
		return 'composer';
	}

	if (
		element.closest('[data-testid="room-favorite-toggle"]') ||
		element.closest('[data-testid="room-info-trigger"]') ||
		element.closest('[data-testid="room-info-sidebar"]')
	) {
		return 'header';
	}

	return null;
};
