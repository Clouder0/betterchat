export type ComposerSendShortcut = 'enter-send' | 'ctrl-enter-send';

type StoredComposerSendShortcut = ComposerSendShortcut;

export const COMPOSER_SEND_SHORTCUT_STORAGE_KEY = 'betterchat.composer.send-shortcut.v1';
export const DEFAULT_COMPOSER_SEND_SHORTCUT: ComposerSendShortcut = 'enter-send';

export const composerSendShortcutOptions = [
	{
		value: 'enter-send',
		label: 'Enter 发送',
		description: 'Shift + Enter 换行',
	},
	{
		value: 'ctrl-enter-send',
		label: 'Enter 换行',
		description: 'Ctrl + Enter 发送',
	},
] as const satisfies readonly {
	value: ComposerSendShortcut;
	label: string;
	description: string;
}[];

type ComposerShortcutKeyboardEvent = {
	key: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
};

const isComposerSendShortcut = (value: string | null): value is StoredComposerSendShortcut =>
	value === 'enter-send' || value === 'ctrl-enter-send';

export const loadComposerSendShortcut = (): ComposerSendShortcut => {
	if (typeof window === 'undefined') {
		return DEFAULT_COMPOSER_SEND_SHORTCUT;
	}

	const storedValue = window.localStorage.getItem(COMPOSER_SEND_SHORTCUT_STORAGE_KEY);
	return isComposerSendShortcut(storedValue) ? storedValue : DEFAULT_COMPOSER_SEND_SHORTCUT;
};

export const saveComposerSendShortcut = (value: ComposerSendShortcut) => {
	if (typeof window === 'undefined') {
		return;
	}

	window.localStorage.setItem(COMPOSER_SEND_SHORTCUT_STORAGE_KEY, value);
};

export const getComposerShortcutHint = (value: ComposerSendShortcut) =>
	value === 'ctrl-enter-send' ? 'Enter 换行，Ctrl + Enter 发送' : 'Shift + Enter 换行';

export const shouldSendOnComposerKeydown = ({
	event,
	isComposing,
	mode,
}: {
	event: ComposerShortcutKeyboardEvent;
	isComposing: boolean;
	mode: ComposerSendShortcut;
}) => {
	if (event.key !== 'Enter' || isComposing) {
		return false;
	}

	if (mode === 'enter-send') {
		return !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
	}

	return !event.altKey && !event.shiftKey && (event.ctrlKey || event.metaKey);
};
