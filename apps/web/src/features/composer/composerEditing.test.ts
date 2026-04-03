import { describe, expect, it } from 'bun:test';

import {
	applyComposerEdit,
	createComposerEnterEdit,
	createComposerListIndentEdit,
	createComposerListOutdentEdit,
	createComposerTabEdit,
} from './composerEditing';

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

	describe('createComposerListIndentEdit', () => {
		it('indents an unordered list line with -', () => {
			const value = '- item';
			const edit = createComposerListIndentEdit({
				selection: { anchor: 4, head: 4 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('  - item');
			expect(edit!.selection).toEqual({ anchor: 6, head: 6 });
		});

		it('indents an unordered list line with *', () => {
			const value = '* item';
			const edit = createComposerListIndentEdit({
				selection: { anchor: 4, head: 4 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('  * item');
		});

		it('indents an unordered list line with +', () => {
			const value = '+ item';
			const edit = createComposerListIndentEdit({
				selection: { anchor: 4, head: 4 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('  + item');
		});

		it('indents an ordered list line', () => {
			const value = '1. item';
			const edit = createComposerListIndentEdit({
				selection: { anchor: 5, head: 5 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('  1. item');
			expect(edit!.selection).toEqual({ anchor: 7, head: 7 });
		});

		it('indents a task list line', () => {
			const value = '- [ ] task';
			const edit = createComposerListIndentEdit({
				selection: { anchor: 8, head: 8 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('  - [ ] task');
			expect(edit!.selection).toEqual({ anchor: 10, head: 10 });
		});

		it('indents an already-indented list line further', () => {
			const value = '  - nested';
			const edit = createComposerListIndentEdit({
				selection: { anchor: 6, head: 6 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('    - nested');
			expect(edit!.selection).toEqual({ anchor: 8, head: 8 });
		});

		it('returns null for a non-list line', () => {
			const value = 'just text';
			const edit = createComposerListIndentEdit({
				selection: { anchor: 4, head: 4 },
				value,
			});

			expect(edit).toBeNull();
		});

		it('indents the correct line in a multi-line document', () => {
			const value = 'hello\n- item\nbye';
			const edit = createComposerListIndentEdit({
				selection: { anchor: 8, head: 8 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('hello\n  - item\nbye');
			expect(edit!.selection).toEqual({ anchor: 10, head: 10 });
		});

		it('indents multiple lines when selection spans them', () => {
			const value = '- one\n- two\n- three';
			const edit = createComposerListIndentEdit({
				selection: { anchor: 2, head: 14 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('  - one\n  - two\n  - three');
			expect(edit!.selection).toEqual({ anchor: 4, head: 20 });
		});

		it('skips non-list lines in multi-line selection', () => {
			const value = '- one\nplain\n- three';
			const edit = createComposerListIndentEdit({
				selection: { anchor: 0, head: 18 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('  - one\nplain\n  - three');
		});
	});

	describe('createComposerListOutdentEdit', () => {
		it('outdents a list line by removing 2 leading spaces', () => {
			const value = '  - item';
			const edit = createComposerListOutdentEdit({
				selection: { anchor: 6, head: 6 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('- item');
			expect(edit!.selection).toEqual({ anchor: 4, head: 4 });
		});

		it('outdents a list line with only 1 leading space', () => {
			const value = ' - item';
			const edit = createComposerListOutdentEdit({
				selection: { anchor: 5, head: 5 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('- item');
			expect(edit!.selection).toEqual({ anchor: 4, head: 4 });
		});

		it('strips the list marker at zero indent', () => {
			const value = '- item';
			const edit = createComposerListOutdentEdit({
				selection: { anchor: 4, head: 4 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('item');
			expect(edit!.selection).toEqual({ anchor: 2, head: 2 });
		});

		it('strips an ordered list marker at zero indent', () => {
			const value = '1. item';
			const edit = createComposerListOutdentEdit({
				selection: { anchor: 5, head: 5 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('item');
			expect(edit!.selection).toEqual({ anchor: 2, head: 2 });
		});

		it('strips a task list marker at zero indent', () => {
			const value = '- [ ] task';
			const edit = createComposerListOutdentEdit({
				selection: { anchor: 8, head: 8 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('[ ] task');
			expect(edit!.selection).toEqual({ anchor: 6, head: 6 });
		});

		it('returns null for a non-list line', () => {
			const value = '  just text';
			const edit = createComposerListOutdentEdit({
				selection: { anchor: 6, head: 6 },
				value,
			});

			expect(edit).toBeNull();
		});

		it('outdents an ordered list line', () => {
			const value = '    1. nested';
			const edit = createComposerListOutdentEdit({
				selection: { anchor: 10, head: 10 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('  1. nested');
			expect(edit!.selection).toEqual({ anchor: 8, head: 8 });
		});

		it('outdents multiple lines when selection spans them', () => {
			const value = '  - one\n  - two\n  - three';
			const edit = createComposerListOutdentEdit({
				selection: { anchor: 4, head: 20 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('- one\n- two\n- three');
			expect(edit!.selection).toEqual({ anchor: 2, head: 14 });
		});

		it('skips non-list lines in multi-line outdent', () => {
			const value = '  - one\n  plain\n  - three';
			const edit = createComposerListOutdentEdit({
				selection: { anchor: 0, head: 24 },
				value,
			});

			expect(edit).not.toBeNull();
			expect(applyComposerEdit(value, edit!)).toBe('- one\n  plain\n- three');
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
