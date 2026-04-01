# Keyboard Reply Jump Navigation

Date: 2026-03-28
Owner: frontend session
Status: completed

## Goal

Add a clean keyboard lane for inline reply previews so keyboard users can
discover and execute “jump to original reply” navigation without relying on the
single-key shortcut only.

## Accepted interaction model

- keep `j` as the direct power shortcut
- when a message has `replyTo`:
  - `ArrowRight` from the message body focuses the inline reply preview first
  - `Enter` / `Space` on the reply preview jumps to the original
  - `ArrowRight` again moves into the normal message action lane
  - `ArrowLeft` from the reply preview returns to the message body
  - `ArrowLeft` from the first action returns to the reply preview when present
- after a keyboard reply jump:
  - focus stays on the target message
  - `Escape` on the target message returns to the previous reading snapshot
  - `End` acts like the keyboard fast path to `最新`

## Floating action semantics

- keep the current pointer-visible `返回` button
- keep `最新` hidden immediately after the jump
- reveal `最新` only after the user departs from the jumped context
- keyboard does not need to focus the floating buttons directly for this flow

## Verification

- targeted Playwright for:
  - message body -> reply preview -> actions lane travel
  - preview `Enter` jump
  - jump-session `Escape` return
  - jump-session `End` to latest
- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`

## Verification snapshot

Passed on 2026-03-28:

- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
- `env BUN_TMPDIR=/tmp bun run test:e2e`

Stabilization during verification:

- refreshed the fixture auth-shell assertion to check for no **visible** sidebar
  activity markers, because the nodes are now always rendered and hidden via
  `data-visible`
