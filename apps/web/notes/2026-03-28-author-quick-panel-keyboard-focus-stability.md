# Author Quick Panel Keyboard Focus Stability

Date: 2026-03-28
Owner: frontend session
Status: completed

## Problem

Keyboard-opening the timeline author quick panel can disturb the timeline keyboard anchor.

Observed user-facing failure:

- focus a timeline message with the keyboard
- move left to the author trigger
- press `Enter` to open the author quick panel
- the quick panel opens, but the timeline keyboard cursor can jump away from the source message toward the top of the viewport

This makes the panel feel unreliable and breaks follow-up arrow travel.

## Root cause

Timeline viewport sync was still allowed to rewrite `focusedMessageId` while the keyboard-owned author quick panel was open.

That path is normally useful when focus truly leaves the timeline, but in this case it is wrong:

- the quick panel intentionally lives in a portal outside the timeline container
- its primary action takes DOM focus
- viewport sync then sees "focus is outside the timeline" and can fall back to the viewport anchor instead of preserving the author-panel source message

So the DOM focus was correct, but the timeline keyboard anchor could drift.

## Intended behavior

1. Opening the author quick panel from the keyboard keeps the originating message as the timeline anchor.
2. While the author quick panel is open, viewport-sync logic must not overwrite that anchor.
3. Closing or traversing away from the quick panel resumes from that same message cluster, not from a viewport-derived fallback.

## TDD / verification

Add or strengthen Playwright coverage for:

- keyboard focus message → author trigger → `Enter`
- quick panel primary action receives DOM focus
- originating message keeps `data-keyboard-focused="true"` while the quick panel is open
- `ArrowUp` / `ArrowDown` continues from the originating author trigger instead of jumping to a top message

Planned verification:

- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "author quick panel"`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`

## Fix

1. Treat keyboard-owned author quick panels like other keyboard overlays during viewport-sync.
2. Preserve the originating timeline message as the active keyboard anchor until the panel is closed or explicit traversal resumes.
3. Strengthen Playwright coverage so a viewport-sync trigger (`resize`) cannot steal the row-level keyboard anchor while the quick panel is open.

## Verification

Passed on 2026-03-28:

- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "author quick panel"`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
