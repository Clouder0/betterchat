# Room Header Presence Clipping Fix

Date: 2026-03-27
Owner: frontend session
Scope: `apps/web/**`, `tests/e2e/**`
Status: completed

## Problem

In DM headers, the inline status text under the title could clip the lower edge of
Latin handle text such as `@charlie`.

The root cause was not the data, but the presentation box:

- very tight line-height
- ellipsis span with `overflow: hidden`
- insufficient bottom breathing room for mixed Latin/CJK glyph metrics

## Fix

- slightly relax the presence row line-height
- give the text span its own line-height and a tiny bottom inset
- keep the visual style concise; no layout redesign

## Verification

- `env BUN_TMPDIR=/tmp bun run test:e2e -- --grep "shows DM presence in the room header while keeping sidebar labels concise"`
- `env BUN_TMPDIR=/tmp bun run build:web`
