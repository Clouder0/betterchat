# Composer Resize Handle Keyboard Parity

Date: 2026-03-28
Owner: frontend session
Status: completed

## Problem

The composer resize handle regressed in keyboard use.

Observed failure:

- hover the pointer over the timeline
- focus the composer resize handle by keyboard
- press `Enter` to enter adjust mode
- `ArrowUp` / `ArrowDown` can get stolen by the global timeline pointer-handoff path instead of resizing the composer

That breaks parity with the sidebar resize handle.

## Root cause hypothesis

The global pointer-to-timeline keyboard entry logic decides whether to hijack arrow keys based on `resolveElementKeyboardRegion(document.activeElement)`.

The resize handles were not recognized as any keyboard region, so they looked like `null`.

When the pointer was last over the timeline, the global capture handler could therefore treat the resize handle as "outside any active region" and redirect arrows into the timeline before the handle’s own `onKeyDown` ran.

## Intended fix

1. Treat both resize handles as explicit keyboard regions for routing purposes.
2. Keep the composer handle’s semantics aligned with the sidebar handle:
   - `Enter` toggles adjust mode
   - arrows resize only while adjusting
   - `Enter` exits adjust mode
   - adjacent arrows resume focus travel when not adjusting
3. Add Playwright coverage for the regression path where the pointer is still over the timeline.

## Implemented fix

1. Extended `resolveElementKeyboardRegion(...)` so:
   - `sidebar-resize-handle` resolves to the sidebar region
   - `composer-resize-handle` resolves to the composer region
2. This prevents the global pointer-to-timeline keyboard capture from hijacking resize-handle arrow keys before the handle’s own keyboard logic runs.
3. Added Playwright coverage for:
   - normal composer resize drag + keyboard flow
   - the regression case where the pointer last hovered the timeline before keyboard adjustment starts

## Verification

Passed on 2026-03-28:

- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "composer resize handle keyboard-adjustable even when the pointer last hovered the timeline|supports dragging the composer boundary to resize the send area and persists the height after reload"`
- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
