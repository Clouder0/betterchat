# BetterChat Contracts v1

Date: 2026-03-25
Status: Active baseline

## Purpose

Define the first BetterChat-owned frontend/backend contracts for the initial implementation cycle.

These contracts exist so:
- frontend can build independently of raw Rocket.Chat payloads
- backend can normalize upstream behavior cleanly
- integration tests can verify one stable BetterChat surface

This is not meant to be a full long-term API design.
It is the cycle-1 contract baseline.

## Envelope rule

All JSON responses should use a stable success/error envelope.

Suggested success shape:

```ts
type ApiSuccess<T> = {
	ok: true;
	data: T;
};
```

Suggested error shape:

```ts
type ApiError = {
	ok: false;
	error: {
		code:
			| 'UNAUTHENTICATED'
			| 'UPSTREAM_UNAVAILABLE'
			| 'UPSTREAM_REJECTED'
			| 'NOT_FOUND'
			| 'VALIDATION_ERROR'
			| 'UNSUPPORTED_UPSTREAM_BEHAVIOR';
		message: string;
		details?: unknown;
	};
};
```

## Public bootstrap

Endpoint:
- `GET /api/public/bootstrap`

Purpose:
- login page bootstrap
- public server identity
- public settings
- login provider hints

Suggested shape:

```ts
type PublicBootstrap = {
	server: {
		version: string;
		siteName?: string;
	};
	session: {
		authenticated: boolean;
	};
	login: {
		passwordEnabled: boolean;
		registeredProviders: Array<{
			name: string;
			label: string;
		}>;
	};
	features: {
		registerEnabled: boolean;
	};
};
```

## Login

Endpoint:
- `POST /api/session/login`

Request:

```ts
type LoginRequest = {
	login: string; // username or email
	password: string;
	code?: string;
};
```

Response:

```ts
type LoginResponse = {
	user: SessionUser;
};
```

## Session user

```ts
type SessionUser = {
	id: string;
	username: string;
	displayName: string;
	avatarUrl?: string;
	status?: string;
};
```

## Authenticated bootstrap

Endpoint:
- `GET /api/workspace`

Purpose:
- current user
- workspace identity
- initial client capabilities

Suggested shape:

```ts
type WorkspaceBootstrap = {
	currentUser: SessionUser;
	workspace: {
		name: string;
		version: string;
	};
	capabilities: {
		canSendMessages: boolean;
		canUploadImages: boolean;
		canUploadImagesInDirectMessages?: boolean;
		realtimeEnabled: boolean;
	};
};
```

`realtimeEnabled` means the backend exposes the BetterChat realtime transport described below.
`canUploadImages` means workspace-level image upload is enabled.
`canUploadImagesInDirectMessages` distinguishes the Rocket.Chat direct-message upload switch from the workspace-wide upload switch.

## Realtime

Endpoint:
- `GET /api/realtime`

Transport:
- WebSocket upgrade
- authenticated by the BetterChat session cookie

Cycle-1 policy:
- BetterChat owns the browser-facing realtime protocol
- realtime is push-driven: the backend consumes Rocket.Chat DDP streams and emits BetterChat websocket events
- there is no internal REST polling fallback in the current design
- websocket payloads remain invalidation-first rather than patch-complete
- clients should refetch versioned HTTP snapshots on invalidate events rather than assuming websocket payload completeness

### Client commands

```ts
type RealtimeClientCommand =
	| {
			type: 'watch-room';
			roomId: string;
			roomVersion?: string;
			timelineVersion?: string;
	  }
	| {
			type: 'watch-thread';
			roomId: string;
			threadId: string;
			threadVersion?: string;
	  }
	| {
			type: 'unwatch-room';
			roomId: string;
	  }
	| {
			type: 'unwatch-thread';
			roomId: string;
			threadId: string;
	  }
	| {
			type: 'ping';
	  }
	| {
			type: 'set-typing';
			roomId: string;
			typing: boolean;
	  };
```

### Server events

```ts
type RealtimeServerEvent =
	| {
			type: 'ready';
			mode: 'push';
			pollIntervalMs: number;
	  }
	| {
			type: 'pong';
	  }
	| {
			type: 'snapshot.invalidate';
			scope: 'room-list';
			reason: 'upstream-changed';
			roomListVersion?: string;
	  }
	| {
			type: 'snapshot.invalidate';
			scope: 'room';
			roomId: string;
			reason: 'watch-started' | 'messages-changed' | 'room-state-changed' | 'room-unavailable';
			roomVersion?: string;
			timelineVersion?: string;
	  }
	| {
			type: 'snapshot.invalidate';
			scope: 'thread';
			roomId: string;
			threadId: string;
			reason: 'watch-started' | 'messages-changed' | 'room-state-changed' | 'thread-unavailable';
			threadVersion?: string;
	  }
	| {
			type: 'typing';
			roomId: string;
			participants: string[];
	  }
	| {
			type: 'session.invalidated';
	  }
	| {
			type: 'error';
			code: 'VALIDATION_ERROR' | 'UPSTREAM_UNAVAILABLE' | 'UNSUPPORTED_UPSTREAM_BEHAVIOR';
			message: string;
	  };
```

`ready` means BetterChat has authenticated its upstream realtime bridge and completed the mandatory initial user-stream subscriptions.

### Frontend handling rule

- `snapshot.invalidate` with `scope: 'room-list'` means refetch `GET /api/rooms`
- `snapshot.invalidate` with `scope: 'room'` means refetch `GET /api/rooms/:roomId` and/or `GET /api/rooms/:roomId/timeline`
- `snapshot.invalidate` with `scope: 'thread'` means refetch `GET /api/rooms/:roomId/threads/:threadId/timeline`
- `timelineVersion` is only expected when the watched room timeline itself changed; `room-state-changed` may carry only `roomVersion`
- watched thread timelines are only invalidated when the thread snapshot changed or the thread became unavailable; room-state churn alone does not fan out to thread invalidations
- live direct-message presence changes are surfaced through the same invalidation flow:
  - room-list presence dots update through `snapshot.invalidate` with `scope: 'room-list'`
  - watched DM headers update through `snapshot.invalidate` with `scope: 'room'` and reason `room-state-changed`
- a thread-only reply may still trigger both thread-scope and room-scope invalidations when the visible parent message's thread summary changes
- `watch-room` may include the client's current `roomVersion` and `timelineVersion`; if both already match, the backend may skip the initial `watch-started` invalidate
- `watch-thread` may include the client's current `threadVersion`; if it already matches, the backend may skip the initial `watch-started` invalidate
- `typing` carries the current typing-participant labels for the watched room
- `session.invalidated` means clear client auth state and return to login

## Room list

Endpoint:
- `GET /api/rooms`

Frontend rule:
- frontend groups these room summaries into Favorites / Rooms / Direct Messages
- frontend performs local jump-to-room search over this snapshot

Suggested snapshot shape:

```ts
type PresenceState = 'online' | 'away' | 'busy' | 'offline';

type RoomSummary = {
	id: string;
	kind: 'channel' | 'group' | 'dm';
	title: string;
	subtitle?: string;
	presence?: PresenceState; // direct-message peer presence only
	avatarUrl?: string;
	favorite: boolean;
	visibility: 'visible' | 'hidden';
	attention: {
		level: 'none' | 'activity' | 'unread' | 'mention';
		badgeCount?: number;
	};
	lastActivityAt?: string;
};

type RoomListSnapshot = {
	version: string;
	rooms: RoomSummary[];
};
```

## Message context

Endpoint:
- `GET /api/rooms/:roomId/messages/:messageId/context`

Query:
- `before?: number`
- `after?: number`

Rules:
- this endpoint loads a bounded room-timeline slice centered on one visible anchor message
- it is BetterChat-owned and does not expose upstream pagination details
- it is meant for jump-to-message and paginated reply navigation, not full history sync
- hidden thread-only replies are not valid room-timeline anchors here

Suggested response:

```ts
type MessageContextSnapshot = {
	version: string;
	roomId: string;
	anchorMessageId: string;
	anchorIndex: number;
	messages: TimelineMessage[];
	hasBefore: boolean;
	hasAfter: boolean;
};
```

## Room details

Endpoint:
- `GET /api/rooms/:roomId`

Purpose:
- main room metadata
- right supplemental sidebar

Rule:
- snapshot reads do not implicitly open hidden rooms

Suggested shape:

```ts
type RoomSnapshot = {
	version: string;
	room: RoomSummary & {
		topic?: string;
		description?: string;
		memberCount?: number;
		announcement?: string;
		capabilities: {
			canSendMessages: boolean;
			canUploadImages: boolean;
			canFavorite: boolean;
			canChangeVisibility: boolean;
		};
	};
};
```

`capabilities.canUploadImages` is room-scoped, so a direct message can expose `false` even when workspace-level uploads remain enabled.
`presence` is currently populated for direct messages only.

## Timeline

Endpoint:
- `GET /api/rooms/:roomId/timeline`

Query:
- `cursor?: string`
- `limit?: number`

Rules:
- `cursor` is BetterChat-owned and opaque
- the initial request with no cursor returns the newest page
- each response page remains ordered oldest -> newest
- `nextCursor` points to older history when present
- timeline reads do not implicitly open hidden rooms

Suggested response:

```ts
type RoomTimelineSnapshot = {
	version: string;
	roomId: string;
	messages: TimelineMessage[];
	nextCursor?: string;
	unreadAnchorMessageId?: string;
};
```

### Timeline message

```ts
type TimelineMessage = {
	id: string;
	roomId: string;
	createdAt: string;
	updatedAt?: string;
	author: {
		id: string;
		displayName: string;
		username?: string;
		avatarUrl?: string;
	};
	body: {
		rawMarkdown: string;
	};
	flags: {
		edited: boolean;
		deleted: boolean;
	};
	replyTo?: {
			messageId: string;
			authorName: string;
			excerpt: string;
			long: boolean;
		};
	thread?: {
			replyCount: number;
			lastReplyAt?: string;
		};
	attachments?: TimelineAttachment[];
	reactions?: TimelineReaction[];
};
```

### Attachments

Cycle-1 attachment support should focus on image rendering.

```ts
type TimelineAttachment =
		| {
				kind: 'image';
				id: string;
				url: string;
				width?: number;
				height?: number;
				title?: string;
		  };
```

### Reactions

```ts
type TimelineReaction = {
	emoji: string;
	count: number;
	reacted: boolean;
};
```

Rules:
- keep Rocket.Chat's canonical emoji key shape, for example `:smile:`
- do not expose raw upstream reaction maps to the frontend
- `reacted` is computed against the current BetterChat user

## Thread timeline

Endpoint:
- `GET /api/rooms/:roomId/threads/:threadId/timeline`

Query:
- `cursor?: string`
- `limit?: number`

Suggested response:

```ts
type ThreadTimelineSnapshot = {
	version: string;
	roomId: string;
	threadParent: TimelineMessage;
	messages: TimelineMessage[];
	nextCursor?: string;
};
```

Rules:
- the parent/root message is returned explicitly in `threadParent`
- `messages` contains thread replies only, not the parent
- page order remains oldest -> newest within the response

## Snapshot sync metadata

Mutation responses share:

```ts
type SnapshotSyncState = {
	roomListVersion?: string;
	roomVersion?: string;
	timelineVersion?: string;
	threadVersion?: string;
};
```

This lets the client refetch canonical snapshots deterministically without requiring whole sidebar or timeline payloads in every mutation response.

## Media reads

Endpoint pattern:
- `GET /api/media/*`

Purpose:
- avatar reads
- rendered image reads
- keep browser access behind BetterChat backend
- only BetterChat-approved media path shapes are allowed:
  - `/avatar/:username`
  - `/avatar/room/:roomId`
  - `/file-upload/**`

The frontend should treat returned URLs as BetterChat-owned URLs.

## Message send contract

- `POST /api/rooms/:roomId/messages`

Request:

```ts
type SendMessageRequest = {
	text: string;
	replyToMessageId?: string; // BetterChat main-timeline quote reply target
};
```

Rules:
- `replyToMessageId` means quote/main-timeline reply, not thread reply
- the sent message stays in the main room timeline
- BetterChat normalizes the quoted target back into `TimelineMessage.replyTo`

## Thread send contract

- `POST /api/rooms/:roomId/threads/:threadId/messages`

Request:

```ts
type SendThreadMessageRequest = {
	text: string;
	broadcastToRoom: boolean;
};
```

Rules:
- this is the explicit BetterChat-owned way to send into a thread
- `broadcastToRoom` maps to Rocket.Chat's `tshow` behavior and must be chosen explicitly
- the response shape matches `SendMessageResponse`

Response:

```ts
type SendMessageResponse = {
	message: TimelineMessage;
	sync?: SnapshotSyncState;
};
```

## Image upload contract

- `POST /api/rooms/:roomId/images`

Request:
- `multipart/form-data`
- exactly one `file` field
- optional `text` field for the image caption/body text

Rules:
- BetterChat validates this endpoint as image-only
- BetterChat spools accepted multipart file bodies to temporary storage before forwarding them upstream, then cleans those temp artifacts after the request completes
- the response shape matches `SendMessageResponse`
- clients should use the returned normalized attachment URLs as BetterChat-owned media URLs

## Thread image upload contract

- `POST /api/rooms/:roomId/threads/:threadId/images`

Request:
- `multipart/form-data`
- exactly one `file` field
- optional `text` field for the image caption/body text

Rules:
- BetterChat validates this endpoint as image-only
- BetterChat spools accepted multipart file bodies to temporary storage before forwarding them upstream, then cleans those temp artifacts after the request completes
- the created message is a thread reply
- the response shape matches `SendMessageResponse`
- the current cycle-1 contract is thread-only: Rocket.Chat `7.6.0` public upload APIs do not expose a clean broadcast-to-room control for image uploads, so `broadcastToRoom: true` is rejected explicitly rather than silently ignored

## Room state mutations

### Visibility

Endpoints:
- `POST /api/rooms/:roomId/open`
- `POST /api/rooms/:roomId/hide`

Request:
- no request body is required

Response:

```ts
type RoomVisibilityMutationResponse = {
	roomId: string;
	open: boolean;
	sync: SnapshotSyncState;
};
```

Rules:
- these endpoints are the explicit BetterChat-owned way to change room open/hidden state
- BetterChat keeps them idempotent at the compatibility layer
- `sync.sidebarVersion` is always expected; `roomVersion` and `timelineVersion` may also be returned when BetterChat refreshes those snapshots

### Favorite

Endpoint:
- `POST /api/rooms/:roomId/favorite`

Request:

```ts
type SetRoomFavoriteRequest = {
	favorite: boolean;
};
```

Response:

```ts
type RoomFavoriteMutationResponse = {
	roomId: string;
	favorite: boolean;
	sync: SnapshotSyncState;
};
```

### Read

Endpoint:
- `POST /api/rooms/:roomId/read`

Request:

```ts
type SetRoomReadRequest = {
	readThreads?: boolean;
};
```

Response:

```ts
type RoomReadStateMutationResponse = {
	roomId: string;
	unread: boolean;
	unreadFromMessageId?: string;
	sync: SnapshotSyncState;
};
```

### Unread

Endpoint:
- `POST /api/rooms/:roomId/unread`

Request:

```ts
type SetRoomUnreadRequest = {
	firstUnreadMessageId?: string;
};
```

Response:
- same shape as `RoomReadStateMutationResponse`

## Message mutations

### Edit

Endpoint:
- `PATCH /api/rooms/:roomId/messages/:messageId`

Request:

```ts
type UpdateMessageRequest = {
	text: string;
};
```

Response:

```ts
type UpdateMessageResponse = {
	message: TimelineMessage;
	sync: SnapshotSyncState;
};
```

### Delete

Endpoint:
- `DELETE /api/rooms/:roomId/messages/:messageId`

Response:

```ts
type DeleteMessageResponse = {
	messageId: string;
	sync: SnapshotSyncState;
};
```

### Reactions

Endpoint:
- `POST /api/rooms/:roomId/messages/:messageId/reactions`

Request:

```ts
type SetReactionRequest = {
	emoji: string;
	shouldReact?: boolean;
};
```

Response:

```ts
type SetReactionResponse = {
	messageId: string;
	reactions?: TimelineReaction[];
	sync: SnapshotSyncState;
};
```

## Search rule

There is no dedicated backend room-search endpoint in cycle 1.

Jump-to-room search should operate over `SidebarEntry[]` in the frontend.
That keeps the first cycle simpler and still supports the required UX.

## Contract discipline

Rules:
- frontend and backend both read from this spec
- backend normalization should target these shapes
- frontend fixtures should also target these shapes
- if a shape must change, update this file first
