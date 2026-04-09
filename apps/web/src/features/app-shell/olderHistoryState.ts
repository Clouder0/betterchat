import type { RoomTimelineSnapshot, TimelineMessage } from '@/lib/chatModels';
import { mergeTimelineMessages } from '@/features/timeline/timelineContext';

export type OlderHistoryState = {
	messages: TimelineMessage[];
	pagination:
		| {
				kind: 'ready';
				nextCursor: string;
		  }
		| {
				kind: 'exhausted';
	};
};

const messageIdsEqual = (left: readonly TimelineMessage[], right: readonly TimelineMessage[]) =>
	left.length === right.length && left.every((message, index) => message.id === right[index]?.id);

const resolveReadyCursor = (nextCursor?: string) => (nextCursor && nextCursor.length > 0 ? nextCursor : null);

export const findDroppedTimelineHead = ({
	nextBaseMessages,
	previousLoadedMessages,
}: {
	nextBaseMessages: readonly TimelineMessage[];
	previousLoadedMessages: readonly TimelineMessage[];
}) => {
	if (
		previousLoadedMessages.length === 0 ||
		nextBaseMessages.length === 0 ||
		nextBaseMessages.length >= previousLoadedMessages.length
	) {
		return [] as TimelineMessage[];
	}

	const firstNextMessageId = nextBaseMessages[0]?.id;
	if (!firstNextMessageId) {
		return [] as TimelineMessage[];
	}

	const preservedHeadLength = previousLoadedMessages.findIndex((message) => message.id === firstNextMessageId);
	if (preservedHeadLength <= 0) {
		return [] as TimelineMessage[];
	}

	const previousTail = previousLoadedMessages.slice(preservedHeadLength);
	if (!messageIdsEqual(previousTail, nextBaseMessages)) {
		return [] as TimelineMessage[];
	}

	return previousLoadedMessages.slice(0, preservedHeadLength);
};

const olderHistoryPaginationFrom = ({
	current,
	previousNextCursor,
}: {
	current?: OlderHistoryState;
	previousNextCursor?: string;
}): OlderHistoryState['pagination'] =>
	current?.pagination ??
	(resolveReadyCursor(previousNextCursor)
		? {
				kind: 'ready',
				nextCursor: previousNextCursor as string,
		  }
		: {
				kind: 'exhausted',
		  });

export const resolveRetainedOlderHistory = ({
	current,
	nextBaseMessages,
	previousLoadedMessages,
	previousNextCursor,
}: {
	current?: OlderHistoryState;
	nextBaseMessages: readonly TimelineMessage[];
	previousLoadedMessages: readonly TimelineMessage[];
	previousNextCursor?: string;
}) => {
	const retainedHead = findDroppedTimelineHead({
		nextBaseMessages,
		previousLoadedMessages,
	});
	if (retainedHead.length === 0) {
		return current;
	}

	const mergedMessages = mergeTimelineMessages(current?.messages ?? [], retainedHead);
	return {
		messages: mergedMessages,
		pagination: olderHistoryPaginationFrom({
			current,
			previousNextCursor,
		}),
	} satisfies OlderHistoryState;
};

export const olderHistoryStatesEqual = (left?: OlderHistoryState, right?: OlderHistoryState) => {
	if (left === right) {
		return true;
	}

	if (!left || !right) {
		return false;
	}

	if (!messageIdsEqual(left.messages, right.messages)) {
		return false;
	}

	if (left.pagination.kind !== right.pagination.kind) {
		return false;
	}

	if (left.pagination.kind === 'exhausted' || right.pagination.kind === 'exhausted') {
		return left.pagination.kind === right.pagination.kind;
	}

	return left.pagination.nextCursor === right.pagination.nextCursor;
};

export const resolveOlderHistoryLoadCursor = ({
	baseNextCursor,
	olderHistory,
}: {
	baseNextCursor?: string;
	olderHistory?: OlderHistoryState;
}) => {
	if (!olderHistory) {
		return resolveReadyCursor(baseNextCursor);
	}

	return olderHistory.pagination.kind === 'ready' ? olderHistory.pagination.nextCursor : null;
};

export const resolveOlderHistoryNextCursor = ({
	baseNextCursor,
	olderHistory,
}: {
	baseNextCursor?: string;
	olderHistory?: OlderHistoryState;
}) => resolveOlderHistoryLoadCursor({ baseNextCursor, olderHistory }) ?? undefined;

export const hasOlderHistory = ({
	baseNextCursor,
	olderHistory,
}: {
	baseNextCursor?: string;
	olderHistory?: OlderHistoryState;
}) => resolveOlderHistoryLoadCursor({ baseNextCursor, olderHistory }) !== null;

export const mergeOlderHistoryPage = ({
	current,
	page,
}: {
	current?: OlderHistoryState;
	page: Pick<RoomTimelineSnapshot, 'messages' | 'nextCursor'>;
}) => {
	const existingMessages = current?.messages ?? [];
	const mergedMessages = mergeTimelineMessages(existingMessages, page.messages);

	return {
		loadedNewMessages: mergedMessages.length > existingMessages.length,
		state: {
			messages: mergedMessages,
			pagination: resolveReadyCursor(page.nextCursor)
				? {
						kind: 'ready',
						nextCursor: page.nextCursor as string,
				  }
				: {
						kind: 'exhausted',
				  },
		} as OlderHistoryState,
	};
};
