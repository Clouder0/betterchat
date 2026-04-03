import type {
	ClipboardEvent as ReactClipboardEvent,
	DragEvent as ReactDragEvent,
	KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { forwardRef, useCallback, useDeferredValue, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getAvatarLabel } from '@/lib/avatar';
import { betterChatApi, betterChatQueryKeys } from '@/lib/betterchat';
import type { TimelineReplyPreview } from '@/lib/chatModels';
import { spaceText } from '@/lib/text';

import type { ComposerEdit, ComposerSelection } from './composerEditing';
import {
	applyComposerEdit,
	createComposerEnterEdit,
	createComposerListIndentEdit,
	createComposerListOutdentEdit,
	createComposerTabEdit,
} from './composerEditing';
import { isCollapsedSelectionOnLastLine } from './composerBoundaryNavigation';
import {
	createMentionCompletionEdit,
	getActiveMentionMatch,
	getMentionCandidateSecondaryLabel,
	getMentionInsertionText,
	hasDistinctMentionHandle,
	normalizeMentionSearchValue,
	toComposerMentionCandidates,
	type ComposerMentionCandidate,
} from './mentions';
import {
	getComposerShortcutHint,
	shouldSendOnComposerKeydown,
	type ComposerSendShortcut,
} from './sendShortcutPreference';
import { hasComposerTransferImageFile, pickComposerTransferImageFile } from './composerTransfer';
import type { LiveMarkdownEditorHandle } from './LiveMarkdownEditor';
import { loadLiveMarkdownEditor, preloadLiveMarkdownEditor } from './loadLiveMarkdownEditor';
import styles from './ComposerBar.module.css';

const formatImageFileSize = (bytes: number) => {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '0 B';
	}

	if (bytes < 1024) {
		return `${bytes} B`;
	}

	const kib = bytes / 1024;
	if (kib < 1024) {
		return `${kib >= 10 ? Math.round(kib) : kib.toFixed(1)} KB`;
	}

	const mib = kib / 1024;
	return `${mib >= 10 ? Math.round(mib) : mib.toFixed(1)} MB`;
};

type ComposerSelectedImage = {
	dimensions?: {
		height: number;
		width: number;
	};
	file: File;
	previewUrl: string;
};

export type ComposerSubmitPayload = {
	imageFile?: File;
	imageDimensions?: {
		height: number;
		width: number;
	};
	text: string;
};

export type ComposerBarHandle = {
	focus: () => boolean;
};

const loadPreviewImageDimensions = (previewUrl: string) =>
	new Promise<{ height: number; width: number } | null>((resolve) => {
		const image = new Image();

		const finish = (dimensions: { height: number; width: number } | null) => {
			image.onload = null;
			image.onerror = null;
			resolve(dimensions);
		};

		image.onload = () => {
			const width = image.naturalWidth || image.width;
			const height = image.naturalHeight || image.height;
			finish(width > 0 && height > 0 ? { height, width } : null);
		};
		image.onerror = () => finish(null);
		image.src = previewUrl;

		if (image.complete) {
			const width = image.naturalWidth || image.width;
			const height = image.naturalHeight || image.height;
			finish(width > 0 && height > 0 ? { height, width } : null);
		}
	});

const shouldInsertComposerNewline = ({
	event,
	isComposing,
	mode,
}: {
	event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>;
	isComposing: boolean;
	mode: ComposerSendShortcut;
}) => {
	if (event.key !== 'Enter' || isComposing || event.altKey || event.metaKey) {
		return false;
	}

	if (mode === 'enter-send') {
		return event.shiftKey && !event.ctrlKey;
	}

	return !event.shiftKey && !event.ctrlKey;
};

type ComposerEditorProps = {
	describedBy: string;
	disabled?: boolean;
	focusToken?: number;
	onChange: (value: string) => void;
	onCompositionChange?: (composing: boolean) => void;
	onFocusChange?: (focused: boolean) => void;
	onNavigateDownBoundary?: () => boolean | void;
	onNavigateUpBoundary?: () => boolean | void;
	onSelectionChange?: (selection: ComposerSelection) => void;
	onSubmit: () => void;
	placeholder: string;
	sendShortcut: ComposerSendShortcut;
	value: string;
};

const ComposerTextareaFallback = forwardRef<LiveMarkdownEditorHandle, ComposerEditorProps>(function ComposerTextareaFallback(
	{
		describedBy,
		disabled = false,
		focusToken = 0,
		onChange,
		onCompositionChange,
		onFocusChange,
		onNavigateDownBoundary,
		onNavigateUpBoundary,
		onSelectionChange,
		onSubmit,
		placeholder,
		sendShortcut,
		value,
	},
	ref,
) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const lastFocusTokenRef = useRef(focusToken);

	const reportSelection = () => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}

		onSelectionChange?.({
			anchor: textarea.selectionStart ?? 0,
			head: textarea.selectionEnd ?? 0,
		});
	};

	const applyTextareaEdit = (edit: ComposerEdit | null) => {
		if (!edit) {
			return false;
		}

		onChange(applyComposerEdit(value, edit));
		requestAnimationFrame(() => {
			const textarea = textareaRef.current;
			if (!textarea) {
				return;
			}

			textarea.focus({ preventScroll: true });
			textarea.setSelectionRange(edit.selection.anchor, edit.selection.head);
			onSelectionChange?.(edit.selection);
		});

		return true;
	};

	useImperativeHandle(
		ref,
		() => ({
			applyEdit(edit) {
				return applyTextareaEdit(edit);
			},
			focus() {
				textareaRef.current?.focus({ preventScroll: true });
			},
		}),
		[applyTextareaEdit],
	);

	useEffect(() => {
		if (focusToken === lastFocusTokenRef.current) {
			return;
		}

		lastFocusTokenRef.current = focusToken;
		textareaRef.current?.focus({ preventScroll: true });
	}, [focusToken]);

	return (
		<textarea
			aria-describedby={describedBy}
			aria-label='消息输入'
			className={styles.textareaFallback}
			data-live-editor='fallback'
			data-testid='composer-textarea'
			disabled={disabled}
			onBlur={() => onFocusChange?.(false)}
			onChange={(event) => {
				onChange(event.currentTarget.value);
				reportSelection();
			}}
			onCompositionEnd={() => onCompositionChange?.(false)}
			onCompositionStart={() => onCompositionChange?.(true)}
			onFocus={() => {
				onFocusChange?.(true);
				reportSelection();
			}}
			onKeyDown={(event) => {
				if (
					shouldSendOnComposerKeydown({
						event,
						isComposing: event.nativeEvent.isComposing,
						mode: sendShortcut,
					})
				) {
					event.preventDefault();
					onSubmit();
					return;
				}

				if (
					event.key === 'ArrowDown' &&
					onNavigateDownBoundary &&
					!event.altKey &&
					!event.ctrlKey &&
					!event.metaKey &&
					!event.shiftKey &&
					isCollapsedSelectionOnLastLine({
						selection: {
							anchor: event.currentTarget.selectionStart ?? 0,
							head: event.currentTarget.selectionEnd ?? 0,
						},
						value,
					})
				) {
					event.preventDefault();
					onNavigateDownBoundary();
					return;
				}

				if (
					event.key === 'ArrowUp' &&
					onNavigateUpBoundary &&
					!event.altKey &&
					!event.ctrlKey &&
					!event.metaKey &&
					!event.shiftKey &&
					(event.currentTarget.selectionStart ?? 0) === 0 &&
					(event.currentTarget.selectionEnd ?? 0) === 0
				) {
					event.preventDefault();
					onNavigateUpBoundary?.();
					return;
				}

				if (event.key === 'Tab' && !event.shiftKey) {
					event.preventDefault();
					const sel = {
						selection: {
							anchor: event.currentTarget.selectionStart ?? 0,
							head: event.currentTarget.selectionEnd ?? 0,
						},
						value,
					};
					applyTextareaEdit(
						createComposerListIndentEdit(sel) ?? createComposerTabEdit(sel),
					);
					return;
				}

				if (event.key === 'Tab' && event.shiftKey) {
					const edit = createComposerListOutdentEdit({
						selection: {
							anchor: event.currentTarget.selectionStart ?? 0,
							head: event.currentTarget.selectionEnd ?? 0,
						},
						value,
					});
					if (edit) {
						event.preventDefault();
						applyTextareaEdit(edit);
					}
					return;
				}

				if (
					shouldInsertComposerNewline({
						event,
						isComposing: event.nativeEvent.isComposing,
						mode: sendShortcut,
					})
				) {
					const edit = createComposerEnterEdit({
						selection: {
							anchor: event.currentTarget.selectionStart ?? 0,
							head: event.currentTarget.selectionEnd ?? 0,
						},
						value,
					});

					if (edit) {
						event.preventDefault();
						applyTextareaEdit(edit);
					}
				}
			}}
			onKeyUp={reportSelection}
			onMouseUp={reportSelection}
			onSelect={reportSelection}
			placeholder={placeholder}
			ref={textareaRef}
			rows={1}
			spellCheck
			value={value}
		/>
	);
});

export type ComposerEditTarget = {
	messageId: string;
	originalText: string;
};

export const ComposerBar = forwardRef<ComposerBarHandle, {
	canUploadImages?: boolean;
	disabled?: boolean;
	disabledReason?: string;
	editTarget?: ComposerEditTarget | null;
	focusToken?: number;
	onClearEdit?: () => void;
	onFocusChange?: (focused: boolean) => void;
	onReadyChange?: (ready: boolean) => void;
	onNavigateUpBoundary?: () => boolean | void;
	pendingCount?: number;
	replyTo?: TimelineReplyPreview | null;
	roomId?: string | null;
	onClearReply?: () => void;
	onSend: (payload: ComposerSubmitPayload) => Promise<void> | void;
	sendShortcut: ComposerSendShortcut;
}>(function ComposerBar({
	canUploadImages = false,
	disabled = false,
	disabledReason,
	editTarget,
	focusToken = 0,
	onClearEdit,
	onFocusChange,
	onReadyChange,
	onNavigateUpBoundary,
	pendingCount = 0,
	replyTo,
	roomId = null,
	onClearReply,
	onSend,
	sendShortcut,
}, ref) {
	const editorRef = useRef<LiveMarkdownEditorHandle>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const imageTriggerRef = useRef<HTMLButtonElement>(null);
	const sendButtonRef = useRef<HTMLButtonElement>(null);
	const fallbackSelectionRef = useRef({ anchor: 0, head: 0 });
	const fallbackLastInputAtRef = useRef(0);
	const fallbackComposingRef = useRef(false);
	const imageTransferDragDepthRef = useRef(0);
	const selectedImageRef = useRef<ComposerSelectedImage | null>(null);
	const retainedPreviewUrlsRef = useRef(new Set<string>());
	const [text, setText] = useState('');
	const [selectedImage, setSelectedImage] = useState<ComposerSelectedImage | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [focusWithin, setFocusWithin] = useState(false);
	const [imageTransferDragActive, setImageTransferDragActive] = useState(false);
	const [isEditorFocused, setIsEditorFocused] = useState(false);
	const [selection, setSelection] = useState<ComposerSelection>({ anchor: 0, head: 0 });
	const [activeMentionIndex, setActiveMentionIndex] = useState(0);
	const [dismissedMentionSignature, setDismissedMentionSignature] = useState<string | null>(null);
	const [LoadedLiveMarkdownEditor, setLoadedLiveMarkdownEditor] = useState<typeof import('./LiveMarkdownEditor').LiveMarkdownEditor | null>(null);
	const [usesLoadedEditor, setUsesLoadedEditor] = useState(false);
	const helperMessageId = useId();
	const errorMessageId = useId();
	const selectedImageMeta = useMemo(() => {
		if (!selectedImage) {
			return null;
		}

		const extension = selectedImage.file.name.split('.').pop()?.toUpperCase();
		const meta = extension ? `${extension} · ${formatImageFileSize(selectedImage.file.size)}` : formatImageFileSize(selectedImage.file.size);
		return {
			meta,
			name: selectedImage.file.name,
		};
	}, [selectedImage]);

	const releasePreviewUrl = useCallback((previewUrl: string | undefined) => {
		if (!previewUrl || !retainedPreviewUrlsRef.current.has(previewUrl)) {
			return;
		}

		retainedPreviewUrlsRef.current.delete(previewUrl);
		URL.revokeObjectURL(previewUrl);
	}, []);

	const replaceSelectedImage = useCallback(
		(nextImage: ComposerSelectedImage | null) => {
			setSelectedImage((currentImage) => {
				if (currentImage && currentImage.previewUrl !== nextImage?.previewUrl) {
					releasePreviewUrl(currentImage.previewUrl);
				}

				return nextImage;
			});

			if (!nextImage && fileInputRef.current) {
				fileInputRef.current.value = '';
			}
		},
		[releasePreviewUrl],
	);

	const syncSelection = useCallback((nextSelection: ComposerSelection) => {
		fallbackSelectionRef.current = nextSelection;
		setSelection((currentSelection) =>
			currentSelection.anchor === nextSelection.anchor && currentSelection.head === nextSelection.head ? currentSelection : nextSelection,
		);
	}, []);

	const reportFocusWithin = useCallback(
		(focused: boolean) => {
			setFocusWithin((currentFocused) => (currentFocused === focused ? currentFocused : focused));
			onFocusChange?.(focused);
		},
		[onFocusChange],
	);

	useEffect(() => {
		selectedImageRef.current = selectedImage;
	}, [selectedImage]);

	useEffect(
		() => () => {
			retainedPreviewUrlsRef.current.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
			retainedPreviewUrlsRef.current.clear();
		},
		[],
	);

	useEffect(() => {
		preloadLiveMarkdownEditor();

		let active = true;
		void loadLiveMarkdownEditor().then((module) => {
			if (!active) {
				return;
			}

			setLoadedLiveMarkdownEditor(() => module.default);
		});

		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		onReadyChange?.(Boolean(editorRef.current));
		return () => {
			onReadyChange?.(false);
		};
	}, [LoadedLiveMarkdownEditor, onReadyChange, usesLoadedEditor]);

	const prevEditTargetIdRef = useRef<string | null>(null);
	useEffect(() => {
		const nextId = editTarget?.messageId ?? null;
		if (nextId !== prevEditTargetIdRef.current) {
			prevEditTargetIdRef.current = nextId;
			if (editTarget) {
				setText(editTarget.originalText);
				replaceSelectedImage(null);
				setErrorMessage(null);
				queueMicrotask(() => {
					editorRef.current?.focus();
				});
			}
		}
	}, [editTarget, replaceSelectedImage]);

	useImperativeHandle(
		ref,
		() => ({
			focus() {
				if (!editorRef.current) {
					return false;
				}

				editorRef.current.focus();
				return true;
			},
		}),
		[],
	);

	const submit = () => {
		const trimmedText = text.trim();
		const submittedImage = selectedImageRef.current;

		if ((!trimmedText && !submittedImage) || disabled) {
			return;
		}

		if (submittedImage && replyTo) {
			setErrorMessage('当前版本暂不支持图片回复，请先取消回复或仅发送文字。');
			return;
		}

		setErrorMessage(null);
		setText('');
		setSelectedImage(null);
		if (fileInputRef.current) {
			fileInputRef.current.value = '';
		}
		editorRef.current?.focus();

		void Promise.resolve()
			.then(() =>
				onSend({
					imageFile: submittedImage?.file,
					imageDimensions: submittedImage?.dimensions,
					text: trimmedText,
				}),
			)
			.then(() => {
				if (submittedImage) {
					releasePreviewUrl(submittedImage.previewUrl);
				}
			})
			.catch((error) => {
				setErrorMessage(error instanceof Error ? error.message : '发送失败，请稍后重试。');
				setText((currentText) => currentText || trimmedText);
				setSelectedImage((currentImage) => currentImage ?? submittedImage ?? null);
				editorRef.current?.focus();
			});
	};

	const imageReplyConflict = Boolean(selectedImage && replyTo);
	const canAttachImages = canUploadImages && !disabled && !replyTo;
	const canSend = (Boolean(text.trim()) || Boolean(selectedImage)) && !disabled && !imageReplyConflict;
	const resolvedDisabledReason = disabledReason?.trim() || '当前会话为只读。';
	const describedBy = errorMessage ? errorMessageId : helperMessageId;
	const clearImageTransferDragState = useCallback(() => {
		imageTransferDragDepthRef.current = 0;
		setImageTransferDragActive(false);
	}, []);
	const getFooterFocusTargets = useCallback(() => {
		const nextTargets: HTMLButtonElement[] = [];

		if (canAttachImages && imageTriggerRef.current && !imageTriggerRef.current.disabled) {
			nextTargets.push(imageTriggerRef.current);
		}

		if (sendButtonRef.current && !sendButtonRef.current.disabled) {
			nextTargets.push(sendButtonRef.current);
		}

		return nextTargets;
	}, [canAttachImages, canSend]);
	const focusComposerEditor = useCallback(() => {
		editorRef.current?.focus();
		return true;
	}, []);
	const focusComposerFooterBoundary = useCallback(() => {
		const [nextTarget] = getFooterFocusTargets();
		if (!nextTarget) {
			return false;
		}

		nextTarget.focus({ preventScroll: true });
		return true;
	}, [getFooterFocusTargets]);
	const moveComposerFooterFocus = useCallback(
		(currentTarget: HTMLButtonElement, direction: 'next' | 'previous') => {
			const targets = getFooterFocusTargets();
			const currentIndex = targets.findIndex((target) => target === currentTarget);
			if (currentIndex < 0) {
				return false;
			}

			const nextTarget = targets[currentIndex + (direction === 'next' ? 1 : -1)];
			if (!nextTarget) {
				return false;
			}

			nextTarget.focus({ preventScroll: true });
			return true;
		},
		[getFooterFocusTargets],
	);
	const acceptSelectedImageFile = useCallback(
		(file: File) => {
			const previewUrl = URL.createObjectURL(file);
			retainedPreviewUrlsRef.current.add(previewUrl);
			replaceSelectedImage({
				file,
				previewUrl,
			});
			setErrorMessage(null);

			void loadPreviewImageDimensions(previewUrl).then((dimensions) => {
				if (!dimensions) {
					return;
				}

				setSelectedImage((currentImage) => {
					if (!currentImage || currentImage.previewUrl !== previewUrl) {
						return currentImage;
					}

					if (
						currentImage.dimensions?.width === dimensions.width &&
						currentImage.dimensions?.height === dimensions.height
					) {
						return currentImage;
					}

					return {
						...currentImage,
						dimensions,
					};
				});
			});
		},
		[replaceSelectedImage],
	);
	const acceptTransferredImage = useCallback(
		(file: File) => {
			if (disabled) {
				return false;
			}

			if (!canUploadImages) {
				setErrorMessage('当前会话不支持图片发送。');
				return false;
			}

			if (replyTo) {
				setErrorMessage('当前版本暂不支持图片回复，请先取消回复或仅发送文字。');
				return false;
			}

			acceptSelectedImageFile(file);
			return true;
		},
		[acceptSelectedImageFile, canUploadImages, disabled, replyTo],
	);
	const activeMentionMatch = useMemo(
		() => (disabled ? null : getActiveMentionMatch({ selection, value: text })),
		[disabled, selection, text],
	);
	const deferredMentionQuery = useDeferredValue(activeMentionMatch?.query ?? '');
	const mentionLookupEnabled = Boolean(roomId && focusWithin && activeMentionMatch && !disabled);
	const mentionCandidatesQuery = useQuery({
		queryKey: roomId ? betterChatQueryKeys.roomMentionCandidates(roomId, deferredMentionQuery) : ['room-mention-candidates', 'empty'],
		queryFn: () =>
			betterChatApi.roomMentionCandidates(roomId!, {
				query: deferredMentionQuery,
			}),
		enabled: mentionLookupEnabled,
		staleTime: 30_000,
	});
	const visibleMentionCandidates = useMemo(
		() => {
			if (!activeMentionMatch || !mentionCandidatesQuery.data) {
				return [];
			}

			if (mentionCandidatesQuery.data.query !== normalizeMentionSearchValue(activeMentionMatch.query)) {
				return [];
			}

			return toComposerMentionCandidates(mentionCandidatesQuery.data.entries);
		},
		[activeMentionMatch, mentionCandidatesQuery.data],
	);
	const mentionMenuOpen = Boolean(
		focusWithin &&
			activeMentionMatch &&
			visibleMentionCandidates.length > 0 &&
			dismissedMentionSignature !== activeMentionMatch.signature,
	);
	const activeMentionCandidate = mentionMenuOpen
		? visibleMentionCandidates[Math.min(activeMentionIndex, visibleMentionCandidates.length - 1)] ?? null
		: null;

	useEffect(() => {
		if (!LoadedLiveMarkdownEditor || usesLoadedEditor) {
			return;
		}

		const shouldWaitForIdleWindow =
			fallbackComposingRef.current || (isEditorFocused && Date.now() - fallbackLastInputAtRef.current < 180);

		if (!shouldWaitForIdleWindow) {
			setUsesLoadedEditor(true);
			return;
		}

		const timerId = window.setTimeout(() => {
			if (!fallbackComposingRef.current) {
				setUsesLoadedEditor(true);
			}
		}, 180);

		return () => {
			window.clearTimeout(timerId);
		};
	}, [LoadedLiveMarkdownEditor, isEditorFocused, text, usesLoadedEditor]);

	useEffect(() => {
		if (!activeMentionMatch) {
			if (dismissedMentionSignature) {
				setDismissedMentionSignature(null);
			}
			setActiveMentionIndex(0);
			return;
		}

		if (dismissedMentionSignature && dismissedMentionSignature !== activeMentionMatch.signature) {
			setDismissedMentionSignature(null);
		}
	}, [activeMentionMatch, dismissedMentionSignature]);

	useEffect(() => {
		if (!mentionMenuOpen) {
			setActiveMentionIndex(0);
			return;
		}

		setActiveMentionIndex((currentIndex) => Math.min(currentIndex, visibleMentionCandidates.length - 1));
	}, [mentionMenuOpen, visibleMentionCandidates.length]);

	const acceptMentionCandidate = useCallback(
		(candidate: ComposerMentionCandidate) => {
			if (!activeMentionMatch) {
				return;
			}

			const mentionEdit = createMentionCompletionEdit({
				candidate,
				match: activeMentionMatch,
				value: text,
			});
			const nextText = applyComposerEdit(text, mentionEdit);
			editorRef.current?.applyEdit(mentionEdit);
			fallbackLastInputAtRef.current = Date.now();
			setDismissedMentionSignature(null);
			syncSelection(mentionEdit.selection);
			setText(nextText);

			if (errorMessage) {
				setErrorMessage(null);
			}

			editorRef.current?.focus();
		},
		[activeMentionMatch, errorMessage, syncSelection, text],
	);

	const handleComposerKeyDownCapture = useCallback(
		(event: ReactKeyboardEvent<HTMLFormElement>) => {
			if (!mentionMenuOpen || event.nativeEvent.isComposing) {
				return;
			}

			if (event.key === 'ArrowDown') {
				event.preventDefault();
				event.stopPropagation();
				setActiveMentionIndex((currentIndex) => (currentIndex + 1) % visibleMentionCandidates.length);
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				event.stopPropagation();
				setActiveMentionIndex((currentIndex) =>
					(currentIndex - 1 + visibleMentionCandidates.length) % visibleMentionCandidates.length,
				);
				return;
			}

			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				setDismissedMentionSignature(activeMentionMatch?.signature ?? null);
				return;
			}

			if (!activeMentionCandidate || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
				return;
			}

			if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault();
				event.stopPropagation();
				acceptMentionCandidate(activeMentionCandidate);
			}
		},
		[acceptMentionCandidate, activeMentionCandidate, activeMentionMatch, mentionMenuOpen, visibleMentionCandidates.length],
	);
	const handleComposerPasteCapture = useCallback(
		(event: ReactClipboardEvent<HTMLFormElement>) => {
			const pastedImage = pickComposerTransferImageFile(event.clipboardData);
			if (!pastedImage) {
				return;
			}

			if (!acceptTransferredImage(pastedImage)) {
				return;
			}

			event.preventDefault();
		},
		[acceptTransferredImage],
	);
	const handleComposerDragEnterCapture = useCallback(
		(event: ReactDragEvent<HTMLFormElement>) => {
			if (!hasComposerTransferImageFile(event.dataTransfer)) {
				return;
			}

			imageTransferDragDepthRef.current += 1;
			if (canAttachImages) {
				setImageTransferDragActive(true);
			}
		},
		[canAttachImages],
	);
	const handleComposerDragLeaveCapture = useCallback(() => {
		if (imageTransferDragDepthRef.current <= 0) {
			return;
		}

		imageTransferDragDepthRef.current = Math.max(0, imageTransferDragDepthRef.current - 1);
		if (imageTransferDragDepthRef.current === 0) {
			setImageTransferDragActive(false);
		}
	}, []);
	const handleComposerDragOverCapture = useCallback(
		(event: ReactDragEvent<HTMLFormElement>) => {
			if (!hasComposerTransferImageFile(event.dataTransfer)) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = canAttachImages ? 'copy' : 'none';
		},
		[canAttachImages],
	);
	const handleComposerDropCapture = useCallback(
		(event: ReactDragEvent<HTMLFormElement>) => {
			const droppedImage = pickComposerTransferImageFile(event.dataTransfer);
			clearImageTransferDragState();
			if (!droppedImage) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			if (acceptTransferredImage(droppedImage)) {
				focusComposerEditor();
			}
		},
		[acceptTransferredImage, clearImageTransferDragState, focusComposerEditor],
	);

	return (
		<form
			className={styles.composer}
			data-testid='composer'
			onBlurCapture={(event) => {
				const nextFocusedNode = event.relatedTarget;
				if (nextFocusedNode instanceof Node && event.currentTarget.contains(nextFocusedNode)) {
					return;
				}

				reportFocusWithin(false);
			}}
			onFocusCapture={() => {
				reportFocusWithin(true);
			}}
			onDragEndCapture={clearImageTransferDragState}
			onDragEnterCapture={handleComposerDragEnterCapture}
			onDragLeaveCapture={handleComposerDragLeaveCapture}
			onDragOverCapture={handleComposerDragOverCapture}
			onDropCapture={handleComposerDropCapture}
			onKeyDownCapture={handleComposerKeyDownCapture}
			onPasteCapture={handleComposerPasteCapture}
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			{replyTo ? (
				<div className={styles.composeContext} data-testid='composer-reply-context'>
					<div className={styles.composeContextCopy}>
						<p className={styles.composeContextLabel}>{spaceText(`回复 ${replyTo.authorName}`)}</p>
						<p className={styles.composeContextExcerpt}>{spaceText(replyTo.excerpt)}</p>
					</div>

					{onClearReply ? (
						<button
							aria-label='取消回复'
							className={styles.composeContextDismiss}
							data-testid='composer-reply-cancel'
							onClick={onClearReply}
							type='button'
						>
							<span aria-hidden='true'>×</span>
						</button>
					) : null}
				</div>
			) : null}

			{editTarget ? (
				<div className={styles.composeContext} data-mode='edit' data-testid='composer-edit-context'>
					<div className={styles.composeContextCopy}>
						<p className={styles.composeContextLabel}>{spaceText('编辑消息')}</p>
					</div>

					{onClearEdit ? (
						<button
							aria-label='取消编辑'
							className={styles.composeContextDismiss}
							data-testid='composer-edit-cancel'
							onClick={onClearEdit}
							type='button'
						>
							<span aria-hidden='true'>×</span>
						</button>
					) : null}
				</div>
			) : null}

			{selectedImage && selectedImageMeta ? (
				<div className={styles.attachmentPreview} data-testid='composer-image-preview'>
					<div className={styles.attachmentPreviewMedia}>
						<img
							alt={selectedImageMeta.name}
							className={styles.attachmentPreviewImage}
							height={selectedImage.dimensions?.height}
							src={selectedImage.previewUrl}
							width={selectedImage.dimensions?.width}
						/>
					</div>
					<div className={styles.attachmentPreviewCopy}>
						<p className={styles.attachmentPreviewLabel}>待发送图片</p>
						<p className={styles.attachmentPreviewName}>{selectedImageMeta.name}</p>
						<p className={styles.attachmentPreviewMeta}>{selectedImageMeta.meta}</p>
					</div>
					<button
						aria-label='移除待发送图片'
						className={styles.attachmentPreviewDismiss}
						data-testid='composer-image-remove'
						onClick={() => replaceSelectedImage(null)}
						type='button'
					>
						<span aria-hidden='true'>×</span>
					</button>
				</div>
			) : null}

			<div
				className={styles.shell}
				data-disabled={disabled ? 'true' : 'false'}
				data-error={errorMessage ? 'true' : 'false'}
				data-focused={focusWithin ? 'true' : 'false'}
				data-has-image={selectedImage ? 'true' : 'false'}
				data-transfer-drag-active={imageTransferDragActive ? 'true' : 'false'}
				data-has-value={text.trim() ? 'true' : 'false'}
				data-testid='composer-editor-shell'
			>
				{LoadedLiveMarkdownEditor && usesLoadedEditor ? (
					<LoadedLiveMarkdownEditor
						ref={editorRef}
						describedBy={describedBy}
						disabled={disabled}
						focusToken={focusToken}
						initialSelection={fallbackSelectionRef.current}
						onChange={(value) => {
							if (errorMessage) {
								setErrorMessage(null);
							}

							setText(value);
						}}
						onFocusChange={setIsEditorFocused}
						onNavigateDownBoundary={focusComposerFooterBoundary}
						onNavigateUpBoundary={onNavigateUpBoundary}
						onSelectionChange={syncSelection}
						placeholder={spaceText(disabled ? resolvedDisabledReason : '写消息')}
						restoreFocusOnMount={isEditorFocused}
						onSubmit={submit}
						sendShortcut={sendShortcut}
						value={text}
					/>
				) : (
					<ComposerTextareaFallback
						ref={editorRef}
						describedBy={describedBy}
						disabled={disabled}
						focusToken={focusToken}
						onChange={(value) => {
							if (errorMessage) {
								setErrorMessage(null);
							}

							fallbackLastInputAtRef.current = Date.now();
							setText(value);
						}}
						onCompositionChange={(composing) => {
							fallbackComposingRef.current = composing;
							if (!composing) {
								fallbackLastInputAtRef.current = Date.now();
							}
						}}
						onFocusChange={setIsEditorFocused}
						onNavigateDownBoundary={focusComposerFooterBoundary}
						onNavigateUpBoundary={onNavigateUpBoundary}
						onSelectionChange={syncSelection}
						placeholder={spaceText(disabled ? resolvedDisabledReason : '写消息')}
						onSubmit={submit}
						sendShortcut={sendShortcut}
						value={text}
					/>
				)}
				<input readOnly type='hidden' data-testid='composer-raw-value' value={text} />
				<input
					accept='image/*'
					className={styles.fileInput}
					data-testid='composer-image-input'
					onChange={(event) => {
						const file = event.currentTarget.files?.[0];
						event.currentTarget.value = '';
						if (!file) {
							return;
						}

						if (!file.type.startsWith('image/')) {
							setErrorMessage('当前只支持图片上传。');
							return;
						}

						acceptSelectedImageFile(file);
					}}
					ref={fileInputRef}
					type='file'
				/>
			</div>

			{mentionMenuOpen && activeMentionMatch ? (
				<div
					aria-label='提及候选'
					className={styles.mentionMenu}
					data-testid='composer-mention-menu'
					role='listbox'
				>
					{visibleMentionCandidates.map((candidate, index) => {
						const selected = index === activeMentionIndex;
						const handleLabel = getMentionInsertionText(candidate);
						return (
							<button
								key={candidate.id}
								aria-selected={selected}
								className={styles.mentionOption}
								data-selected={selected ? 'true' : 'false'}
								data-testid={`composer-mention-option-${candidate.id}`}
								onMouseDown={(event) => {
									event.preventDefault();
									acceptMentionCandidate(candidate);
								}}
								onMouseEnter={() => setActiveMentionIndex(index)}
								role='option'
								type='button'
							>
								<span aria-hidden='true' className={styles.mentionAvatar}>
									{candidate.kind === 'special'
										? candidate.insertText.replace(/^@/, '').slice(0, 2).toUpperCase()
										: getAvatarLabel(candidate.displayName)}
								</span>
								<span className={styles.mentionOptionCopy}>
									<span className={styles.mentionOptionPrimary}>{spaceText(candidate.displayName)}</span>
									{getMentionCandidateSecondaryLabel(candidate) ? (
										<span className={styles.mentionOptionSecondary}>
											{spaceText(getMentionCandidateSecondaryLabel(candidate) ?? '')}
										</span>
									) : null}
								</span>
							</button>
						);
					})}
				</div>
			) : null}

			<div className={styles.footer} data-testid='composer-footer'>
				<div className={styles.footerLead}>
					{canUploadImages ? (
						<button
							aria-label='选择图片'
							className={styles.mediaButton}
							data-ready={selectedImage ? 'true' : 'false'}
							data-testid='composer-image-trigger'
							disabled={!canAttachImages}
							onClick={() => fileInputRef.current?.click()}
							onKeyDown={(event) => {
								if (event.key === 'ArrowUp') {
									event.preventDefault();
									focusComposerEditor();
									return;
								}

								if (event.key === 'ArrowRight') {
									if (moveComposerFooterFocus(event.currentTarget, 'next')) {
										event.preventDefault();
									}
								}
							}}
							ref={imageTriggerRef}
							title={replyTo ? '当前版本暂不支持带回复的图片发送' : '选择图片'}
							type='button'
						>
							<svg aria-hidden='true' className={styles.mediaButtonIcon} viewBox='0 0 16 16'>
								<rect fill='none' height='9.5' rx='2' stroke='currentColor' strokeWidth='1.15' width='9.5' x='3.25' y='3.25' />
								<circle cx='5.45' cy='5.45' r='1.05' fill='currentColor' />
								<path
									d='m4.2 10.55 2.48-2.88a.58.58 0 0 1 .88-.02l1.36 1.54 1.36-1.22a.58.58 0 0 1 .78.02l1.02 1.02'
									fill='none'
									stroke='currentColor'
									strokeLinecap='round'
									strokeLinejoin='round'
									strokeWidth='1.15'
								/>
							</svg>
						</button>
					) : null}
					<div className={styles.metaRow}>
						{errorMessage ? (
							<p className={styles.assistiveText} data-testid='composer-error' data-tone='warning' id={errorMessageId} role='alert'>
								{spaceText(errorMessage)}
							</p>
						) : imageReplyConflict ? (
							<p className={styles.assistiveText} data-tone='warning' id={helperMessageId}>
								{spaceText('图片发送暂不附带回复引用。')}
							</p>
						) : disabled ? (
							<p className={styles.assistiveText} data-tone='neutral' id={helperMessageId}>
								{spaceText(resolvedDisabledReason)}
							</p>
						) : pendingCount > 0 ? (
							<p className={styles.assistiveText} data-testid='composer-pending-count' data-tone='neutral' id={helperMessageId}>
								{spaceText(`正在发送 ${pendingCount} 条`)}
							</p>
						) : selectedImage ? (
							<p className={styles.assistiveText} data-tone='neutral' id={helperMessageId}>
								{spaceText('可直接发送图片，也可补充一段说明。')}
							</p>
						) : (
							<p className={styles.assistiveText} data-testid='composer-shortcut-hint' id={helperMessageId}>
								{spaceText(getComposerShortcutHint(sendShortcut))}
							</p>
						)}
					</div>
				</div>

				<button
					className={styles.sendButton}
					data-testid='composer-send'
					data-ready={canSend ? 'true' : 'false'}
					disabled={!canSend}
					onKeyDown={(event) => {
						if (event.key === 'ArrowUp') {
							event.preventDefault();
							focusComposerEditor();
							return;
						}

						if (event.key === 'ArrowLeft') {
							if (moveComposerFooterFocus(event.currentTarget, 'previous')) {
								event.preventDefault();
							}
						}
					}}
					ref={sendButtonRef}
					type='submit'
				>
					<span className={styles.sendLabel}>{spaceText('发送消息')}</span>
				</button>
			</div>
		</form>
	);
});
