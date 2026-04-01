import { describe, expect, it } from 'bun:test';

import {
	buildMessageContextMenuActionKeySignature,
	resolveMessageContextMenuActiveKey,
	resolveMessageContextMenuIndexByKey,
	resolveMessageContextMenuKeyAtIndex,
} from './messageContextMenuState';

describe('messageContextMenuState', () => {
	it('starts keyboard-owned menus on the first action and keeps pointer menus inactive', () => {
		expect(
			resolveMessageContextMenuActiveKey({
				actionKeys: ['reply', 'forward', 'copy'],
				currentKey: null,
				source: 'keyboard',
			}),
		).toBe('reply');

		expect(
			resolveMessageContextMenuActiveKey({
				actionKeys: ['reply', 'forward', 'copy'],
				currentKey: null,
				source: 'pointer',
			}),
		).toBeNull();
	});

	it('preserves the current action key across unrelated rerenders when it still exists', () => {
		expect(
			resolveMessageContextMenuActiveKey({
				actionKeys: ['reply', 'forward', 'copy'],
				currentKey: 'forward',
				source: 'keyboard',
			}),
		).toBe('forward');

		expect(
			resolveMessageContextMenuActiveKey({
				actionKeys: ['reply', 'forward', 'copy'],
				currentKey: 'forward',
				source: 'pointer',
			}),
		).toBe('forward');
	});

	it('falls back to the first action when the prior key becomes invalid', () => {
		expect(
			resolveMessageContextMenuActiveKey({
				actionKeys: ['reply', 'jump', 'copy'],
				currentKey: 'forward',
				source: 'keyboard',
			}),
		).toBe('reply');
	});

	it('maps between keys and indices without wrapping', () => {
		expect(
			resolveMessageContextMenuIndexByKey({
				actionKeys: ['reply', 'forward', 'copy'],
				activeKey: 'forward',
			}),
		).toBe(1);
		expect(
			resolveMessageContextMenuIndexByKey({
				actionKeys: ['reply', 'forward', 'copy'],
				activeKey: 'missing',
			}),
		).toBeNull();

		expect(
			resolveMessageContextMenuKeyAtIndex({
				actionKeys: ['reply', 'forward', 'copy'],
				index: 99,
			}),
		).toBe('copy');
		expect(
			resolveMessageContextMenuKeyAtIndex({
				actionKeys: ['reply', 'forward', 'copy'],
				index: -99,
			}),
		).toBe('reply');
	});

	it('builds a stable signature from the actionable keys', () => {
		expect(buildMessageContextMenuActionKeySignature(['reply', 'forward', 'copy'])).toBe('reply\u001fforward\u001fcopy');
	});
});
