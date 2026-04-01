import type { ParsedForwardedMessage } from '@/features/messages/messageCompose';
import type { TimelineAttachment } from '@/lib/chatModels';

export type TimelineMessageLayout = {
	leadingSurface: boolean;
	surfaceOnly: boolean;
};

const FENCE_PATTERN = /^(\s*)(```|~~~)(.*)$/u;
const FENCE_CLOSE_PATTERN = /^(\s*)(```|~~~)\s*$/u;
const STANDALONE_IMAGE_PATTERN = /^!\[[^\]]*\]\([^)]+\)\s*$/u;
const TABLE_ALIGNMENT_PATTERN = /^\s*\|?[\-:\s|]+\|?\s*$/u;
const TABLE_ROW_PATTERN = /^\s*\|.+\|\s*$/u;
const DISPLAY_MATH_PATTERN = /^\s*\$\$\s*$/u;

const trimBlankLineEdges = (lines: string[]) => {
	let start = 0;
	let end = lines.length;

	while (start < end && lines[start]?.trim() === '') {
		start += 1;
	}

	while (end > start && lines[end - 1]?.trim() === '') {
		end -= 1;
	}

	return lines.slice(start, end).map((line) => line.trimEnd());
};

const normalizeMarkdownLines = (source: string) => trimBlankLineEdges(source.split('\n'));

const isOnlySingleFencedBlock = (lines: string[]) => {
	const openingMatch = lines[0]?.match(FENCE_PATTERN);
	if (!openingMatch) {
		return false;
	}

	const openingFence = openingMatch[2];
	for (let index = 1; index < lines.length; index += 1) {
		const line = lines[index];
		const closingMatch = line?.match(FENCE_CLOSE_PATTERN);
		if (!closingMatch || closingMatch[2] !== openingFence) {
			continue;
		}

		return index === lines.length - 1;
	}

	return false;
};

const isOnlyDisplayMathBlock = (lines: string[]) => {
	if (!DISPLAY_MATH_PATTERN.test(lines[0] ?? '')) {
		return false;
	}

	for (let index = 1; index < lines.length; index += 1) {
		if (!DISPLAY_MATH_PATTERN.test(lines[index] ?? '')) {
			continue;
		}

		return index === lines.length - 1;
	}

	return false;
};

const isOnlyMarkdownTable = (lines: string[]) => {
	if (lines.length < 2 || !TABLE_ROW_PATTERN.test(lines[0] ?? '') || !TABLE_ALIGNMENT_PATTERN.test(lines[1] ?? '')) {
		return false;
	}

	return lines.slice(2).every((line) => TABLE_ROW_PATTERN.test(line));
};

const resolveMarkdownSurfaceLayout = (source: string): TimelineMessageLayout => {
	const lines = normalizeMarkdownLines(source);
	if (lines.length === 0) {
		return {
			leadingSurface: false,
			surfaceOnly: false,
		};
	}

	const firstLine = lines[0] ?? '';
	if (FENCE_PATTERN.test(firstLine)) {
		return {
			leadingSurface: true,
			surfaceOnly: isOnlySingleFencedBlock(lines),
		};
	}

	if (STANDALONE_IMAGE_PATTERN.test(firstLine)) {
		return {
			leadingSurface: true,
			surfaceOnly: lines.length === 1,
		};
	}

	if (TABLE_ROW_PATTERN.test(firstLine)) {
		return {
			leadingSurface: true,
			surfaceOnly: isOnlyMarkdownTable(lines),
		};
	}

	if (DISPLAY_MATH_PATTERN.test(firstLine)) {
		return {
			leadingSurface: true,
			surfaceOnly: isOnlyDisplayMathBlock(lines),
		};
	}

	return {
		leadingSurface: false,
		surfaceOnly: false,
	};
};

const hasLeadingSurfaceAttachments = (attachments: TimelineAttachment[] | undefined) =>
	Boolean(attachments?.some((attachment) => attachment.kind === 'image'));

export const resolveTimelineMessageLayout = ({
	attachments,
	forwardedMessage,
	rawMarkdown,
}: {
	attachments?: TimelineAttachment[];
	forwardedMessage: ParsedForwardedMessage | null;
	rawMarkdown: string;
}): TimelineMessageLayout => {
	if (forwardedMessage) {
		if (!forwardedMessage.leadMarkdown) {
			return {
				leadingSurface: true,
				surfaceOnly: true,
			};
		}

		return {
			...resolveMarkdownSurfaceLayout(forwardedMessage.leadMarkdown),
			surfaceOnly: false,
		};
	}

	const markdownLayout = resolveMarkdownSurfaceLayout(rawMarkdown);
	const leadingSurfaceAttachments = hasLeadingSurfaceAttachments(attachments);
	if (markdownLayout.leadingSurface) {
		return {
			leadingSurface: true,
			surfaceOnly: markdownLayout.surfaceOnly && !leadingSurfaceAttachments,
		};
	}

	if (rawMarkdown.trim().length === 0 && leadingSurfaceAttachments) {
		return {
			leadingSurface: true,
			surfaceOnly: true,
		};
	}

	return {
		leadingSurface: false,
		surfaceOnly: false,
	};
};
