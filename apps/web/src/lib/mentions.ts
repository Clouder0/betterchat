import type { SessionUser } from '@betterchat/contracts';

export type MentionIdentity = Pick<SessionUser, 'displayName' | 'username'> | null | undefined;
export type MentionInteractionUser = {
	id: string;
	displayName: string;
	username?: string;
};

export type MentionSegment =
	| {
			kind: 'mention';
			value: string;
	  }
	| {
			kind: 'text';
			value: string;
	  };

export type InlineMentionTone = 'default' | 'self';

const mentionBoundaryPattern = /[\s()[\]{}"'“”‘’<>《》「」【】、，。！？；：,.;!?/\\|+\-=*~`]/u;
const mentionTokenCharacterPattern = /[\p{L}\p{N}._-]/u;

const normalizeMentionIdentity = (value: string | undefined) => normalizeMentionToken(value).toLocaleLowerCase();

export const normalizeMentionToken = (value: string | undefined) => value?.trim().replace(/^@+/, '') ?? '';

export const isMentionBoundaryCharacter = (character: string | undefined) => !character || mentionBoundaryPattern.test(character);

export const isMentionTokenCharacter = (character: string | undefined) =>
	Boolean(character && mentionTokenCharacterPattern.test(character));

export const buildMentionTokens = (currentUser: MentionIdentity) => {
	if (!currentUser) {
		return [];
	}

	return Array.from(
		new Set(
			[normalizeMentionIdentity(currentUser.username), normalizeMentionIdentity(currentUser.displayName)].filter(
				(token) => token.length > 0,
			),
		),
	);
};

export const mentionTokenMatchesCurrentUser = ({
	currentUser,
	token,
}: {
	currentUser: MentionIdentity;
	token: string;
}) => {
	const mentionTokens = buildMentionTokens(currentUser);
	if (mentionTokens.length === 0) {
		return false;
	}

	return mentionTokens.includes(normalizeMentionIdentity(token));
};

export const resolveInlineMentionTone = ({
	currentUser,
	token,
}: {
	currentUser: MentionIdentity;
	token: string;
}): InlineMentionTone => (mentionTokenMatchesCurrentUser({ currentUser, token }) ? 'self' : 'default');

export const resolveMentionInteractionUser = ({
	currentUserId,
	token,
	users,
}: {
	currentUserId?: string | null;
	token: string;
	users: MentionInteractionUser[];
}) => {
	const normalizedToken = normalizeMentionIdentity(token);
	if (!normalizedToken) {
		return null;
	}

	if (
		currentUserId &&
		users.some(
			(user) =>
				user.id === currentUserId &&
				(normalizeMentionIdentity(user.username) === normalizedToken ||
					normalizeMentionIdentity(user.displayName) === normalizedToken),
		)
	) {
		return null;
	}

	const usernameMatches = users.filter(
		(user) => user.id !== currentUserId && normalizeMentionIdentity(user.username) === normalizedToken,
	);
	if (usernameMatches.length === 1) {
		return usernameMatches[0] ?? null;
	}

	if (usernameMatches.length > 1) {
		return null;
	}

	const displayNameMatches = users.filter(
		(user) => user.id !== currentUserId && normalizeMentionIdentity(user.displayName) === normalizedToken,
	);
	if (displayNameMatches.length === 1) {
		return displayNameMatches[0] ?? null;
	}

	return null;
};

export const splitMentionSegments = (value: string): MentionSegment[] => {
	const characters = Array.from(value);
	const segments: MentionSegment[] = [];
	let buffer = '';
	let index = 0;

	while (index < characters.length) {
		const character = characters[index];
		const previousCharacter = index === 0 ? undefined : characters[index - 1];

		if (character === '@' && isMentionBoundaryCharacter(previousCharacter)) {
			let endIndex = index + 1;
			while (endIndex < characters.length && isMentionTokenCharacter(characters[endIndex])) {
				endIndex += 1;
			}

			if (endIndex > index + 1) {
				if (buffer) {
					segments.push({ kind: 'text', value: buffer });
					buffer = '';
				}

				segments.push({
					kind: 'mention',
					value: characters.slice(index, endIndex).join(''),
				});
				index = endIndex;
				continue;
			}
		}

		buffer += character;
		index += 1;
	}

	if (buffer) {
		segments.push({ kind: 'text', value: buffer });
	}

	return segments;
};
