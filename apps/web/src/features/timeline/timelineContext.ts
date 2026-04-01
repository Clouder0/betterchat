import type { MessageContextSnapshot, RoomTimelineSnapshot, TimelineMessage } from '@/lib/chatModels';

const resolveMessageTimestamp = (message: TimelineMessage, fallbackOrder: number) => {
	const timestamp = Date.parse(message.createdAt);
	return Number.isFinite(timestamp) ? timestamp : fallbackOrder;
};

const mergeTimelineMessagesInternal = (
	currentMessages: readonly TimelineMessage[],
	incomingMessages: readonly TimelineMessage[],
	prefer: 'current' | 'incoming',
): TimelineMessage[] => {
	const mergedById = new Map<string, TimelineMessage>();
	const originalOrder = new Map<string, number>();

	for (const [index, message] of currentMessages.entries()) {
		mergedById.set(message.id, message);
		originalOrder.set(message.id, index);
	}

	for (const [index, message] of incomingMessages.entries()) {
		if (!mergedById.has(message.id)) {
			originalOrder.set(message.id, currentMessages.length + index);
		}

		mergedById.set(message.id, prefer === 'incoming' ? message : (mergedById.get(message.id) ?? message));
	}

	return [...mergedById.values()].sort((left, right) => {
		const timestampDelta =
			resolveMessageTimestamp(left, originalOrder.get(left.id) ?? 0) -
			resolveMessageTimestamp(right, originalOrder.get(right.id) ?? 0);
		if (timestampDelta !== 0) {
			return timestampDelta;
		}

		return (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
	});
};

export const mergeTimelineMessagesPreferCurrent = (
	currentMessages: readonly TimelineMessage[],
	incomingMessages: readonly TimelineMessage[],
) => mergeTimelineMessagesInternal(currentMessages, incomingMessages, 'current');

export const mergeTimelineMessagesPreferIncoming = (
	currentMessages: readonly TimelineMessage[],
	incomingMessages: readonly TimelineMessage[],
) => mergeTimelineMessagesInternal(currentMessages, incomingMessages, 'incoming');

export const mergeTimelineMessages = mergeTimelineMessagesPreferCurrent;

export const mergeMessageContextIntoTimeline = (
	currentTimeline: RoomTimelineSnapshot,
	context: MessageContextSnapshot,
): RoomTimelineSnapshot => ({
	...currentTimeline,
	messages: mergeTimelineMessagesPreferCurrent(currentTimeline.messages, context.messages),
});
