import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
	COMPOSER_SEND_SHORTCUT_STORAGE_KEY,
	getComposerShortcutHint,
	loadComposerSendShortcut,
	saveComposerSendShortcut,
	shouldSendOnComposerKeydown,
} from './sendShortcutPreference';

type LocalStorageShape = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'>;

const createLocalStorage = (): LocalStorageShape => {
	const store = new Map<string, string>();

	return {
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => {
			store.set(key, value);
		},
		removeItem: (key) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
	};
};

const originalWindow = globalThis.window;

beforeEach(() => {
	(globalThis as typeof globalThis & { window?: Window }).window = {
		localStorage: createLocalStorage(),
	} as Window;
});

afterEach(() => {
	if (originalWindow) {
		(globalThis as typeof globalThis & { window?: Window }).window = originalWindow;
		return;
	}

	delete (globalThis as typeof globalThis & { window?: Window }).window;
});

describe('sendShortcutPreference', () => {
	it('loads and saves the composer send shortcut', () => {
		expect(loadComposerSendShortcut()).toBe('enter-send');

		saveComposerSendShortcut('ctrl-enter-send');
		expect(loadComposerSendShortcut()).toBe('ctrl-enter-send');
	});

	it('falls back when storage is malformed', () => {
		window.localStorage.setItem(COMPOSER_SEND_SHORTCUT_STORAGE_KEY, 'alt-enter-send');

		expect(loadComposerSendShortcut()).toBe('enter-send');
	});

	it('returns the right helper hint for each send mode', () => {
		expect(getComposerShortcutHint('enter-send')).toBe('Shift + Enter 换行');
		expect(getComposerShortcutHint('ctrl-enter-send')).toBe('Enter 换行，Ctrl + Enter 发送');
	});

	it('matches the enter-to-send shortcut', () => {
		expect(
			shouldSendOnComposerKeydown({
				event: {
					key: 'Enter',
					altKey: false,
					ctrlKey: false,
					metaKey: false,
					shiftKey: false,
				},
				isComposing: false,
				mode: 'enter-send',
			}),
		).toBe(true);

		expect(
			shouldSendOnComposerKeydown({
				event: {
					key: 'Enter',
					altKey: false,
					ctrlKey: false,
					metaKey: false,
					shiftKey: true,
				},
				isComposing: false,
				mode: 'enter-send',
			}),
		).toBe(false);
	});

	it('matches the ctrl-enter-to-send shortcut', () => {
		expect(
			shouldSendOnComposerKeydown({
				event: {
					key: 'Enter',
					altKey: false,
					ctrlKey: true,
					metaKey: false,
					shiftKey: false,
				},
				isComposing: false,
				mode: 'ctrl-enter-send',
			}),
		).toBe(true);

		expect(
			shouldSendOnComposerKeydown({
				event: {
					key: 'Enter',
					altKey: false,
					ctrlKey: false,
					metaKey: false,
					shiftKey: false,
				},
				isComposing: false,
				mode: 'ctrl-enter-send',
			}),
		).toBe(false);
	});

	it('never sends while IME composition is active', () => {
		expect(
			shouldSendOnComposerKeydown({
				event: {
					key: 'Enter',
					altKey: false,
					ctrlKey: true,
					metaKey: false,
					shiftKey: false,
				},
				isComposing: true,
				mode: 'ctrl-enter-send',
			}),
		).toBe(false);
	});
});
