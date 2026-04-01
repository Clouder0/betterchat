const HAN_TOKEN = /^\p{Script=Han}+$/u;
const LATIN_TOKEN = /^[A-Za-z0-9]+$/u;
const TOKEN_PATTERN = /\p{Script=Han}+|[A-Za-z0-9]+/gu;

const takeFirstChars = (text: string, count: number) => Array.from(text).slice(0, count).join('');
const takeLastChars = (text: string, count: number) => Array.from(text).slice(-count).join('');
const toUpper = (text: string) => text.toLocaleUpperCase('en-US');

const getMixedTokenLabel = (token: string) => {
	if (HAN_TOKEN.test(token)) {
		return takeFirstChars(token, 1);
	}

	if (LATIN_TOKEN.test(token)) {
		return takeFirstChars(toUpper(token), 1);
	}

	return takeFirstChars(token, 1);
};

export const getAvatarLabel = (name: string) => {
	const normalized = name.trim().replace(/\s+/g, ' ');

	if (!normalized) {
		return '?';
	}

	const tokens = normalized.match(TOKEN_PATTERN);

	if (!tokens?.length) {
		return takeFirstChars(normalized, 2);
	}

	if (tokens.every((token) => HAN_TOKEN.test(token))) {
		return takeLastChars(tokens.join(''), 2);
	}

	if (tokens.every((token) => LATIN_TOKEN.test(token))) {
		if (tokens.length === 1) {
			return takeFirstChars(toUpper(tokens[0]), 2);
		}

		return tokens
			.slice(0, 2)
			.map((token) => takeFirstChars(toUpper(token), 1))
			.join('');
	}

	return takeFirstChars(
		tokens
			.slice(0, 2)
			.map(getMixedTokenLabel)
			.join(''),
		2,
	);
};
