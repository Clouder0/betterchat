import { useCallback, useRef, useState } from 'react';
import { copyTextToClipboard } from '@/lib/clipboard';

export type ClipboardState = 'idle' | 'copied' | 'error';

type UseClipboardOptions = {
	resetAfter?: number;
};

type UseClipboardReturn = {
	state: ClipboardState;
	error: string | null;
	copy: (text: string) => Promise<void>;
	reset: () => void;
};

export const useClipboard = (options: UseClipboardOptions = {}): UseClipboardReturn => {
	const { resetAfter = 1600 } = options;
	const [state, setState] = useState<ClipboardState>('idle');
	const [error, setError] = useState<string | null>(null);
	const resetTimerRef = useRef<number | null>(null);

	const reset = useCallback(() => {
		if (resetTimerRef.current) {
			window.clearTimeout(resetTimerRef.current);
			resetTimerRef.current = null;
		}
		setState('idle');
		setError(null);
	}, []);

	const copy = useCallback(
		async (text: string) => {
			// Clear any existing timer
			if (resetTimerRef.current) {
				window.clearTimeout(resetTimerRef.current);
				resetTimerRef.current = null;
			}

			const result = await copyTextToClipboard(text);

			if (result.success) {
				setState('copied');
				setError(null);
			} else {
				setState('error');
				setError(result.message);
			}

			// Auto-reset after specified timeout
			resetTimerRef.current = window.setTimeout(() => {
				setState('idle');
				setError(null);
				resetTimerRef.current = null;
			}, resetAfter);
		},
		[resetAfter],
	);

	return {
		state,
		error,
		copy,
		reset,
	};
};
