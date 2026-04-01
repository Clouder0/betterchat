# BetterChat backend fix plan - 2026-03-28

## Scope
Implement the confirmed backend fixes from the latest review pass:
- harness reproducibility under upstream read-only mode
- truthful workspace/conversation capabilities
- deterministic seed + atomic manifest lifecycle
- BetterChat unread-anchor validation
- best-effort presence enrichment
- narrow direct-conversation lookup path
- deterministic directory ordering/version
- best-effort OAuth branch in public bootstrap

## Execution order
1. Harness + seed manifest safety
2. Capability derivation truthfulness
3. Seed unread baseline correctness + verification
4. Public bootstrap OAuth fallback
5. Presence best-effort reads/stream
6. Direct-conversation narrow resolver
7. Unread-anchor route validation
8. Deterministic directory ordering
9. Full backend unit/typecheck run
10. Live stack start + integration test run

## Testing strategy
- Add unit tests for each behavior before/following implementation:
  - capabilities with air-gapped restriction and DM upload predicates
  - OAuth fallback route behavior
  - presence failure degradation for snapshots/direct lookup/stream
  - mark-unread invalid anchor rejection
  - deterministic directory ordering
  - seed manifest atomic lifecycle helpers where practical
- Run live podman stack after harness fixes.
- Keep integration tests authoritative for seeded unread correctness.

## Implementation notes
- The harness now injects Rocket.Chat's upstream CI test license via `tests/integration/fixtures/rocketchat-test-license.txt` so the 7.6.0 stack stays writable instead of falling into the `restricted-workspace` path.
- The seed script now clears stale manifests before reseed, verifies upstream writability, establishes unread fixtures as the final write step, verifies exact unread anchors via `chat.syncMessages`, and writes the manifest atomically.
