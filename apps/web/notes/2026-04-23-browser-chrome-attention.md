# Browser Chrome Attention

## Problem

Users can miss new BetterChat activity when the tab is backgrounded or buried among
many tabs. The sidebar already knows room attention, but the browser chrome still uses
a static title and favicon.

## Design Contract

- Use existing room attention as the single source of truth.
- Respect room notification preferences so muted rooms and non-interruptive generic
  channel unread do not leak into browser chrome.
- Count visible, attention-worthy unread messages when a room exposes `badgeCount`.
- Treat mention/unread attention without a count as one item rather than dropping it.
- Treat uncounted activity as attention, but do not fabricate a message count.
- Title format:
  - `(N) BetterChat 设计评审` for counted attention.
  - `• BetterChat 设计评审` for uncounted activity only.
  - Restore the base title when attention clears or the shell unmounts.
- Favicon format:
  - Keep the existing BetterChat mark.
  - Add a compact top-right badge for counted attention, capped at `99+`.
  - Add a dot for uncounted activity.
  - Use a distinct mention tone when any counted attention is a mention.
  - Restore the original favicon when attention clears or the shell unmounts.

## Acceptance Tests

- Pure unit tests cover count derivation, notification preference filtering, title
  formatting, count capping, and generated favicon markup.
- AppShell integration test verifies document title and favicon update from sidebar
  attention and restore after unmount.
- Existing unit, typecheck, fixture E2E, and API integration suites remain green.
