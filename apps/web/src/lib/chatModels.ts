import type { PresenceState, SessionUser } from '@betterchat/contracts';

export type { PresenceState, SessionUser };

export type RoomKind = 'channel' | 'group' | 'dm';
export type RoomVisibility = 'visible' | 'hidden';
export type RoomAttentionLevel = 'mention' | 'unread' | 'activity' | 'none';

export type RoomAttention = {
	level: RoomAttentionLevel;
	badgeCount?: number;
};

export type RoomSummary = {
	id: string;
	kind: RoomKind;
	title: string;
	subtitle?: string;
	presence?: PresenceState;
	avatarUrl?: string;
	favorite: boolean;
	visibility: RoomVisibility;
	attention: RoomAttention;
	lastActivityAt?: string;
};

export type RoomListSnapshot = {
	version: string;
	rooms: RoomSummary[];
};

export type RoomCapabilities = {
	canSendMessages: boolean;
	canUploadImages: boolean;
	canFavorite: boolean;
	canChangeVisibility: boolean;
};

export type RoomSnapshot = {
	version: string;
	room: RoomSummary & {
		topic?: string;
		description?: string;
		memberCount?: number;
		announcement?: string;
		capabilities: RoomCapabilities;
	};
};

export type TimelineAttachment =
	| {
			kind: 'image';
			id: string;
			title?: string;
			preview: {
				url: string;
				width?: number;
				height?: number;
			};
			source: {
				url: string;
				width?: number;
				height?: number;
			};
	  };

export type TimelineReplyPreview = {
	messageId: string;
	authorName: string;
	excerpt: string;
	long: boolean;
};

export type TimelineReaction = {
	emoji: string;
	count: number;
	reacted: boolean;
};

export type TimelineMessage = {
	id: string;
	roomId: string;
	createdAt: string;
	updatedAt?: string;
	author: {
		id: string;
		username?: string;
		displayName: string;
		avatarUrl?: string;
	};
	body: {
		rawMarkdown: string;
	};
	flags: {
		edited: boolean;
		deleted: boolean;
	};
	replyTo?: TimelineReplyPreview;
	thread?: {
		rootMessageId?: string;
		replyCount: number;
		lastReplyAt?: string;
	};
	attachments?: TimelineAttachment[];
	reactions?: TimelineReaction[];
};

export type RoomTimelineSnapshot = {
	version: string;
	roomId: string;
	messages: TimelineMessage[];
	nextCursor?: string;
	unreadAnchorMessageId?: string;
};

export type MessageContextSnapshot = {
	version: string;
	roomId: string;
	anchorMessageId: string;
	anchorIndex: number;
	messages: TimelineMessage[];
	hasBefore: boolean;
	hasAfter: boolean;
};

export type SendMessageRequest = {
	text: string;
	replyToMessageId?: string;
};

export type SendMessageResponse = {
	message: TimelineMessage;
};

export type SetRoomFavoriteRequest = {
	favorite: boolean;
};

export type SetRoomReadStateRequest =
	| {
			state: 'read';
	  }
	| {
			state: 'unread';
			firstUnreadMessageId?: string;
	  };

export type SetRoomVisibilityRequest = {
	visibility: RoomVisibility;
};

export type SnapshotSyncState = {
	roomListVersion?: string;
	roomVersion?: string;
	timelineVersion?: string;
	threadVersion?: string;
};

export type RoomFavoriteMutationResponse = {
	roomId: string;
	favorite: boolean;
	sync: SnapshotSyncState;
};

export type RoomReadStateMutationResponse = {
	roomId: string;
	sync: SnapshotSyncState;
};

export type RoomVisibilityMutationResponse = {
	roomId: string;
	visibility: RoomVisibility;
	sync: SnapshotSyncState;
};

export type ChatUserSummary = {
	id: string;
	username?: string;
	displayName: string;
	avatarUrl?: string;
	presence?: PresenceState;
};

export type DirectConversationLookupResult = {
	user: ChatUserSummary;
	conversation:
		| {
				state: 'none';
		  }
		| {
				state: RoomVisibility;
				roomId: string;
		  };
};

export type EnsureDirectConversationResult = {
	user: ChatUserSummary;
	roomId: string;
	disposition: 'existing-listed' | 'existing-hidden-opened' | 'created';
	sync: SnapshotSyncState;
};
