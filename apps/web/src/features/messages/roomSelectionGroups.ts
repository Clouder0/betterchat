import type { RoomSummary } from '@/lib/chatModels';
import { buildSidebarGroups, type SidebarGroup } from '@/features/sidebar/sidebarModel';
import type { RoomAlertPreferenceStore } from '@/features/sidebar/roomAlertPreferences';
import type { SidebarOrderingState } from '@/features/sidebar/sidebarOrdering';

export const buildRoomSelectionGroups = ({
	activeRoomId,
	alertPreferences = {},
	entries,
	orderingState = {},
	query = '',
}: {
	activeRoomId?: string | null;
	alertPreferences?: RoomAlertPreferenceStore;
	entries: RoomSummary[];
	orderingState?: SidebarOrderingState;
	query?: string;
}): SidebarGroup[] => buildSidebarGroups(entries, query, alertPreferences, orderingState, activeRoomId);
