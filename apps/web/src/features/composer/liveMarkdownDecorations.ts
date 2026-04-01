import type { Range } from '@codemirror/state';
import { type Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

type MarkdownSyntaxNode = {
	name: string;
	from: number;
	to: number;
	firstChild: MarkdownSyntaxNode | null;
	lastChild: MarkdownSyntaxNode | null;
	nextSibling: MarkdownSyntaxNode | null;
};

const delimiterDecoration = Decoration.mark({
	attributes: { 'data-live-markdown': 'delimiter' },
	class: 'bc-live-md-delimiter',
});

const strongDecoration = Decoration.mark({
	attributes: { 'data-live-markdown': 'strong' },
	class: 'bc-live-md-strong',
});

const emphasisDecoration = Decoration.mark({
	attributes: { 'data-live-markdown': 'emphasis' },
	class: 'bc-live-md-emphasis',
});

const strikethroughDecoration = Decoration.mark({
	attributes: { 'data-live-markdown': 'strikethrough' },
	class: 'bc-live-md-strikethrough',
});

const inlineCodeDecoration = Decoration.mark({
	attributes: { 'data-live-markdown': 'inline-code' },
	class: 'bc-live-md-inline-code',
});

const headingDecoration = (level: number) =>
	Decoration.mark({
		attributes: { 'data-live-markdown': `heading-${level}` },
		class: `bc-live-md-heading bc-live-md-heading-${level}`,
	});

const blockquoteDecoration = Decoration.mark({
	attributes: { 'data-live-markdown': 'blockquote' },
	class: 'bc-live-md-blockquote',
});

const linkTextDecoration = Decoration.mark({
	attributes: { 'data-live-markdown': 'link-text' },
	class: 'bc-live-md-link-text',
});

const linkUrlDecoration = Decoration.mark({
	attributes: { 'data-live-markdown': 'link-url' },
	class: 'bc-live-md-link-url',
});

const taskContentDecoration = Decoration.mark({
	attributes: { 'data-live-markdown': 'task-content' },
	class: 'bc-live-md-task-content',
});

const codeLineDecoration = Decoration.line({
	attributes: { 'data-live-markdown-line': 'code' },
	class: 'bc-live-md-code-line',
});

const codeLineStartDecoration = Decoration.line({
	attributes: { 'data-live-markdown-line': 'code' },
	class: 'bc-live-md-code-line bc-live-md-code-line-start',
});

const codeLineEndDecoration = Decoration.line({
	attributes: { 'data-live-markdown-line': 'code' },
	class: 'bc-live-md-code-line bc-live-md-code-line-end',
});

const codeLineOnlyDecoration = Decoration.line({
	attributes: { 'data-live-markdown-line': 'code' },
	class: 'bc-live-md-code-line bc-live-md-code-line-only',
});

const codeInfoDecoration = Decoration.mark({
	attributes: { 'data-live-markdown': 'code-info' },
	class: 'bc-live-md-code-info',
});

const codeTextDecoration = Decoration.mark({
	attributes: { 'data-live-markdown': 'code-text' },
	class: 'bc-live-md-code-text',
});

const addMark = (
	ranges: Range<Decoration>[],
	decoration: Decoration,
	from: number,
	to: number,
) => {
	if (to <= from) {
		return;
	}

	ranges.push(decoration.range(from, to));
};

const addLine = (ranges: Range<Decoration>[], decoration: Decoration, position: number) => {
	ranges.push(decoration.range(position));
};

const addDelimitedContentMark = (
	ranges: Range<Decoration>[],
	node: MarkdownSyntaxNode,
	markName: string,
	decoration: Decoration,
) => {
	const firstChild = node.firstChild;
	const lastChild = node.lastChild;

	if (!firstChild || !lastChild || firstChild.name !== markName || lastChild.name !== markName) {
		return;
	}

	addMark(ranges, decoration, firstChild.to, lastChild.from);
};

const addHeadingMark = (ranges: Range<Decoration>[], node: MarkdownSyntaxNode) => {
	const match = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
	if (!match) {
		return;
	}

	addMark(ranges, headingDecoration(Number(match[1])), node.from, node.to);
};

const addLinkMarks = (ranges: Range<Decoration>[], node: MarkdownSyntaxNode) => {
	const openTextMark = node.firstChild;
	const closeTextMark = openTextMark?.nextSibling ?? null;
	const openUrlMark = closeTextMark?.nextSibling ?? null;
	const urlNode = openUrlMark?.nextSibling ?? null;

	if (openTextMark?.name === 'LinkMark' && closeTextMark?.name === 'LinkMark') {
		addMark(ranges, linkTextDecoration, openTextMark.to, closeTextMark.from);
	}

	if (urlNode?.name === 'URL') {
		addMark(ranges, linkUrlDecoration, urlNode.from, urlNode.to);
	}
};

const addTaskMark = (ranges: Range<Decoration>[], node: MarkdownSyntaxNode) => {
	const taskMarker = node.firstChild;

	if (taskMarker?.name !== 'TaskMarker') {
		return;
	}

	addMark(ranges, taskContentDecoration, taskMarker.to, node.to);
};

const addFencedCodeMarks = (ranges: Range<Decoration>[], node: MarkdownSyntaxNode, view: EditorView) => {
	const startLineNumber = view.state.doc.lineAt(node.from).number;
	const endLineNumber = view.state.doc.lineAt(node.to).number;

	for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber += 1) {
		const line = view.state.doc.line(lineNumber);
		const isStart = lineNumber === startLineNumber;
		const isEnd = lineNumber === endLineNumber;

		if (isStart && isEnd) {
			addLine(ranges, codeLineOnlyDecoration, line.from);
			continue;
		}

		if (isStart) {
			addLine(ranges, codeLineStartDecoration, line.from);
			continue;
		}

		if (isEnd) {
			addLine(ranges, codeLineEndDecoration, line.from);
			continue;
		}

		addLine(ranges, codeLineDecoration, line.from);
	}

	for (let child = node.firstChild; child; child = child.nextSibling) {
		if (child.name === 'CodeInfo') {
			addMark(ranges, codeInfoDecoration, child.from, child.to);
			continue;
		}

		if (child.name === 'CodeText') {
			addMark(ranges, codeTextDecoration, child.from, child.to);
		}
	}
};

const buildLiveMarkdownDecorations = (view: EditorView) => {
	const ranges: Range<Decoration>[] = [];
	const tree = syntaxTree(view.state);

	for (const { from, to } of view.visibleRanges) {
		tree.iterate({
			from,
			to,
			enter(nodeRef) {
				const node = nodeRef.node as unknown as MarkdownSyntaxNode;

				switch (node.name) {
					case 'EmphasisMark':
					case 'StrikethroughMark':
					case 'HeaderMark':
					case 'QuoteMark':
					case 'LinkMark':
						case 'ListMark':
						case 'TaskMarker':
						case 'CodeMark':
							addMark(ranges, delimiterDecoration, node.from, node.to);
							return;
						case 'StrongEmphasis':
							addDelimitedContentMark(ranges, node, 'EmphasisMark', strongDecoration);
							return;
						case 'Emphasis':
							addDelimitedContentMark(ranges, node, 'EmphasisMark', emphasisDecoration);
							return;
						case 'Strikethrough':
							addDelimitedContentMark(ranges, node, 'StrikethroughMark', strikethroughDecoration);
							return;
						case 'InlineCode':
							addMark(ranges, inlineCodeDecoration, node.from, node.to);
							return;
						case 'Blockquote':
							addMark(ranges, blockquoteDecoration, node.from, node.to);
							return;
						case 'Link':
							addLinkMarks(ranges, node);
							return;
						case 'Task':
							addTaskMark(ranges, node);
							return;
						case 'FencedCode':
							addFencedCodeMarks(ranges, node, view);
							return;
					default:
						break;
				}

					addHeadingMark(ranges, node);
				},
			});
		}

	return Decoration.set(ranges, true);
};

export const liveMarkdownDecorations = (): Extension =>
	ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildLiveMarkdownDecorations(view);
			}

			update(update: ViewUpdate) {
				if (!update.docChanged && !update.viewportChanged) {
					return;
				}

				this.decorations = buildLiveMarkdownDecorations(update.view);
			}
		},
		{
			decorations: (value) => value.decorations,
		},
	);
