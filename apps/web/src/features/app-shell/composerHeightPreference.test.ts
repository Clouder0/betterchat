import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
	COMPOSER_EDITOR_HEIGHT_STORAGE_KEY,
	DEFAULT_COMPOSER_EDITOR_HEIGHT_PX,
	clampComposerEditorHeight,
	loadComposerEditorHeightPreference,
	resolveComposerEditorHeightBounds,
	resolveComposerEditorResizeHeight,
	saveComposerEditorHeightPreference,
} from './composerHeightPreference';

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

describe('composerHeightPreference', () => {
	it('loads and saves the composer editor height', () => {
		expect(loadComposerEditorHeightPreference()).toBe(DEFAULT_COMPOSER_EDITOR_HEIGHT_PX);

		saveComposerEditorHeightPreference(188);
		expect(loadComposerEditorHeightPreference()).toBe(188);
	});

	it('falls back when storage is malformed', () => {
		window.localStorage.setItem(COMPOSER_EDITOR_HEIGHT_STORAGE_KEY, '"bad-value"');

		expect(loadComposerEditorHeightPreference()).toBe(DEFAULT_COMPOSER_EDITOR_HEIGHT_PX);
	});

	it('clamps the editor height inside the computed bounds', () => {
		const bounds = resolveComposerEditorHeightBounds({
			conversationBodyHeight: 600,
		});

		expect(bounds).toEqual({
			min: 84,
			max: 320,
		});
		expect(clampComposerEditorHeight(72, bounds)).toBe(84);
		expect(clampComposerEditorHeight(360, bounds)).toBe(320);
		expect(clampComposerEditorHeight(132, bounds)).toBe(132);
	});

	it('shrinks the maximum editor height on shorter workspaces to preserve timeline room', () => {
		expect(
			resolveComposerEditorHeightBounds({
				conversationBodyHeight: 300,
			}),
		).toEqual({
			min: 84,
			max: 100,
		});
	});

	it('treats upward dragging as a taller composer editor', () => {
		const bounds = {
			min: 84,
			max: 320,
		};

		expect(
			resolveComposerEditorResizeHeight({
				bounds,
				currentY: 320,
				startHeight: 148,
				startY: 400,
			}),
		).toBe(228);

		expect(
			resolveComposerEditorResizeHeight({
				bounds,
				currentY: 500,
				startHeight: 148,
				startY: 400,
			}),
		).toBe(84);
	});
});
