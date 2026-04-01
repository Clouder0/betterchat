#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/backend-harness-common.sh"

clear_seed_manifest
bun run "$ROOT_DIR/scripts/wait-backend-stack.ts"
bun run "$ROOT_DIR/scripts/seed-backend-fixtures.ts"
bun test "$ROOT_DIR/tests/integration/backend.integration.test.ts"
