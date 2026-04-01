import { describe, expect, it } from 'bun:test';

import { shouldAnimateThemePreferenceChange } from './themeDocument';

describe('shouldAnimateThemePreferenceChange', () => {
	it('returns false when the theme preference does not change', () => {
		expect(
			shouldAnimateThemePreferenceChange({
				currentResolvedTheme: 'light',
				currentThemePreference: 'light',
				nextThemePreference: 'light',
				systemTheme: 'light',
			}),
		).toBe(false);
	});

	it('returns false when the resolved theme stays the same', () => {
		expect(
			shouldAnimateThemePreferenceChange({
				currentResolvedTheme: 'light',
				currentThemePreference: 'light',
				nextThemePreference: 'auto',
				systemTheme: 'light',
			}),
		).toBe(false);
	});

	it('returns true when the resolved theme changes', () => {
		expect(
			shouldAnimateThemePreferenceChange({
				currentResolvedTheme: 'light',
				currentThemePreference: 'auto',
				nextThemePreference: 'dark',
				systemTheme: 'light',
			}),
		).toBe(true);
	});
});
