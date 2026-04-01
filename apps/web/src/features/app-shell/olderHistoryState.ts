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

const resolveReadyCursor = (nextCursor?: string) => (nextCursor && nextCursor.length > 0 ? nextCursor : null);

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
