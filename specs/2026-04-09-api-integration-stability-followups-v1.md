# API integration stability follow-ups v1

## Scope

Stabilize the remaining live `tests/e2e/api-integration.spec.ts` failures after the notification work landed.

## Verified failure clusters

### 1. Realtime transport noise during expected disconnects

- Failing tests:
  - `persists deleted-message tombstones across BetterChat backend restart in API mode`
- Root cause:
  - `apps/web/src/lib/betterchat-realtime.ts` reports reconnectable websocket closes/errors via `onSocketError`.
  - `apps/web/src/features/app-shell/AppShell.tsx` unconditionally logs every socket error with `console.error`.
  - Backend restart is an expected reconnect scenario, but the browser-error guard treats the console error as a product failure.
- Design intent:
  - Recoverable transport interruptions should update connection status, not emit app-level error logs.
  - Only non-recoverable/auth/protocol errors should surface as errors/toasts.

### 2. Logout does not quiesce the shell before session invalidation

- Failing tests:
  - `opens a hidden room through BetterChat, persists favorite state, and supports logout`
- Root cause:
  - `AppShell` queries are enabled whenever the room/session UI is mounted.
  - `logoutMutation` waits for the server logout to finish, then calls `resetSessionAndReturnToLogin()`.
  - During that gap, sidebar/room/timeline/participants requests continue and start returning `401`, which show up as browser console errors.
  - `queryClient.clear()` clears cache state, but it does not model “session is shutting down”; mounted queries still have `enabled: true`.
- Design intent:
  - Explicit session lifecycle: active → closing → logged-out.
  - Closing must stop realtime, cancel queries, and disable further fetches before the cookie is invalidated.

### 3. Active timeline window can shrink after a refetch

- Failing tests:
  - `keeps live prepend history restoration stable after long older pages load`
  - `prefetches the next older live timeline page before the viewport fully reaches the top edge`
- Root cause:
  - Backend intentionally expands the initial page when the unread anchor is older than the normal latest slice (`apps/backend/src/snapshots.ts`).
  - Later polling/refetch can return the normal latest slice again.
  - `apps/web/src/features/app-shell/AppShell.tsx` rebuilds `activeRoomBaseTimeline` from the latest query result plus explicit `roomOlderHistory`, but it does not preserve the already-loaded prefix from the expanded initial page.
  - Result: DOM message count can drop (for example `120 -> 50`), which invalidates viewport assumptions and older-history prefetch expectations.
- Design intent:
  - Once a message enters the loaded room window, a newer refetch must not silently evict it unless the room changes or the window is intentionally reset.

### 4. Bottom-follow survives longer than user intent

- Failing tests:
  - contributes to the two older-history failures above
- Root cause:
  - `TimelineView.scrollToBottom()` arms `bottomReflowFollowUntilRef`.
  - `apps/web/src/features/timeline/bottomFollow.ts` cancels that state only for a narrow “user scrolled upward” signature.
  - After topward navigation / history loading / anchor restoration, stale bottom-follow can still win later resize/reflow decisions and pull the viewport downward again.
- Design intent:
  - Manual upward exploration and history prepend must take precedence over any earlier bottom-follow intent.

### 5. Fold-anchor E2E has a weak precondition

- Failing tests:
  - `keeps the viewport anchored when folding an expanded long historical message in API mode`
- Root cause:
  - The test now uses the correct anchor-bias scroll formula, but the browser-side `evaluate()` callback still referenced `TIMELINE_VIEWPORT_ANCHOR_TOP_BIAS` from outer scope.
  - Playwright executes that callback inside the page, so the imported test constant is undefined there and the test fails before exercising the product behavior.
- Design intent:
  - The test should deliberately place the target near the anchor bias line before asserting anchor preservation, and pass all constants explicitly into the page callback.

### 6. Favorite toggles can drop follow-up keyboard intent while the first mutation is still in flight

- Failing tests:
  - `keeps keyboard focus on the favorite toggle after enter-triggered API favorite changes`
- Root cause:
  - `apps/web/src/features/app-shell/AppShell.tsx` leaves the favorite button enabled while an API mutation is in flight, but `handleFavoriteToggle()` returns early during that same window.
  - A second keyboard activation is therefore accepted by the DOM yet silently ignored by the handler.
  - The mutation pending window currently includes refetch cleanup, which makes the dropped-intent window wider than the actual network mutation.
- Design intent:
  - Header controls should never silently discard user intent.
  - Sequential keyboard toggles should either queue explicitly or block explicitly; silent no-op is the wrong behavior.

### 7. Image retry loses optimistic visual identity

- Failing tests:
  - `keeps a failed API image upload in the timeline across polling and supports retry`
- Root cause:
  - Text sends already stabilize optimistic-to-canonical replacement with explicit submission identity.
  - Media uploads still drop `submissionId` before `rooms.mediaConfirm`, so Rocket.Chat creates a different canonical message id on retry success.
  - BetterChat then removes the failed optimistic image row and appends a different canonical row, which loses the expanded image surface in live mode.
- Design intent:
  - Media and text should share one reconciliation model based on explicit submission identity, with the canonical image message reusing the optimistic id.

## Fix plan

### A. Realtime error taxonomy cleanup

- Files:
  - `apps/web/src/lib/betterchat-realtime.ts`
  - `apps/web/src/lib/betterchat-realtime.test.ts`
  - `apps/web/src/features/app-shell/AppShell.tsx`
- Plan:
  - Distinguish recoverable transport interruptions from actionable socket failures.
  - Route reconnectable close/error events through status/reconnect handling without `console.error`.
  - Keep explicit auth/protocol/rate-limit/server-parse failures as surfaced errors.

### B. Session shutdown lifecycle

- Files:
  - `apps/web/src/features/app-shell/AppShell.tsx`
  - related AppShell tests
- Plan:
  - Add a local session lifecycle flag that gates all authenticated queries and realtime wiring.
  - On logout start: enter `closing`, stop realtime, cancel active queries, disable polling/refetch, suppress stale auth-failure handling noise.
  - On logout success/unauthenticated: clear cache and navigate to `/login`.
  - On logout failure: restore `active` and show the mutation error.

### C. Stable loaded timeline window

- Files:
  - `apps/web/src/features/app-shell/AppShell.tsx`
  - `apps/web/src/features/app-shell/olderHistoryState.ts`
  - AppShell / older-history tests
- Plan:
  - Preserve the already-loaded older prefix when a later base refetch returns a narrower latest slice.
  - Treat the dropped prefix as loaded older history, carrying forward the correct deeper cursor instead of shrinking the DOM window.
  - Ensure the merged room window is monotonic within a room session.

### D. Stronger bottom-follow invalidation

- Files:
  - `apps/web/src/features/timeline/TimelineView.tsx`
  - `apps/web/src/features/timeline/bottomFollow.ts`
  - tests around bottom-follow / prepend
- Plan:
  - Cancel bottom-follow when the user materially leaves the bottom zone, not only on one narrow delta pattern.
  - Explicitly clear bottom-follow before/while older-history prepend is active.
  - Keep anchor-preservation and history-prepend restoration higher priority than stale bottom restore.

### E. Fold-anchor test correction

- Files:
  - `tests/e2e/api-integration.spec.ts`
- Plan:
  - Position the target message intentionally near the viewport anchor line (`offsetTop - bias + desiredOffset`) before taking the “before toggle” snapshot.
  - Pass the anchor-bias constant explicitly into the page callback so the test actually executes the fold behavior.
  - Re-evaluate the product behavior only if the corrected test still fails.

### F. Favorite mutation intent queue

- Files:
  - `apps/web/src/features/app-shell/AppShell.tsx`
  - `apps/web/src/features/app-shell/AppShell.test.tsx`
- Plan:
  - Replace the current “enabled button + dropped handler” behavior with an explicit latest-intent queue for API favorite mutations.
  - Keep focus on the same header control while sequential keyboard toggles drain through one request at a time.
  - Stop coupling the button busy state to post-mutation refetch cleanup.

### G. Unified media submission reconciliation

- Files:
  - `apps/web/src/lib/betterchat.ts`
  - `apps/web/src/lib/betterchat-fixtures.ts`
  - `apps/backend/src/routes/conversations.ts`
  - `apps/backend/src/upstream.ts`
  - `apps/web/src/features/app-shell/AppShell.tsx`
  - relevant unit/integration/E2E tests
- Plan:
  - Add optional `submissionId` to media upload requests end-to-end.
  - Forward that identity through Rocket.Chat media confirmation as the canonical message `_id`.
  - Preserve image expansion state across failed → retrying → canonical transitions by keeping optimistic and canonical image rows under one message identity.

## Verification

- Unit:
  - realtime error taxonomy
  - older history state/window preservation
  - bottom-follow cancellation
  - media submission-id parsing/reconciliation
- Integration:
  - backend route tests for media `submissionId`
  - AppShell tests for logout quiesce / reconnect noise
- Live API E2E:
  - rerun each failing spec in isolation first
  - rerun full `tests/e2e/api-integration.spec.ts`
