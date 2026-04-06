# Deleted Message Tombstone Persistence v1

Date: 2026-04-07
Status: proposed
Scope: `apps/backend/src/**`, `apps/web/src/**`, `tests/**`

## Problem

Deleted messages already have a tombstone presentation in the web timeline, but that state is only reliable in the optimistic local patch / fixture path.

In API-backed mode today:

- deleting a message patches the current timeline cache to `flags.deleted = true`
- then the app invalidates and refetches the canonical timeline
- the backend timeline no longer contains the deleted message
- so the tombstone disappears
- browser refresh shows the same disappearance

## Design truth

The product requirement is not “show a transient local delete placeholder.”

It is:

- a deleted message remains represented in the main timeline
- that representation survives canonical refetches
- that representation survives browser refresh

So tombstones must be part of the canonical BetterChat snapshot contract, not only a frontend optimistic patch.

## Required behavior

### 1. Main timeline tombstone

After deletion, the message must remain in the main conversation timeline with:

- same message id
- same authored timestamp
- same author identity lane
- `state.deleted === true`
- empty body / deleted placeholder rendering
- no edit/delete/reply/forward actions

### 2. Persistence across refetch / refresh

After any canonical timeline refetch or browser refresh:

- the deleted message must still appear as a tombstone

### 3. Hard-delete upstream compatibility

Even if the upstream system hard-deletes the message from raw history, BetterChat should still be able to project the tombstone in its own canonical snapshots.

## Non-goals

- no attempt to resurrect original deleted content
- no server-restart durability requirement in this pass unless explicitly needed
- no redesign of deleted-message visuals in this pass

## Acceptance criteria

- API-mode delete leaves a visible tombstone in the main timeline
- the tombstone remains after refresh
- fixture mode still works
- backend integration and API-mode browser coverage prove the persisted tombstone path

## Recommended seam

Introduce a backend-owned deleted-message tombstone overlay:

- capture the pre-delete message snapshot before deletion
- convert it to a canonical tombstone record
- merge tombstones into conversation timeline snapshots when the upstream history no longer returns that message

The frontend already knows how to render `flags.deleted`; the missing piece is canonical snapshot ownership.
