import { describe, expect, it } from 'bun:test';

import {
	clampViewportSnapshotAnchorOffset,
	mergePendingContentResizeAdjustment,
	normalizePendingContentResizeAdjustment,
	resolveHistoryPrependRestoreScrollTop,
	resolveViewportSnapshotScrollTop,
	type ActiveHistoryPrependRestore,
	type PendingContentResizeAdjustment,
} from './timelineViewportRestoration';

type Snapshot = {
	anchorMessageId: string;
	anchorOffset: number;
};

const staleSnapshot: Snapshot = {
	anchorMessageId: 'history-060',
	anchorOffset: 24,
};

const lockedSnapshot: Snapshot = {
	anchorMessageId: 'history-083',
	anchorOffset: 52,
};

const historyPrependRestore: ActiveHistoryPrependRestore<Snapshot> = {
	baselineMessageCount: 50,
	baselineScrollHeight: 1_280,
	baselineScrollTop: 0,
	pendingLayoutRestore: true,
	revision: 0,
	roomId: 'history-archive',
	snapshot: lockedSnapshot,
	startedAt: 0,
};

const contentResizeAnchorAdjustment: PendingContentResizeAdjustment<Snapshot> = {
	mode: 'anchor',
	roomId: 'history-archive',
	snapshot: staleSnapshot,
	source: 'content-resize',
};

describe('timelineViewportRestoration', () => {
	it('clamps anchor offsets to the resized message height during viewport restoration', () => {
		expect(
			clampViewportSnapshotAnchorOffset({
				anchorHeight: 269,
				anchorOffset: 332,
			}),
		).toBe(268);

		expect(
			clampViewportSnapshotAnchorOffset({
				anchorHeight: 269,
				anchorOffset: 192,
			}),
		).toBe(192);
	});

	it('derives the restored scrollTop from the clamped anchor offset', () => {
		expect(
			resolveViewportSnapshotScrollTop({
				anchorHeight: 269,
				anchorOffset: 332,
				anchorTop: 874,
				viewportAnchorTopBias: 12,
			}),
		).toBe(1130);

		expect(
			resolveViewportSnapshotScrollTop({
				anchorHeight: 269,
				anchorOffset: 24,
				anchorTop: -10,
				viewportAnchorTopBias: 12,
			}),
		).toBe(2);
	});

	it('locks anchor adjustments to the original prepend snapshot while history prepend restoration is active', () => {
		expect(
			normalizePendingContentResizeAdjustment({
				activeHistoryPrependRestore: historyPrependRestore,
				nextAdjustment: contentResizeAnchorAdjustment,
			}),
		).toEqual({
			mode: 'anchor',
			roomId: 'history-archive',
			snapshot: lockedSnapshot,
			source: 'history-prepend',
		});
	});

	it('keeps a queued history-prepend adjustment from being overwritten by a later generic resize adjustment', () => {
		const currentAdjustment: PendingContentResizeAdjustment<Snapshot> = {
			mode: 'anchor',
			roomId: 'history-archive',
			snapshot: lockedSnapshot,
			source: 'history-prepend',
		};

		expect(
			mergePendingContentResizeAdjustment({
				currentAdjustment,
				nextAdjustment: contentResizeAnchorAdjustment,
			}),
		).toEqual(currentAdjustment);
	});

	it('lets a history-prepend adjustment replace an older generic content-resize adjustment', () => {
		const nextHistoryPrependAdjustment: PendingContentResizeAdjustment<Snapshot> = {
			mode: 'anchor',
			roomId: 'history-archive',
			snapshot: lockedSnapshot,
			source: 'history-prepend',
		};

		expect(
			mergePendingContentResizeAdjustment({
				currentAdjustment: contentResizeAnchorAdjustment,
				nextAdjustment: nextHistoryPrependAdjustment,
			}),
		).toEqual(nextHistoryPrependAdjustment);
	});

	it('preserves bottom-priority adjustments ahead of later anchor restores', () => {
		const currentBottomAdjustment: PendingContentResizeAdjustment<Snapshot> = {
			mode: 'bottom',
			roomId: 'history-archive',
			snapshot: null,
			source: 'bottom-reflow',
		};

		expect(
			mergePendingContentResizeAdjustment({
				currentAdjustment: currentBottomAdjustment,
				nextAdjustment: contentResizeAnchorAdjustment,
			}),
		).toEqual(currentBottomAdjustment);
	});

	it('restores prepended history from the measured scroll-height delta before later reflow refinement', () => {
		expect(
			resolveHistoryPrependRestoreScrollTop({
				baselineScrollHeight: 1_280,
				baselineScrollTop: 0,
				currentScrollHeight: 1_436,
			}),
		).toBe(156);

		expect(
			resolveHistoryPrependRestoreScrollTop({
				baselineScrollHeight: 1_280,
				baselineScrollTop: 42,
				currentScrollHeight: 1_250,
			}),
		).toBe(42);
	});
});
