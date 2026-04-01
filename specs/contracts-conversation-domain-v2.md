# BetterChat Contracts Conversation Domain v2

Date: 2026-03-27
Status: Canonical backend/frontend target

## Purpose

Define the clean BetterChat-owned conversation-domain contracts.

This replaces the earlier room/sidebar-shaped model as the canonical design.
Rocket.Chat is one upstream adapter behind this surface.

## Core model

The public split is:

- `conversation`: shared object
- `membership`: current-user relationship to that conversation
- `directory`: the current user’s ordered conversation index
- `timeline`: ordered message history for either a conversation or a thread
- `live`: ephemeral presence/typing state

Important rule:

- do not collapse `conversation` and `membership` into one object again

## Authenticated bootstrap

Endpoint:

- `GET /api/workspace`

Purpose:

- current user
- workspace identity
- workspace-level capabilities

## Canonical HTTP surface

- `GET /api/public/bootstrap`
- `POST /api/session/login`
- `POST /api/session/logout`
- `GET /api/workspace`
- `GET /api/directory`
- `GET /api/conversations/:conversationId`
- `GET /api/conversations/:conversationId/timeline`
- `GET /api/conversations/:conversationId/messages/:messageId/context`
- `GET /api/conversations/:conversationId/threads/:threadId/timeline`
- `POST /api/conversations/:conversationId/messages`
- `POST /api/conversations/:conversationId/media`
- `POST /api/conversations/:conversationId/membership/commands`
- `GET /api/stream`
- `GET /api/media/*`

## Attention semantics

`membership.attention` is:

- `none`
- `activity`
- `unread`
- `mention`

Rules:

- `count` is only present when the backend has a trustworthy numeric value
- Rocket.Chat alert-only rooms stay `activity` without a fabricated count
- frontend must not invent numeric unread counts when the backend omitted them

## Message creation semantics

`POST /api/conversations/:conversationId/messages` supports:

- main timeline message
- inline reply in main timeline
- thread reply
- thread reply echoed to main timeline

Uploads use the same target semantics through `POST /api/conversations/:conversationId/media`.

## Membership command plane

`POST /api/conversations/:conversationId/membership/commands`

Supported commands:

- `set-starred`
- `set-listing`
- `mark-read`
- `mark-unread`

## Stream

Endpoint:

- `GET /api/stream`

Transport:

- WebSocket
- authenticated by BetterChat session cookie

Stream principle:

- HTTP stays the snapshot and mutation plane
- websocket carries semantic resync/update events
- BetterChat owns the browser-facing protocol

### Client commands

```ts
type ConversationStreamClientCommand =
	| {
			type: 'watch-directory';
			directoryVersion?: string;
	  }
	| {
			type: 'unwatch-directory';
	  }
	| {
			type: 'watch-conversation';
			conversationId: string;
			conversationVersion?: string;
			timelineVersion?: string;
	  }
	| {
			type: 'unwatch-conversation';
			conversationId: string;
	  }
	| {
			type: 'watch-thread';
			conversationId: string;
			threadId: string;
			threadVersion?: string;
	  }
	| {
			type: 'unwatch-thread';
			conversationId: string;
			threadId: string;
	  }
	| {
			type: 'ping';
	  }
	| {
			type: 'set-typing';
			conversationId: string;
			typing: boolean;
	  };
```

### Server events

```ts
type ConversationStreamServerEvent =
	| {
			type: 'ready';
			mode: 'push';
			protocol: 'conversation-stream.v1';
	  }
	| {
			type: 'pong';
	  }
	| {
			type: 'directory.resynced';
			snapshot: DirectorySnapshot;
	  }
	| {
			type: 'conversation.resynced';
			snapshot: ConversationSnapshot;
	  }
	| {
			type: 'conversation.updated';
			snapshot: ConversationSnapshot;
	  }
	| {
			type: 'timeline.resynced';
			snapshot: ConversationTimelineSnapshot;
	  }
	| {
			type: 'thread.resynced';
			snapshot: ConversationTimelineSnapshot;
	  }
	| {
			type: 'presence.updated';
			conversationId: string;
			presence: PresenceState;
	  }
	| {
			type: 'typing.updated';
			conversationId: string;
			participants: string[];
	  }
	| {
			type: 'resync.required';
			scope: 'directory' | 'conversation' | 'thread';
			conversationId?: string;
			threadId?: string;
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

## Frontend handling rules

- fetch `GET /api/directory` first, then `watch-directory`
- fetch `GET /api/conversations/:conversationId` and timeline first, then `watch-conversation`
- fetch thread timeline first, then `watch-thread`
- `directory.resynced` replaces any older local directory snapshot
- `conversation.updated` replaces the current conversation snapshot
- `timeline.resynced` and `thread.resynced` replace the corresponding local timeline snapshot
- `presence.updated` and `typing.updated` are ephemeral live-state updates
- `resync.required` means refetch the relevant HTTP snapshot and reconcile from there
