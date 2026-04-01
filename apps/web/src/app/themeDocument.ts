import { isDocumentMotionDisabled } from './motionPreference';

export type ThemePreference = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'betterchat.theme-preference.v1';
export const LEGACY_THEME_STORAGE_KEY = 'betterchat-theme';
export const THEME_SWITCHING_ATTRIBUTE = 'data-theme-switching';
export const THEME_SWITCH_DURATION_MS = 180;

let themeSwitchCleanupTimer: number | null = null;

const isThemePreference = (value: string | null): value is ThemePreference => value === 'light' || value === 'dark' || value === 'auto';

export const getSystemTheme = (): ResolvedTheme => {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
		return 'light';
	}

	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const getStoredThemePreference = (): ThemePreference => {
	if (typeof window === 'undefined') {
		return 'auto';
	}

	const storedThemePreference = window.localStorage.getItem(THEME_STORAGE_KEY);
	if (isThemePreference(storedThemePreference)) {
		return storedThemePreference;
	}

	const legacyThemePreference = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
	return legacyThemePreference === 'dark' || legacyThemePreference === 'light' ? legacyThemePreference : 'auto';
};

export const resolveThemePreference = (themePreference: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme =>
	themePreference === 'auto' ? systemTheme : themePreference;

export const shouldAnimateThemePreferenceChange = ({
	currentResolvedTheme,
	currentThemePreference,
	nextThemePreference,
	systemTheme,
}: {
	currentResolvedTheme: ResolvedTheme;
	currentThemePreference: ThemePreference;
	nextThemePreference: ThemePreference;
	systemTheme: ResolvedTheme;
}) =>
	currentThemePreference !== nextThemePreference &&
	resolveThemePreference(nextThemePreference, systemTheme) !== currentResolvedTheme;

export const applyDocumentTheme = ({
	resolvedTheme,
	themePreference,
}: {
	resolvedTheme: ResolvedTheme;
	themePreference: ThemePreference;
}) => {
	if (typeof document === 'undefined') {
		return;
	}

	document.documentElement.dataset.theme = resolvedTheme;
	document.documentElement.dataset.themePreference = themePreference;

	if (typeof window !== 'undefined') {
		window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
		window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
	}
};

export const initializeDocumentTheme = () => {
	const themePreference = getStoredThemePreference();
	const resolvedTheme = resolveThemePreference(themePreference, getSystemTheme());

	applyDocumentTheme({
		resolvedTheme,
		themePreference,
	});

	return {
		resolvedTheme,
		themePreference,
	};
};

const canAnimateThemeSwitch = () =>
	typeof window !== 'undefined' &&
	typeof window.matchMedia === 'function' &&
	!isDocumentMotionDisabled() &&
	!window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clearThemeSwitchingAttribute = () => {
	if (typeof document === 'undefined') {
		return;
	}

	document.documentElement.removeAttribute(THEME_SWITCHING_ATTRIBUTE);
	if (themeSwitchCleanupTimer !== null) {
		window.clearTimeout(themeSwitchCleanupTimer);
		themeSwitchCleanupTimer = null;
	}
};

export const animateThemeSwitch = (applyThemeChange: () => void) => {
	if (typeof document === 'undefined' || !canAnimateThemeSwitch()) {
		applyThemeChange();
		return;
	}

	document.documentElement.setAttribute(THEME_SWITCHING_ATTRIBUTE, 'true');
	applyThemeChange();

	if (themeSwitchCleanupTimer !== null) {
		window.clearTimeout(themeSwitchCleanupTimer);
	}

	themeSwitchCleanupTimer = window.setTimeout(() => {
		clearThemeSwitchingAttribute();
	}, THEME_SWITCH_DURATION_MS + 48);
};
