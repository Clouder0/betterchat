# BetterChat Backend Integration Harness

Commands:
- `./scripts/backend-stack-start.sh`
- `./scripts/backend-integration-test.sh`
- `./scripts/backend-stack-stop.sh`

Harness notes:
- the scripts start `podman.socket` automatically on this machine
- services run in host network mode to avoid the rootless bridge/nftables failure encountered with the default Podman compose network path
- the Rocket.Chat service is started with the upstream CI test license from `tests/integration/fixtures/rocketchat-test-license.txt` so the seeded mutation flows stay writable under 7.6.0
- seeded room/message ids for the current run are written to `/tmp/betterchat-seed-manifest.json`
- the seed manifest is cleared at harness entry and then written atomically during reseed to avoid stale fixture state after failed runs
- the seed manifest also includes stable user ids for DM/user-route tests
- reseed removes the Alice↔Dana DM test room if a prior run left it behind, so the direct-conversation integration coverage stays reproducible across reruns
- later frontend/backend integration tests should prefer the seed manifest over rediscovering dynamic room ids ad hoc

Ports:
- Rocket.Chat: `3100`
- BetterChat backend: `3200`
- Mongo replica set: `37017`
