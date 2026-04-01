import type { ConversationMentionCandidate, ConversationParticipant } from '@betterchat/contracts';
import type { MentionInteractionUser } from '@/lib/mentions';

import type { ComposerEdit, ComposerSelection } from './composerEditing';

export type ComposerMentionCandidate =
	| {
			id: string;
			kind: 'user';
			displayName: string;
			insertText: string;
			username?: string;
	  }
	| {
			description: string;
			displayName: string;
			id: string;
			insertText: string;
			kind: 'special';
	  };

export type ComposerMentionMatch = {
	from: number;
	query: string;
	signature: string;
	to: number;
};

const mentionBoundaryPattern = /[\s()[\]{}"'“”‘’<>《》「」【】、，。！？；：,.;!?/\\|+\-=*~`]/u;

const isMentionBoundary = (character: string | undefined) => !character || mentionBoundaryPattern.test(character);

const clampPosition = (position: number, length: number) => Math.min(Math.max(position, 0), length);

const normalizeIdentityValue = (value: string) => value.trim().replace(/^@+/, '').replace(/[\s._-]+/g, '').toLowerCase();

export const normalizeMentionSearchValue = normalizeIdentityValue;

export const toComposerMentionCandidates = (entries: ConversationMentionCandidate[]): ComposerMentionCandidate[] => {
	const candidates: ComposerMentionCandidate[] = [];

	for (const entry of entries) {
		if (entry.kind === 'user') {
			const displayName = entry.user.displayName.trim();
			const username = entry.user.username?.trim() || undefined;
			const primaryLabel = displayName || username;
			const insertText = entry.insertText.trim();
			if (!entry.user.id.trim() || !primaryLabel || !insertText) {
				continue;
			}

			candidates.push({
				displayName: primaryLabel,
				id: entry.user.id.trim(),
				insertText,
				kind: 'user',
				...(username ? { username } : {}),
			});
			continue;
		}

		const insertText = entry.insertText.trim();
		if (!insertText) {
			continue;
		}

		candidates.push({
			description: entry.label,
			displayName: insertText,
			id: `special-${entry.key}`,
			insertText,
			kind: 'special',
		});
	}

	return candidates;
};

export const toMentionInteractionUsers = (entries: ConversationParticipant[]): MentionInteractionUser[] => {
	const users: MentionInteractionUser[] = [];
	const seenUserIds = new Set<string>();

	for (const entry of entries) {
		const userId = entry.user.id.trim();
		const displayName = entry.user.displayName.trim();
		const username = entry.user.username?.trim() || undefined;
		const primaryLabel = displayName || username;
		if (!userId || !primaryLabel || seenUserIds.has(userId)) {
			continue;
		}

		seenUserIds.add(userId);
		users.push({
			displayName: primaryLabel,
			id: userId,
			...(username ? { username } : {}),
		});
	}

	return users;
};

export const hasDistinctMentionHandle = (candidate: ComposerMentionCandidate) => {
	if (candidate.kind !== 'user' || !candidate.username) {
		return false;
	}

	return normalizeIdentityValue(candidate.displayName) !== normalizeIdentityValue(candidate.username);
};

export const getMentionCandidateSecondaryLabel = (candidate: ComposerMentionCandidate) =>
	candidate.kind === 'special' ? candidate.description : hasDistinctMentionHandle(candidate) ? candidate.insertText : null;

export const getActiveMentionMatch = ({
	selection,
	value,
}: {
	selection: ComposerSelection;
	value: string;
}): ComposerMentionMatch | null => {
	if (selection.anchor !== selection.head) {
		return null;
	}

	const position = clampPosition(selection.head, value.length);
	let tokenStart = position;
	while (tokenStart > 0 && !isMentionBoundary(value[tokenStart - 1])) {
		tokenStart -= 1;
	}

	const tokenBeforeCursor = value.slice(tokenStart, position);
	if (!tokenBeforeCursor.startsWith('@')) {
		return null;
	}

	let tokenEnd = position;
	while (tokenEnd < value.length && !isMentionBoundary(value[tokenEnd])) {
		tokenEnd += 1;
	}

	const fullToken = value.slice(tokenStart, tokenEnd);
	if (!fullToken.startsWith('@')) {
		return null;
	}

	const query = value.slice(tokenStart + 1, position);
	if (query.startsWith('@')) {
		return null;
	}

	return {
		from: tokenStart,
		query,
		signature: `${tokenStart}:${tokenEnd}:${query}`,
		to: tokenEnd,
	};
};

export const getMentionInsertionText = (candidate: ComposerMentionCandidate) => candidate.insertText;

export const createMentionCompletionEdit = ({
	candidate,
	match,
	value,
}: {
	candidate: ComposerMentionCandidate;
	match: ComposerMentionMatch;
	value: string;
}): ComposerEdit => {
	const insertBase = getMentionInsertionText(candidate);
	const nextCharacter = value[match.to];
	const shouldAppendTrailingSpace = !nextCharacter || (!/\s/u.test(nextCharacter) && !mentionBoundaryPattern.test(nextCharacter));
	const insert = shouldAppendTrailingSpace ? `${insertBase} ` : insertBase;
	const nextPosition = match.from + insert.length;

	return {
		from: match.from,
		insert,
		selection: {
			anchor: nextPosition,
			head: nextPosition,
		},
		to: match.to,
	};
};
