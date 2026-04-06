import { describe, expect, it } from 'bun:test';

import { resolveSidebarRailPointerCompletion, resolveSidebarRailPointerPreview } from './sidebarRailInteraction';

describe('resolveSidebarRailPointerPreview', () => {
	it('switches into collapse preview when the raw width enters the collapse zone', () => {
		expect(
			resolveSidebarRailPointerPreview({
				collapseThreshold: 120,
				previewWidth: 96,
				rawWidth: 96,
			}),
		).toEqual({
			collapsed: true,
			kind: 'collapse-preview',
			width: 96,
		});
	});

	it('keeps a continuous expanded preview while the raw width stays above the collapse threshold', () => {
		expect(
			resolveSidebarRailPointerPreview({
				collapseThreshold: 120,
				previewWidth: 160,
				rawWidth: 160,
			}),
		).toEqual({
			collapsed: false,
			kind: 'resize-preview',
			width: 160,
		});
	});

	it('keeps resize preview while larger widths stay above the collapse threshold', () => {
		expect(
			resolveSidebarRailPointerPreview({
				collapseThreshold: 120,
				previewWidth: 264,
				rawWidth: 264,
			}),
		).toEqual({
			collapsed: false,
			kind: 'resize-preview',
			width: 264,
		});
	});
});

describe('resolveSidebarRailPointerCompletion', () => {
	it('expands to the restored width when a collapsed rail receives a click', () => {
		expect(
			resolveSidebarRailPointerCompletion({
				collapsedAtStart: true,
				collapseThreshold: 120,
				dragged: false,
				rawWidth: 0,
				restoredWidth: 292,
			}),
		).toEqual({
			kind: 'expand-restored-width',
			width: 292,
		});
	});

	it('commits the dragged width when a collapsed rail is dragged open past the threshold', () => {
		expect(
			resolveSidebarRailPointerCompletion({
				collapsedAtStart: true,
				collapseThreshold: 120,
				dragged: true,
				rawWidth: 264,
				restoredWidth: 292,
			}),
		).toEqual({
			kind: 'commit-resize',
			width: 264,
		});
	});

	it('stays collapsed when a collapsed rail drag never exceeds the collapse threshold', () => {
		expect(
			resolveSidebarRailPointerCompletion({
				collapsedAtStart: true,
				collapseThreshold: 120,
				dragged: true,
				rawWidth: 96,
				restoredWidth: 292,
			}),
		).toEqual({
			kind: 'set-collapsed',
		});
	});

	it('treats an expanded rail click as a no-op', () => {
		expect(
			resolveSidebarRailPointerCompletion({
				collapsedAtStart: false,
				collapseThreshold: 120,
				dragged: false,
				rawWidth: 292,
				restoredWidth: 292,
			}),
		).toEqual({
			kind: 'no-op',
		});
	});

	it('collapses when an expanded drag finishes below the snap threshold', () => {
		expect(
			resolveSidebarRailPointerCompletion({
				collapsedAtStart: false,
				collapseThreshold: 120,
				dragged: true,
				rawWidth: 80,
				restoredWidth: 292,
			}),
		).toEqual({
			kind: 'set-collapsed',
		});
	});

	it('commits the resized width when an expanded drag stays above the threshold', () => {
		expect(
			resolveSidebarRailPointerCompletion({
				collapsedAtStart: false,
				collapseThreshold: 120,
				dragged: true,
				rawWidth: 336,
				restoredWidth: 292,
			}),
		).toEqual({
			kind: 'commit-resize',
			width: 336,
		});
	});
});
