# Frontend Live Backend Integration Plan

Date: 2026-03-26
Owner: frontend session
Scope: `apps/web/**` and `tests/e2e/**`

## Why this pass exists

The earlier cycle 1 shell landed against fixture mode first.

That note is now stale in one important way:
- BetterChat backend is no longer scaffold-only for the MVP shell
- realtime is in scope for this pass
- the frontend should move from fixture-era local behavior toward backend-owned session, favorite, room visibility, unread, and invalidation flows

## Contract posture

Browser remains BetterChat-only:
- no direct Rocket.Chat calls from browser code
- no invented contract fields
- TanStack Query remains the canonical holder for server-derived state
- plain React state remains for UI-only state

Contracts/backend already available for this pass:
- session login/logout
- bootstrap/sidebar/room/timeline snapshots
- room open/hide
- room favorite
- room read/unread
- room message context
- realtime invalidation websocket

## Planned implementation slices

1. Extend the frontend BetterChat client with the missing contract-backed mutations and context reads.
2. Remove fixture-era local favorite overrides from API mode while preserving fixture-mode behavior for fast local tests.
3. Wire explicit room-open semantics when opening a hidden room in API mode.
4. Wire logout from the product shell against BetterChat session logout.
5. Wire reply jump fallback to room message context when the original message is not already present in the loaded timeline slice.
6. Add realtime invalidation handling:
   - `sidebar.invalidate` -> refetch sidebar
   - `room.invalidate` -> refetch room details and timeline for the watched room
   - `session.invalidated` -> clear client session state and return to `/login`
7. Add frontend read-state synchronization for the active room without breaking existing viewport behavior.
8. Add live Playwright coverage against the seeded BetterChat stack while keeping fixture-mode Playwright coverage intact.

## Implementation note after execution

The browser/live slice is implemented, but the backend websocket bridge still misses several upstream-originated invalidations in the deeper integration harness.

Frontend mitigation added in this pass:
- API-mode sidebar polling safety net
- API-mode active-room details polling safety net
- API-mode active-room timeline polling safety net
- composer image-send UI against BetterChat image endpoints
- optimistic image-send hydration transfer so newly sent image messages keep the expected expansion state
- first-message-in-empty-room append detection so live image sends in empty rooms keep the expected expanded state
- bottom-aware send-intent expansion carryover so active-chat sends expand while historical-view sends still fold

This keeps the shipped shell workable while backend-side realtime invalidation gaps are closed.

## Verification target

Required before closing this pass:
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
- fixture Playwright suite still passes
- live backend integration stack starts, seeds, and supports API-mode browser tests

## Explicit non-goals for this pass

- no browser-direct Rocket.Chat integration
- no contract forking
- no forwarded-message jump-to-origin feature
- no thread UI implementation
- no speculative websocket patch payload layer; HTTP snapshots remain canonical
