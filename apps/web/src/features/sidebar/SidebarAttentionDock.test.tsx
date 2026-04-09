import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';

import type { RoomSummary } from '@/lib/chatModels';
import { installTestDom, type TestDomHarness } from '@/test/domHarness';
import { getByTestId } from '@/test/domQueries';

import { SidebarAttentionDock } from './SidebarAttentionDock';

const baseEntry = (overrides: Partial<RoomSummary>): RoomSummary => ({
	id: overrides.id ?? 'room-1',
	kind: overrides.kind ?? 'channel',
	title: overrides.title ?? '默认房间',
	subtitle: overrides.subtitle,
	presence: overrides.presence,
	avatarUrl: overrides.avatarUrl,
	favorite: overrides.favorite ?? false,
	visibility: overrides.visibility ?? 'visible',
	attention: overrides.attention ?? { level: 'none' },
	lastActivityAt: overrides.lastActivityAt,
});

describe('SidebarAttentionDock', () => {
	let dom: TestDomHarness;

	beforeEach(() => {
		dom = installTestDom();
	});

	afterEach(() => {
		cleanup();
		dom.cleanup();
	});

	it('renders dock items with attention copy and overflow summary', () => {
		const { container } = render(
			<SidebarAttentionDock
				entries={[
					baseEntry({
						id: 'dm-alice',
						kind: 'dm',
						title: 'Alice Example',
						attention: { badgeCount: 1, level: 'mention' },
					}),
					baseEntry({
						id: 'room-ops',
						title: 'Ops room',
						attention: { badgeCount: 3, level: 'unread' },
					}),
				]}
				onOpenRoom={() => {}}
				overflowCount={2}
			/>,
		);

		expect(getByTestId(container, 'sidebar-attention-dock').textContent).toContain('待处理');
		expect(getByTestId(container, 'sidebar-attention-dock-item-dm-alice').textContent).toContain('提及你');
		expect(getByTestId(container, 'sidebar-attention-dock-item-room-ops').textContent).toContain('3 条未读');
		expect(getByTestId(container, 'sidebar-attention-dock-overflow').textContent).toBe('+2');
	});

	it('opens the selected room when a dock item is clicked', () => {
		const openRoom = mock(() => {});
		const { container } = render(
			<SidebarAttentionDock
				entries={[
					baseEntry({
						id: 'room-ops',
						title: 'Ops room',
						attention: { level: 'activity' },
					}),
				]}
				onOpenRoom={openRoom}
				overflowCount={0}
			/>,
		);

		fireEvent.click(getByTestId(container, 'sidebar-attention-dock-item-room-ops'));

		expect(openRoom).toHaveBeenCalledWith('room-ops');
	});
});
