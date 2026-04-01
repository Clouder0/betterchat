import type { PresenceState, RoomSummary } from '@/lib/chatModels';

export type PresenceTone = 'online' | 'away' | 'busy' | 'offline';
export type SidebarSecondaryMeta = {
	presence: { label: string; tone: PresenceTone } | null;
	presenceLabel: string | null;
	text: string;
};

const roomKindLabel: Record<'channel' | 'group' | 'dm', string> = {
	channel: '频道',
	group: '群组',
	dm: '私信',
};

const onlinePresence = { label: '在线', tone: 'online' as const };
const awayPresence = { label: '离开', tone: 'away' as const };
const busyPresence = { label: '忙碌', tone: 'busy' as const };
const offlinePresence = { label: '离线', tone: 'offline' as const };

const sidebarPresenceByLabel: Record<string, { label: string; tone: PresenceTone }> = {
	在线: onlinePresence,
	离开: awayPresence,
	忙碌: busyPresence,
	离线: offlinePresence,
};

const sidebarPresenceByState: Record<PresenceState, { label: string; tone: PresenceTone }> = {
	online: onlinePresence,
	away: awayPresence,
	busy: busyPresence,
	offline: offlinePresence,
};

const toPresenceLabel = (presence: { label: string; tone: PresenceTone } | null) =>
	presence && presence.tone !== 'online' ? presence.label : null;

const splitPresenceSuffix = (subtitle: string) => {
	const presenceMatch = subtitle.trim().match(/^(.*?)(?:\s*[·•・]\s*)?(在线|离开|忙碌|离线)$/u);
	if (!presenceMatch) {
		return null;
	}

	return {
		text: (presenceMatch[1] ?? '').trim(),
		presenceLabel: presenceMatch[2] as keyof typeof sidebarPresenceByLabel,
	};
};

export const resolveSidebarSecondaryMeta = (entry: RoomSummary): SidebarSecondaryMeta => {
	const fallbackText = entry.subtitle?.trim() || roomKindLabel[entry.kind];
	if (entry.kind !== 'dm') {
		return {
			presence: null,
			presenceLabel: null,
			text: fallbackText,
		};
	}

	const structuredPresence = entry.presence ? sidebarPresenceByState[entry.presence] ?? null : null;
	if (structuredPresence) {
		const trimmedSubtitle = entry.subtitle?.trim() ?? '';
		const splitSubtitle = trimmedSubtitle ? splitPresenceSuffix(trimmedSubtitle) : null;
		return {
			presence: structuredPresence,
			presenceLabel: toPresenceLabel(structuredPresence),
			text: splitSubtitle?.text || fallbackText,
		};
	}

	if (!entry.subtitle?.trim()) {
		return {
			presence: null,
			presenceLabel: null,
			text: fallbackText,
		};
	}

	const splitSubtitle = splitPresenceSuffix(entry.subtitle);
	if (!splitSubtitle) {
		return {
			presence: null,
			presenceLabel: null,
			text: fallbackText,
		};
	}

	const presence = sidebarPresenceByLabel[splitSubtitle.presenceLabel] ?? null;
	return {
		presence,
		presenceLabel: toPresenceLabel(presence),
		text: splitSubtitle.text || roomKindLabel[entry.kind],
	};
};
