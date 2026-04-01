# Timeline Panel Keyboard Exit Semantics

Date: 2026-03-28
Owner: frontend session
Status: completed

## Problem

Two timeline keyboard overlays still exit in a way that feels inconsistent:

1. keyboard-opened message context menus only close back to the current message on `ArrowLeft`, not `ArrowRight`
2. keyboard-opened author quick panels still treat `ArrowLeft` like "back to author trigger", while the desired flow is:
   - `ArrowLeft` → leave the panel toward the sidebar
   - `ArrowRight` → return to the current message

This makes panel exit directionally ambiguous and breaks the smooth left/right travel model of the rest of the timeline.

## Intended behavior

### Message context menu

- `ArrowLeft` closes the panel and focuses the current message
- `ArrowRight` also closes the panel and focuses the current message

### Author quick panel

- `ArrowUp` / `ArrowDown` keep their existing adjacent-message travel semantics
- `ArrowLeft` closes the panel and moves focus to the sidebar
- `ArrowRight` closes the panel and returns focus to the current message

## Verification

Implemented:

- message context menu now treats both `ArrowLeft` and `ArrowRight` as "close back to current message"
- author quick panel now uses:
  - `ArrowLeft` → close panel and move to sidebar
  - `ArrowRight` → close panel and return to current message
  - `Escape` still restores the author trigger

Passed on 2026-03-28:

- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "message context menu|author quick panel"`
- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
