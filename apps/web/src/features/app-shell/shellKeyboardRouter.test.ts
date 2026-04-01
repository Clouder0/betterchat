import { describe, expect, it } from 'bun:test';

import { resolveShellKeyboardAction } from './shellKeyboardRouter';

describe('resolveShellKeyboardAction', () => {
	it('resolves global shortcuts before plain navigation', () => {
		expect(
			resolveShellKeyboardAction({
				altKey: false,
				ctrlKey: true,
				isNeutralShellFocus: true,
				key: 'k',
				metaKey: false,
				shiftKey: false,
			}),
		).toEqual({
			kind: 'focus-search',
		});

		expect(
			resolveShellKeyboardAction({
				altKey: true,
				ctrlKey: false,
				isNeutralShellFocus: true,
				key: '2',
				metaKey: false,
				shiftKey: false,
			}),
		).toEqual({
			kind: 'focus-timeline',
			strategy: 'preferred',
		});
	});

	it('bootstraps neutral shell focus into timeline navigation', () => {
		expect(
			resolveShellKeyboardAction({
				altKey: false,
				ctrlKey: false,
				isNeutralShellFocus: true,
				key: 'ArrowDown',
				metaKey: false,
				shiftKey: false,
			}),
		).toEqual({
			kind: 'focus-timeline',
			strategy: 'preferred',
		});

		expect(
			resolveShellKeyboardAction({
				altKey: false,
				ctrlKey: false,
				isNeutralShellFocus: true,
				key: 'Home',
				metaKey: false,
				shiftKey: false,
			}),
		).toEqual({
			kind: 'focus-timeline',
			strategy: 'first-message',
		});

		expect(
			resolveShellKeyboardAction({
				altKey: false,
				ctrlKey: false,
				isNeutralShellFocus: true,
				key: 'End',
				metaKey: false,
				shiftKey: false,
			}),
		).toEqual({
			kind: 'focus-timeline',
			strategy: 'unread-or-latest',
		});
	});

	it('routes neutral upward and leftward travel to the sidebar', () => {
		expect(
			resolveShellKeyboardAction({
				altKey: false,
				ctrlKey: false,
				isNeutralShellFocus: true,
				key: 'ArrowUp',
				metaKey: false,
				shiftKey: false,
			}),
		).toEqual({
			kind: 'focus-sidebar',
		});

		expect(
			resolveShellKeyboardAction({
				altKey: false,
				ctrlKey: false,
				isNeutralShellFocus: true,
				key: 'ArrowLeft',
				metaKey: false,
				shiftKey: false,
			}),
		).toEqual({
			kind: 'focus-sidebar',
		});
	});

	it('ignores plain navigation when focus is already inside a shell region', () => {
		expect(
			resolveShellKeyboardAction({
				altKey: false,
				ctrlKey: false,
				isNeutralShellFocus: false,
				key: 'ArrowDown',
				metaKey: false,
				shiftKey: false,
			}),
		).toBeNull();
	});
});
