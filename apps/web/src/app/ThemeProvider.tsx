import * as Switch from '@radix-ui/react-switch';
import { flushSync } from 'react-dom';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { spaceText } from '@/lib/text';

import {
	animateThemeSwitch,
	applyDocumentTheme,
	getStoredThemePreference,
	getSystemTheme,
	resolveThemePreference,
	shouldAnimateThemePreferenceChange,
	type ResolvedTheme,
	type ThemePreference,
} from './themeDocument';
import styles from './ThemeProvider.module.css';

export type { ResolvedTheme, ThemePreference } from './themeDocument';

type ThemeContextValue = {
	resolvedTheme: ResolvedTheme;
	setThemePreference: (preference: ThemePreference) => void;
	themePreference: ThemePreference;
	toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider = ({ children }: PropsWithChildren) => {
	const [themePreference, setThemePreferenceState] = useState<ThemePreference>(getStoredThemePreference);
	const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

	useEffect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
			return;
		}

		const mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
		const handleChange = (event?: MediaQueryListEvent) => {
			setSystemTheme((event?.matches ?? mediaQueryList.matches) ? 'dark' : 'light');
		};

		handleChange();
		if (typeof mediaQueryList.addEventListener === 'function') {
			mediaQueryList.addEventListener('change', handleChange);
			return () => mediaQueryList.removeEventListener('change', handleChange);
		}

		mediaQueryList.addListener(handleChange);
		return () => mediaQueryList.removeListener(handleChange);
	}, []);

	const resolvedTheme = resolveThemePreference(themePreference, systemTheme);

	const commitThemePreference = (preference: ThemePreference) => {
		const nextResolvedTheme = resolveThemePreference(preference, systemTheme);
		const applyPreference = () => {
			flushSync(() => {
				setThemePreferenceState(preference);
			});

			applyDocumentTheme({
				resolvedTheme: nextResolvedTheme,
				themePreference: preference,
			});
		};

		if (
			!shouldAnimateThemePreferenceChange({
				currentResolvedTheme: resolvedTheme,
				currentThemePreference: themePreference,
				nextThemePreference: preference,
				systemTheme,
			})
		) {
			if (preference === themePreference) {
				return;
			}

			applyPreference();
			return;
		}

		animateThemeSwitch(applyPreference);
	};

	useLayoutEffect(() => {
		applyDocumentTheme({
			resolvedTheme,
			themePreference,
		});
	}, [resolvedTheme, themePreference]);

	const value = useMemo<ThemeContextValue>(
		() => ({
			resolvedTheme,
			setThemePreference(preference) {
				commitThemePreference(preference);
			},
			themePreference,
			toggleTheme() {
				const nextPreference = resolveThemePreference(themePreference, systemTheme) === 'dark' ? 'light' : 'dark';
				commitThemePreference(nextPreference);
			},
		}),
		[commitThemePreference, resolvedTheme, systemTheme, themePreference],
	);

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
	const context = useContext(ThemeContext);

	if (!context) {
		throw new Error('useTheme must be used inside ThemeProvider');
	}

	return context;
};

export const ThemeToggle = () => {
	const { resolvedTheme, toggleTheme } = useTheme();

	return (
		<label className={styles.toggle}>
			<span className={styles.label}>{spaceText('主题')}</span>
			<Switch.Root checked={resolvedTheme === 'dark'} className={styles.switchRoot} onCheckedChange={toggleTheme}>
				<Switch.Thumb className={styles.switchThumb} />
			</Switch.Root>
			<span className={styles.mode}>{spaceText(resolvedTheme === 'light' ? '浅色' : '深色')}</span>
		</label>
	);
};
