# Sidebar Continuous Preview Width v4

Date: 2026-04-07
Status: landed
Scope: `apps/web/src/features/app-shell/**`, `tests/e2e/**`
Related:
- `specs/sidebar-collapse-settle-correctness-v2.md`
- `specs/sidebar-drag-open-preview-visibility-v3.md`

## Problem

Desktop sidebar drag resize currently has a UX discontinuity near collapse:

- settled expanded width has a minimum of `248px`
- collapse snap threshold is `120px`
- preview width is clamped to the settled minimum

So the visual motion does:

- `248px -> 0px` when closing through the threshold
- `0px -> 248px` when opening back past the threshold

This feels like a jump, not a continuous drag.

## Design truth

There are two different contracts:

1. **settled width contract**
   - final expanded width must be `>= min`
   - final collapsed width is `0`
2. **preview width contract**
   - while dragging, width should visually track the pointer continuously

Those contracts should not be forced into the same clamp.

## Required behavior

### 1. Continuous preview

While dragging, the sidebar preview width may move continuously from:

- `0..max`

including the region below the settled minimum.

### 2. Snap only on release

When the pointer is released:

- raw width below collapse threshold => settle to `0`
- raw width above collapse threshold => settle to expanded width, clamped to the settled min/max rules

### 3. Preview visibility semantics remain correct

- below threshold, the shell may still be in preview-collapsed mode
- above threshold, content may preview open before release

## Acceptance criteria

- dragging closed shows intermediate preview widths between `248` and `0`
- dragging open shows intermediate preview widths between `0` and `248`
- release behavior remains unchanged
- unit, fixture browser, and API-mode browser coverage prove the sub-min preview path

## Recommended seam

Keep two explicit width primitives:

- settled width clamp: `min..max`
- preview width clamp: `0..max`

Preview logic should use the preview clamp.
Commit logic should keep using the settled clamp.

## Landed notes

The landed fix:

- introduced preview-only width clamping `0..max`
- kept settled width clamping at `min..max`
- updated drag regressions to assert real intermediate widths while the pointer is still down
