export type ComposerSelection = {
	anchor: number;
	head: number;
};

export type ComposerEdit = {
	from: number;
	to: number;
	insert: string;
	selection: ComposerSelection;
};

const codeFenceLinePattern = /^(\s*(?:>\s*)*)(`{3,})([^`]*)$/;
const emptyQuoteLinePattern = /^\s*(?:>\s*)+$/;
const quotedLinePattern = /^\s*(?:>\s*)+/;

const normalizeSelection = (selection: ComposerSelection, length: number) => {
	const anchor = Math.min(Math.max(selection.anchor, 0), length);
	const head = Math.min(Math.max(selection.head, 0), length);

	return anchor <= head ? { anchor, head } : { anchor: head, head: anchor };
};

const findLineStart = (value: string, position: number, lineBreak: string) => {
	const lineBreakIndex = value.lastIndexOf(lineBreak, Math.max(position - 1, 0));
	return lineBreakIndex === -1 ? 0 : lineBreakIndex + lineBreak.length;
};

const findLineEnd = (value: string, position: number, lineBreak: string) => {
	const lineBreakIndex = value.indexOf(lineBreak, position);
	return lineBreakIndex === -1 ? value.length : lineBreakIndex;
};

const buildInsertEdit = ({
	from,
	insert,
	selection,
	to = from,
}: {
	from: number;
	insert: string;
	selection: ComposerSelection;
	to?: number;
}): ComposerEdit => ({
	from,
	to,
	insert,
	selection,
});

export const applyComposerEdit = (value: string, edit: ComposerEdit) =>
	value.slice(0, edit.from) + edit.insert + value.slice(edit.to);

export const createComposerTabEdit = ({
	selection,
	value,
}: {
	selection: ComposerSelection;
	value: string;
}): ComposerEdit => {
	const normalizedSelection = normalizeSelection(selection, value.length);

	return buildInsertEdit({
		from: normalizedSelection.anchor,
		insert: '\t',
		selection: {
			anchor: normalizedSelection.anchor + 1,
			head: normalizedSelection.anchor + 1,
		},
		to: normalizedSelection.head,
	});
};

export const createComposerEnterEdit = ({
	lineBreak = '\n',
	selection,
	value,
}: {
	lineBreak?: string;
	selection: ComposerSelection;
	value: string;
}): ComposerEdit | null => {
	const normalizedSelection = normalizeSelection(selection, value.length);
	if (normalizedSelection.anchor !== normalizedSelection.head) {
		return null;
	}

	const position = normalizedSelection.anchor;
	const lineStart = findLineStart(value, position, lineBreak);
	const lineEnd = findLineEnd(value, position, lineBreak);
	const lineText = value.slice(lineStart, lineEnd);
	const cursorOffset = position - lineStart;
	const trimmedLineText = lineText.replace(/\s+$/, '');

	if (cursorOffset >= trimmedLineText.length) {
		const codeFenceMatch = codeFenceLinePattern.exec(trimmedLineText);
		if (codeFenceMatch && /^\s*$/.test(lineText.slice(cursorOffset))) {
			const prefix = codeFenceMatch[1] ?? '';
			const fence = codeFenceMatch[2] ?? '```';
			const nextLineStart = lineEnd + lineBreak.length;
			const nextLineText =
				lineEnd < value.length
					? value.slice(nextLineStart, findLineEnd(value, nextLineStart, lineBreak)).replace(/\s+$/, '')
					: null;

			if (nextLineText !== `${prefix}${fence}`) {
				return buildInsertEdit({
					from: position,
					insert: `${lineBreak}${prefix}${lineBreak}${prefix}${fence}`,
					selection: {
						anchor: position + lineBreak.length + prefix.length,
						head: position + lineBreak.length + prefix.length,
					},
				});
			}
		}

		if (emptyQuoteLinePattern.test(trimmedLineText) && lineStart > 0) {
			const previousLineEnd = lineStart - lineBreak.length;
			const previousLineStart = findLineStart(value, previousLineEnd, lineBreak);
			const previousLineText = value.slice(previousLineStart, previousLineEnd);

			if (quotedLinePattern.test(previousLineText)) {
				return buildInsertEdit({
					from: lineStart,
					insert: '',
					selection: {
						anchor: lineStart,
						head: lineStart,
					},
					to: lineEnd,
				});
			}
		}
	}

	return null;
};
