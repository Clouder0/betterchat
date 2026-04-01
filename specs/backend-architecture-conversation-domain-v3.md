# BetterChat Backend Architecture Conversation Domain v3

Date: 2026-03-27
Status: canonical backend architecture target
Target upstream: Rocket.Chat 7.6.0

## Direction

BetterChat backend is the canonical conversation-domain boundary.

It should:

- own stable BetterChat semantics
- normalize upstream-specific read and activity behavior
- keep frontend independent from Rocket.Chat payload shape
- remain simple to host as a single-node service
- keep the adapter seam explicit for future upstreams

## Public domain split

Keep these distinct:

- `conversation`
- `membership`
- `membership.inbox`
- `conversation capabilities`
- `timeline`
- `thread`
- `live state`

The most important split is:

- conversation data is shared object state
- membership data is current-user state
- inbox is current-user read/activity state
- snapshot capabilities are mutation-target support
- per-message actions are message-instance truth

## Architecture layers

1. upstream adapter
2. BetterChat domain normalization
3. inbox projection
4. snapshot service
5. HTTP routes
6. stream gateway

### Adapter

Rocket.Chat-specific transport, payloads, settings, REST calls, and DDP streams stay here.

### Domain normalization

Transforms upstream rooms, subscriptions, and messages into BetterChat conversation-domain objects.

Important Rocket.Chat adapter rules:

- upstream `t: 'd'` with exactly two participants becomes BetterChat direct
- upstream `t: 'd'` with more than two participants becomes BetterChat private group
- direct-only counterpart presence applies only to the true one-to-one case
- same-origin Rocket.Chat media paths normalize to `/api/media/*`
- external absolute media URLs stay external rather than inventing a remote-media proxy
- non-HTTP(S), malformed, and unsupported same-origin media URLs are rejected during normalization
- Rocket.Chat uploaded image attachments must normalize into BetterChat `preview` and `source` assets instead of a single ambiguous URL
- authenticated upstream `401` invalidates the BetterChat session; authenticated upstream `403` stays a permission rejection and must not clear the session
- capability projection must expose explicit mutation targets (`conversation`, `conversationReply`, `thread`, `threadEchoToConversation`) separately for text and media

Image normalization rule:

- BetterChat image attachments carry:
  - `preview`
  - `source`
- for Rocket.Chat uploaded images:
  - `preview.url <- attachment.image_url` because Rocket.Chat rewrites it to the generated thumbnail
  - `source.url <- attachment.title_link` because Rocket.Chat keeps it pointed at the full uploaded file
- if only one usable image URL exists, `preview` and `source` collapse to the same asset
- do not fabricate source dimensions when upstream only reports thumbnail dimensions
- keep `mediaMutations.threadEchoToConversation = false` until the adapter can support broadcast-thread media as a clean first-class mutation

### Inbox projection

Builds BetterChat-owned inbox semantics from adapter state.

For Rocket.Chat:

- use subscription `ls || ts` as the read checkpoint
- reconcile exact main-timeline unread counts from messages updated since the checkpoint when upstream subscription counts are insufficient
- derive the exact first unread main-timeline message id from the same post-checkpoint projection
- derive exact `replyCount` from the same post-checkpoint main-timeline message set by resolving canonical reply parents and checking whether the parent belongs to the current user
- use subscription mention/thread fields (`userMentions`, `groupMentions`, `tunread`, `tunreadUser`, `tunreadGroup`) as the authoritative attention facts
- preserve `hasUncountedActivity` only when upstream raises `alert` without explicit unread, mention, or thread signals
- avoid full room-history rescans; use post-checkpoint message sync instead
- project room ordering/activity timestamps from actual room activity (`lm`, thread reply activity via `lr`, creation/join fallback via `ts`), not from user read timestamps

### Snapshot service

Owns versioned session-scoped projections, explicit per-refresh fact scopes, and invalidation.

Rules:

- initial timeline loads must include the exact unread anchor when one exists
- independent HTTP reads must rebuild facts from upstream truth rather than serving stale per-session fact snapshots
- coordinated refreshes may share one explicit fact scope across related snapshot loads
- invalidation advances snapshot generations so the next coordinated refresh rebuilds from upstream truth

### Stream gateway

Owns browser-facing realtime protocol.
It consumes upstream realtime signals and emits BetterChat semantic events.

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

Removed from the public surface:

- `GET /api/rooms`
- `GET /api/rooms/:roomId`
- `GET /api/rooms/:roomId/timeline`
- `GET /api/rooms/:roomId/threads/:threadId/timeline`
- `POST /api/rooms/*`
- `GET /api/realtime`

## Conversation roster and mention resources

BetterChat keeps roster truth and mention UX truth separate:

- participants route = authoritative conversation roster
- mention-candidates route = ranked composer candidates

Why:

- frontend `@mention` needs stable user ids and backend-owned insert semantics
- frontend must not guess room members from timeline authors or directory titles
- future upstreams may provide different member-search primitives while preserving the same BetterChat contract

Rocket.Chat adapter mapping:

- `c` / `p` conversations use `rooms.membersOrderedByRole`
- `d` conversations use `im.members`

Mention-candidate rules:

- derive candidates from the authoritative conversation roster
- exclude the current user
- tolerate raw composer queries with or without the leading `@`
- normalize ranking independently from upstream member-search filtering
- append room-wide `@all` / `@here` only when the conversation is not a true one-to-one direct

## Realtime policy

`/api/stream` is the only realtime transport.

Design rules:

- directory watch is explicit and first-class
- directory updates come from current-user subscription and room changes
- inactive conversations must update without per-room frontend polling
- `directory.entry.upsert/remove` is the normal path
- `directory.resynced` is the fallback recovery path
- watched conversation timeline and metadata can resync snapshots when a precise patch is not worth fabricating
- typing and presence remain separate ephemeral events
- when Rocket.Chat `stream-user-presence` carries an explicit status, apply it directly instead of invalidating the directory
- patch remembered directory entries for inactive one-to-one directs instead of forcing a full sidebar reload on every presence tick
- fall back to a REST presence lookup only when the realtime presence event omits the status code
- `/api/media/*` must preserve validator and byte-range semantics end to end

## Why inbox projection exists

Rocket.Chat unread semantics are not the BetterChat product semantics.

Important upstream facts:

- channels and private groups may keep `unread = 0` while still setting `alert = true`
- `chat.syncMessages` after `ls` exposes the authoritative post-checkpoint message set
- subscription mention/thread fields carry attention signals that room-history scans would otherwise misclassify
- thread-only replies do not belong in the main conversation timeline

If BetterChat exposed raw upstream unread semantics, the frontend could not render inactive-conversation unread state correctly.
The backend must own the projection.

## Multi-upstream boundary

Future upstreams should implement the same domain seams:

- current user bootstrap
- user identity lookup
- direct-conversation ensure/open/create by stable user id
- directory snapshot source
- conversation snapshot source
- timeline and thread history
- membership mutations
- media reads/uploads
- realtime bridge

The core backend should depend on adapter capabilities, not Rocket.Chat field names.

## Hosting model

Keep deployment simple:

- single BetterChat backend instance is the default
- no Redis requirement
- no extra durable store requirement
- session-scoped snapshot and stream state may stay in memory
- rebuild projections from upstream truth when resync is needed

## Testing strategy

Use TDD at the seam that owns semantics:

- unit-test inbox projection rules directly
- unit-test directory diff and stream patch behavior
- unit-test route parsing and contract envelopes
- run live integration tests against Rocket.Chat 7.6.0 in the Podman stack

Required live coverage:

- login and workspace bootstrap
- directory snapshot
- conversation snapshot
- conversation timeline and thread timeline
- inactive-conversation unread updates
- exact unread anchor on initial conversation timeline load
- media proxy reads
- image upload/send flow
- canonical stream watch behavior

## Direct-conversation ensure flow

The user quick-panel DM action is a BetterChat-owned user resource, not an adapter-shaped `im.*` pass-through.

Flow:

1. resolve target user by stable user id
2. inspect the current directory/direct mapping by counterpart user id
3. if a true one-to-one direct already exists:
   - return `existing-listed`, or
   - reopen it and return `existing-hidden-opened`
4. otherwise create a new one-to-one direct and return `created`

Important rule:

- multi-user Rocket.Chat `t: 'd'` rooms are private-group conversations in BetterChat terms and must not satisfy this user-scoped direct resource
