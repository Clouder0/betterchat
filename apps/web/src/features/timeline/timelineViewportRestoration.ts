export type PendingContentResizeAdjustmentSource = 'bottom-reflow' | 'content-resize' | 'history-prepend';

export type PendingContentResizeAdjustment<TSnapshot> = {
	mode: 'anchor' | 'bottom';
	roomId: string;
	snapshot: TSnapshot | null;
	source: PendingContentResizeAdjustmentSource;
};

export type ActiveHistoryPrependRestore<TSnapshot> = {
	baselineMessageCount: number;
	baselineScrollHeight: number;
	baselineScrollTop: number;
	pendingLayoutRestore: boolean;
	revision: number;
	roomId: string;
	snapshot: TSnapshot;
	startedAt: number;
};

export const resolveHistoryPrependRestoreScrollTop = ({
	baselineScrollHeight,
	baselineScrollTop,
	currentScrollHeight,
}: {
	baselineScrollHeight: number;
	baselineScrollTop: number;
	currentScrollHeight: number;
}) => Math.max(baselineScrollTop + Math.max(currentScrollHeight - baselineScrollHeight, 0), 0);

export const normalizePendingContentResizeAdjustment = <TSnapshot>({
	activeHistoryPrependRestore,
	nextAdjustment,
}: {
	activeHistoryPrependRestore: ActiveHistoryPrependRestore<TSnapshot> | null;
	nextAdjustment: PendingContentResizeAdjustment<TSnapshot>;
}): PendingContentResizeAdjustment<TSnapshot> => {
	if (
		nextAdjustment.mode !== 'anchor' ||
		!activeHistoryPrependRestore ||
		activeHistoryPrependRestore.roomId !== nextAdjustment.roomId
	) {
		return nextAdjustment;
	}

	return {
		...nextAdjustment,
		snapshot: activeHistoryPrependRestore.snapshot,
		source: 'history-prepend',
	};
};

export const mergePendingContentResizeAdjustment = <TSnapshot>({
	currentAdjustment,
	nextAdjustment,
}: {
	currentAdjustment: PendingContentResizeAdjustment<TSnapshot> | null;
	nextAdjustment: PendingContentResizeAdjustment<TSnapshot>;
}): PendingContentResizeAdjustment<TSnapshot> => {
	if (!currentAdjustment) {
		return nextAdjustment;
	}

	if (nextAdjustment.mode === 'bottom') {
		return nextAdjustment;
	}

	if (currentAdjustment.mode === 'bottom') {
		return currentAdjustment;
	}

	if (currentAdjustment.source === 'history-prepend' && nextAdjustment.source !== 'history-prepend') {
		return currentAdjustment;
	}

	return nextAdjustment;
};
