import { describe, expect, it } from 'bun:test';

import {
	resolveSettlingUnreadDivider,
	shouldSuppressPinnedLiveUnreadDivider,
	type TimelineUnreadDividerSnapshot,
} from './unreadDividerState';

const previousLiveUnreadDivider: TimelineUnreadDividerSnapshot = {
	label: '09:12 之后 6 条未读',
	messageId: 'message-3',
	roomId: 'room-1',
};

describe('resolveSettlingUnreadDivider', () => {
	it('settles the divider only after the matching local read request cleared the anchor', () => {
		expect(
			resolveSettlingUnreadDivider({
				currentRoomId: 'room-1',
				loadedMessageIds: ['message-1', 'message-2', 'message-3', 'message-4'],
				currentUnreadAnchorMessageId: undefined,
				lastReadRequestAnchorId: 'message-3',
				previousLiveUnreadDivider,
			}),
		).toEqual(previousLiveUnreadDivider);
	});

	it('does not settle while the room still has a live unread anchor', () => {
		expect(
			resolveSettlingUnreadDivider({
				currentRoomId: 'room-1',
				loadedMessageIds: ['message-1', 'message-2', 'message-3', 'message-4'],
				currentUnreadAnchorMessageId: 'message-4',
				lastReadRequestAnchorId: 'message-3',
				previousLiveUnreadDivider,
			}),
		).toBeNull();
	});

	it('does not settle across room switches or unrelated anchor clears', () => {
		expect(
			resolveSettlingUnreadDivider({
				currentRoomId: 'room-2',
				loadedMessageIds: ['message-1', 'message-2', 'message-3', 'message-4'],
				currentUnreadAnchorMessageId: undefined,
				lastReadRequestAnchorId: 'message-3',
				previousLiveUnreadDivider,
			}),
		).toBeNull();

		expect(
			resolveSettlingUnreadDivider({
				currentRoomId: 'room-1',
				loadedMessageIds: ['message-1', 'message-2', 'message-3', 'message-4'],
				currentUnreadAnchorMessageId: undefined,
				lastReadRequestAnchorId: 'message-9',
				previousLiveUnreadDivider,
			}),
		).toBeNull();
	});

	it('does not settle when the anchor message is no longer loaded', () => {
		expect(
			resolveSettlingUnreadDivider({
				currentRoomId: 'room-1',
				loadedMessageIds: ['message-4', 'message-5'],
				currentUnreadAnchorMessageId: undefined,
				lastReadRequestAnchorId: 'message-3',
				previousLiveUnreadDivider,
			}),
		).toBeNull();
	});
});

describe('shouldSuppressPinnedLiveUnreadDivider', () => {
	it('suppresses appended unread anchors when the room was already pinned to bottom', () => {
		expect(
			shouldSuppressPinnedLiveUnreadDivider({
				appendedMessageIds: new Set(['message-4']),
				isStickyToBottom: true,
				unreadAnchorMessageId: 'message-4',
			}),
		).toBe(true);
	});

	it('does not suppress historical anchors or non-sticky rooms', () => {
		expect(
			shouldSuppressPinnedLiveUnreadDivider({
				appendedMessageIds: new Set(['message-4']),
				isStickyToBottom: false,
				unreadAnchorMessageId: 'message-4',
			}),
		).toBe(false);

		expect(
			shouldSuppressPinnedLiveUnreadDivider({
				appendedMessageIds: new Set(['message-5']),
				isStickyToBottom: true,
				unreadAnchorMessageId: 'message-4',
			}),
		).toBe(false);
	});
});
