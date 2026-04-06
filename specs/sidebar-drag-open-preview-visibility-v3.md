# Sidebar Drag-Open Preview Visibility v3

Date: 2026-04-07
Status: landed
Scope: `apps/web/src/features/app-shell/**`, `tests/e2e/**`
Related:
- `specs/sidebar-collapse-expand-behavior-v1.md`
- `specs/sidebar-collapse-settle-correctness-v2.md`

## Problem

After the collapse-settle fix, drag-open from the collapsed rail still has a preview-state bug:

- start from collapsed
- drag the rail right
- the sidebar column opens immediately
- but sidebar content stays hidden until pointer release

This is not a width problem anymore. The width preview is already working.
It is a visibility-state ownership problem during drag preview.

## Design truth

The shell now has at least four distinct concerns:

1. remembered expanded width
2. transient drag preview width
3. settled collapsed preference
4. effective visual collapsed state during drag preview

The current code still conflates (3) and (4).

## Required behavior

### 1. Drag-open preview from collapsed

When the rail is dragged right far enough to produce a non-zero preview width:

- the sidebar width preview must open
- the sidebar content must become visible during the drag
- the settled collapsed preference must remain unchanged until release

### 2. Drag back into collapse zone before release

If the same drag returns into the collapse zone:

- the effective visual collapsed state must switch back to collapsed immediately
- content must hide again during the same drag

### 3. Pointer release

- release above threshold commits expanded state
- release inside collapse zone keeps collapsed state
- preview-only visibility state must be cleared after release

## Non-goals

- no change to desktop resize thresholds
- no change to persisted width behavior
- no mobile redesign

## Acceptance criteria

- during a collapsed-to-open drag preview, `app-sidebar` content is visible before pointer release
- dragging back left during the same gesture hides the content again before release
- release still commits the same final states as v2
- fixture and API-mode browser coverage prove both preview-time and settled-time behavior

## Recommended seam

Introduce an explicit preview visibility override:

- settled `sidebarCollapsed`
- transient preview override for visual collapse state while dragging
- derived `effectiveSidebarCollapsed`

`effectiveSidebarCollapsed` should drive DOM visibility (`data-collapsed`) and preview-facing rail semantics.
Settled `sidebarCollapsed` should continue to own persistence, focus side effects, and final commit logic.

## Landed notes

The landed fix introduced:

- transient preview collapse override in `AppShell`
- derived `effectiveSidebarCollapsed` for DOM visibility and rail UI semantics
- preview-time browser regressions that prove content appears before pointer release
