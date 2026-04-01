## Goal

Close the two confirmed backend review findings from the latest pass:

1. Conversation capabilities overclaim writable actions because they ignore room/subscription restrictions.
2. The integration harness can leave a stale seed manifest behind when startup fails before the seed script runs.

## Constraints

- Backend-only scope.
- No contract churn unless required; fix current contract truthfulness first.
- Prefer root-cause fixes over endpoint-local patches.
- Add tests before the implementation where practical.

## Design

### Capability projection

- Extend upstream room/subscription types with the Rocket.Chat fields already published by `rooms.get`, `rooms.info`, and `subscriptions.get`.
- Replace the current workspace-only capability projection with a projector that considers:
  - workspace write restriction
  - room readonly / archived
  - room reaction policy in readonly rooms
  - room mute state for the current user
  - subscription blocked / blocker state
- Keep delete/reaction capability checks aligned with the specific upstream guards we can prove from current Rocket.Chat behavior; do not invent a broader permission system in this pass.
- Keep non-write capabilities (`star`, `hide`, `markRead`, `markUnread`, thread support) unchanged.
- Thread reply capabilities follow main send capability because Rocket.Chat uses the same send guard for thread posts.

### Harness manifest cleanup

- Clear the configured seed manifest path at the start of the shell entrypoints, before compose/wait logic.
- Keep the seed script’s own clear + atomic write as a second line of defense.
- Avoid duplicating logic if a shell helper keeps the scripts simple.

## Test plan

- Unit tests for capability projection:
  - readonly room disables send/edit/delete and disables react unless `reactWhenReadOnly` is true
  - muted current user disables send/edit/react
  - blocked subscription disables send/edit
  - archived room disables send/edit/upload
  - workspace restriction still disables write-related capabilities
- Script-level regression test for manifest cleanup helper if introduced.
- Verification:
  - targeted unit tests
  - backend package tests
  - backend typecheck
  - test-utils tests/typecheck
  - live integration harness
