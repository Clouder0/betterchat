# BetterChat Scripts

Current reproducible backend entrypoints:
- `backend-stack-start.sh`
- `backend-stack-stop.sh`
- `backend-integration-test.sh`
- `wait-backend-stack.ts`
- `seed-backend-fixtures.ts`

Behavior:
- `backend-stack-start.sh` starts `podman.socket` automatically before `podman compose`
- the integration harness runs on fixed host ports: Rocket.Chat `3100`, BetterChat backend `3200`, Mongo replica set `37017`
- the Rocket.Chat container receives the upstream CI test license from `tests/integration/fixtures/rocketchat-test-license.txt` so write-path integration coverage remains reproducible under 7.6.0
- Mongo replica-set initialization is explicit inside the script; no manual local setup is required
- the seed script writes a runtime manifest to `/tmp/betterchat-seed-manifest.json`
- the seed script removes stale manifests first, verifies the workspace is writable, verifies exact unread baselines for the seeded unread rooms, and then writes the manifest atomically
- the seeded workspace now includes multiple channels, private rooms, DMs, unread state, hidden state, reply state, image state, stable DM presence baselines, and stable user ids for user-scoped DM tests

Prefer small explicit scripts over undocumented shell history.
