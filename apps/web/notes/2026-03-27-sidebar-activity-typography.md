# Sidebar Activity-Only Attention Refinement

Date: 2026-03-27
Owner: frontend session
Scope: BetterChat web sidebar UX
Status: completed

## Problem

The sidebar previously used a small green dot in the right signal lane for
`attention.level === 'activity'`.

That was semantically ambiguous:

- dots read as presence
- green reads as online
- but the signal actually meant low-priority room activity without an exact unread badge

## Design decision

Remove the dedicated activity dot entirely.

Use typography hierarchy instead:

- quiet rooms: slightly softer title/status tone
- activity-only rooms: stronger title/status tone
- unread rooms: stronger title plus unread badge
- mentioned rooms: mention styling plus mention/unread signals

This keeps:

- presence near the avatar
- attention in the right signal lane only for explicit mention/unread badges
- activity-only as a quiet but readable state

## Implementation notes

- sidebar rows now expose `data-attention-level`
- activity-only no longer renders a separate signal element
- API integration test now asserts the room row attention level directly

## Verification

- targeted API integration sidebar test
- `env BUN_TMPDIR=/tmp bun run test:web`
- `env BUN_TMPDIR=/tmp bun run typecheck:web`
- `env BUN_TMPDIR=/tmp bun run build:web`
