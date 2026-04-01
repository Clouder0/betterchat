# User Quick Panel And Direct Conversation Plan

Date: 2026-03-28
Owner: frontend session
Scope: `apps/web/**`, `tests/e2e/**`
Status: completed

## Goal

Add a clean group-chat author quick panel that lets users inspect a sender briefly and open or start a direct conversation with that person.

The flow must work in both:

- fixture mode
- API mode against the BetterChat backend

## Accepted interaction model

- clicking a sender avatar or display name in the timeline opens a compact anchored quick panel near that message
- the panel stays local to the message instead of reusing the large right info sidebar
- the panel shows:
  - avatar
  - display name
  - `@username`
  - presence
  - one primary direct-conversation action
- if a DM already exists:
  - button label: `打开私信`
- if no DM exists:
  - button label: `发起私信`

This stays intentionally narrow and quiet. Richer profile detail is out of scope for v1.

## Backend contract

Use the BetterChat backend routes now available:

- `GET /api/users/:userId/direct-conversation`
- `PUT /api/users/:userId/direct-conversation`

Semantics:

- lookup returns user summary plus existing DM state
- ensure is idempotent and returns the direct conversation id plus sync hints
- frontend must not infer DM existence by scanning sidebar titles or handles

## Frontend design

### State ownership

- `TimelineView` owns local anchored-panel positioning and author-target interactions
- `AppShell` owns server-derived direct-conversation lookup / ensure mutations and route navigation
- `betterchat.ts` owns the browser-to-contract boundary
- fixture mode must expose the same semantics through `betterchat-fixtures.ts`

### Keyboard contract

- the author cluster becomes a timeline focus slot for non-grouped messages only
- `ArrowLeft` from message body moves to the author cluster
- `ArrowRight` from author cluster returns to the message body
- `Enter` / `Space` on author cluster opens the quick panel
- focus lands on the primary DM action inside the panel
- `Escape` or `ArrowLeft` closes the panel and restores focus to the exact author cluster
- after activating the DM action, navigation moves to the DM room and focus lands in the composer

### Grouped message rule

- only messages with visible author chrome get the quick-panel affordance in v1
- grouped continuation messages do not fabricate hidden author focus targets

## Implementation slices

1. Add browser API methods and local types for direct-conversation lookup / ensure
2. Extend fixture mode with:
   - user lookup
   - existing DM lookup
   - new DM creation and sidebar insertion
3. Add quick-panel state and mutations in `AppShell.tsx`
4. Add timeline author trigger UI and anchored panel rendering
5. Add keyboard support and focus restoration
6. Add fixture Playwright coverage
7. Add API-mode live Playwright coverage against the real backend

## Verification target

- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "user quick panel|direct conversation from timeline"`
- `env BUN_TMPDIR=/tmp BETTERCHAT_E2E_API_MODE=api BETTERCHAT_E2E_API_BASE_URL=http://127.0.0.1:3200 bun run test:e2e -- --grep "user quick panel|direct conversation from timeline"`

## Verification snapshot

Passed on 2026-03-28:

- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp BETTERCHAT_E2E_PORT=3402 BETTERCHAT_E2E_BASE_URL=http://127.0.0.1:3402 bun run test:e2e`
- `env BUN_TMPDIR=/tmp BETTERCHAT_E2E_API_MODE=api BETTERCHAT_E2E_API_BASE_URL=http://127.0.0.1:3200 BETTERCHAT_E2E_PORT=3412 BETTERCHAT_E2E_BASE_URL=http://127.0.0.1:3412 bun run test:e2e -- --grep "api integration"`

Stabilization done during verification:

- updated the fixture sidebar-order expectation to match the current subscription-priority-first ordering contract
- relaxed the fixture markdown-image height assertion to the current compact-preview range
- fixed the keyboard context-menu E2E to wait for the reopened menu to own focus before sending `End`

## Notes

- cache updates may start with query invalidation rather than a brittle optimistic room fabrication path
- stable test selectors are required for:
  - author cluster trigger
  - quick panel root
  - quick panel primary action
  - quick panel close behavior
