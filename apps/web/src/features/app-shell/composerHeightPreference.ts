export const COMPOSER_EDITOR_HEIGHT_STORAGE_KEY = 'betterchat.composer-editor-height.v1';
export const DEFAULT_COMPOSER_EDITOR_HEIGHT_PX = 148;
export const MIN_COMPOSER_EDITOR_HEIGHT_PX = 84;
export const MAX_COMPOSER_EDITOR_HEIGHT_PX = 320;

const COMPOSER_NON_EDITOR_CHROME_HEIGHT_PX = 104;
const MIN_TIMELINE_VIEWPORT_HEIGHT_PX = 96;

const isStoredComposerEditorHeight = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const clampComposerEditorHeight = (value: number, bounds: { max: number; min: number }) =>
	Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));

export const formatComposerEditorHeightCssValue = (value: number) => `${Math.round(value)}px`;

export const resolveComposerEditorResizeHeight = ({
	bounds,
	currentY,
	startHeight,
	startY,
}: {
	bounds: { max: number; min: number };
	currentY: number;
	startHeight: number;
	startY: number;
}) => clampComposerEditorHeight(startHeight + (startY - currentY), bounds);

export const resolveComposerEditorHeightBounds = ({
	conversationBodyHeight,
}: {
	conversationBodyHeight: number;
}) => {
	if (!Number.isFinite(conversationBodyHeight) || conversationBodyHeight <= 0) {
		return {
			min: MIN_COMPOSER_EDITOR_HEIGHT_PX,
			max: MAX_COMPOSER_EDITOR_HEIGHT_PX,
		};
	}

	const computedMax = Math.round(
		conversationBodyHeight - COMPOSER_NON_EDITOR_CHROME_HEIGHT_PX - MIN_TIMELINE_VIEWPORT_HEIGHT_PX,
	);
	const max = Math.max(
		MIN_COMPOSER_EDITOR_HEIGHT_PX,
		Math.min(MAX_COMPOSER_EDITOR_HEIGHT_PX, Number.isFinite(computedMax) ? computedMax : MAX_COMPOSER_EDITOR_HEIGHT_PX),
	);

	return {
		min: MIN_COMPOSER_EDITOR_HEIGHT_PX,
		max,
	};
};

export const loadComposerEditorHeightPreference = () => {
	if (typeof window === 'undefined') {
		return DEFAULT_COMPOSER_EDITOR_HEIGHT_PX;
	}

	const rawValue = window.localStorage.getItem(COMPOSER_EDITOR_HEIGHT_STORAGE_KEY);
	if (!rawValue) {
		return DEFAULT_COMPOSER_EDITOR_HEIGHT_PX;
	}

	try {
		const parsedValue: unknown = JSON.parse(rawValue);
		return isStoredComposerEditorHeight(parsedValue) ? parsedValue : DEFAULT_COMPOSER_EDITOR_HEIGHT_PX;
	} catch {
		return DEFAULT_COMPOSER_EDITOR_HEIGHT_PX;
	}
};

export const saveComposerEditorHeightPreference = (value: number) => {
	if (typeof window === 'undefined') {
		return;
	}

	window.localStorage.setItem(COMPOSER_EDITOR_HEIGHT_STORAGE_KEY, JSON.stringify(Math.round(value)));
};
