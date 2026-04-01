import type { TimelineMessage } from '@/lib/chatModels';

export const MESSAGE_COLLAPSE_MAX_HEIGHT_PX = 208;
const MESSAGE_COLLAPSE_HEIGHT_EPSILON_PX = 12;
const ESTIMATED_RENDER_LINE_HEIGHT_PX = 28;
const ESTIMATED_RENDER_BLOCK_GAP_PX = 12;
const ESTIMATED_RENDER_WRAP_UNITS_PER_LINE = 34;

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\([^)]+\)/;
const BLOCKQUOTE_LINE_PATTERN = /^\s*>\s+/u;
const TABLE_ROW_PATTERN = /^\s*\|.+\|\s*$/u;
const OPTIMISTIC_MESSAGE_ID_TOKEN = '-optimistic-';
const LEADING_BLOCKQUOTE_PATTERN = /^(\s*>\s*)+/u;
const LEADING_LIST_MARKER_PATTERN = /^\s*(?:[-+*]|\d+[.)])\s+/u;
const LEADING_TASK_MARKER_PATTERN = /^\s*\[[ xX]\]\s+/u;
const MARKDOWN_IMAGE_INLINE_PATTERN = /!\[[^\]]*\]\([^)]+\)/gu;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\([^)]+\)/gu;
const MARKDOWN_DECORATION_PATTERN = /[`*_~#]/gu;
const LATIN_ALPHA_NUMERIC_PATTERN = /[\p{Script=Latin}\p{N}]/u;
const WHITESPACE_PATTERN = /\s/u;
const NARROW_PUNCTUATION_PATTERN = /[.,!?;:'"()[\]{}<>/\\|+=\-]/u;

const estimateLongestLineLength = (source: string) =>
	source.split('\n').reduce((maxLength, line) => Math.max(maxLength, line.length), 0);

const normalizeMeasuredTextLine = (line: string) =>
	line
		.replace(LEADING_BLOCKQUOTE_PATTERN, '')
		.replace(LEADING_LIST_MARKER_PATTERN, '')
		.replace(LEADING_TASK_MARKER_PATTERN, '')
		.replace(MARKDOWN_IMAGE_INLINE_PATTERN, ' 图 ')
		.replace(MARKDOWN_LINK_PATTERN, '$1')
		.replace(MARKDOWN_DECORATION_PATTERN, '');

const estimateCharacterWrapUnits = (character: string) => {
	if (WHITESPACE_PATTERN.test(character)) {
		return 0.34;
	}

	if (LATIN_ALPHA_NUMERIC_PATTERN.test(character)) {
		return 0.56;
	}

	if (NARROW_PUNCTUATION_PATTERN.test(character)) {
		return 0.42;
	}

	return 1;
};

const estimateWrappedLineCount = (line: string) => {
	const normalizedLine = normalizeMeasuredTextLine(line).trim();
	if (!normalizedLine) {
		return 0;
	}

	const wrapUnits = Array.from(normalizedLine).reduce((total, character) => total + estimateCharacterWrapUnits(character), 0);
	return Math.max(1, Math.ceil(wrapUnits / ESTIMATED_RENDER_WRAP_UNITS_PER_LINE));
};

const estimateRenderedMessageHeight = (source: string) => {
	let activeFence: '```' | '~~~' | null = null;
	let renderedLineCount = 0;
	let blockBreakCount = 0;
	let previousLineBlank = true;

	for (const rawLine of source.split('\n')) {
		const line = rawLine.trimEnd();
		const fenceMatch = line.match(/^(\s*)(```|~~~)/u);
		if (fenceMatch) {
			const fence = fenceMatch[2] as '```' | '~~~';
			if (renderedLineCount > 0 && previousLineBlank) {
				blockBreakCount += 1;
			}
			previousLineBlank = false;
			renderedLineCount += 1;
			activeFence = activeFence === fence ? null : activeFence ?? fence;
			continue;
		}

		if (!line.trim()) {
			previousLineBlank = true;
			continue;
		}

		if (renderedLineCount > 0 && previousLineBlank) {
			blockBreakCount += 1;
		}

		previousLineBlank = false;

		if (activeFence) {
			renderedLineCount += Math.max(1, Math.ceil(line.length / 32));
			continue;
		}

		renderedLineCount += estimateWrappedLineCount(line);
	}

	return renderedLineCount * ESTIMATED_RENDER_LINE_HEIGHT_PX + blockBreakCount * ESTIMATED_RENDER_BLOCK_GAP_PX;
};

const analyzeFencedCodeBlocks = (source: string) => {
	let activeFence: '```' | '~~~' | null = null;
	let currentBlockLineCount = 0;
	let maxBlockLineCount = 0;
	let blockCount = 0;

	for (const line of source.split('\n')) {
		const fenceMatch = line.match(/^(\s*)(```|~~~)/u);
		if (fenceMatch) {
			const fence = fenceMatch[2] as '```' | '~~~';
			if (activeFence === fence) {
				activeFence = null;
				maxBlockLineCount = Math.max(maxBlockLineCount, currentBlockLineCount);
				currentBlockLineCount = 0;
				continue;
			}

			if (!activeFence) {
				activeFence = fence;
				blockCount += 1;
				currentBlockLineCount = 0;
			}

			continue;
		}

		if (activeFence) {
			currentBlockLineCount += 1;
		}
	}

	if (activeFence) {
		maxBlockLineCount = Math.max(maxBlockLineCount, currentBlockLineCount);
	}

	return {
		blockCount,
		maxBlockLineCount,
	};
};

export const messageHasVisualMedia = (message: TimelineMessage) =>
	MARKDOWN_IMAGE_PATTERN.test(message.body.rawMarkdown) || Boolean(message.attachments?.some((attachment) => attachment.kind === 'image'));

export const estimateMessageMayNeedCollapse = (message: TimelineMessage) => {
	const source = message.body.rawMarkdown;
	const lineCount = source.split('\n').length;
	const longestLineLength = estimateLongestLineLength(source);
	const blockquoteLineCount = source.split('\n').filter((line) => BLOCKQUOTE_LINE_PATTERN.test(line)).length;
	const tableRowCount = source.split('\n').filter((line) => TABLE_ROW_PATTERN.test(line)).length;
	const displayMathBlockCount = (source.match(/\$\$/gu) ?? []).length / 2;
	const { blockCount: fencedCodeBlockCount, maxBlockLineCount } = analyzeFencedCodeBlocks(source);

	if (messageHasVisualMedia(message)) {
		return true;
	}

	if (source.length > 260 || lineCount > 10 || longestLineLength > 180) {
		return true;
	}

	if (fencedCodeBlockCount > 0 && (maxBlockLineCount >= 4 || source.length > 160 || lineCount >= 8)) {
		return true;
	}

	if (displayMathBlockCount > 0 && lineCount >= 6) {
		return true;
	}

	if (estimateRenderedMessageHeight(source) > MESSAGE_COLLAPSE_MAX_HEIGHT_PX) {
		return true;
	}

	if (blockquoteLineCount >= 5 || tableRowCount >= 4) {
		return true;
	}

	return false;
};

export const resolveMeasuredMessageCollapsible = (height: number | undefined, message: TimelineMessage) => {
	if (messageHasVisualMedia(message)) {
		return true;
	}

	if (typeof height === 'number' && Number.isFinite(height)) {
		return height > MESSAGE_COLLAPSE_MAX_HEIGHT_PX + MESSAGE_COLLAPSE_HEIGHT_EPSILON_PX;
	}

	return estimateMessageMayNeedCollapse(message);
};

export const resolveMessageExpandedState = ({
	appendedExpandedByDefault,
	collapsible,
	persistedExpanded,
}: {
	appendedExpandedByDefault?: boolean;
	collapsible: boolean;
	persistedExpanded?: boolean;
}) => {
	if (!collapsible) {
		return true;
	}

	return persistedExpanded ?? appendedExpandedByDefault ?? false;
};

export const resolveNextMessageExpansionOverride = ({
	appendedExpandedByDefault,
	collapsible,
	currentExpanded,
}: {
	appendedExpandedByDefault?: boolean;
	collapsible: boolean;
	currentExpanded: boolean;
}) => {
	if (!collapsible) {
		return undefined;
	}

	const nextExpanded = !currentExpanded;
	const defaultExpanded = resolveMessageExpandedState({
		appendedExpandedByDefault,
		collapsible,
	});

	return nextExpanded === defaultExpanded ? undefined : nextExpanded;
};

export const resolveNextAppendedMessageExpansionDefaults = ({
	appendedMessageIds,
	currentDefaults,
	currentMessageIds,
	expandByDefault,
}: {
	appendedMessageIds: Iterable<string>;
	currentDefaults: Record<string, boolean>;
	currentMessageIds: string[];
	expandByDefault: boolean;
}) => {
	const currentMessageIdSet = new Set(currentMessageIds);
	const nextDefaults = Object.fromEntries(
		Object.entries(currentDefaults).filter(([messageId]) => currentMessageIdSet.has(messageId)),
	) as Record<string, boolean>;

	for (const messageId of appendedMessageIds) {
		if (nextDefaults[messageId] !== undefined) {
			continue;
		}

		nextDefaults[messageId] = expandByDefault;
	}

	return nextDefaults;
};

export type MessageIdTransfer = {
	fromId: string;
	toId: string;
};

export const resolveTransferredAppendedMessageIds = ({
	appendedMessageIds,
	messageIdTransfers,
	preserveTransferredIds,
}: {
	appendedMessageIds: Iterable<string>;
	messageIdTransfers: MessageIdTransfer[];
	preserveTransferredIds: boolean;
}) => {
	if (!preserveTransferredIds || messageIdTransfers.length === 0) {
		return appendedMessageIds instanceof Set ? appendedMessageIds : new Set(appendedMessageIds);
	}

	const nextAppendedMessageIds = appendedMessageIds instanceof Set ? new Set(appendedMessageIds) : new Set(appendedMessageIds);
	for (const transfer of messageIdTransfers) {
		nextAppendedMessageIds.add(transfer.toId);
	}

	return nextAppendedMessageIds;
};

const attachmentsMatchForTransfer = (leftMessage: TimelineMessage, rightMessage: TimelineMessage) => {
	const leftAttachments = leftMessage.attachments ?? [];
	const rightAttachments = rightMessage.attachments ?? [];
	const allowOptimisticImageUrlMismatch =
		leftMessage.id.includes(OPTIMISTIC_MESSAGE_ID_TOKEN) || rightMessage.id.includes(OPTIMISTIC_MESSAGE_ID_TOKEN);

	if (leftAttachments.length !== rightAttachments.length) {
		return false;
	}

	return leftAttachments.every((attachment, index) => {
		const rightAttachment = rightAttachments[index];
		if (!rightAttachment || attachment.kind !== rightAttachment.kind) {
			return false;
		}

		if (attachment.kind === 'image' && rightAttachment.kind === 'image') {
			if (attachment.title !== rightAttachment.title) {
				return false;
			}

			if (allowOptimisticImageUrlMismatch) {
				return true;
			}

			return (
				attachment.preview.url === rightAttachment.preview.url &&
				attachment.source.url === rightAttachment.source.url
			);
		}

		return true;
	});
};

const authorsMatchForTransfer = (leftMessage: TimelineMessage, rightMessage: TimelineMessage) => {
	if (leftMessage.author.id === rightMessage.author.id) {
		return true;
	}

	if (leftMessage.author.username && rightMessage.author.username && leftMessage.author.username === rightMessage.author.username) {
		return true;
	}

	return leftMessage.author.displayName === rightMessage.author.displayName;
};

const messagesMatchForStateTransfer = (leftMessage: TimelineMessage, rightMessage: TimelineMessage) =>
	leftMessage.roomId === rightMessage.roomId &&
	authorsMatchForTransfer(leftMessage, rightMessage) &&
	leftMessage.body.rawMarkdown === rightMessage.body.rawMarkdown &&
	(leftMessage.replyTo?.messageId ?? null) === (rightMessage.replyTo?.messageId ?? null) &&
	attachmentsMatchForTransfer(leftMessage, rightMessage);

export const findMessageIdTransfers = (previousMessages: TimelineMessage[], nextMessages: TimelineMessage[]): MessageIdTransfer[] => {
	if (previousMessages.length !== nextMessages.length) {
		return [];
	}

	const previousIds = new Set(previousMessages.map((message) => message.id));
	const nextIds = new Set(nextMessages.map((message) => message.id));

	return previousMessages.flatMap((previousMessage, index) => {
		const nextMessage = nextMessages[index];
		if (!nextMessage || previousMessage.id === nextMessage.id) {
			return [];
		}

		if (previousIds.has(nextMessage.id) || nextIds.has(previousMessage.id)) {
			return [];
		}

		return messagesMatchForStateTransfer(previousMessage, nextMessage)
			? [
					{
						fromId: previousMessage.id,
						toId: nextMessage.id,
					} as const,
			  ]
			: [];
	});
};

export const transferMessageStateById = <T,>(state: Record<string, T>, transfers: MessageIdTransfer[]) => {
	if (transfers.length === 0) {
		return state;
	}

	const nextState = { ...state };
	let changed = false;

	for (const transfer of transfers) {
		if (!(transfer.fromId in nextState) || transfer.toId in nextState) {
			continue;
		}

		nextState[transfer.toId] = nextState[transfer.fromId] as T;
		delete nextState[transfer.fromId];
		changed = true;
	}

	return changed ? nextState : state;
};

export const findAppendedMessageIds = (previousMessageIds: string[], nextMessageIds: string[]) => {
	const previousAnchorMessageId =
		[...previousMessageIds].reverse().find((messageId) => !messageId.includes(OPTIMISTIC_MESSAGE_ID_TOKEN)) ?? previousMessageIds.at(-1);
	if (!previousAnchorMessageId) {
		return new Set(nextMessageIds);
	}

	const previousLastMessageIndex = nextMessageIds.lastIndexOf(previousAnchorMessageId);
	if (previousLastMessageIndex < 0) {
		return new Set<string>();
	}

	const previousMessageIdSet = new Set(previousMessageIds);
	return new Set(nextMessageIds.slice(previousLastMessageIndex + 1).filter((messageId) => !previousMessageIdSet.has(messageId)));
};
