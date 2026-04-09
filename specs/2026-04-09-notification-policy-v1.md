# Notification Policy v1

Date: 2026-04-09
Scope: `apps/web/**`, `tests/e2e/**`

## Problem

BetterChat currently conflates room importance and browser delivery into a binary local flag:

- `subscribed`
- `normal`

That model is too coarse:

- channels are too noisy by default
- muted rooms still compete for interruptive surfaces
- the room header control is a binary toggle, but the product needs richer semantics
- browser permission is requested from room-level intent, which is the wrong boundary

## Product model

Separate **room importance** from **browser delivery**.

### Room importance (per room)

Effective room notification preference:

- `all`
- `personal`
- `mute`

Stored room overrides only persist non-default values.

### Default room importance (workspace-local for now)

- DM default: `all`
- Channel/group default: `personal`

### Browser delivery (per browser)

- `off`
- `foreground`
- `background` (reserved; current build reports unsupported and does not enable selection)

## Policy rules

### Truth vs interruption

Unread truth remains visible in the room row regardless of preference.

Interruptive surfaces must respect room importance:

- attention dock
- browser notifications

### Event classification

Current frontend inference:

- mentions are `personal`
- DM unread/activity is `personal`
- non-DM unread/activity is `general`

### Preference effect

- `all`: allow personal + general interruption
- `personal`: allow personal interruption only
- `mute`: suppress interruptive surfaces

## UX changes

1. Replace header bell toggle with a popover menu:
   - follow default
   - all messages
   - personal only
   - mute
2. Add browser notification delivery controls to settings panel.
3. Add default room notification controls to settings panel:
   - DMs
   - channels/groups
4. Update info sidebar summary to show:
   - effective room preference
   - whether it follows default
   - browser delivery on this browser
   - effect summary
5. Request browser permission only when enabling browser delivery, not when changing room importance.

## Non-goals in this pass

- no service worker
- no Push API backend delivery
- no server persistence of room preferences yet

## Verification

- unit: storage + migration + policy evaluation
- unit: attention dock filtering
- unit: browser notification gating
- unit: sidebar ordering preference tiers
- API E2E: default channel personal-only behavior, DM default all behavior, mute suppression, all-messages override behavior
