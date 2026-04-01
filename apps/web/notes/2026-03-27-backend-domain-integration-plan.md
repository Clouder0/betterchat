# Frontend Conversation Domain v3 Integration Plan

Date: 2026-03-27
Owner: frontend session
Scope: `apps/web/**`, `tests/e2e/**`
Status: completed

## Goal

Integrate the BetterChat web frontend with the canonical conversation-domain v3 backend while preserving the current product UX:

- login
- directory/sidebar
- conversation open flow
- realtime updates
- unread and mention cues
- message sending and image uploads
- reply jump and timeline context
- fixture mode parity
- stable keyboard and Playwright coverage

## Design choice

Do not thread raw backend snapshots directly through the entire UI.

Instead:

1. consume the canonical BetterChat contracts at the browser boundary
2. normalize them into explicit frontend-local view models
3. keep the rest of the UI on that stable local model

Reason:

- the backend contract should stay canonical and explicit
- the frontend still needs UI-specific derived concepts such as grouped sidebar entries, local reply preview, and presentation-oriented message fields
- a deliberate adapter layer is cleaner than letting backend field names leak across every UI module

Important constraint:

- the frontend-local model may derive values from canonical contract fields
- it must not fabricate data the contract does not provide

## Canonical backend surface

HTTP:

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

Realtime:

- `watch-directory`
- `watch-conversation`
- `watch-thread`
- `set-typing`
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

## Frontend-local domain

Introduce explicit frontend-local types under `apps/web/src/lib/` for:

- sidebar entry
- conversation details
- timeline snapshot
- message
- attachment
- reply preview
- local mutation sync hints

These types should preserve the existing UX-friendly naming where useful, but their construction must be a pure mapping from the v3 contracts.

Examples of allowed derivation:

- derive sidebar badge state from `membership.inbox`
- derive UI conversation kind from `ConversationKind`
- expose message markdown from `content.text`
- expose deleted/edited flags from `state`

Examples of disallowed fabrication:

- invent unread counts when backend only reports quiet activity
- infer inactive-conversation unread state from the active timeline
- invent presence for non-DM conversations

## Migration slices

### Slice 1. Red tests at the boundary

Add or rewrite unit tests first for:

- contract-to-UI adapter mapping
- sidebar sort and badge derivation from `membership.inbox`
- timeline/context merge on canonical message timestamps
- realtime controller command/event handling for `/api/stream`
- send and media request shaping

### Slice 2. Transport and adapter layer

Rewrite `apps/web/src/lib/betterchat.ts` to:

- call the conversation-domain v3 HTTP surface
- expose new query keys:
  - `directory`
  - `conversation(conversationId)`
  - `conversationTimeline(conversationId)`
  - `messageContext(conversationId, messageId, before, after)`
- normalize contract snapshots into frontend-local types

### Slice 3. Realtime controller

Rewrite `apps/web/src/lib/betterchat-realtime.ts` to:

- connect to `/api/stream`
- watch directory and active conversation explicitly
- handle patch-vs-resync behavior correctly
- stop assuming `pollIntervalMs`

### Slice 4. Sidebar model

Rebuild sidebar helpers on directory entries:

- grouping into favorites / rooms / direct messages
- ordering by:
  1. local alert preference
  2. mention signal
  3. unread/activity signal
  4. `conversation.lastActivityAt`
  5. localized title
- presence only on one-to-one directs

### Slice 5. App shell integration

Update `AppShell.tsx` to:

- use directory/conversation/timeline queries
- use membership commands instead of room mutations
- patch query caches by conversation ID
- keep route compatibility with `/app/rooms/$roomId`, treating it internally as `conversationId`
- keep current UX for sidebar, right sidebar, composer, and timeline interactions

### Slice 6. Timeline and composer helpers

Migrate:

- `TimelineView.tsx`
- `messageCompose.ts`
- `mentions.ts`
- `mentionNavigation.ts`
- `messageCollapsing.ts`
- `timelineContext.ts`
- `ComposerBar.tsx`

Use frontend-local message types and local derived reply-preview types.

### Slice 7. Fixture rewrite

Rebuild fixture mode to emit the exact v3 contract shapes internally, then adapt them through the same adapter layer used by API mode.

Goal:

- fixture and API mode share the same frontend-facing normalized model
- no dual semantic drift

### Slice 8. End-to-end coverage

Rewrite Playwright coverage for:

- fixture mode
- live API mode against BetterChat backend + Rocket.Chat

Required live scenarios:

- login and workspace bootstrap
- directory load
- open hidden conversation through search
- star/unstar
- realtime directory update while another conversation is active
- unread and mention signals
- mark-read after reaching bottom
- reply jump through message context load
- send text
- send image
- image viewer open path

## Acceptance criteria

- `env BUN_TMPDIR=/tmp bun run test:web` passes
- `env BUN_TMPDIR=/tmp bun run typecheck:web` passes
- `env BUN_TMPDIR=/tmp bun run build:web` passes
- fixture Playwright passes
- live frontend/backend/Rocket.Chat Playwright passes
- browser uses BetterChat backend contracts only
- any backend mismatch discovered during implementation is recorded explicitly and not papered over in the frontend

## Current known risk

At the start of this pass, the backend contract and unit tests are green, but the local live stack previously timed out during readiness checks. Re-verify the live stack before trusting any frontend end-to-end result.

## Execution result

Completed on 2026-03-27.

Implemented:

- explicit frontend-local chat model layer in `apps/web/src/lib/chatModels.ts`
- v3 contract-to-UI adapters in `apps/web/src/lib/chatAdapters.ts`
- canonical conversation-domain HTTP transport in `apps/web/src/lib/betterchat.ts`
- canonical `/api/stream` realtime controller in `apps/web/src/lib/betterchat-realtime.ts`
- canonical fixture conversation-directory/timeline state in `apps/web/src/lib/betterchat-fixtures.ts`
- app-shell stream cache updates for directory/conversation/timeline v3 events
- frontend module/test imports moved off removed room-era contract types
- API-mode Playwright migrated from `/api/rooms/*` to conversation-domain v3 endpoints
- fixture-mode adapter coverage in `apps/web/src/lib/betterchat-fixtures.test.ts`

Verified:

- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
- `env BUN_TMPDIR=/tmp bun run test:e2e` in fixture mode
- `./scripts/backend-stack-start.sh`
- `./scripts/backend-integration-test.sh`
- `env BUN_TMPDIR=/tmp BETTERCHAT_E2E_API_MODE=api BETTERCHAT_E2E_API_BASE_URL=http://127.0.0.1:3200 bun run test:e2e`

Current note:

- fixture mode now stores canonical conversation-domain state internally and reuses the same adapter boundary as API mode
- descriptive fixture handles stay plain in sidebar presentation, while username-like handles still render as `@handle` for identity-oriented UI paths
- this follow-up re-verified the full fixture suite after the fixture rewrite
- this follow-up also re-verified the live API browser path against the current backend:
  - `./scripts/backend-integration-test.sh`
  - `env BUN_TMPDIR=/tmp BETTERCHAT_E2E_API_MODE=api BETTERCHAT_E2E_API_BASE_URL=http://127.0.0.1:3200 bun run test:e2e`
