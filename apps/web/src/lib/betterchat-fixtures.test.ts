import { beforeEach, describe, expect, it } from 'bun:test';

import { betterChatApi } from './betterchat';
import { fixtureBetterChatService } from './betterchat-fixtures';

const fixtureLogin = {
	login: 'linche',
	password: 'demo',
};

beforeEach(() => {
	fixtureBetterChatService.clearSession();
});

describe('fixtureBetterChatService', () => {
	it('emits canonical directory snapshots with conversation and membership split', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const directory = await fixtureBetterChatService.directory();
		const ops = directory.entries.find((entry) => entry.conversation.id === 'ops-handoff');
		const mia = directory.entries.find((entry) => entry.conversation.id === 'dm-mia');

		expect(directory.version).toStartWith('fixture-');
		expect(ops).toEqual(
			expect.objectContaining({
				conversation: expect.objectContaining({
					id: 'ops-handoff',
					title: '运营协调',
				}),
				membership: expect.objectContaining({
					listing: 'listed',
					starred: true,
					inbox: expect.objectContaining({
						unreadMessages: 4,
						mentionCount: 1,
					}),
				}),
			}),
		);
		expect(ops?.live).toBeUndefined();
		expect(mia?.live?.counterpartPresence).toBe('away');
		expect(mia?.membership.inbox.unreadMessages).toBe(1);
	});

	it('creates canonical reply messages and clears its own unread state', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const response = await fixtureBetterChatService.createConversationMessage('ops-handoff', {
			target: {
				kind: 'conversation',
				replyToMessageId: 'ops-004',
			},
			content: {
				format: 'markdown',
				text: '新的回复消息',
			},
		});

		expect(response.message).toEqual(
			expect.objectContaining({
				conversationId: 'ops-handoff',
				content: {
					format: 'markdown',
					text: '新的回复消息',
				},
				replyTo: expect.objectContaining({
					messageId: 'ops-004',
					authorName: '周岚',
				}),
			}),
		);

		const conversation = await fixtureBetterChatService.conversation('ops-handoff');
		const timeline = await fixtureBetterChatService.conversationTimeline('ops-handoff');

		expect(conversation.membership.inbox.unreadMessages).toBe(0);
		expect(conversation.membership.inbox.mentionCount).toBe(0);
		expect(timeline.unreadAnchorMessageId).toBeUndefined();
		expect(timeline.messages.at(-1)?.id).toBe(response.message.id);
	});

	it('reuses submission ids for canonical fixture text sends so optimistic reconciliation stays deterministic', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const response = await fixtureBetterChatService.createConversationMessage('ops-handoff', {
			submissionId: 'submission-fixture-1',
			target: {
				kind: 'conversation',
			},
			content: {
				format: 'markdown',
				text: 'submission fixture',
			},
		});

		expect(response.message.id).toBe('submission-fixture-1');
		expect(response.message.submissionId).toBe('submission-fixture-1');

		const timeline = await fixtureBetterChatService.conversationTimeline('ops-handoff');
		expect(timeline.messages.at(-1)?.id).toBe('submission-fixture-1');
		expect(timeline.messages.at(-1)?.submissionId).toBe('submission-fixture-1');
	});

	it('reuses submission ids for canonical fixture image uploads so optimistic retries stay deterministic', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const response = await fixtureBetterChatService.uploadConversationMedia('ops-handoff', {
			file: new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'fixture-upload.png', {
				type: 'image/png',
			}),
			submissionId: 'submission-fixture-image-1',
			text: 'fixture image upload',
		});

		expect(response.message.id).toBe('submission-fixture-image-1');
		expect(response.message.submissionId).toBe('submission-fixture-image-1');

		const timeline = await fixtureBetterChatService.conversationTimeline('ops-handoff');
		expect(timeline.messages.at(-1)?.id).toBe('submission-fixture-image-1');
		expect(timeline.messages.at(-1)?.submissionId).toBe('submission-fixture-image-1');
	});

	it('applies membership commands against canonical inbox state', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const mutation = await fixtureBetterChatService.membershipCommand('platform-duty', {
			type: 'mark-unread',
			fromMessageId: 'platform-003',
		});

		const conversation = await fixtureBetterChatService.conversation('platform-duty');
		const timeline = await fixtureBetterChatService.conversationTimeline('platform-duty');

		expect(mutation.sync.directoryVersion).toStartWith('fixture-');
		expect(mutation.sync.conversationVersion).toStartWith('fixture-');
		expect(mutation.sync.timelineVersion).toStartWith('fixture-');
		expect(conversation.membership.inbox.unreadMessages).toBe(1);
		expect(timeline.unreadAnchorMessageId).toBe('platform-003');
	});

	it('paginates long timelines and exposes older history cursors', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const firstPage = await fixtureBetterChatService.conversationTimeline('history-archive');
		expect(firstPage.messages).toHaveLength(50);
		expect(firstPage.messages[0]?.id).toBe('history-061');
		expect(firstPage.messages.at(-1)?.id).toBe('history-110');
		expect(firstPage.nextCursor).toBeTruthy();

		const secondPage = await fixtureBetterChatService.conversationTimeline('history-archive', {
			cursor: firstPage.nextCursor,
		});
		expect(secondPage.messages).toHaveLength(50);
		expect(secondPage.messages[0]?.id).toBe('history-011');
		expect(secondPage.messages.at(-1)?.id).toBe('history-060');
		expect(secondPage.nextCursor).toBeTruthy();

		const finalPage = await fixtureBetterChatService.conversationTimeline('history-archive', {
			cursor: secondPage.nextCursor,
		});
		expect(finalPage.messages).toHaveLength(10);
		expect(finalPage.messages[0]?.id).toBe('history-001');
		expect(finalPage.messages.at(-1)?.id).toBe('history-010');
		expect(finalPage.nextCursor).toBeUndefined();
	});

	it('keeps the unread anchor inside the initial fixture timeline page even when it is older than the default latest slice', async () => {
		await fixtureBetterChatService.login(fixtureLogin);
		await fixtureBetterChatService.membershipCommand('history-archive', {
			type: 'mark-unread',
			fromMessageId: 'history-020',
		});

		const timeline = await fixtureBetterChatService.conversationTimeline('history-archive');
		expect(timeline.unreadAnchorMessageId).toBe('history-020');
		expect(timeline.messages[0]?.id).toBe('history-020');
		expect(timeline.messages.at(-1)?.id).toBe('history-110');
		expect(timeline.nextCursor).toBeTruthy();
	});

	it('looks up an existing direct conversation for known group participants', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const result = await fixtureBetterChatService.lookupDirectConversation('user-zhou');
		expect(result).toEqual({
			user: {
				id: 'user-zhoulan',
				username: 'zhoulan',
				displayName: '周岚',
				avatarUrl: '/api/media/avatar/zhoulan',
				presence: 'online',
			},
			conversation: {
				state: 'listed',
				conversationId: 'dm-zhoulan',
			},
		});
	});

	it('creates a new direct conversation and inserts it into the directory when none exists', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const created = await fixtureBetterChatService.ensureDirectConversation('user-ouyang');
		expect(created.conversationId).toBe('dm-mingyuan');
		expect(created.disposition).toBe('created');

		const lookup = await fixtureBetterChatService.lookupDirectConversation('user-ouyang');
		expect(lookup.conversation).toEqual({
			state: 'listed',
			conversationId: 'dm-mingyuan',
		});

		const directory = await fixtureBetterChatService.directory();
		expect(directory.entries.some((entry) => entry.conversation.id === 'dm-mingyuan')).toBe(true);

		const participants = await fixtureBetterChatService.conversationParticipants('dm-mingyuan');
		expect(participants.entries.map((entry) => entry.user.id)).toEqual(['user-linche', 'user-ouyang']);
	});

	it('reopens a hidden direct conversation instead of fabricating a new one', async () => {
		await fixtureBetterChatService.login(fixtureLogin);
		await fixtureBetterChatService.membershipCommand('dm-mia', {
			type: 'set-listing',
			value: 'hidden',
		});

		const ensured = await fixtureBetterChatService.ensureDirectConversation('user-mia');
		expect(ensured.disposition).toBe('existing-hidden-opened');
		expect(ensured.conversationId).toBe('dm-mia');

		const conversation = await fixtureBetterChatService.conversation('dm-mia');
		expect(conversation.membership.listing).toBe('listed');
	});

	it('serves authoritative room participants plus backend-owned mention candidates in fixture mode', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const participants = await fixtureBetterChatService.conversationParticipants('compat-lab', {
			query: '周',
		});
		expect(participants.entries.map((entry) => entry.user.username)).toEqual(['zhoulan']);

		const publicCandidates = await fixtureBetterChatService.conversationMentionCandidates('compat-lab', {
			query: '',
		});
		expect(publicCandidates.entries.some((entry) => entry.kind === 'special' && entry.key === 'all')).toBe(true);
		expect(publicCandidates.entries.some((entry) => entry.kind === 'special' && entry.key === 'here')).toBe(true);

		const directCandidates = await fixtureBetterChatService.conversationMentionCandidates('dm-mia', {
			query: '',
		});
		expect(directCandidates.entries.some((entry) => entry.kind === 'special')).toBe(false);
	});

	it('edits own message text and marks state as edited', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const created = await fixtureBetterChatService.createConversationMessage('ops-handoff', {
			target: { kind: 'conversation' },
			content: { format: 'markdown', text: '原始消息' },
		});

		const updated = await fixtureBetterChatService.updateMessage('ops-handoff', created.message.id, {
			text: '编辑后的消息',
		});

		expect(updated.message.content.text).toBe('编辑后的消息');
		expect(updated.message.state.edited).toBe(true);
		expect(updated.message.updatedAt).toBeTruthy();
		expect(updated.sync.timelineVersion).toStartWith('fixture-');

		const timeline = await fixtureBetterChatService.conversationTimeline('ops-handoff');
		const editedMessage = timeline.messages.find((m) => m.id === created.message.id);
		expect(editedMessage?.content.text).toBe('编辑后的消息');
		expect(editedMessage?.state.edited).toBe(true);
	});

	it('rejects editing a non-existent message', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		await expect(
			fixtureBetterChatService.updateMessage('ops-handoff', 'nonexistent-msg', { text: '不存在' }),
		).rejects.toEqual(expect.objectContaining({ code: 'NOT_FOUND' }));
	});

	it('rejects editing with empty text', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const created = await fixtureBetterChatService.createConversationMessage('ops-handoff', {
			target: { kind: 'conversation' },
			content: { format: 'markdown', text: '原始消息' },
		});

		await expect(
			fixtureBetterChatService.updateMessage('ops-handoff', created.message.id, { text: '   ' }),
		).rejects.toEqual(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
	});

	it('deletes own message and marks state as deleted', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const created = await fixtureBetterChatService.createConversationMessage('ops-handoff', {
			target: { kind: 'conversation' },
			content: { format: 'markdown', text: '待删消息' },
		});

		const deleted = await fixtureBetterChatService.deleteMessage('ops-handoff', created.message.id);

		expect(deleted.messageId).toBe(created.message.id);
		expect(deleted.sync.timelineVersion).toStartWith('fixture-');

		const timeline = await fixtureBetterChatService.conversationTimeline('ops-handoff');
		const deletedMessage = timeline.messages.find((m) => m.id === created.message.id);
		expect(deletedMessage?.state.deleted).toBe(true);
		expect(deletedMessage?.content.text).toBe('');
	});

	it('rejects deleting a non-existent message', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		await expect(
			fixtureBetterChatService.deleteMessage('ops-handoff', 'nonexistent-msg'),
		).rejects.toEqual(expect.objectContaining({ code: 'NOT_FOUND' }));
	});

	it('stamps actions on own messages as editable and deletable', async () => {
		await fixtureBetterChatService.login(fixtureLogin);

		const created = await fixtureBetterChatService.createConversationMessage('ops-handoff', {
			target: { kind: 'conversation' },
			content: { format: 'markdown', text: 'action test' },
		});

		expect(created.message.actions).toEqual({ edit: true, delete: true });

		const timeline = await fixtureBetterChatService.conversationTimeline('ops-handoff');
		const ownMessage = timeline.messages.find((m) => m.id === created.message.id);
		expect(ownMessage?.actions).toEqual({ edit: true, delete: true });

		// Other users' messages should not be editable/deletable
		const otherMessage = timeline.messages.find((m) => m.author.id !== 'user-linche');
		if (otherMessage) {
			expect(otherMessage.actions).toEqual({ edit: false, delete: false });
		}
	});
});

describe('betterChatApi fixture mode', () => {
	it('maps canonical fixture snapshots through the shared room adapters', async () => {
		await betterChatApi.login(fixtureLogin);

		const roomList = await betterChatApi.roomList();
		const ops = roomList.rooms.find((room) => room.id === 'ops-handoff');
		const mia = roomList.rooms.find((room) => room.id === 'dm-mia');

		expect(ops?.attention).toEqual({
			level: 'mention',
			badgeCount: 4,
		});
		expect(mia?.presence).toBe('away');
		expect(mia?.visibility).toBe('visible');
		expect(mia?.favorite).toBe(true);
	});

	it('projects readonly room capabilities through the shared room adapter', async () => {
		await betterChatApi.login(fixtureLogin);

		const room = await betterChatApi.room('readonly-updates');
		expect(room.room.capabilities.canSendMessages).toBe(false);
		expect(room.room.capabilities.canUploadImages).toBe(false);
	});

	it('uses backend-style room mention candidates instead of timeline authors in fixture mode', async () => {
		await betterChatApi.login(fixtureLogin);

		const candidates = await betterChatApi.roomMentionCandidates('compat-lab', {
			query: '周',
		});
		expect(candidates.conversationId).toBe('compat-lab');
		expect(candidates.query).toBe('周');
		expect(candidates.entries).toEqual([
			{
				insertText: '@zhoulan',
				kind: 'user',
				user: {
					avatarUrl: '/api/media/avatar/zhoulan',
					displayName: '周岚',
					id: 'user-zhoulan',
					presence: 'online',
					username: 'zhoulan',
				},
			},
		]);
	});

	it('maps direct conversation lookup and ensure through the shared adapter layer', async () => {
		await betterChatApi.login(fixtureLogin);

		const existing = await betterChatApi.directConversationLookup('user-mia');
		expect(existing.conversation).toEqual({
			state: 'visible',
			roomId: 'dm-mia',
		});

		const created = await betterChatApi.ensureDirectConversation('user-ouyang');
		expect(created.roomId).toBe('dm-mingyuan');
		expect(created.disposition).toBe('created');
		expect(created.sync.roomListVersion).toStartWith('fixture-');
	});
});
