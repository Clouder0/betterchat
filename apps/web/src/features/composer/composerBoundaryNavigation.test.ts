import { describe, expect, test } from 'bun:test';

import { isCollapsedSelectionOnLastLine } from './composerBoundaryNavigation';

describe('isCollapsedSelectionOnLastLine', () => {
	test('treats single-line content as already being on the last line', () => {
		expect(
			isCollapsedSelectionOnLastLine({
				selection: { anchor: 4, head: 4 },
				value: 'hello world',
			}),
		).toBe(true);
	});

	test('returns false while the cursor is still above a later line break', () => {
		expect(
			isCollapsedSelectionOnLastLine({
				selection: { anchor: 1, head: 1 },
				value: 'a\nb\nc',
			}),
		).toBe(false);
	});

	test('returns true when the collapsed cursor is on the final line', () => {
		expect(
			isCollapsedSelectionOnLastLine({
				selection: { anchor: 4, head: 4 },
				value: 'a\nb\nc',
			}),
		).toBe(true);
	});

	test('returns false for non-collapsed selections', () => {
		expect(
			isCollapsedSelectionOnLastLine({
				selection: { anchor: 2, head: 5 },
				value: 'hello\nworld',
			}),
		).toBe(false);
	});
});
