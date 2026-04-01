# Author Lane Avatar Feedback Refinement

Date: 2026-03-28
Owner: frontend session
Status: completed

## Problem

The timeline author lane mixed two different affordances:

- pointer hover on the display name behaved like a compact meta hover
- keyboard `ArrowLeft` into the author lane reused that same presentation even
  though the movement semantics are spatially leftward toward the avatar lane

This made keyboard author travel feel visually misaligned. Avatar hover also
needed clearer direct feedback on the avatar itself.

## Fix

1. Split author-lane presentation into:
   - `avatar`
   - `meta`
2. Keep pointer name behavior as-is.
3. Strengthen avatar hover/focus feedback directly on the avatar shell.
4. Render keyboard-entered author focus as `avatar` presentation.
5. Keep keyboard-opened author quick-panel state aligned with the avatar
   presentation rather than falling back to a name-hover look.

## Verification

- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "author quick panel|author lane|avatar"`
- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
