# Sidebar Order Stability Refinement Plan

Date: 2026-03-27
Owner: frontend session
Scope: `apps/web/**`, `tests/e2e/**`
Status: completed

## Problem

Current sidebar ordering is too mechanically tied to immediate unread state.

When the active room is opened and reaches read state:

- unread or mention attention clears immediately
- the active room can fall to a lower bucket immediately
- the sidebar reorders in-place while the user is still reading that room

This is logically consistent but UX-hostile.

## Design goal

Keep sidebar ordering:

1. stable while the user is actively reading the current room
2. responsive when genuinely higher-priority rooms receive new activity
3. grounded in BetterChat canonical attention facts rather than invented unread counts

## Refined rule

Keep the canonical sort spine:

1. local alert preference
2. mention / unread / activity / none
3. last activity time
4. localized title

Add a frontend-local ordering overlay:

- promotion is immediate
  - a room that gains mention/unread/activity rises immediately
- demotion of the active room is held
  - if the currently open room clears from mention/unread/activity to none, preserve its prior attention bucket while it remains active
- once the user leaves that room, remove the hold and let the room settle back to its true quiet position

This preserves stable reading while still letting new important rooms rise above.

## Implementation shape

- add a pure sidebar ordering state helper under `features/sidebar/`
- track:
  - latest attention timestamp
  - active-room demotion hold bucket
- feed that local ordering state into sidebar sorting
- keep this as UI-only React state/ref logic

## Tests first

Unit:

- active room does not immediately drop when unread clears
- held active room still yields to genuinely newer unread/mention rooms
- held room settles back after the active room changes

Browser:

- API-mode room with unread clears after being read, but remains stable in the sidebar while active
- after leaving that room, normal quiet ordering resumes

## Completed

- added a frontend-local sidebar ordering overlay that preserves the active room's prior attention bucket while it stays open
- kept canonical promotion behavior intact so newer mention/unread/activity rooms still rise immediately
- wired the ordering overlay into `AppShell` without changing backend contracts
- added unit coverage for hold, promotion, and settle behavior
- added fixture and API Playwright coverage for sidebar ordering regression cases

## Verification

- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "persists local normal-priority markers and reorders rooms by subscription priority, mention, and latest activity"`
- `env BUN_TMPDIR=/tmp BETTERCHAT_E2E_API_MODE=api BETTERCHAT_E2E_API_BASE_URL=http://127.0.0.1:3200 bun run test:e2e -- --grep "keeps the active room stable in the DM list after unread clears and settles once the user leaves"`
- `./scripts/backend-integration-test.sh`
