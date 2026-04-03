import type { TimelineMessage } from '@/lib/chatModels';

type MessageDeliveryState = 'sending' | 'failed';

export type SubmissionReconciliationLocalMessage = {
	errorMessage?: string;
	message: TimelineMessage;
	status: MessageDeliveryState;
};

export type SubmissionReconciliationResult = {
	failedMessageActions: Record<string, { errorMessage?: string }>;
	localOutgoingMessageIds: Set<string>;
	messageDeliveryStates: Record<string, MessageDeliveryState>;
	messages: TimelineMessage[];
};

const messageIdentityKeys = (message: Pick<TimelineMessage, 'id' | 'submissionId'>): string[] => {
	const identities = new Set<string>();
	identities.add(message.id);
	if (message.submissionId) {
		identities.add(message.submissionId);
	}
	return [...identities];
};

export const timelineMessagesShareIdentity = (
	left: Pick<TimelineMessage, 'id' | 'submissionId'>,
	right: Pick<TimelineMessage, 'id' | 'submissionId'>,
): boolean => {
	const rightIdentities = new Set(messageIdentityKeys(right));
	return messageIdentityKeys(left).some((identity) => rightIdentities.has(identity));
};

const mergeCanonicalMessageWithLocalSubmission = (
	canonicalMessage: TimelineMessage,
	localMessage: TimelineMessage,
): TimelineMessage => {
	const submissionId = canonicalMessage.submissionId ?? localMessage.submissionId;

	return {
		...canonicalMessage,
		...(submissionId ? { submissionId } : {}),
		updatedAt: canonicalMessage.updatedAt ?? localMessage.updatedAt,
		replyTo: canonicalMessage.replyTo ?? localMessage.replyTo,
		thread: canonicalMessage.thread ?? localMessage.thread,
		attachments: canonicalMessage.attachments ?? localMessage.attachments,
		reactions: canonicalMessage.reactions ?? localMessage.reactions,
	};
};

export const reconcileSubmissionTimeline = ({
	canonicalMessages,
	localMessages,
}: {
	canonicalMessages: readonly TimelineMessage[];
	localMessages: readonly SubmissionReconciliationLocalMessage[];
}): SubmissionReconciliationResult => {
	const reconciledMessages = [...canonicalMessages];
	const canonicalIndexByIdentity = new Map<string, number>();
	const localOutgoingMessageIds = new Set<string>();
	const messageDeliveryStates: Record<string, MessageDeliveryState> = {};
	const failedMessageActions: Record<string, { errorMessage?: string }> = {};

	for (const [index, message] of canonicalMessages.entries()) {
		for (const identity of messageIdentityKeys(message)) {
			if (!canonicalIndexByIdentity.has(identity)) {
				canonicalIndexByIdentity.set(identity, index);
			}
		}
	}

	for (const localMessage of localMessages) {
		const matchedIndex = messageIdentityKeys(localMessage.message)
			.map((identity) => canonicalIndexByIdentity.get(identity))
			.find((index): index is number => index !== undefined);

		if (matchedIndex !== undefined) {
			const matchedMessage = reconciledMessages[matchedIndex];
			if (!matchedMessage) {
				continue;
			}

			reconciledMessages[matchedIndex] = mergeCanonicalMessageWithLocalSubmission(matchedMessage, localMessage.message);

			if (localMessage.status === 'sending') {
				messageDeliveryStates[matchedMessage.id] = 'sending';
				localOutgoingMessageIds.add(matchedMessage.id);
			}
			continue;
		}

		reconciledMessages.push(localMessage.message);
		messageDeliveryStates[localMessage.message.id] = localMessage.status;
		localOutgoingMessageIds.add(localMessage.message.id);
		if (localMessage.status === 'failed') {
			failedMessageActions[localMessage.message.id] = {
				errorMessage: localMessage.errorMessage,
			};
		}
	}

	return {
		failedMessageActions,
		localOutgoingMessageIds,
		messageDeliveryStates,
		messages: reconciledMessages,
	};
};
