import { cloneElement, isValidElement, memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import type { FocusEventHandler, KeyboardEventHandler, ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { pangu } from 'pangu/browser';
import 'katex/dist/katex.min.css';

import { GalleryImage } from '@/features/media/ImageGallery';
import { useClipboard } from '@/hooks/useClipboard';
import type { MentionInteractionUser } from '@/lib/mentions';
import { resolveInlineMentionTone, resolveMentionInteractionUser, splitMentionSegments } from '@/lib/mentions';
import styles from './MarkdownContent.module.css';

type MarkdownCodeNode = {
	position?: {
		start?: { line?: number };
		end?: { line?: number };
	};
};

type MarkdownNode = {
	type?: string;
	value?: string;
	children?: MarkdownNode[];
};

type MarkdownCurrentUser = {
	id?: string;
	displayName: string;
	username: string;
} | null;

export type MarkdownMentionInteraction = {
	focusKeyPrefix: string;
	onFocus?: FocusEventHandler<HTMLButtonElement>;
	onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
	onOpen?: (payload: {
		anchorRect: DOMRect;
		focusKey: string;
		source: 'keyboard' | 'pointer';
		token: string;
		timelineMessageId?: string;
		user: MentionInteractionUser;
	}) => void;
	onPrepare?: (user: MentionInteractionUser) => void;
	tabIndex?: number;
	timelineMessageId?: string;
	users: MentionInteractionUser[];
};

const NON_INTERACTIVE_MENTION_PARENT_TYPES = new Set(['a', 'button', 'code', 'pre', 'kbd', 'samp']);

const buildMentionInteractionUserSignature = (users: MentionInteractionUser[] | undefined) =>
	(users ?? [])
		.map((user) => `${user.id}:${user.username ?? ''}:${user.displayName}`)
		.join('|');

const decorateInlineMentions = ({
	currentUser,
	interactiveDisabled = false,
	keyPrefix = 'mention-inline',
	mentionInteraction,
	node,
}: {
	currentUser?: MarkdownCurrentUser;
	interactiveDisabled?: boolean;
	keyPrefix?: string;
	mentionInteraction?: MarkdownMentionInteraction;
	node: ReactNode;
}): ReactNode => {
	if (typeof node === 'string' || typeof node === 'number') {
		const value = String(node);
		const segments = splitMentionSegments(value);
		if (segments.length === 1 && segments[0]?.kind === 'text') {
			return node;
		}

		return segments.map((segment, index) =>
			segment.kind === 'mention'
				? (() => {
						const interaction = mentionInteraction;
						const mentionTone = resolveInlineMentionTone({
							currentUser,
							token: segment.value,
						});
						const resolvedUser =
							interactiveDisabled || !interaction
								? null
								: resolveMentionInteractionUser({
										currentUserId: currentUser?.id,
										token: segment.value,
										users: interaction.users,
								  });

						if (!resolvedUser || !interaction || !interaction.onOpen) {
							return (
								<span
									className={styles.mentionInline}
									data-mention-token='true'
									data-mention-tone={mentionTone}
									key={`${keyPrefix}-${index}`}
								>
									{segment.value}
								</span>
							);
						}

						const focusKey = `${interaction.focusKeyPrefix}:${keyPrefix}:${index}`;
						return (
							<button
								className={`${styles.mentionInline} ${styles.mentionInteractive}`.trim()}
								data-mention-focus-key={focusKey}
								data-mention-interactive='true'
								data-mention-token='true'
								data-mention-token-value={segment.value}
								data-mention-tone={mentionTone}
								data-mention-user-id={resolvedUser.id}
								data-timeline-message-id={mentionInteraction.timelineMessageId}
								key={`${keyPrefix}-${index}`}
								onClick={(event) =>
									interaction.onOpen?.({
										anchorRect: event.currentTarget.getBoundingClientRect(),
										focusKey,
										source: event.detail === 0 ? 'keyboard' : 'pointer',
										token: segment.value,
										timelineMessageId: interaction.timelineMessageId,
										user: resolvedUser,
									})
								}
								onFocus={interaction.onFocus}
								onKeyDown={interaction.onKeyDown}
								onPointerEnter={(event) => {
									if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
										interaction.onPrepare?.(resolvedUser);
									}
								}}
								tabIndex={interaction.tabIndex ?? 0}
								type='button'
							>
								{segment.value}
							</button>
						);
				  })()
				: segment.value,
		);
	}

	if (Array.isArray(node)) {
		return node.map((child, index) =>
			decorateInlineMentions({
				currentUser,
				interactiveDisabled,
				keyPrefix: `${keyPrefix}-${index}`,
				mentionInteraction,
				node: child,
			}),
		);
	}

	if (!isValidElement(node)) {
		return node;
	}

	const nextInteractiveDisabled =
		interactiveDisabled || (typeof node.type === 'string' && NON_INTERACTIVE_MENTION_PARENT_TYPES.has(node.type));
	if (nextInteractiveDisabled && typeof node.type === 'string' && ['code', 'pre', 'kbd', 'samp'].includes(node.type)) {
		return node;
	}

	const children = (node.props as { children?: ReactNode }).children;
	if (children === undefined) {
		return node;
	}

	return cloneElement(
		node,
		undefined,
		decorateInlineMentions({
			currentUser,
			interactiveDisabled: nextInteractiveDisabled,
			keyPrefix: `${keyPrefix}-child`,
			mentionInteraction,
			node: children,
		}),
	);
};

const collectText = (node: ReactNode): string => {
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}

	if (Array.isArray(node)) {
		return node.map(collectText).join('');
	}

	if (node && typeof node === 'object' && 'props' in node) {
		return collectText((node as { props?: { children?: ReactNode } }).props?.children);
	}

	return '';
};

const formatLanguageLabel = (language: string) => {
	if (language.length <= 3) {
		return language.toUpperCase();
	}

	return language;
};

const isBlockCodeNode = (node: MarkdownCodeNode | undefined, rawText: string, className?: string) => {
	const startLine = node?.position?.start?.line;
	const endLine = node?.position?.end?.line;

	if (typeof startLine === 'number' && typeof endLine === 'number' && startLine !== endLine) {
		return true;
	}

	if (rawText.includes('\n')) {
		return true;
	}

	return /(?:^|\s)(?:hljs|language-[\w-]+)/.test(className ?? '');
};

const normalizeStandaloneDisplayMath = (source: string) => {
	const lines = source.split('\n');
	const normalizedLines: string[] = [];
	let activeFence: '```' | '~~~' | null = null;

	for (const line of lines) {
		const fenceMatch = line.match(/^(\s*)(```|~~~)/);
		if (fenceMatch) {
			const fence = fenceMatch[2] as '```' | '~~~';
			activeFence = activeFence === fence ? null : activeFence ?? fence;
			normalizedLines.push(line);
			continue;
		}

		if (activeFence) {
			normalizedLines.push(line);
			continue;
		}

		const singleLineBlockMathMatch = line.match(/^(\s*(?:>\s*)*)\$\$(.+)\$\$\s*$/);
		if (!singleLineBlockMathMatch) {
			normalizedLines.push(line);
			continue;
		}

		const prefix = singleLineBlockMathMatch[1] ?? '';
		const expression = singleLineBlockMathMatch[2]?.trim();
		if (!expression) {
			normalizedLines.push(line);
			continue;
		}

		normalizedLines.push(`${prefix}$$`, `${prefix}${expression}`, `${prefix}$$`);
	}

	return normalizedLines.join('\n');
};

const INLINE_SPACING_CONTAINER_TYPES = new Set(['paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link', 'linkReference', 'tableCell']);
const NON_SPACING_PARENT_TYPES = new Set(['inlineCode', 'code', 'math', 'inlineMath', 'html']);

const getBoundaryCharacter = (node: MarkdownNode | undefined, direction: 'start' | 'end'): string | undefined => {
	if (!node) {
		return undefined;
	}

	if (typeof node.value === 'string') {
		const characters = Array.from(node.value);
		const orderedCharacters = direction === 'start' ? characters : [...characters].reverse();
		return orderedCharacters.find((character) => !/\s/u.test(character));
	}

	if (!node.children?.length) {
		return undefined;
	}

	const orderedChildren = direction === 'start' ? node.children : [...node.children].reverse();
	for (const child of orderedChildren) {
		const boundaryCharacter = getBoundaryCharacter(child, direction);
		if (boundaryCharacter) {
			return boundaryCharacter;
		}
	}

	return undefined;
};

const getRawBoundaryCharacter = (node: MarkdownNode | undefined, direction: 'start' | 'end'): string | undefined => {
	if (!node) {
		return undefined;
	}

	if (typeof node.value === 'string') {
		const characters = Array.from(node.value);
		return direction === 'start' ? characters[0] : characters.at(-1);
	}

	if (!node.children?.length) {
		return undefined;
	}

	const orderedChildren = direction === 'start' ? node.children : [...node.children].reverse();
	for (const child of orderedChildren) {
		const boundaryCharacter = getRawBoundaryCharacter(child, direction);
		if (boundaryCharacter) {
			return boundaryCharacter;
		}
	}

	return undefined;
};

const shouldInsertSpacingBetween = (leftNode: MarkdownNode | undefined, rightNode: MarkdownNode | undefined) => {
	const leftCharacter = getBoundaryCharacter(leftNode, 'end');
	const rightCharacter = getBoundaryCharacter(rightNode, 'start');

	if (!leftCharacter || !rightCharacter) {
		return false;
	}

	const leftRawCharacter = getRawBoundaryCharacter(leftNode, 'end');
	const rightRawCharacter = getRawBoundaryCharacter(rightNode, 'start');

	if ((leftRawCharacter && /\s/u.test(leftRawCharacter)) || (rightRawCharacter && /\s/u.test(rightRawCharacter))) {
		return false;
	}

	return pangu.spacingText(`${leftCharacter}${rightCharacter}`) !== `${leftCharacter}${rightCharacter}`;
};

const insertInlineBoundarySpacing = (children: MarkdownNode[]) => {
	const spacedChildren: MarkdownNode[] = [];

	for (const child of children) {
		const previousChild = spacedChildren.at(-1);
		if (previousChild && shouldInsertSpacingBetween(previousChild, child)) {
			spacedChildren.push({ type: 'text', value: ' ' });
		}

		spacedChildren.push(child);
	}

	return spacedChildren;
};

const remarkPanguSpacing = () => (tree: MarkdownNode) => {
	const visit = (node: MarkdownNode, parentType?: string) => {
		if (node.type === 'text' && typeof node.value === 'string' && !NON_SPACING_PARENT_TYPES.has(parentType ?? '')) {
			node.value = pangu.spacingText(node.value);
		}

		if (!node.children?.length) {
			return;
		}

		node.children.forEach((child) => visit(child, node.type));

		if (INLINE_SPACING_CONTAINER_TYPES.has(node.type ?? '')) {
			node.children = insertInlineBoundarySpacing(node.children);
		}
	};

	visit(tree);
};

const CodeBlock: NonNullable<Components['code']> = ({
	node,
	children,
	className,
	...props
}) => {
	const match = /language-([\w-]+)/.exec(className ?? '');
	const rawText = collectText(children);
	const isBlock = isBlockCodeNode(node, rawText, className);
	const { state: copyState, copy } = useClipboard({ resetAfter: 1600 });

	if (!isBlock) {
		return (
			<code className={`no-pangu-spacing ${styles.inlineCode}`} {...props}>
				{children}
			</code>
		);
	}

	const language = match?.[1] ?? 'text';
	const normalizedText = rawText.replace(/\n$/, '');

	const getCopyButtonText = () => {
		switch (copyState) {
			case 'copied':
				return '已复制';
			case 'error':
				return '复制失败';
			default:
				return '复制';
		}
	};

	return (
		<figure className={`no-pangu-spacing ${styles.codeBlock}`}>
			<figcaption className={styles.codeHeader}>
				<div className={styles.codeMeta}>
					<span className={styles.codeLabel}>代码片段</span>
					<span className={styles.codeLanguage}>{formatLanguageLabel(language)}</span>
				</div>
				<button
					className={styles.copyButton}
					data-state={copyState}
					onClick={() => copy(normalizedText)}
					type='button'
				>
					{getCopyButtonText()}
				</button>
			</figcaption>
			<pre className={styles.pre}>
				<code className={className} {...props}>
					{children}
				</code>
			</pre>
		</figure>
	);
};

const createMarkdownComponents = ({
	currentUser,
	imageInteraction,
	mentionInteraction,
}: {
	currentUser?: MarkdownCurrentUser;
	imageInteraction?: {
		onFocus?: FocusEventHandler<HTMLImageElement>;
		onKeyDown?: KeyboardEventHandler<HTMLImageElement>;
		tabIndex?: number;
		timelineMessageId?: string;
	};
	mentionInteraction?: MarkdownMentionInteraction;
}): Components => ({
	a: ({ children, ...props }) => (
		<a className={styles.link} {...props}>
			{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}
		</a>
	),
	blockquote: ({ children, ...props }) => (
		<blockquote {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</blockquote>
	),
	code: CodeBlock,
	em: ({ children, ...props }) => <em {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</em>,
	h1: ({ children, ...props }) => <h1 {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</h1>,
	h2: ({ children, ...props }) => <h2 {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</h2>,
	h3: ({ children, ...props }) => <h3 {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</h3>,
	h4: ({ children, ...props }) => <h4 {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</h4>,
	h5: ({ children, ...props }) => <h5 {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</h5>,
	h6: ({ children, ...props }) => <h6 {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</h6>,
	img: ({ alt, src = '', title }) => (
		<GalleryImage
			alt={alt}
			className={styles.image}
			onFocus={imageInteraction?.onFocus}
			onKeyDown={imageInteraction?.onKeyDown}
			src={src}
			tabIndex={imageInteraction?.tabIndex}
			title={title}
			timelineMessageId={imageInteraction?.timelineMessageId}
		/>
	),
	li: ({ children, ...props }) => <li {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</li>,
	ol: ({ children, ...props }) => <ol {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</ol>,
	p: ({ children, ...props }) => <p {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</p>,
	pre: ({ children }) => <>{children}</>,
	strong: ({ children, ...props }) => (
		<strong {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</strong>
	),
	table: ({ children, ...props }) => (
		<div className={styles.tableWrap}>
			<table {...props}>{children}</table>
		</div>
	),
	td: ({ children, ...props }) => <td {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</td>,
	th: ({ children, ...props }) => <th {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</th>,
	ul: ({ children, ...props }) => <ul {...props}>{decorateInlineMentions({ currentUser, mentionInteraction, node: children })}</ul>,
});

type MarkdownContentProps = {
	currentUser?: MarkdownCurrentUser;
	imageInteraction?: {
		onFocus?: FocusEventHandler<HTMLImageElement>;
		onKeyDown?: KeyboardEventHandler<HTMLImageElement>;
		tabIndex?: number;
		timelineMessageId?: string;
	};
	mentionInteraction?: MarkdownMentionInteraction;
	source: string;
	dense?: boolean;
};

const MarkdownContentComponent = ({
	currentUser = null,
	imageInteraction,
	mentionInteraction,
	source,
	dense = false,
}: MarkdownContentProps) => {
	const normalizedSource = useMemo(() => normalizeStandaloneDisplayMath(source), [source]);
	const markdownComponents = useMemo(
		() =>
			createMarkdownComponents({
				currentUser,
				imageInteraction,
				mentionInteraction,
			}),
		[currentUser, imageInteraction, mentionInteraction],
	);

	return (
		<div className={`${styles.markdown} ${dense ? styles.dense : ''}`.trim()}>
			<ReactMarkdown
				components={markdownComponents}
				rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true }]]}
				remarkPlugins={[remarkGfm, remarkMath, remarkPanguSpacing]}
			>
				{normalizedSource}
			</ReactMarkdown>
		</div>
	);
};

export const areMarkdownContentPropsEqual = (previousProps: MarkdownContentProps, nextProps: MarkdownContentProps) =>
	previousProps.source === nextProps.source &&
	previousProps.dense === nextProps.dense &&
	(previousProps.currentUser?.id ?? null) === (nextProps.currentUser?.id ?? null) &&
	(previousProps.currentUser?.displayName ?? null) === (nextProps.currentUser?.displayName ?? null) &&
	(previousProps.currentUser?.username ?? null) === (nextProps.currentUser?.username ?? null) &&
	previousProps.imageInteraction?.onFocus === nextProps.imageInteraction?.onFocus &&
	previousProps.imageInteraction?.onKeyDown === nextProps.imageInteraction?.onKeyDown &&
	(previousProps.imageInteraction?.tabIndex ?? null) === (nextProps.imageInteraction?.tabIndex ?? null) &&
	(previousProps.imageInteraction?.timelineMessageId ?? null) === (nextProps.imageInteraction?.timelineMessageId ?? null) &&
	previousProps.mentionInteraction?.onFocus === nextProps.mentionInteraction?.onFocus &&
	previousProps.mentionInteraction?.onKeyDown === nextProps.mentionInteraction?.onKeyDown &&
	previousProps.mentionInteraction?.onOpen === nextProps.mentionInteraction?.onOpen &&
	previousProps.mentionInteraction?.onPrepare === nextProps.mentionInteraction?.onPrepare &&
	(previousProps.mentionInteraction?.tabIndex ?? null) === (nextProps.mentionInteraction?.tabIndex ?? null) &&
	(previousProps.mentionInteraction?.timelineMessageId ?? null) === (nextProps.mentionInteraction?.timelineMessageId ?? null) &&
	(previousProps.mentionInteraction?.focusKeyPrefix ?? null) === (nextProps.mentionInteraction?.focusKeyPrefix ?? null) &&
	buildMentionInteractionUserSignature(previousProps.mentionInteraction?.users) ===
		buildMentionInteractionUserSignature(nextProps.mentionInteraction?.users);

export const MarkdownContent = memo(MarkdownContentComponent, areMarkdownContentPropsEqual);
