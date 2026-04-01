import { describe, expect, it } from 'bun:test';

import { applyComposerEdit, createComposerEnterEdit, createComposerTabEdit } from './composerEditing';

describe('composerEditing', () => {
	it('auto-completes fenced code blocks on enter and keeps the cursor inside', () => {
		const edit = createComposerEnterEdit({
			selection: {
				anchor: '```ts'.length,
				head: '```ts'.length,
			},
			value: '```ts',
		});

		expect(edit).not.toBeNull();
		if (!edit) {
			throw new Error('expected a fenced-code completion edit');
		}

		expect(applyComposerEdit('```ts', edit)).toBe('```ts\n\n```');
		expect(edit.selection).toEqual({
			anchor: '```ts\n'.length,
			head: '```ts\n'.length,
		});
	});

	it('turns the second empty quote-line enter into a normal blank line', () => {
		const value = '> 引用说明\n> ';
		const edit = createComposerEnterEdit({
			selection: {
				anchor: value.length,
				head: value.length,
			},
			value,
		});

		expect(edit).not.toBeNull();
		if (!edit) {
			throw new Error('expected a quote-exit edit');
		}

		expect(applyComposerEdit(value, edit)).toBe('> 引用说明\n');
		expect(edit.selection).toEqual({
			anchor: '> 引用说明\n'.length,
			head: '> 引用说明\n'.length,
		});
	});

	it('inserts a literal tab at the current selection', () => {
		const value = '第一行';
		const edit = createComposerTabEdit({
			selection: {
				anchor: value.length,
				head: value.length,
			},
			value,
		});

		expect(applyComposerEdit(value, edit)).toBe('第一行\t');
		expect(edit.selection).toEqual({
			anchor: '第一行\t'.length,
			head: '第一行\t'.length,
		});
	});
});
