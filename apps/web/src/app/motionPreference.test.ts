import { afterEach, describe, expect, it, mock } from 'bun:test';

import {
	MOTION_ATTRIBUTE,
	MOTION_STORAGE_KEY,
	applyDocumentMotionPreference,
	getStoredMotionPreference,
	initializeDocumentMotionPreference,
	isDocumentMotionDisabled,
	shouldDisableMotion,
} from './motionPreference';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

const createStorage = () => {
	const values = new Map<string, string>();
	return {
		getItem(key: string) {
			return values.get(key) ?? null;
		},
		removeItem(key: string) {
			values.delete(key);
		},
		setItem(key: string, value: string) {
			values.set(key, value);
		},
	};
};

afterEach(() => {
	mock.restore();
	if (originalWindow === undefined) {
		delete (globalThis as typeof globalThis & { window?: Window }).window;
	} else {
		globalThis.window = originalWindow;
	}

	if (originalDocument === undefined) {
		delete (globalThis as typeof globalThis & { document?: Document }).document;
	} else {
		globalThis.document = originalDocument;
	}
});

describe('motionPreference', () => {
	it('defaults to enabled when nothing is stored', () => {
		globalThis.window = {
			localStorage: createStorage(),
		} as Window;

		expect(getStoredMotionPreference()).toBe('enabled');
	});

	it('applies and persists the document motion preference', () => {
		const localStorage = createStorage();
		globalThis.window = { localStorage } as Window;
		globalThis.document = {
			documentElement: {
				getAttribute: () => null,
				setAttribute: mock(),
			},
		} as unknown as Document;

		applyDocumentMotionPreference('disabled');

		expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBe('disabled');
		expect((globalThis.document.documentElement.setAttribute as ReturnType<typeof mock>).mock.calls).toEqual([
			[MOTION_ATTRIBUTE, 'off'],
		]);
	});

	it('initializes the document attribute from storage', () => {
		const localStorage = createStorage();
		localStorage.setItem(MOTION_STORAGE_KEY, 'disabled');
		globalThis.window = { localStorage } as Window;
		const setAttribute = mock();
		globalThis.document = {
			documentElement: {
				getAttribute: () => null,
				setAttribute,
			},
		} as unknown as Document;

		expect(initializeDocumentMotionPreference()).toBe('disabled');
		expect(setAttribute.mock.calls).toEqual([[MOTION_ATTRIBUTE, 'off']]);
	});

	it('treats the document attribute as the primary runtime motion source', () => {
		globalThis.window = {
			localStorage: createStorage(),
		} as Window;
		globalThis.document = {
			documentElement: {
				getAttribute: () => 'off',
				setAttribute: mock(),
			},
		} as unknown as Document;

		expect(isDocumentMotionDisabled()).toBe(true);
	});

	it('falls back to storage when the document attribute is unavailable', () => {
		const localStorage = createStorage();
		localStorage.setItem(MOTION_STORAGE_KEY, 'disabled');
		globalThis.window = { localStorage } as Window;
		globalThis.document = {
			documentElement: {
				getAttribute: () => null,
				setAttribute: mock(),
			},
		} as unknown as Document;

		expect(isDocumentMotionDisabled()).toBe(true);
	});

	it('combines explicit disable with system reduced motion', () => {
		expect(
			shouldDisableMotion({
				motionPreference: 'enabled',
				systemReducedMotion: false,
			}),
		).toBe(false);
		expect(
			shouldDisableMotion({
				motionPreference: 'disabled',
				systemReducedMotion: false,
			}),
		).toBe(true);
		expect(
			shouldDisableMotion({
				motionPreference: 'enabled',
				systemReducedMotion: true,
			}),
		).toBe(true);
	});
});
