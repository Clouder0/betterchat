#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/backend-harness-common.sh"

SMOKE_GREP="${BETTERCHAT_E2E_API_SMOKE_GREP:-(loads the anonymous login page without protected-route or favicon console noise|establishes realtime watch subscriptions and does not replay them after cached versions advance|persists deleted-message tombstones across browser refresh in API mode)}"

clear_seed_manifest
bun run "$ROOT_DIR/scripts/wait-backend-stack.ts"
bun run "$ROOT_DIR/scripts/seed-backend-fixtures.ts"
env \
	BUN_TMPDIR="${BUN_TMPDIR:-/tmp}" \
	BETTERCHAT_E2E_API_MODE=api \
	BETTERCHAT_E2E_API_BASE_URL="${BETTERCHAT_E2E_API_BASE_URL:-http://127.0.0.1:3200}" \
	bun --cwd "$ROOT_DIR/tests/e2e" test api-integration.spec.ts --grep "$SMOKE_GREP"
