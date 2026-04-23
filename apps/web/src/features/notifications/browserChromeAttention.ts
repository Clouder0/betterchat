import type { RoomSummary } from '@/lib/chatModels';

import {
	DEFAULT_ROOM_NOTIFICATION_DEFAULTS,
	resolveRoomNotificationPreference,
	type RoomNotificationDefaults,
	type RoomNotificationPreferenceStore,
} from './notificationPreferences';
import { isInterruptiveRoomAttentionAllowed } from './notificationPolicy';

export type BrowserChromeAttentionTone = 'activity' | 'mention' | 'none' | 'unread';

export type BrowserChromeAttention = {
	badgeLabel: string | null;
	count: number;
	hasAttention: boolean;
	hasMention: boolean;
	hasUncountedActivity: boolean;
	tone: BrowserChromeAttentionTone;
};

const MAX_BROWSER_CHROME_BADGE_COUNT = 99;
const BASE_BROWSER_CHROME_TITLE = 'BetterChat';
const ACTIVITY_TITLE_PREFIX = '\u2022';

const browserChromeBadgeColors: Record<Exclude<BrowserChromeAttentionTone, 'none'>, string> = {
	activity: '#6EE7B7',
	mention: '#F97316',
	unread: '#EF4444',
};

const formatBrowserChromeBadgeLabel = (count: number) =>
	count > MAX_BROWSER_CHROME_BADGE_COUNT ? `${MAX_BROWSER_CHROME_BADGE_COUNT}+` : String(count);

const normalizeAttentionCount = (count: number | undefined) => {
	if (typeof count !== 'number' || !Number.isFinite(count)) {
		return 0;
	}

	return Math.max(Math.floor(count), 0);
};

export const resolveBrowserChromeAttention = (
	entries: readonly RoomSummary[],
	{
		defaults = DEFAULT_ROOM_NOTIFICATION_DEFAULTS,
		preferences = {},
	}: {
		defaults?: RoomNotificationDefaults;
		preferences?: RoomNotificationPreferenceStore;
	} = {},
): BrowserChromeAttention => {
	let count = 0;
	let hasMention = false;
	let hasUncountedActivity = false;

	for (const entry of entries) {
		if (entry.visibility !== 'visible' || entry.attention.level === 'none') {
			continue;
		}

		const preference = resolveRoomNotificationPreference({
			defaults,
			preferences,
			roomId: entry.id,
			roomKind: entry.kind,
		});
		if (!isInterruptiveRoomAttentionAllowed({ entry, preference })) {
			continue;
		}

		if (entry.attention.level === 'mention') {
			hasMention = true;
		}

		const badgeCount = normalizeAttentionCount(entry.attention.badgeCount);
		if (badgeCount > 0) {
			count += badgeCount;
			continue;
		}

		if (entry.attention.level === 'mention' || entry.attention.level === 'unread') {
			count += 1;
			continue;
		}

		hasUncountedActivity = true;
	}

	const hasCountedAttention = count > 0;
	const hasAttention = hasCountedAttention || hasUncountedActivity;
	const tone: BrowserChromeAttentionTone = hasMention
		? 'mention'
		: hasCountedAttention
			? 'unread'
			: hasUncountedActivity
				? 'activity'
				: 'none';

	return {
		badgeLabel: hasCountedAttention ? formatBrowserChromeBadgeLabel(count) : null,
		count,
		hasAttention,
		hasMention,
		hasUncountedActivity,
		tone,
	};
};

export const formatBrowserChromeTitle = (baseTitle: string, attention: BrowserChromeAttention) => {
	const normalizedTitle = baseTitle.trim() || BASE_BROWSER_CHROME_TITLE;
	if (attention.badgeLabel) {
		return `(${attention.badgeLabel}) ${normalizedTitle}`;
	}

	if (attention.hasUncountedActivity) {
		return `${ACTIVITY_TITLE_PREFIX} ${normalizedTitle}`;
	}

	return normalizedTitle;
};

export const createBrowserChromeFaviconHref = (attention: BrowserChromeAttention) => {
	if (!attention.hasAttention || attention.tone === 'none') {
		return null;
	}

	const badgeFill = browserChromeBadgeColors[attention.tone];
	const badgeMarkup = attention.badgeLabel
		? `<g data-browser-chrome-badge="${attention.tone}"><circle cx="48" cy="16" r="14" fill="${badgeFill}" stroke="#101826" stroke-width="4"/><text x="48" y="21" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${attention.badgeLabel.length > 2 ? 12 : 16}" font-weight="800" fill="#FFFFFF">${attention.badgeLabel}</text></g>`
		: `<g data-browser-chrome-badge="${attention.tone}"><circle cx="50" cy="14" r="8" fill="${badgeFill}" stroke="#101826" stroke-width="4"/></g>`;

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="18" fill="#101826"/><path d="M19 19.5C19 16.4624 21.4624 14 24.5 14H39.5C42.5376 14 45 16.4624 45 19.5V34.5C45 37.5376 42.5376 40 39.5 40H30.5L22 48.5V40H24.5C21.4624 40 19 37.5376 19 34.5V19.5Z" fill="#6EE7B7"/><path d="M26 24H38" stroke="#101826" stroke-width="4" stroke-linecap="round"/><path d="M26 30.5H34" stroke="#101826" stroke-width="4" stroke-linecap="round"/>${badgeMarkup}</svg>`;

	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};
