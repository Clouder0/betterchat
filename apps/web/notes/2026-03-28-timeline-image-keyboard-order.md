# Timeline Image Keyboard Order

Date: 2026-03-28
Owner: frontend session
Status: completed

## Problem

Timeline keyboard traversal currently skips inline / attachment images when moving right from a message row.

That makes image-heavy messages feel inconsistent:

- reply previews participate in the horizontal keyboard path
- images do not
- users cannot naturally reach an image before the reply / forward actions

## Intended interaction

Within one message, horizontal keyboard travel should follow the reading / interaction order:

1. message row
2. reply preview, if present
3. first focusable image, if present
4. reply action
5. forward action

Leftward travel should unwind the same path in reverse.

## Implementation notes

1. Keep the ordering logic explicit in a pure helper with tests.
2. Add a timeline-only image focus path:
   - focus the first focusable viewer-enabled image in the message
   - preserve the message as the keyboard anchor
3. Wire image key handling so:
   - left returns to the previous intra-message stop
   - right advances to reply / forward actions
   - up / down continue the vertical timeline flow
4. Cover the real user path in Playwright.

## Verification

- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "routes timeline keyboard focus through images before reply and forward actions"`
- `env BUN_TMPDIR=/tmp bun run test:e2e -- image-viewer.spec.ts`
- `env BUN_TMPDIR=/tmp bun run test:e2e -- auth-and-shell.spec.ts`
- `env BUN_TMPDIR=/tmp bun run build:web`
