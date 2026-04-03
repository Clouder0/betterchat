import type {
	ConversationAttachment,
	ConversationKind,
	ConversationMessage,
	ConversationMessageContextSnapshot,
	ConversationSnapshot,
	ConversationTimelineSnapshot,
	CreateConversationMessageRequest,
	CreateConversationMessageResponse,
	DeleteMessageResponse as ContractDeleteMessageResponse,
	DirectoryEntry,
	DirectorySnapshot,
	DirectConversationLookup as ContractDirectConversationLookup,
	EnsureDirectConversationResponse as ContractEnsureDirectConversationResponse,
	MembershipCommandResponse,
	MembershipInbox,
	MembershipListing,
	SnapshotSyncState as ContractSnapshotSyncState,
	UpdateMessageResponse as ContractUpdateMessageResponse,
	UserSummary,
} from '@betterchat/contracts';

import type {
	ChatUserSummary,
	DeleteMessageResponse,
	DirectConversationLookupResult,
	EditMessageResponse,
	EnsureDirectConversationResult,
	MessageContextSnapshot,
	RoomAttention,
	RoomKind,
	RoomListSnapshot,
	RoomSnapshot,
	RoomSummary,
	RoomTimelineSnapshot,
	RoomVisibility,
	SendMessageRequest,
	SendMessageResponse,
	SnapshotSyncState,
	TimelineAttachment,
	TimelineMessage,
} from './chatModels';

const toRoomKind = (kind: ConversationKind): RoomKind => {
	if (kind.mode === 'direct') {
		return 'dm';
	}

	return kind.privacy === 'public' ? 'channel' : 'group';
};

const toRoomVisibility = (listing: MembershipListing): RoomVisibility => (listing === 'listed' ? 'visible' : 'hidden');

const toRoomAttention = (inbox: MembershipInbox): RoomAttention => {
	if (inbox.mentionCount > 0) {
		return {
			level: 'mention',
			...(inbox.unreadMessages > 0 ? { badgeCount: inbox.unreadMessages } : {}),
		};
	}

	if (inbox.unreadMessages > 0) {
		return {
			level: 'unread',
			badgeCount: inbox.unreadMessages,
		};
	}

	if (inbox.hasThreadActivity || inbox.hasUncountedActivity) {
		return {
			level: 'activity',
		};
	}

	return {
		level: 'none',
	};
};

const USERNAME_LIKE_HANDLE_PATTERN = /^[a-z0-9._-]+$/iu;

const toHandleSubtitle = (handle: string | undefined) => {
	const normalizedHandle = handle?.trim();
	if (!normalizedHandle) {
		return undefined;
	}

	if (normalizedHandle.startsWith('@') || normalizedHandle.startsWith('#')) {
		return normalizedHandle;
	}

	return USERNAME_LIKE_HANDLE_PATTERN.test(normalizedHandle) ? `@${normalizedHandle}` : normalizedHandle;
};

const toChatUserSummary = (user: UserSummary): ChatUserSummary => ({
	id: user.id,
	username: user.username,
	displayName: user.displayName,
	avatarUrl: user.avatarUrl,
	presence: user.presence,
});

const toTimelineAttachment = (attachment: ConversationAttachment): TimelineAttachment => ({
	kind: 'image',
	id: attachment.id,
	title: attachment.title,
	preview: {
		url: attachment.preview.url,
		width: attachment.preview.width,
		height: attachment.preview.height,
	},
	source: {
		url: attachment.source.url,
		width: attachment.source.width,
		height: attachment.source.height,
	},
});

export const toTimelineMessage = (message: ConversationMessage): TimelineMessage => ({
	id: message.id,
	...(message.submissionId ? { submissionId: message.submissionId } : {}),
	roomId: message.conversationId,
	createdAt: message.authoredAt,
	updatedAt: message.updatedAt,
	author: {
		id: message.author.id,
		username: message.author.username,
		displayName: message.author.displayName,
		avatarUrl: message.author.avatarUrl,
	},
	body: {
		rawMarkdown: message.content.text,
	},
	flags: {
		edited: message.state.edited,
		deleted: message.state.deleted,
	},
	replyTo: message.replyTo
		? {
				messageId: message.replyTo.messageId,
				authorName: message.replyTo.authorName,
				excerpt: message.replyTo.excerpt,
				long: message.replyTo.long,
		  }
		: undefined,
	thread: message.thread
		? {
				rootMessageId: message.thread.rootMessageId,
				replyCount: message.thread.replyCount,
				lastReplyAt: message.thread.lastReplyAt,
		  }
		: undefined,
	attachments: message.attachments?.map(toTimelineAttachment),
	reactions: message.reactions,
	actions: message.actions ? { edit: message.actions.edit, delete: message.actions.delete } : undefined,
});

export const toRoomSummary = (entry: DirectoryEntry): RoomSummary => ({
	id: entry.conversation.id,
	kind: toRoomKind(entry.conversation.kind),
	title: entry.conversation.title,
	subtitle: toHandleSubtitle(entry.conversation.handle),
	presence: entry.live?.counterpartPresence,
	avatarUrl: entry.conversation.avatarUrl,
	favorite: entry.membership.starred,
	visibility: toRoomVisibility(entry.membership.listing),
	attention: toRoomAttention(entry.membership.inbox),
	lastActivityAt: entry.conversation.lastActivityAt,
});

export const toRoomListSnapshot = (snapshot: DirectorySnapshot): RoomListSnapshot => ({
	version: snapshot.version,
	rooms: snapshot.entries.map(toRoomSummary),
});

export const toRoomSnapshot = (snapshot: ConversationSnapshot): RoomSnapshot => ({
	version: snapshot.version,
	room: {
		id: snapshot.conversation.id,
		kind: toRoomKind(snapshot.conversation.kind),
		title: snapshot.conversation.title,
		subtitle: toHandleSubtitle(snapshot.conversation.handle),
		presence: snapshot.live?.counterpartPresence,
		avatarUrl: snapshot.conversation.avatarUrl,
		favorite: snapshot.membership.starred,
		visibility: toRoomVisibility(snapshot.membership.listing),
		attention: toRoomAttention(snapshot.membership.inbox),
		lastActivityAt: snapshot.conversation.lastActivityAt,
		topic: snapshot.conversation.topic,
		description: snapshot.conversation.description,
		memberCount: snapshot.conversation.memberCount,
		announcement: snapshot.conversation.announcement,
		capabilities: {
			canSendMessages: snapshot.capabilities.messageMutations.conversation,
			canUploadImages: snapshot.capabilities.mediaMutations.conversation,
			canFavorite: snapshot.capabilities.star,
			canChangeVisibility: snapshot.capabilities.hide,
		},
	},
});

export const toRoomTimelineSnapshot = (snapshot: ConversationTimelineSnapshot): RoomTimelineSnapshot => ({
	version: snapshot.version,
	roomId: snapshot.scope.conversationId,
	messages: snapshot.messages.map(toTimelineMessage),
	nextCursor: snapshot.nextCursor,
	unreadAnchorMessageId: snapshot.unreadAnchorMessageId,
});

export const toMessageContextSnapshot = (snapshot: ConversationMessageContextSnapshot): MessageContextSnapshot => ({
	version: snapshot.version,
	roomId: snapshot.conversationId,
	anchorMessageId: snapshot.anchorMessageId,
	anchorIndex: snapshot.anchorIndex,
	messages: snapshot.messages.map(toTimelineMessage),
	hasBefore: snapshot.hasBefore,
	hasAfter: snapshot.hasAfter,
});

export const toSendMessageResponse = (response: CreateConversationMessageResponse): SendMessageResponse => ({
	message: toTimelineMessage(response.message),
});

export const toEditMessageResponse = (response: ContractUpdateMessageResponse): EditMessageResponse => ({
	message: toTimelineMessage(response.message),
	sync: toContractSyncState(response.sync),
});

export const toDeleteMessageResponse = (response: ContractDeleteMessageResponse): DeleteMessageResponse => ({
	messageId: response.messageId,
	sync: toContractSyncState(response.sync),
});

export const toCreateConversationMessageRequest = (request: SendMessageRequest): CreateConversationMessageRequest => ({
	...(request.submissionId ? { submissionId: request.submissionId } : {}),
	target: {
		kind: 'conversation',
		...(request.replyToMessageId ? { replyToMessageId: request.replyToMessageId } : {}),
	},
	content: {
		format: 'markdown',
		text: request.text,
	},
});

export const toContractSyncState = (sync: ContractSnapshotSyncState | undefined): SnapshotSyncState => ({
	roomListVersion: sync?.directoryVersion,
	roomVersion: sync?.conversationVersion,
	timelineVersion: sync?.timelineVersion,
	threadVersion: sync?.threadVersion,
});

export const toFavoriteMutationResponse = ({
	favorite,
	response,
	roomId,
}: {
	favorite: boolean;
	response: MembershipCommandResponse;
	roomId: string;
}) => ({
	roomId,
	favorite,
	sync: toContractSyncState(response.sync),
});

export const toVisibilityMutationResponse = ({
	roomId,
	response,
	visibility,
}: {
	roomId: string;
	response: MembershipCommandResponse;
	visibility: RoomVisibility;
}) => ({
	roomId,
	visibility,
	sync: toContractSyncState(response.sync),
});

export const toReadStateMutationResponse = ({
	roomId,
	response,
}: {
	roomId: string;
	response: MembershipCommandResponse;
}) => ({
	roomId,
	sync: toContractSyncState(response.sync),
});

export const toDirectConversationLookupResult = (result: ContractDirectConversationLookup): DirectConversationLookupResult => ({
	user: toChatUserSummary(result.user),
	conversation:
		result.conversation.state === 'none'
			? {
					state: 'none',
			  }
			: {
					state: toRoomVisibility(result.conversation.state),
					roomId: result.conversation.conversationId,
			  },
});

export const toEnsureDirectConversationResult = (
	result: ContractEnsureDirectConversationResponse,
): EnsureDirectConversationResult => ({
	user: toChatUserSummary(result.user),
	roomId: result.conversationId,
	disposition: result.disposition,
	sync: toContractSyncState(result.sync),
});
