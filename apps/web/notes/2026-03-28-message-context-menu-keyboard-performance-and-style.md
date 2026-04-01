# Message Context Menu Keyboard Performance And Style

Date: 2026-03-28
Owner: frontend session
Status: completed

## Problem

The keyboard-opened message context menu still feels laggy under arrow-key travel, and the active-item styling has one redundant detail:

1. arrow navigation feels sluggish instead of crisp
2. the thin left selection line on the active item is visually noisy and unnecessary

## Root-cause hypothesis

The active menu index currently lives in the top-level `TimelineView` state.

That means every `ArrowUp` / `ArrowDown` press re-renders the full timeline tree just to move a menu highlight. In a chat timeline, that is the wrong level for this state and can make keyboard travel feel delayed.

## Intended fix

1. move context-menu-local keyboard selection state into the menu layer itself so arrow travel only re-renders the menu
2. keep keyboard fallback capture for menus opened by keyboard
3. simplify the active-item styling to rely on background / text emphasis only, without the left vertical line

## Implemented fix

1. Extracted the keyboard-owned menu selection flow into a dedicated `MessageContextMenuLayer` so `ArrowUp` / `ArrowDown` no longer drive `TimelineView`-wide re-renders.
2. Kept the existing keyboard-capture fallback for keyboard-opened menus, but moved it into the menu layer so focus handoff stays local and immediate.
3. Removed the redundant left selection line and kept the active state quiet through background, text, and a subtle inset outline only.

## Verification

Passed on 2026-03-28:

- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "message context menu|keyboard-opened|rapid arrow travel and uses background-only active styling"`
- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
