export type ForwardDialogSearchKeyAction = 'focus-active-room' | null;

export const resolveForwardDialogSearchKeyAction = ({
	hasActiveRoom,
	key,
}: {
	hasActiveRoom: boolean;
	key: string;
}): ForwardDialogSearchKeyAction => {
	if (!hasActiveRoom) {
		return null;
	}

	if (key === 'ArrowDown' || key === 'Enter') {
		return 'focus-active-room';
	}

	return null;
};

export type ForwardDialogRoomKeyAction =
	| { kind: 'focus-note' }
	| { kind: 'focus-room'; index: number }
	| { kind: 'focus-search' }
	| { kind: 'select-room' }
	| { kind: 'select-room-and-focus-note' }
	| null;

export const resolveForwardDialogRoomKeyAction = ({
	currentIndex,
	key,
	roomCount,
}: {
	currentIndex: number;
	key: string;
	roomCount: number;
}): ForwardDialogRoomKeyAction => {
	if (currentIndex < 0 || roomCount <= 0) {
		return null;
	}

	if (key === 'ArrowDown') {
		return currentIndex === roomCount - 1 ? { kind: 'focus-note' } : { kind: 'focus-room', index: currentIndex + 1 };
	}

	if (key === 'ArrowUp') {
		return currentIndex === 0 ? { kind: 'focus-search' } : { kind: 'focus-room', index: currentIndex - 1 };
	}

	if (key === 'Home') {
		return { kind: 'focus-room', index: 0 };
	}

	if (key === 'End') {
		return { kind: 'focus-room', index: roomCount - 1 };
	}

	if (key === 'ArrowLeft') {
		return { kind: 'focus-search' };
	}

	if (key === 'ArrowRight') {
		return { kind: 'focus-note' };
	}

	if (key === 'Enter') {
		return { kind: 'select-room-and-focus-note' };
	}

	if (key === ' ') {
		return { kind: 'select-room' };
	}

	return null;
};

export type ForwardDialogNoteKeyAction = 'focus-active-room' | 'focus-search' | 'focus-submit' | 'submit' | null;

export const resolveForwardDialogNoteKeyAction = ({
	hasActiveRoom,
	isOnFirstLine,
	isOnLastLine,
	key,
	submitModifierPressed,
}: {
	hasActiveRoom: boolean;
	isOnFirstLine: boolean;
	isOnLastLine: boolean;
	key: string;
	submitModifierPressed: boolean;
}): ForwardDialogNoteKeyAction => {
	if (submitModifierPressed && key === 'Enter') {
		return 'submit';
	}

	if (key === 'ArrowUp' && isOnFirstLine) {
		return hasActiveRoom ? 'focus-active-room' : 'focus-search';
	}

	if (key === 'ArrowDown' && isOnLastLine) {
		return 'focus-submit';
	}

	return null;
};

export type ForwardDialogSubmitKeyAction = 'focus-note' | null;

export const resolveForwardDialogSubmitKeyAction = ({ key }: { key: string }): ForwardDialogSubmitKeyAction =>
	key === 'ArrowUp' ? 'focus-note' : null;
