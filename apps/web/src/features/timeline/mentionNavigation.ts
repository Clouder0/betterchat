import type { SessionUser } from '@betterchat/contracts';
import type { TimelineMessage } from '@/lib/chatModels';

import { buildMentionTokens, isMentionBoundaryCharacter, normalizeMentionToken } from '@/lib/mentions';

const messageMentionsToken = (markdown: string, token: string) => {
	if (!token) {
		return false;
	}

	const normalizedMarkdown = markdown.toLocaleLowerCase();
	const normalizedNeedle = `@${token.toLocaleLowerCase()}`;
	let searchStart = 0;

	while (searchStart < normalizedMarkdown.length) {
		const candidateIndex = normalizedMarkdown.indexOf(normalizedNeedle, searchStart);
		if (candidateIndex < 0) {
			return false;
		}

		const beforeCharacter = candidateIndex === 0 ? undefined : normalizedMarkdown[candidateIndex - 1];
		const afterCharacter = normalizedMarkdown[candidateIndex + normalizedNeedle.length];
		if (isMentionBoundaryCharacter(beforeCharacter) && isMentionBoundaryCharacter(afterCharacter)) {
			return true;
		}

		searchStart = candidateIndex + normalizedNeedle.length;
	}

	return false;
};

export const messageMentionsCurrentUser = ({
	currentUser,
	message,
}: {
	currentUser: Pick<SessionUser, 'displayName' | 'id' | 'username'> | null | undefined;
	message: TimelineMessage;
}) => {
	if (!currentUser || message.author.id === currentUser.id || message.flags.deleted) {
		return false;
	}

	const mentionTokens = buildMentionTokens(currentUser);
	if (mentionTokens.length === 0) {
		return false;
	}

	return mentionTokens.some((token) => messageMentionsToken(message.body.rawMarkdown, token));
};

export const resolveLoadedMentionTargetMessageId = ({
	currentUser,
	messages,
	roomMentioned,
	unreadFromMessageId,
}: {
	currentUser: Pick<SessionUser, 'displayName' | 'id' | 'username'> | null | undefined;
	messages: TimelineMessage[];
	roomMentioned: boolean;
	unreadFromMessageId?: string;
}) => {
	if (!roomMentioned || !currentUser) {
		return null;
	}

	const mentionTokens = buildMentionTokens(currentUser);
	if (mentionTokens.length === 0) {
		return null;
	}

	const unreadStartIndex = unreadFromMessageId ? messages.findIndex((message) => message.id === unreadFromMessageId) : -1;
	const searchSpace = unreadStartIndex >= 0 ? messages.slice(unreadStartIndex) : messages;

	return searchSpace.find((message) => messageMentionsCurrentUser({ currentUser, message }))?.id ?? null;
};
