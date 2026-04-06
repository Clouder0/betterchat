# Sidebar Collapse Settle Correctness v2

Date: 2026-04-07
Status: landed
Scope: `apps/web/src/features/app-shell/**`, `tests/e2e/**`
Related: `specs/sidebar-collapse-expand-behavior-v1.md`

## Problem

After the earlier click-expand fix, a second regression remains on the desktop sidebar rail:

- drag the rail hard left into the collapse zone
- release
- the shell can bounce back to the old width
- in some runs the column reappears but the sidebar content is blank

This is not a data-fetching problem. It is a state-settle correctness problem at the resize/collapse boundary.

## Design truth

The sidebar shell has three distinct concerns:

1. **Persisted expanded width**
   - the user’s remembered desktop width
2. **Transient drag preview width**
   - a temporary visual value while the pointer is dragging
3. **Collapsed visibility state**
   - whether the sidebar content should be hidden and non-interactive

These must never fight each other.

## Required behavior

### 1. Drag preview above the collapse threshold

- the live preview may use a transient width
- the pending preview may be flushed to the workspace during active drag

### 2. Drag preview inside the collapse zone

- the live preview must become width `0`
- any previously queued non-zero preview width must be invalidated immediately
- the system must not retain a stale expanded preview that can be replayed on release

### 3. Pointer release inside the collapse zone

The final settled state must converge to:

- `sidebarCollapsed === true`
- workspace sidebar width `0px`
- no pending non-zero sidebar preview width
- sidebar content hidden and non-interactive because the shell is truly collapsed, not because width/content state drifted apart

### 4. Later expand after a drag-collapse

- expanding afterward must restore the remembered expanded width
- content must be visible immediately after expand

## Non-goals

- no mobile redesign
- no sidebar data-query changes
- no new affordance split for the rail in this pass

## Acceptance criteria

- a new regression test reproduces: drag left into collapse zone -> release -> shell bounces back or becomes visually blank
- after implementation, the same interaction settles to a true collapsed state after a short post-release wait
- no stale preview width is reapplied during collapse completion
- fixture and API-mode browser coverage both prove the settled post-release state

## Recommended seam

Introduce explicit preview-state semantics instead of one overloaded “flush” operation:

- **flush preview**
  - apply pending preview width intentionally
- **discard preview**
  - cancel RAF work and clear pending preview width without applying it

Collapse completion must use discard semantics, not flush semantics.

## Landed notes

The landed fix needed both state and layout correctness:

- collapse paths now discard stale preview state instead of replaying it
- settled sidebar width sync now respects `sidebarCollapsed`
- collapsed sidebar chrome no longer keeps padding that leaves a blank residual strip
