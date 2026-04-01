#!/usr/bin/env bash

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
TEST_LICENSE_FILE="$ROOT_DIR/tests/integration/fixtures/rocketchat-test-license.txt"

export BETTERCHAT_TEST_UPSTREAM_URL="${BETTERCHAT_TEST_UPSTREAM_URL:-http://127.0.0.1:3100}"
export BETTERCHAT_TEST_BACKEND_URL="${BETTERCHAT_TEST_BACKEND_URL:-http://127.0.0.1:3200}"
export BETTERCHAT_TEST_MONGO_URL="${BETTERCHAT_TEST_MONGO_URL:-mongodb://127.0.0.1:37017/rocketchat?replicaSet=rs0}"
export BETTERCHAT_TEST_SEED_MANIFEST_PATH="${BETTERCHAT_TEST_SEED_MANIFEST_PATH:-/tmp/betterchat-seed-manifest.json}"
export BETTERCHAT_TEST_SESSION_SECRET="${BETTERCHAT_TEST_SESSION_SECRET:-betterchat-integration-session-secret}"
export BETTERCHAT_TEST_ROCKETCHAT_LICENSE="${BETTERCHAT_TEST_ROCKETCHAT_LICENSE:-$(tr -d '\n' < "$TEST_LICENSE_FILE")}"

clear_seed_manifest() {
  rm -f -- "$BETTERCHAT_TEST_SEED_MANIFEST_PATH"
}
