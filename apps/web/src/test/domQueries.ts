const walkElements = (root: ParentNode): HTMLElement[] => {
	const elements: HTMLElement[] = [];
	const stack = Array.from(root.childNodes);

	while (stack.length > 0) {
		const node = stack.shift();
		if (!(node instanceof HTMLElement)) {
			continue;
		}

		elements.push(node);
		stack.unshift(...Array.from(node.childNodes));
	}

	return elements;
};

export const queryByTestId = (root: ParentNode, testId: string): HTMLElement | null =>
	walkElements(root).find((element) => element.dataset.testid === testId) ?? null;

export const getByTestId = (root: ParentNode, testId: string): HTMLElement => {
	const found = queryByTestId(root, testId);
	if (!found) {
		throw new Error(`Unable to find element with data-testid="${testId}"`);
	}

	return found;
};

export const queryAllByTestIdPrefix = (root: ParentNode, prefix: string): HTMLElement[] =>
	walkElements(root).filter((element) => typeof element.dataset.testid === 'string' && element.dataset.testid.startsWith(prefix));

