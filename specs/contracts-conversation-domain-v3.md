# BetterChat Contracts Conversation Domain v3

Date: 2026-03-27
Status: canonical backend/frontend contract

## Purpose

Define the BetterChat-owned conversation-domain contract.

This is a clean break from the legacy room/sidebar compatibility surface.
Rocket.Chat is one upstream adapter behind this contract, not the public model.

## Public nouns

- workspace
- directory
- conversation
- membership
- inbox
- timeline
- thread
- live state
- stream

Important rule:

- `conversation` and `membership` remain separate objects

## Canonical HTTP surface

- `GET /api/public/bootstrap`
- `POST /api/session/login`
- `POST /api/session/logout`
- `GET /api/workspace`
- `GET /api/users/:userId/direct-conversation`
- `PUT /api/users/:userId/direct-conversation`
- `GET /api/directory`
- `GET /api/conversations/:conversationId`
- `GET /api/conversations/:conversationId/participants`
- `GET /api/conversations/:conversationId/mention-candidates`
- `GET /api/conversations/:conversationId/timeline`
- `GET /api/conversations/:conversationId/messages/:messageId/context`
- `GET /api/conversations/:conversationId/threads/:threadId/timeline`
- `POST /api/conversations/:conversationId/messages`
- `PATCH /api/conversations/:conversationId/messages/:messageId`
- `DELETE /api/conversations/:conversationId/messages/:messageId`
- `POST /api/conversations/:conversationId/messages/:messageId/reactions`
- `POST /api/conversations/:conversationId/media`
- `POST /api/conversations/:conversationId/membership/commands`
- `GET /api/stream`
- `GET /api/media/*`

Explicitly removed:

- `/api/rooms/*`
- `/api/realtime`

## Direct-conversation user resource

BetterChat exposes a user-scoped direct-conversation resource.

```ts
type UserSummary = {
  id: string;
  username?: string;
  displayName: string;
  avatarUrl?: string;
  presence?: PresenceState;
};

type DirectConversationLookup = {
  user: UserSummary;
  conversation:
    | { state: 'none' }
    | { state: 'listed' | 'hidden'; conversationId: string };
};

type EnsureDirectConversationResponse = {
  user: UserSummary;
  conversationId: string;
  disposition: 'existing-listed' | 'existing-hidden-opened' | 'created';
  sync: SnapshotSyncState;
};
```

Rules:

- target identity is the stable BetterChat/upstream user id
- only true one-to-one directs qualify
- multi-user Rocket.Chat `t: 'd'` rooms do not satisfy this resource
- hidden existing directs surface as `state: 'hidden'`
- `PUT /api/users/:userId/direct-conversation` is idempotent and ensures the direct exists and is listed/open
- self-targeting is rejected as a validation error for this feature

## Conversation participants and mention candidates

BetterChat exposes two distinct conversation-scoped user resources:

- `GET /api/conversations/:conversationId/participants`
- `GET /api/conversations/:conversationId/mention-candidates`

They are intentionally different:

- participants = authoritative roster truth
- mention-candidates = composer suggestion truth

```ts
type ConversationParticipant = {
  user: UserSummary;
  self: boolean;
};

type ConversationParticipantsPage = {
  conversationId: string;
  entries: ConversationParticipant[];
  nextCursor?: string;
};

type ConversationMentionCandidate =
  | {
      kind: 'user';
      user: UserSummary;
      insertText: string;
    }
  | {
      kind: 'special';
      key: 'all' | 'here';
      label: string;
      insertText: string;
    };

type ConversationMentionCandidatesResponse = {
  conversationId: string;
  query: string;
  entries: ConversationMentionCandidate[];
};
```

Participants semantics:

- authoritative room roster for the current user and conversation
- paginated with the standard cursor/limit shape
- optional `q` filter narrows the upstream/member search
- includes the current user with `self: true`

Mention-candidate semantics:

- room-scoped ranked composer suggestions
- excludes the current user
- backend owns `insertText`
- `query` is normalized for the response:
  - trim whitespace
  - tolerate a leading `@`
  - rank user matches case-insensitively and punctuation-insensitively
- `@all` and `@here` appear only for conversations that are not true one-to-one directs
- frontend must not infer DM targets or room members by scanning directory entries or timeline authors

## Membership inbox

`membership.inbox` is the canonical current-user attention/read model.

```ts
type MembershipInbox = {
  unreadMessages: number;
  mentionCount: number;
  replyCount: number;
  hasThreadActivity: boolean;
  hasUncountedActivity: boolean;
};
```

Semantics:

- `unreadMessages`
  - exact count of unseen messages that belong to the main conversation timeline
  - for Rocket.Chat this is derived from the read checkpoint `ls || ts` plus post-checkpoint message sync when upstream subscription counts are insufficient
- `mentionCount`
  - exact count when the adapter can provide or derive it reliably
  - `0` means no current mention signal
- `replyCount`
  - exact count of unseen main-timeline messages from other users that canonically reply to one of the current user's messages in this conversation
  - count ordinary quoted/main-timeline replies and broadcast thread replies that echo into the main timeline
  - do not count thread-only replies that stay outside the main conversation timeline
- `hasThreadActivity`
  - there is unseen thread activity outside the main conversation timeline
- `hasUncountedActivity`
  - there is unseen conversation activity that should surface as a quiet dot, but not as a fabricated unread badge

Frontend derives badges and dots from these facts.
Frontend must not invent unread counts.

## Directory snapshot

```ts
type DirectoryEntry = {
  conversation: ConversationPreview;
  membership: {
    listing: 'listed' | 'hidden';
    starred: boolean;
    inbox: MembershipInbox;
  };
  live?: {
    counterpartPresence?: PresenceState;
  };
};
```

`conversation.lastActivityAt` is the ordering timestamp for the directory.

It means:

- actual conversation activity, not a user read checkpoint
- room message activity and thread activity after normalization
- adapter-provided fallback such as creation or join timestamp when no later activity exists

Presence rule:

- `live.counterpartPresence` exists only for true one-to-one direct conversations
- upstream Rocket.Chat rooms with `t: 'd'` and more than two participants normalize to private groups, not one-to-one directs

## Conversation snapshot

Conversation snapshot extends the conversation preview with metadata and capabilities.
The same membership object shape is used in both directory and conversation snapshots.

The same presence rule applies here:

- one-to-one directs may expose `live.counterpartPresence`
- private/public groups do not

Capability shape:

```ts
type ConversationMutationCapabilities = {
  conversation: boolean;
  conversationReply: boolean;
  thread: boolean;
  threadEchoToConversation: boolean;
};

type ConversationCapabilities = {
  star: boolean;
  hide: boolean;
  markRead: boolean;
  markUnread: boolean;
  react: boolean;
  messageMutations: ConversationMutationCapabilities;
  mediaMutations: ConversationMutationCapabilities;
};
```

Rules:

- snapshot capabilities describe mutation-target support, not per-message ownership
- per-message edit/delete truth lives on `ConversationMessage.actions`
- Rocket.Chat currently supports:
  - text thread echo to conversation
  - image upload into conversation replies
  - image upload into non-broadcast thread replies
- Rocket.Chat does not provide the same clean broadcast path for media thread replies, so `mediaMutations.threadEchoToConversation` stays `false`

## Timeline semantics

`ConversationTimelineSnapshot.unreadAnchorMessageId` is the exact first unread main-timeline message currently included in the loaded snapshot.

For Rocket.Chat:

- read checkpoint comes from subscription `ls || ts`
- main timeline excludes thread-only replies
- thread replies echoed into the room timeline stay in the main timeline
- exact unread counts and unread anchor may require reconciling messages updated since `ls || ts`
- self-authored post-checkpoint messages do not create an unread anchor
- the initial conversation timeline load must expand beyond the default page size when needed so the exact unread anchor is present

## Image attachment semantics

Image attachments are explicit dual-asset objects.

```ts
type ConversationImageAsset = {
  url: string;
  width?: number;
  height?: number;
};

type ConversationAttachment =
  | {
      kind: 'image';
      id: string;
      title?: string;
      preview: ConversationImageAsset;
      source: ConversationImageAsset;
    };
```

Rules:

- `preview`
  - the image asset intended for inline timeline rendering
- `source`
  - the best full-fidelity image BetterChat can provide for viewer/open/download semantics
- both `preview` and `source` must exist
- when the upstream only provides one usable image URL, `preview.url` and `source.url` are the same
- frontend must use `preview` for inline rendering and `source` for the image viewer

For Rocket.Chat:

- uploaded image thumbnail:
  - `preview.url <- attachment.image_url`
  - `source.url <- attachment.title_link`
- external or single-URL images:
  - `preview == source`

## Message creation semantics

`POST /api/conversations/:conversationId/messages` supports:

- normal conversation message
- conversation reply that stays in the main timeline
- thread reply
- thread reply echoed to the main timeline

`POST /api/conversations/:conversationId/media` supports:

- normal conversation image upload
- conversation reply image upload
- thread image upload

Media upload rule:

- `echoToConversation=true` is rejected for media uploads because the current Rocket.Chat adapter cannot provide clean broadcast-thread media semantics

Additional message mutations:

- `PATCH /api/conversations/:conversationId/messages/:messageId`
- `DELETE /api/conversations/:conversationId/messages/:messageId`
- `POST /api/conversations/:conversationId/messages/:messageId/reactions`

Update-message reply semantics:

- `replyToMessageId` omitted:
  - preserve the current main-timeline reply relation
- `replyToMessageId: string`:
  - set or replace the main-timeline reply relation
- `replyToMessageId: null`:
  - remove the current main-timeline reply relation
- `replyToMessageId` is rejected when editing thread replies

Media rendering rule:

- same-origin Rocket.Chat avatar/file-upload URLs normalize to BetterChat `/api/media/*`
- external absolute media URLs remain external render URLs
- unsafe or malformed media URLs are dropped rather than passed through
- `/api/media/*` preserves HTTP validator and range semantics, including `304 Not Modified` and `206 Partial Content`

## Membership command plane

`POST /api/conversations/:conversationId/membership/commands`

Supported commands:

- `set-starred`
- `set-listing`
- `mark-read`
- `mark-unread`

Mutations return identifiers plus sync/version hints.
Snapshots remain the source of truth for derived state.

## Stream

Endpoint:

- `GET /api/stream`

Transport:

- WebSocket
- authenticated by BetterChat session cookie

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
      type: 'directory.entry.upsert';
      version: string;
      entry: DirectoryEntry;
    }
  | {
      type: 'directory.entry.remove';
      version: string;
      conversationId: string;
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

Stream policy:

- `directory.entry.upsert/remove` is the normal incremental path
- `directory.resynced` is the recovery path
- conversation and thread streams may still resync snapshots when an exact patch is not worth fabricating
- inactive direct-conversation presence changes may arrive as `directory.entry.upsert`

## Frontend handling rules

- fetch directory first, then `watch-directory`
- fetch conversation and timeline first, then `watch-conversation`
- fetch thread timeline first, then `watch-thread`
- treat `directory.entry.upsert/remove` as authoritative incremental changes
- treat `directory.resynced`, `conversation.resynced`, `timeline.resynced`, and `thread.resynced` as full replacement snapshots
- derive badge and dot rendering from `membership.inbox`
- do not infer inactive-conversation unread state from the active conversation timeline
