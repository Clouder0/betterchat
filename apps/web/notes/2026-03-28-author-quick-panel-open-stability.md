# Author Quick Panel Open Stability

Date: 2026-03-28
Owner: frontend session
Status: completed

## Problem

Opening the timeline author quick panel can show a brief content flicker.

Observed shape:

- pointer hover/click opens the panel
- the panel can paint once in a loading state
- a second paint replaces that loading state with resolved direct-conversation data

This makes the quick panel feel unstable even though the underlying interaction succeeds.

## Root cause hypothesis

- direct-conversation lookup starts only after the panel is opened
- the panel therefore mounts before the lookup cache is warm
- fixture mode makes this especially visible because it has an artificial network delay

## Fix

1. Prefetch the direct-conversation lookup when the user hovers or focuses an author trigger.
2. Give the lookup query a short `staleTime` so opening the panel right after hover/focus uses warm cached data instead of immediately re-entering a loading path.
3. Move author-lane `ArrowUp` / `ArrowDown` over visible author anchors only, so grouped continuation messages cannot steal the jump target.
4. Strengthen author-cluster feedback:
   - keyboard-focused author lane now highlights both avatar and author line
   - quick-panel primary action focus is more explicit
5. Remove the sidebar quiet-activity dot so the sidebar uses:
   - mention marker
   - unread number
   - row emphasis only for quiet activity

## Verification

- targeted fixture E2E around author quick-panel warm open
- `env BUN_TMPDIR=/tmp bun run test:web`
- targeted or broader fixture Playwright as needed

Passed on 2026-03-28:

- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp BETTERCHAT_E2E_PORT=3402 BETTERCHAT_E2E_BASE_URL=http://127.0.0.1:3402 bun run test:e2e`
- `env BUN_TMPDIR=/tmp BETTERCHAT_E2E_API_MODE=api BETTERCHAT_E2E_API_BASE_URL=http://127.0.0.1:3200 BETTERCHAT_E2E_PORT=3412 BETTERCHAT_E2E_BASE_URL=http://127.0.0.1:3412 bun run test:e2e -- --grep "api integration"`
