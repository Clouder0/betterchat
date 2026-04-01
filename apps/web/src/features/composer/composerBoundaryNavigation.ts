import type { ComposerSelection } from './composerEditing';

const clampCursor = (cursor: number, valueLength: number) => Math.min(Math.max(cursor, 0), valueLength);

export const isCollapsedSelectionOnLastLine = ({
	selection,
	value,
}: {
	selection: ComposerSelection;
	value: string;
}) => {
	if (selection.anchor !== selection.head) {
		return false;
	}

	const cursor = clampCursor(selection.anchor, value.length);
	return value.indexOf('\n', cursor) === -1;
};
