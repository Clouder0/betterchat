# Sidebar Collapse / Expand Behavior v1

Date: 2026-04-07
Status: landed
Scope: `apps/web/src/features/app-shell/**`, `tests/e2e/**`

## Problem

The desktop left sidebar can be collapsed until only the rail remains visible.

In the collapsed state, the visible affordance advertises expand semantics, but a normal pointer click does not restore the sidebar. The current implementation routes every pointer sequence through resize completion logic, so a collapsed click begins from width `0` and completes back into the collapsed state.

This is a semantic contract bug, not a data-loading bug.

## Goals

- make the collapsed affordance actually expand the sidebar on a normal click
- preserve drag-to-resize behavior without inventing a second width source of truth
- preserve existing keyboard and double-click flows unless the spec explicitly changes them
- verify visible content after expand, not only a boolean collapsed flag

## Interaction contract

### 1. Expanded state

- the rail is primarily a resize boundary
- single click is a no-op
- drag resizes the sidebar width
- double click toggles collapse
- keyboard behavior remains unchanged from the current desktop contract

### 2. Collapsed state

- the visible rail is primarily an expand affordance
- a single click expands the sidebar to the last committed expanded width, clamped to the current desktop bounds
- a drag right from the collapsed rail expands and commits the dragged width
- a pointer sequence that never becomes a meaningful drag and never leaves the collapsed zone must not be treated as a resize attempt
- once expanded, sidebar content becomes visible and interactive in the same interaction flow

### 3. Width ownership

- collapsing the sidebar must not destroy the last committed expanded width preference
- click-to-expand restores the stored width rather than synthesizing a new one from DOM measurements
- collapsed-state drag can update the stored width only when the user performs a real resize gesture

### 4. Behavioral truth over label text

- any visible label or `aria-label` that says "expand sidebar" must correspond to an actual pointer-expand path
- tests must assert content visibility after expand, not just `data-collapsed="false"`

## Non-goals

- no mobile shell redesign
- no sidebar data-query refactor
- no broader shell layout rewrite

## Acceptance criteria

- a new failing regression test reproduces: collapse -> single click on the collapsed rail -> sidebar stays hidden
- after implementation, that same interaction expands the sidebar and reveals visible sidebar content
- expand restores the prior committed width within ordinary transition tolerance
- existing desktop keyboard, double-click, and drag-resize behavior continues to pass
- desktop width persistence after reload remains intact

## Recommended seam

- add a small pure helper that decides pointer-completion outcome from explicit inputs:
  - collapsed vs expanded
  - drag vs click
  - raw width / threshold
- let `AppShell` own state updates, but keep the interaction decision itself unit-testable

## Deferred alternative

A dedicated collapsed-only expand button would make semantics more explicit, but it adds DOM and styling churn on top of the existing rail. The first implementation pass should fix the ownership boundary directly before considering a visual affordance split.
