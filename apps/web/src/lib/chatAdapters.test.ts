import { describe, expect, it } from 'bun:test';
import type { ConversationMessage, DeleteMessageResponse, DirectoryEntry, DirectConversationLookup, EnsureDirectConversationResponse, UpdateMessageResponse } from '@betterchat/contracts';

import {
	toCreateConversationMessageRequest,
	toDeleteMessageResponse,
	toDirectConversationLookupResult,
	toEditMessageResponse,
	toEnsureDirectConversationResult,
	toRoomSummary,
	toTimelineMessage,
} from './chatAdapters';

const baseDirectoryEntry = (handle?: string): DirectoryEntry => ({
	conversation: {
		id: 'dm-guning',
		kind: {
			mode: 'direct',
		},
		title: '顾宁',
		...(handle ? { handle } : {}),
	},
	membership: {
		listing: 'listed',
		starred: false,
		inbox: {
			unreadMessages: 0,
			mentionCount: 0,
			hasThreadActivity: false,
			hasUncountedActivity: false,
		},
	},
	live: {
		counterpartPresence: 'busy',
	},
});

describe('toRoomSummary', () => {
	it('keeps descriptive handles plain so sidebar copy stays concise', () => {
		expect(toRoomSummary(baseDirectoryEntry('交付协同')).subtitle).toBe('交付协同');
		expect(toRoomSummary(baseDirectoryEntry('平台同学')).subtitle).toBe('平台同学');
	});

	it('still prefixes username-like handles for identity-oriented displays', () => {
		expect(toRoomSummary(baseDirectoryEntry('guning')).subtitle).toBe('@guning');
		expect(toRoomSummary(baseDirectoryEntry('@already-tagged')).subtitle).toBe('@already-tagged');
	});
});

describe('toTimelineMessage', () => {
	const baseMessage: ConversationMessage = {
		id: 'message-1',
		submissionId: 'submission-1',
		conversationId: 'room-1',
		authoredAt: '2026-03-27T12:00:00.000Z',
		author: {
			id: 'user-1',
			displayName: 'Alice',
			username: 'alice',
		},
		content: {
			format: 'markdown',
			text: '看图',
		},
		state: {
			edited: false,
			deleted: false,
		},
	};

	it('maps image attachments into preview and source assets so the timeline and viewer can use different URLs', () => {
		const message: ConversationMessage = {
			...baseMessage,
			attachments: [
				{
					kind: 'image',
					id: 'attachment-1',
					title: 'upload.png',
					preview: {
						url: '/api/media/file-upload/thumb-1/upload.png',
						width: 360,
						height: 270,
					},
					source: {
						url: '/api/media/file-upload/original-1/upload.png',
					},
				},
			],
		};

		expect(toTimelineMessage(message).attachments).toEqual([
			{
				kind: 'image',
				id: 'attachment-1',
				title: 'upload.png',
				preview: {
					url: '/api/media/file-upload/thumb-1/upload.png',
					width: 360,
					height: 270,
				},
				source: {
					url: '/api/media/file-upload/original-1/upload.png',
					width: undefined,
					height: undefined,
				},
			},
		]);
		expect(toTimelineMessage(message).submissionId).toBe('submission-1');
	});

	it('propagates actions when present on the source message', () => {
		const message: ConversationMessage = {
			...baseMessage,
			actions: { edit: true, delete: false },
		};

		expect(toTimelineMessage(message).actions).toEqual({ edit: true, delete: false });
	});

	it('sets actions to undefined when absent on the source message', () => {
		expect(toTimelineMessage(baseMessage).actions).toBeUndefined();
	});
});

describe('toCreateConversationMessageRequest', () => {
	it('forwards submission ids so the backend can reconcile canonical sends explicitly', () => {
		expect(
			toCreateConversationMessageRequest({
				submissionId: 'submission-42',
				text: 'hello world',
			}),
		).toEqual({
			submissionId: 'submission-42',
			target: {
				kind: 'conversation',
			},
			content: {
				format: 'markdown',
				text: 'hello world',
			},
		});
	});
});

describe('direct conversation adapters', () => {
	it('maps direct-conversation lookup state into frontend-local room semantics', () => {
		const lookup: DirectConversationLookup = {
			user: {
				id: 'user-1',
				username: 'alice',
				displayName: 'Alice',
				avatarUrl: '/api/media/avatar/alice',
				presence: 'online',
			},
			conversation: {
				state: 'hidden',
				conversationId: 'dm-alice',
			},
		};

		expect(toDirectConversationLookupResult(lookup)).toEqual({
			user: lookup.user,
			conversation: {
				state: 'hidden',
				roomId: 'dm-alice',
			},
		});
	});

	it('maps ensure responses into room-centric sync hints', () => {
		const result: EnsureDirectConversationResponse = {
			user: {
				id: 'user-2',
				username: 'bob',
				displayName: 'Bob',
				avatarUrl: '/api/media/avatar/bob',
				presence: 'busy',
			},
			conversationId: 'dm-bob',
			disposition: 'existing-hidden-opened',
			sync: {
				directoryVersion: 'directory-v1',
				conversationVersion: 'conversation-v1',
				timelineVersion: 'timeline-v1',
			},
		};

		expect(toEnsureDirectConversationResult(result)).toEqual({
			user: result.user,
			roomId: 'dm-bob',
			disposition: 'existing-hidden-opened',
			sync: {
				roomListVersion: 'directory-v1',
				roomVersion: 'conversation-v1',
				timelineVersion: 'timeline-v1',
				threadVersion: undefined,
			},
		});
	});
});

describe('toEditMessageResponse', () => {
	it('maps contract update response to frontend edit response', () => {
		const response: UpdateMessageResponse = {
			message: {
				id: 'msg-1',
				conversationId: 'room-1',
				authoredAt: '2026-03-27T12:00:00.000Z',
				updatedAt: '2026-03-27T12:05:00.000Z',
				author: { id: 'user-1', displayName: 'Alice', username: 'alice' },
				content: { format: 'markdown', text: '编辑后' },
				state: { edited: true, deleted: false },
				actions: { edit: true, delete: true },
			},
			sync: {
				directoryVersion: 'dir-v2',
				conversationVersion: 'conv-v2',
				timelineVersion: 'tl-v2',
			},
		};

		const result = toEditMessageResponse(response);
		expect(result.message.id).toBe('msg-1');
		expect(result.message.body.rawMarkdown).toBe('编辑后');
		expect(result.message.flags.edited).toBe(true);
		expect(result.message.actions).toEqual({ edit: true, delete: true });
		expect(result.sync.roomListVersion).toBe('dir-v2');
		expect(result.sync.timelineVersion).toBe('tl-v2');
	});
});

describe('toDeleteMessageResponse', () => {
	it('maps contract delete response to frontend delete response', () => {
		const response: DeleteMessageResponse = {
			messageId: 'msg-99',
			sync: {
				directoryVersion: 'dir-v3',
				conversationVersion: 'conv-v3',
				timelineVersion: 'tl-v3',
			},
		};

		const result = toDeleteMessageResponse(response);
		expect(result.messageId).toBe('msg-99');
		expect(result.sync.roomListVersion).toBe('dir-v3');
		expect(result.sync.timelineVersion).toBe('tl-v3');
	});
});
