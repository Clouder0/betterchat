export const buildMessageContextMenuActionKeySignature = (actionKeys: readonly string[]) => actionKeys.join('\u001f');

export const resolveMessageContextMenuActiveKey = ({
	actionKeys,
	currentKey,
	source,
}: {
	actionKeys: readonly string[];
	currentKey: string | null;
	source: 'keyboard' | 'pointer';
}) => {
	if (actionKeys.length === 0) {
		return null;
	}

	if (currentKey && actionKeys.includes(currentKey)) {
		return currentKey;
	}

	return source === 'keyboard' ? (actionKeys[0] ?? null) : null;
};

export const resolveMessageContextMenuIndexByKey = ({
	actionKeys,
	activeKey,
}: {
	actionKeys: readonly string[];
	activeKey: string | null;
}) => {
	if (!activeKey) {
		return null;
	}

	const index = actionKeys.indexOf(activeKey);
	return index >= 0 ? index : null;
};

export const resolveMessageContextMenuKeyAtIndex = ({
	actionKeys,
	index,
}: {
	actionKeys: readonly string[];
	index: number | null;
}) => {
	if (index === null || actionKeys.length === 0) {
		return null;
	}

	const boundedIndex = Math.max(0, Math.min(index, actionKeys.length - 1));
	return actionKeys[boundedIndex] ?? null;
};
