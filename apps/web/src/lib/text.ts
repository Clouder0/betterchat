import type { ReactNode } from 'react';
import { pangu } from 'pangu/browser';

export const spaceText = (text: string) => pangu.spacingText(text);

export const spaceReactNode = (node: ReactNode): ReactNode => {
	if (typeof node === 'string') {
		return spaceText(node);
	}

	if (Array.isArray(node)) {
		return node.map(spaceReactNode);
	}

	return node;
};
