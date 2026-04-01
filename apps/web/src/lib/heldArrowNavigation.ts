export const HELD_ARROW_NAVIGATION_INTERVAL_MS = 80;

export type HeldArrowNavigationState = {
	key: 'ArrowDown' | 'ArrowUp' | null;
	lastHandledAt: number;
};

export const createHeldArrowNavigationState = (): HeldArrowNavigationState => ({
	key: null,
	lastHandledAt: Number.NEGATIVE_INFINITY,
});

export const resolveHeldArrowNavigationAllowance = ({
	key,
	lastState,
	now,
	repeat,
}: {
	key: string;
	lastState: HeldArrowNavigationState;
	now: number;
	repeat: boolean;
}) => {
	if (key !== 'ArrowDown' && key !== 'ArrowUp') {
		return {
			allow: true,
			nextState: lastState,
		};
	}

	if (!repeat) {
		return {
			allow: true,
			nextState: {
				key,
				lastHandledAt: now,
			} satisfies HeldArrowNavigationState,
		};
	}

	if (lastState.key !== key || now - lastState.lastHandledAt >= HELD_ARROW_NAVIGATION_INTERVAL_MS) {
		return {
			allow: true,
			nextState: {
				key,
				lastHandledAt: now,
			} satisfies HeldArrowNavigationState,
		};
	}

	return {
		allow: false,
		nextState: lastState,
	};
};
