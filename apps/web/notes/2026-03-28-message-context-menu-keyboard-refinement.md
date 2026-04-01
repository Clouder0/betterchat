# Message Context Menu Keyboard Refinement

Date: 2026-03-28
Owner: frontend session
Status: completed

## Problem

The message context menu already worked in the narrow mechanical sense, but the
keyboard-opened path still felt weak:

- `Enter` opened the menu, but the source message lost too much visible anchoring
- the first active menu item was not visually distinct enough from hover-only state
- pointer hover could still compete with a keyboard-owned menu, which made the
  interaction model feel unstable

This produced a flow that technically passed tests but still felt detached and
unpolished in real use.

## Fix

1. Treat a keyboard-opened message menu as keyboard-owned until it closes.
2. Keep the source message in a quiet but explicit anchored state while its menu is open.
3. Make the active menu item more legible without introducing heavy chrome.
4. Extend Playwright coverage to verify:
   - keyboard-opened menus keep ownership even if the pointer moves elsewhere
   - the source message stays in a keyboard-context anchor state
   - the first action is explicitly active on open

## Verification

- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "message context menu"`
- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
