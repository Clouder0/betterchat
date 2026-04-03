import { defaultKeymap, history, historyKeymap, insertNewlineAndIndent, insertTab } from '@codemirror/commands';
import { insertNewlineContinueMarkup, markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { Compartment, EditorSelection, EditorState, Prec } from '@codemirror/state';
import { EditorView, drawSelection, highlightSpecialChars, keymap, placeholder as editorPlaceholder } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import type { ComposerEdit, ComposerSelection } from './composerEditing';
import { isCollapsedSelectionOnLastLine } from './composerBoundaryNavigation';
import { createComposerEnterEdit, createComposerListIndentEdit, createComposerListOutdentEdit, createComposerTabEdit } from './composerEditing';
import type { ComposerSendShortcut } from './sendShortcutPreference';
import { liveMarkdownDecorations } from './liveMarkdownDecorations';
import styles from './ComposerBar.module.css';

export type LiveMarkdownEditorHandle = {
	applyEdit: (edit: ComposerEdit) => boolean;
	focus: () => void;
};

const buildContentAttributes = (describedBy: string) => ({
	'aria-describedby': describedBy,
	'aria-label': '消息输入',
	'data-testid': 'composer-textarea',
	'data-live-editor': 'true',
	'role': 'textbox',
	'spellcheck': 'true',
});

const dispatchComposerEdit = (view: EditorView, edit: ComposerEdit | null) => {
	if (!edit) {
		return false;
	}

	view.dispatch(
		view.state.update({
			changes: {
				from: edit.from,
				insert: edit.insert,
				to: edit.to,
			},
			scrollIntoView: true,
			selection: EditorSelection.range(edit.selection.anchor, edit.selection.head),
			userEvent: 'input',
		}),
	);

	return true;
};

const toComposerSelection = (selection: EditorSelection): ComposerSelection => ({
	anchor: selection.main.anchor,
	head: selection.main.head,
});

const runComposerNewline = (view: EditorView) =>
	dispatchComposerEdit(
		view,
		createComposerEnterEdit({
			lineBreak: view.state.lineBreak,
			selection: {
				anchor: view.state.selection.main.anchor,
				head: view.state.selection.main.head,
			},
			value: view.state.doc.toString(),
		}),
	) ||
	insertNewlineContinueMarkup({
		dispatch: view.dispatch,
		state: view.state,
	}) ||
	insertNewlineAndIndent({
		dispatch: view.dispatch,
		state: view.state,
	});

const getComposerSelectionAndValue = (view: EditorView) => ({
	selection: {
		anchor: view.state.selection.main.anchor,
		head: view.state.selection.main.head,
	},
	value: view.state.doc.toString(),
});

const runComposerTab = (view: EditorView) =>
	dispatchComposerEdit(view, createComposerListIndentEdit(getComposerSelectionAndValue(view))) ||
	dispatchComposerEdit(view, createComposerTabEdit(getComposerSelectionAndValue(view)));

const runComposerShiftTab = (view: EditorView) =>
	dispatchComposerEdit(view, createComposerListOutdentEdit(getComposerSelectionAndValue(view)));

export const LiveMarkdownEditor = forwardRef<
	LiveMarkdownEditorHandle,
	{
		describedBy: string;
		disabled?: boolean;
		focusToken?: number;
		initialSelection?: {
			anchor: number;
			head: number;
		};
		onChange: (value: string) => void;
		onFocusChange?: (focused: boolean) => void;
		onNavigateDownBoundary?: () => boolean | void;
		onNavigateUpBoundary?: () => boolean | void;
		onSelectionChange?: (selection: ComposerSelection) => void;
		onSubmit: () => void;
		placeholder: string;
		restoreFocusOnMount?: boolean;
		sendShortcut: ComposerSendShortcut;
		value: string;
	}
>(function LiveMarkdownEditor(
	{
		describedBy,
		disabled = false,
		focusToken = 0,
		initialSelection,
		onChange,
		onFocusChange,
		onNavigateDownBoundary,
		onNavigateUpBoundary,
		onSelectionChange,
		onSubmit,
		placeholder,
		restoreFocusOnMount = false,
		sendShortcut,
		value,
	},
	ref,
) {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const lastFocusTokenRef = useRef(focusToken);
	const onChangeRef = useRef(onChange);
	const onFocusChangeRef = useRef(onFocusChange);
	const onNavigateDownBoundaryRef = useRef(onNavigateDownBoundary);
	const onNavigateUpBoundaryRef = useRef(onNavigateUpBoundary);
	const onSelectionChangeRef = useRef(onSelectionChange);
	const onSubmitRef = useRef(onSubmit);
	const sendShortcutRef = useRef(sendShortcut);

	const editableCompartmentRef = useRef(new Compartment());
	const readOnlyCompartmentRef = useRef(new Compartment());
	const attributesCompartmentRef = useRef(new Compartment());
	const placeholderCompartmentRef = useRef(new Compartment());

	onChangeRef.current = onChange;
	onFocusChangeRef.current = onFocusChange;
	onNavigateDownBoundaryRef.current = onNavigateDownBoundary;
	onNavigateUpBoundaryRef.current = onNavigateUpBoundary;
	onSelectionChangeRef.current = onSelectionChange;
	onSubmitRef.current = onSubmit;
	sendShortcutRef.current = sendShortcut;

	useImperativeHandle(
		ref,
		() => ({
			applyEdit(edit) {
				const view = viewRef.current;
				if (!view) {
					return false;
				}

				return dispatchComposerEdit(view, edit);
			},
			focus() {
				viewRef.current?.focus();
			},
		}),
		[],
	);

	useEffect(() => {
		if (!hostRef.current) {
			return;
		}

		const sendKeymap = Prec.highest(
			keymap.of([
				{
					key: 'ArrowDown',
					run(view) {
						if (view.composing) {
							return false;
						}

						if (!onNavigateDownBoundaryRef.current) {
							return false;
						}

						if (
							!isCollapsedSelectionOnLastLine({
								selection: toComposerSelection(view.state.selection),
								value: view.state.doc.toString(),
							})
						) {
							return false;
						}

						onNavigateDownBoundaryRef.current();
						return true;
					},
				},
				{
					key: 'ArrowUp',
					run(view) {
						if (view.composing) {
							return false;
						}

						const selection = view.state.selection.main;
						if (!selection.empty || selection.anchor !== 0 || selection.head !== 0) {
							return false;
						}

						if (!onNavigateUpBoundaryRef.current) {
							return false;
						}

						onNavigateUpBoundaryRef.current();
						return true;
					},
				},
				{
					key: 'Tab',
					run(view) {
						if (view.composing) {
							return false;
						}

						return runComposerTab(view) || insertTab({
							dispatch: view.dispatch,
							state: view.state,
						});
					},
				},
				{
					key: 'Shift-Tab',
					run(view) {
						if (view.composing) {
							return false;
						}

						return runComposerShiftTab(view);
					},
				},
				{
					key: 'Enter',
					run(view) {
						if (sendShortcutRef.current === 'ctrl-enter-send' && !view.composing) {
							return runComposerNewline(view);
						}

						if (sendShortcutRef.current !== 'enter-send' || view.composing) {
							return false;
						}

						onSubmitRef.current();
						return true;
					},
				},
				{
					key: 'Shift-Enter',
					run(view) {
						if (sendShortcutRef.current !== 'enter-send' || view.composing) {
							return false;
						}

						return runComposerNewline(view);
					},
				},
				{
					key: 'Mod-Enter',
					run(view) {
						if (sendShortcutRef.current !== 'ctrl-enter-send' || view.composing) {
							return false;
						}

						onSubmitRef.current();
						return true;
					},
				},
			]),
		);

		const view = new EditorView({
			parent: hostRef.current,
			state: EditorState.create({
				doc: value,
				selection: initialSelection
					? {
							anchor: Math.min(initialSelection.anchor, value.length),
							head: Math.min(initialSelection.head, value.length),
					  }
					: undefined,
				extensions: [
					EditorView.editorAttributes.of({
						class: styles.editorRoot ?? '',
						'data-testid': 'composer-editor',
					}),
					EditorView.lineWrapping,
					highlightSpecialChars(),
					drawSelection(),
					history(),
					liveMarkdownDecorations(),
					markdown({
						addKeymap: false,
						base: markdownLanguage,
						completeHTMLTags: false,
						pasteURLAsLink: false,
					}),
					sendKeymap,
					keymap.of([...markdownKeymap, ...historyKeymap, ...defaultKeymap]),
					editableCompartmentRef.current.of(EditorView.editable.of(!disabled)),
					readOnlyCompartmentRef.current.of(EditorState.readOnly.of(disabled)),
					attributesCompartmentRef.current.of(EditorView.contentAttributes.of(buildContentAttributes(describedBy))),
					placeholderCompartmentRef.current.of(editorPlaceholder(placeholder)),
					EditorView.domEventHandlers({
						blur() {
							onFocusChangeRef.current?.(false);
							return false;
						},
						focus() {
							onFocusChangeRef.current?.(true);
							return false;
						},
					}),
					EditorView.updateListener.of((update) => {
						if (update.focusChanged) {
							onFocusChangeRef.current?.(update.view.hasFocus);
						}

						if (update.selectionSet || update.docChanged) {
							onSelectionChangeRef.current?.(toComposerSelection(update.state.selection));
						}

						if (!update.docChanged) {
							return;
						}

						onChangeRef.current(update.state.doc.toString());
					}),
				],
			}),
		});

		viewRef.current = view;
		onSelectionChangeRef.current?.(toComposerSelection(view.state.selection));
		if (restoreFocusOnMount) {
			view.focus();
		}

		return () => {
			viewRef.current = null;
			view.destroy();
		};
	}, []);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) {
			return;
		}

		const currentValue = view.state.doc.toString();
		if (currentValue === value) {
			return;
		}

		view.dispatch({
			changes: {
				from: 0,
				to: currentValue.length,
				insert: value,
			},
		});
	}, [value]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) {
			return;
		}

		view.dispatch({
			effects: [
				editableCompartmentRef.current.reconfigure(EditorView.editable.of(!disabled)),
				readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(disabled)),
			],
		});
	}, [disabled]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) {
			return;
		}

		view.dispatch({
			effects: [attributesCompartmentRef.current.reconfigure(EditorView.contentAttributes.of(buildContentAttributes(describedBy)))],
		});
	}, [describedBy]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) {
			return;
		}

		view.dispatch({
			effects: [placeholderCompartmentRef.current.reconfigure(editorPlaceholder(placeholder))],
		});
	}, [placeholder]);

	useEffect(() => {
		if (focusToken === lastFocusTokenRef.current) {
			return;
		}

		lastFocusTokenRef.current = focusToken;
		viewRef.current?.focus();
	}, [focusToken]);

	return <div className={styles.editorHost} ref={hostRef} />;
});
