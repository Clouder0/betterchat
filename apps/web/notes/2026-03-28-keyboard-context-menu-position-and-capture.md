# Keyboard Context Menu Position And Capture

Date: 2026-03-28
Owner: frontend session
Status: completed

## Problem

The message context menu still had two weak points in keyboard mode:

1. the keyboard-opened anchor leaned too far toward the far right edge of the
   message body, which felt detached from the current reading focus
2. arrow navigation depended too heavily on focus already living inside the menu;
   if focus ownership drifted, arrows could fall back into the timeline instead
   of continuing menu travel

## Fix

1. Re-anchor keyboard-opened menus closer to the message body’s working area
   instead of the far-right edge.
2. Keep the existing in-menu key handler, but add a capture-phase fallback for
   keyboard-opened menus so arrow/home/end/tab/enter/escape still route to the
   menu even when focus momentarily slips outside the menu shell.

## Verification

- targeted Playwright for:
  - keyboard-opened menus opening in a less right-biased position
  - keyboard-opened menus still capturing arrows when focus briefly falls back
    to the source message
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "message context menu|keyboard-opened"`
