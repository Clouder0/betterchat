# BetterChat Frontend Architecture v1

Date: 2026-03-25
Status: Active baseline

## Purpose

Define how the BetterChat frontend should be structured for the first implementation cycle.

This document focuses on:
- responsibility boundaries
- route and feature structure
- state ownership
- how frontend work should proceed in parallel with backend work

## Frontend role

The frontend is responsible for:
- user interface
- interaction design
- local view state
- rendering normalized BetterChat contracts
- applying the BetterChat design system to real product surfaces

The frontend is not responsible for:
- Rocket.Chat protocol normalization
- direct Rocket.Chat auth/header handling
- direct REST or DDP integration with Rocket.Chat upstream

The browser should talk only to BetterChat backend.

## Core principle

Frontend code must depend on BetterChat-owned contracts, not raw Rocket.Chat response shapes.

That is required for:
- real frontend/backend parallel work
- future backend normalization
- compatibility debugging without UI churn

## Route strategy

Current review routes should remain available during implementation:
- `/`
- `/shell`
- `/content`
- `/system`

The real product flow should add dedicated app routes:
- `/login`
- `/app`
- `/app/rooms/$roomId`

Rules:
- review routes remain the visual reference surfaces
- product routes are where real API-backed implementation lands
- do not mix demo-only logic into the real app routes

## Feature areas

Suggested feature ownership inside `apps/web/src/`:

- `features/session/`
  - login form
  - authenticated session guard
- `features/bootstrap/`
  - authenticated bootstrap load
- `features/sidebar/`
  - favorites / rooms / direct messages grouping
  - unread ordering
  - jump-to-room search
- `features/room/`
  - room header
  - room metadata actions
- `features/room-sidebar/`
  - right supplemental sidebar
  - open / close state
- `features/timeline/`
  - room timeline
  - reply jump-to-original
  - long-message expansion
  - image and rich-content rendering
- `features/composer/`
  - keep minimal in cycle 1 unless sending is implemented

The current shared layers stay relevant:
- `components/`
- `lib/`
- `styles/`

## State ownership

### Server-derived state

Use `TanStack Query` as the primary owner for:
- public bootstrap
- session bootstrap
- sidebar room/subscription data
- room details
- timeline snapshots

### Local UI state

Use plain React state/context for:
- right sidebar open / close
- selected room info panel content
- jump-to-room search input and overlay state
- message collapse / expand state
- transient UI-only focus or scroll state

Do not introduce a new global store unless plain React state becomes clearly insufficient.

## Query model

Suggested query ownership:

- `public-bootstrap`
- `session-bootstrap`
- `sidebar`
- `room-details/{roomId}`
- `room-timeline/{roomId}`

Rules:
- room switching should reuse cached sidebar and room metadata when safe
- timeline updates should patch query data rather than create parallel state stores
- optimistic updates should stay limited until the backend contract is stable

## Data-flow rules

Frontend should:
- request normalized BetterChat data
- group sidebar entries into Favorites / Rooms / Direct Messages
- sort unread items to the top within groups
- own room search behavior over the sidebar snapshot
- render room info in the right sidebar based on the selected room and UI state

Frontend should not:
- reconstruct Rocket.Chat semantics from ad hoc raw payloads
- own upstream auth token transport
- call Rocket.Chat APIs directly

## Search strategy

Cycle 1 jump-to-room search should be simple:
- operate over the current sidebar snapshot
- support direct Chinese substring matches well
- support normal mixed Chinese / English title matching

Do not add advanced fuzzy or pinyin logic in this cycle unless it becomes necessary for basic usability.

## Sidebar behavior

The frontend owns sidebar presentation rules:
- Favorites section
- Rooms section
- Direct Messages section
- unread-first sorting inside each section
- clear unread indicators

The backend should expose enough metadata to make this straightforward:
- room kind
- favorite flag
- unread count
- mention state if available
- title / display name
- last activity ordering fields

## Right sidebar behavior

The right sidebar is supplementary.

Rules:
- closed by default
- opened explicitly from room header / room title interactions
- clear close affordance
- should not behave like a permanent third column of required information

## Timeline behavior

Cycle 1 timeline must support:
- initial snapshot render
- markdown
- math
- quote blocks
- code blocks
- image rendering
- reply jump-to-original

Deferred timeline features:
- reply-inspector for descendants
- full thread UI
- advanced message actions

## Design-system rule

Real product routes must use the design system baseline in `specs/design-system-v1.md`.

Do not treat the current demo routes as disposable art.
Treat them as the visual baseline and translate that language into the real app.

## Testing strategy

Frontend development should use two modes:

### Contract-fixture mode

Use local fixtures that implement BetterChat contracts so UI work can proceed before the backend is complete.

### Real-stack mode

Switch the same UI surfaces to the real BetterChat backend as endpoints land.

Frontend acceptance is not complete until:
- the app builds cleanly
- the key flows work against the real backend
- Playwright covers the cycle-1 core flow

## Parallel-work rule

Frontend may move ahead of backend only through documented BetterChat contracts.

If frontend needs a contract change:
- write it into `specs/contracts-v1.md`
- do not silently invent a local-only shape
