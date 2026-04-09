import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { installTestDom, type TestDomHarness } from '@/test/domHarness';
import { setElementBox } from '@/test/layoutHarness';
import { revealSidebarRoomInContainer, resolveSidebarRoomRevealScrollTop } from './sidebarActiveRoomReveal';

describe('resolveSidebarRoomRevealScrollTop', () => {
	it('returns null when the room is already fully visible', () => {
		expect(
			resolveSidebarRoomRevealScrollTop({
				currentScrollTop: 40,
				roomBottom: 120,
				roomTop: 60,
				viewportHeight: 100,
			}),
		).toBeNull();
	});

	it('scrolls upward just enough when the room starts above the viewport', () => {
		expect(
			resolveSidebarRoomRevealScrollTop({
				currentScrollTop: 80,
				roomBottom: 110,
				roomTop: 52,
				viewportHeight: 120,
			}),
		).toBe(52);
	});

	it('scrolls downward just enough when the room bottom is clipped', () => {
		expect(
			resolveSidebarRoomRevealScrollTop({
				currentScrollTop: 0,
				roomBottom: 140,
				roomTop: 96,
				viewportHeight: 100,
			}),
		).toBe(40);
	});
});

describe('revealSidebarRoomInContainer', () => {
	let dom: TestDomHarness;

	beforeEach(() => {
		dom = installTestDom();
	});

	afterEach(() => {
		dom.cleanup();
	});

	it('only scrolls the sidebar container when the room is actually clipped', () => {
		const container = document.createElement('div');
		const roomButton = document.createElement('button');

		setElementBox(container, {
			clientHeight: 100,
			height: 100,
			scrollTop: 0,
			top: 0,
			width: 240,
		});
		setElementBox(roomButton, {
			height: 40,
			offsetTop: 96,
			top: 96,
			width: 220,
		});

		expect(
			revealSidebarRoomInContainer({
				container,
				motionDisabled: true,
				roomButton,
			}),
		).toBe(true);
		expect(container.scrollTop).toBe(36);

		setElementBox(container, {
			clientHeight: 100,
			height: 100,
			scrollTop: 36,
			top: 0,
			width: 240,
		});
		setElementBox(roomButton, {
			height: 40,
			offsetTop: 96,
			top: 60,
			width: 220,
		});

		expect(
			revealSidebarRoomInContainer({
				container,
				motionDisabled: true,
				roomButton,
			}),
		).toBe(false);
		expect(container.scrollTop).toBe(36);
	});
});
