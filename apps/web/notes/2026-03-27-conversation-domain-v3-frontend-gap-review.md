# Frontend Gap Review Against Conversation Domain v3 Backend

Date: 2026-03-27
Owner: frontend session
Scope: `apps/web/**`, `tests/e2e/**`
Status: review complete, implementation not started

## Goal

Recheck the current BetterChat web frontend against the newly refactored backend and identify the exact work required to integrate cleanly.

## Canonical backend baseline

The backend is now conversation-domain v3.

Canonical HTTP surface:

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
- `PATCH /api/conversations/:conversationId/messages/:messageId`
- `DELETE /api/conversations/:conversationId/messages/:messageId`
- `POST /api/conversations/:conversationId/messages/:messageId/reactions`
- `POST /api/conversations/:conversationId/media`
- `POST /api/conversations/:conversationId/membership/commands`
- `GET /api/stream`
- `GET /api/media/*`

Removed surface:

- `/api/rooms/*`
- `/api/realtime`

Canonical frontend-facing data model:

- `DirectorySnapshot`
- `DirectoryEntry`
- `ConversationSnapshot`
- `ConversationTimelineSnapshot`
- `ConversationMessage`
- `ConversationMessageContextSnapshot`
- `MembershipSummary`
- `MembershipInbox`
- `ConversationStreamClientCommand`
- `ConversationStreamServerEvent`

## Current state

The frontend is still on the removed room-domain contract.

Direct evidence:

- `env BUN_TMPDIR=/tmp bun run build:web` currently fails on removed exports such as:
  - `RoomListSnapshot`
  - `RoomSnapshot`
  - `RoomSummary`
  - `RoomTimelineSnapshot`
  - `TimelineMessage`
  - `TimelineAttachment`
  - `TimelineReplyPreview`
  - `MessageContextSnapshot`
  - `RealtimeClientCommand`
  - `RealtimeServerEvent`

So the current frontend cannot compile against the current contracts package, and therefore cannot integrate with the new backend yet.

## Backend readiness recheck

Rechecked locally on 2026-03-27:

- `env BUN_TMPDIR=/tmp bun --filter @betterchat/contracts typecheck` ✅
- `env BUN_TMPDIR=/tmp bun --filter @betterchat/backend typecheck` ✅
- `env BUN_TMPDIR=/tmp bun --filter @betterchat/backend test` ✅
  - 94 pass / 0 fail

The backend contract and unit-test surface are ready enough for frontend integration work.

Current live harness note:

- `./scripts/backend-stack-start.sh` currently times out waiting for the backend health check
- `./scripts/backend-integration-test.sh` currently fails for the same reason

So the contract is ready, but the local live stack is not currently in a green state for end-to-end verification on this machine. That should be treated as a separate backend/harness issue during the final integration pass.

## Exact frontend gaps

### 1. Transport layer is fully outdated

`apps/web/src/lib/betterchat.ts` still calls:

- `/api/rooms`
- `/api/rooms/:roomId`
- `/api/rooms/:roomId/timeline`
- `/api/rooms/:roomId/messages/:messageId/context`
- `/api/rooms/:roomId/messages`
- `/api/rooms/:roomId/images`
- `/api/rooms/:roomId/favorite`
- `/api/rooms/:roomId/read-state`
- `/api/rooms/:roomId/visibility`

Needed replacement:

- directory/conversation/timeline/context endpoints
- unified membership commands
- conversation media endpoint
- new query keys aligned to directory/conversation/thread nouns

### 2. Realtime layer is fully outdated

`apps/web/src/lib/betterchat-realtime.ts` still assumes:

- websocket URL `/api/realtime`
- commands `watch-room` / `unwatch-room`
- event `snapshot.invalidate`
- ready payload includes `pollIntervalMs`

Backend now provides:

- websocket URL `/api/stream`
- commands:
  - `watch-directory`
  - `unwatch-directory`
  - `watch-conversation`
  - `unwatch-conversation`
  - `watch-thread`
  - `unwatch-thread`
  - `set-typing`
- events:
  - `directory.resynced`
  - `directory.entry.upsert`
  - `directory.entry.remove`
  - `conversation.resynced`
  - `conversation.updated`
  - `timeline.resynced`
  - `thread.resynced`
  - `presence.updated`
  - `typing.updated`
  - `resync.required`
  - `session.invalidated`
- ready payload is `{ type: 'ready', mode: 'push', protocol: 'conversation-stream.v1' }`

So the current realtime controller must be rewritten, not patched.

### 3. Sidebar domain model is outdated

Current sidebar helpers still depend on `RoomSummary` and `RoomAttentionLevel`.

New source of truth is:

- `DirectoryEntry.conversation`
- `DirectoryEntry.membership`
- `DirectoryEntry.live`

Frontend should derive display state from canonical inbox facts:

- mention signal from `membership.inbox.mentionCount`
- unread badge from `membership.inbox.unreadMessages`
- quiet activity signal from `hasThreadActivity` / `hasUncountedActivity`
- starred from `membership.starred`
- hidden/listed from `membership.listing`

Sorting should be rebuilt on:

1. local alert preference (`subscribed` vs `normal`)
2. mention signal
3. unread/activity signal
4. latest activity timestamp (`conversation.lastActivityAt`)
5. localized title fallback

### 4. App shell query/mutation logic is outdated

`AppShell.tsx` still assumes:

- sidebar query -> room list snapshot
- details query -> room snapshot
- timeline query -> room timeline snapshot
- room favorite mutation
- room visibility mutation
- room read-state mutation
- room invalidation from old realtime events

Needed migration:

- directory query
- conversation query
- conversation timeline query
- message context query
- membership command mutation plane:
  - `set-starred`
  - `set-listing`
  - `mark-read`
  - `mark-unread`
- cache patching keyed by conversation IDs and snapshot sync hints

Route shape can remain `/app/rooms/$roomId` for now if desired, but the data model underneath must treat it as `conversationId`.

### 5. Timeline/message helpers are outdated

Current message helpers still assume old fields like:

- `createdAt`
- `body.rawMarkdown`
- reply preview contract types exported from contracts
- old attachment/message types

New canonical message shape is:

- `authoredAt`
- `content.text`
- `state.edited`
- `state.deleted`
- `replyTo`
- `thread`
- `attachments`
- `reactions`

This affects at least:

- `TimelineView.tsx`
- `messageCompose.ts`
- `mentions.ts`
- `mentionNavigation.ts`
- `messageCollapsing.ts`
- `timelineContext.ts`
- related unit tests

Important note:

- `TimelineReplyPreview` no longer exists in contracts
- reply preview should now be a frontend-local derived type built from `ConversationMessageReference` / `ConversationMessage`

### 6. Send and media flows need semantic migration

Text send is now:

- `CreateConversationMessageRequest`
  - `target.kind: 'conversation' | 'thread'`
  - `content.format: 'markdown'`
  - `content.text`

Uploads now go through:

- `POST /api/conversations/:conversationId/media`

The current frontend send path still posts old room payloads and old image endpoint semantics.

### 7. Fixture mode is stale

`apps/web/src/lib/betterchat-fixtures.ts` still manufactures room-era types and mutation responses.

It must be rebuilt to emit exact v3 shapes for:

- `DirectorySnapshot`
- `ConversationSnapshot`
- `ConversationTimelineSnapshot`
- `ConversationMessageContextSnapshot`
- membership commands
- create message responses
- media upload responses
- stream events if/when fixture realtime is exercised

Fixture mode must remain contract-faithful.

### 8. API-mode Playwright coverage is stale

`tests/e2e/api-integration.spec.ts` still directly hits removed routes such as `/api/rooms/*`.

This suite needs to move to:

- `/api/directory`
- `/api/conversations/*`
- `/api/stream`
- membership commands
- conversation media upload

## Recommended migration order

1. Rewrite transport + query keys to conversation-domain v3.
2. Rewrite realtime controller to `/api/stream` and new watch/event semantics.
3. Migrate sidebar helpers from room summaries to directory entries.
4. Migrate app shell queries, optimistic updates, and membership mutations.
5. Migrate timeline/message helpers and local derived types.
6. Migrate send/media flows.
7. Rebuild fixture mode to exact v3 contract fidelity.
8. Rewrite unit tests and Playwright API-mode coverage.
9. Only then run full live end-to-end frontend/backend/Rocket.Chat verification.

## Backend dependencies / risks to watch during integration

No immediate frontend blocker is visible from the contract itself, but integration must be careful around these points:

- treat `membership.inbox` as the only canonical unread/mention source for inactive conversations
- do not fabricate unread counts where backend only gives quiet activity facts
- preserve route compatibility while internally renaming room concepts to conversation concepts
- thread support exists in the backend contract, but frontend can stage it after main conversation integration unless current UI paths already depend on it
- optimistic updates must not fork contract state; backend snapshots remain authoritative

## Acceptance criteria for the implementation pass

- `env BUN_TMPDIR=/tmp bun run build:web` passes
- fixture mode compiles and stays contract-faithful
- API mode works against the current backend conversation-domain v3 surface
- sidebar unread/mention/live updates are driven by directory + stream v3
- send/media/read/star/hide flows use only canonical BetterChat backend contracts
- Playwright coverage is updated for both fixture and live API integration paths
