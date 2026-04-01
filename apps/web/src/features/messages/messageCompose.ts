import type { TimelineAttachment, TimelineMessage, TimelineReplyPreview } from '@/lib/chatModels';

import { estimateMessageMayNeedCollapse } from '@/features/timeline/messageCollapsing';

const forwardTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
	hour: '2-digit',
	minute: '2-digit',
});

const FORWARD_HEADER_PREFIX = '> **转发自 ';
const FORWARD_HEADER_SUFFIX = '**';
const FORWARD_META_SEPARATOR = ' · ';
const MAX_REPLY_EXCERPT_LENGTH = 120;

export type ParsedForwardedMessage = {
	authorName: string;
	bodyMarkdown: string;
	leadMarkdown: string | null;
	roomTitle: string;
	timeLabel: string;
};

const isImageAttachment = (attachment: TimelineAttachment): attachment is Extract<TimelineAttachment, { kind: 'image' }> =>
	attachment.kind === 'image';

const normalizeWhitespace = (value: string) => value.replace(/\s+/gu, ' ').trim();

export const stripMarkdownToPlainText = (source: string) =>
	normalizeWhitespace(
		source
			.replace(/```[\s\S]*?```/gu, (block) => block.replace(/```/gu, '').replace(/^[a-z0-9_-]+\n/iu, ''))
			.replace(/`([^`]+)`/gu, '$1')
			.replace(/!\[([^\]]*)\]\([^)]+\)/gu, '$1')
			.replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
			.replace(/^>\s?/gmu, '')
			.replace(/^#{1,6}\s+/gmu, '')
			.replace(/^[-*+]\s+/gmu, '')
			.replace(/^\d+\.\s+/gmu, '')
			.replace(/[*_~]/gu, ''),
	);

export const createMessageExcerpt = (message: TimelineMessage) => {
	const contentSource = [message.body.rawMarkdown, collectForwardableAttachmentMarkdown(message.attachments)].filter(Boolean).join('\n\n');
	const normalized = stripMarkdownToPlainText(contentSource);

	if (!normalized) {
		return '图片消息';
	}

	if (normalized.length <= MAX_REPLY_EXCERPT_LENGTH) {
		return normalized;
	}

	return `${normalized.slice(0, MAX_REPLY_EXCERPT_LENGTH - 1).trimEnd()}…`;
};

export const createReplyPreviewFromMessage = (message: TimelineMessage): TimelineReplyPreview => ({
	messageId: message.id,
	authorName: message.author.displayName,
	excerpt: createMessageExcerpt(message),
	long: estimateMessageMayNeedCollapse(message),
});

const formatForwardTimeLabel = (isoTimestamp: string) => forwardTimeFormatter.format(new Date(isoTimestamp));

const quoteMarkdownLines = (source: string) =>
	source
		.split('\n')
		.map((line) => (line.length > 0 ? `> ${line}` : '>'))
		.join('\n');

const collectForwardableAttachmentMarkdown = (attachments: TimelineMessage['attachments']) =>
	(attachments ?? [])
		.filter(isImageAttachment)
		.map((attachment) => `![${attachment.title ?? '图片'}](${attachment.source.url})`)
		.join('\n\n');

export const composeForwardSourceMarkdown = (message: TimelineMessage) =>
	[message.body.rawMarkdown.trim(), collectForwardableAttachmentMarkdown(message.attachments)].filter(Boolean).join('\n\n').trim();

export const buildForwardedMessageMarkdown = ({
	leadText,
	message,
	roomTitle,
}: {
	leadText?: string;
	message: TimelineMessage;
	roomTitle: string;
}) => {
	const normalizedLeadText = leadText?.trim() ?? '';
	const forwardedBody = composeForwardSourceMarkdown(message);
	const bodyMarkdown = forwardedBody || '（原消息为空）';
	const header = `${FORWARD_HEADER_PREFIX}${message.author.displayName}${FORWARD_META_SEPARATOR}${roomTitle}${FORWARD_META_SEPARATOR}${formatForwardTimeLabel(message.createdAt)}${FORWARD_HEADER_SUFFIX}`;
	const forwardedBlock = [header, '>', quoteMarkdownLines(bodyMarkdown)].join('\n');

	return [normalizedLeadText, forwardedBlock].filter(Boolean).join('\n\n');
};

export const parseForwardedMessageMarkdown = (source: string): ParsedForwardedMessage | null => {
	const lines = source.split('\n');
	const headerIndex = lines.findIndex((line) => line.startsWith(FORWARD_HEADER_PREFIX) && line.endsWith(FORWARD_HEADER_SUFFIX));
	if (headerIndex < 0) {
		return null;
	}

	const forwardedLines = lines.slice(headerIndex);
	if (forwardedLines.some((line) => line.length > 0 && !line.startsWith('>'))) {
		return null;
	}

	const headerLine = forwardedLines[0];
	if (!headerLine || !headerLine.endsWith(FORWARD_HEADER_SUFFIX)) {
		return null;
	}

	const rawMeta = headerLine.slice(FORWARD_HEADER_PREFIX.length, -FORWARD_HEADER_SUFFIX.length);
	const metaParts = rawMeta.split(FORWARD_META_SEPARATOR);
	if (metaParts.length < 3) {
		return null;
	}

	const timeLabel = metaParts.pop();
	const roomTitle = metaParts.pop();
	const authorName = metaParts.join(FORWARD_META_SEPARATOR);
	if (!authorName || !roomTitle || !timeLabel) {
		return null;
	}

	const bodyLines = forwardedLines
		.slice(1)
		.map((line) => line.replace(/^> ?/u, ''))
		.slice();
	while (bodyLines.length > 0 && bodyLines[0]?.trim() === '') {
		bodyLines.shift();
	}

	const bodyMarkdown = bodyLines.join('\n').trim();
	if (!bodyMarkdown) {
		return null;
	}

	const leadMarkdown = lines.slice(0, headerIndex).join('\n').trim();
	return {
		authorName,
		bodyMarkdown,
		leadMarkdown: leadMarkdown || null,
		roomTitle,
		timeLabel,
	};
};
