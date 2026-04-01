import { describe, expect, it } from 'bun:test';

import { resolveElementKeyboardRegion } from './keyboardRegion';

const createClosestStub = (matches: string[]): Element =>
	({
		closest: (selector: string) => (matches.includes(selector) ? ({} as Element) : null),
	} as Element);

describe('resolveElementKeyboardRegion', () => {
	it('treats timeline-owned popup surfaces as part of the timeline region', () => {
		expect(resolveElementKeyboardRegion(createClosestStub(['[data-testid="timeline-message-context-menu"]']))).toBe('timeline');
		expect(resolveElementKeyboardRegion(createClosestStub(['[data-testid="timeline-author-quick-panel"]']))).toBe('timeline');
	});

	it('keeps the existing sidebar, header, composer, and null classifications', () => {
		expect(resolveElementKeyboardRegion(createClosestStub(['[data-testid="app-sidebar"]']))).toBe('sidebar-list');
		expect(resolveElementKeyboardRegion(createClosestStub(['[data-testid="room-favorite-toggle"]']))).toBe('header');
		expect(resolveElementKeyboardRegion(createClosestStub(['[data-testid="composer"]']))).toBe('composer');
		expect(resolveElementKeyboardRegion(createClosestStub([]))).toBeNull();
	});
});
