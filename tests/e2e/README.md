# BetterChat frontend e2e tests

Default mode is fixture-first.

The browser suite is intentionally split:
- fixture-only specs cover the dense UI and interaction surface quickly
- API-mode specs cover real BetterChat backend integration against the seeded stack

## Run

From repo root:

- `env BUN_TMPDIR=/tmp bun run test:e2e`

Or directly:

- `env BUN_TMPDIR=/tmp bun --cwd tests/e2e test`

## Backend-integrated mode

The Playwright config is parameterized so the browser suite can run against the BetterChat backend:

- `BETTERCHAT_E2E_API_MODE=api`
- `BETTERCHAT_E2E_API_BASE_URL=http://127.0.0.1:3200`

Example:

- `env BUN_TMPDIR=/tmp BETTERCHAT_E2E_API_MODE=api BETTERCHAT_E2E_API_BASE_URL=http://127.0.0.1:3200 bun run test:e2e`

When `BETTERCHAT_E2E_API_MODE=api`:
- fixture-only specs are skipped
- `api-integration.spec.ts` is enabled
- the suite expects a seeded BetterChat stack and `/tmp/betterchat-seed-manifest.json` unless `BETTERCHAT_TEST_SEED_MANIFEST_PATH` overrides it

## Browser

The suite uses system Chromium by default:

- `/usr/bin/chromium`

Override with `BETTERCHAT_E2E_CHROMIUM_PATH` if needed.
