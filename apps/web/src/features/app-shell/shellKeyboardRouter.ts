export type ShellKeyboardAction =
	| {
			kind: 'focus-search';
	  }
	| {
			kind: 'open-settings';
	  }
	| {
			kind: 'focus-sidebar';
	  }
	| {
			kind: 'focus-timeline';
			strategy: 'first-message' | 'preferred' | 'unread-or-latest';
	  }
	| {
			kind: 'focus-composer';
	  };

const isPlainNavigationKey = (key: string) => ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home'].includes(key);

export const resolveShellKeyboardAction = ({
	altKey,
	ctrlKey,
	isNeutralShellFocus,
	key,
	metaKey,
	shiftKey,
}: {
	altKey: boolean;
	ctrlKey: boolean;
	isNeutralShellFocus: boolean;
	key: string;
	metaKey: boolean;
	shiftKey: boolean;
}): ShellKeyboardAction | null => {
	const normalizedKey = key.toLowerCase();
	const isSearchShortcut = (metaKey || ctrlKey) && !altKey && !shiftKey && normalizedKey === 'k';
	if (isSearchShortcut) {
		return {
			kind: 'focus-search',
		};
	}

	const isSettingsShortcut = (metaKey || ctrlKey) && !altKey && !shiftKey && key === ',';
	if (isSettingsShortcut) {
		return {
			kind: 'open-settings',
		};
	}

	if (altKey && !ctrlKey && !metaKey && !shiftKey) {
		if (key === '1') {
			return {
				kind: 'focus-sidebar',
			};
		}

		if (key === '2') {
			return {
				kind: 'focus-timeline',
				strategy: 'preferred',
			};
		}

		if (key === '3') {
			return {
				kind: 'focus-composer',
			};
		}
	}

	if (!isNeutralShellFocus || altKey || ctrlKey || metaKey || shiftKey || !isPlainNavigationKey(key)) {
		return null;
	}

	if (key === 'ArrowRight' || key === 'ArrowDown') {
		return {
			kind: 'focus-timeline',
			strategy: 'preferred',
		};
	}

	if (key === 'Home') {
		return {
			kind: 'focus-timeline',
			strategy: 'first-message',
		};
	}

	if (key === 'End') {
		return {
			kind: 'focus-timeline',
			strategy: 'unread-or-latest',
		};
	}

	return {
		kind: 'focus-sidebar',
	};
};
