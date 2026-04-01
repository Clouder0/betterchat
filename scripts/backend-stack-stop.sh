#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$ROOT_DIR/tests/integration/podman-compose.yml"
TEST_LICENSE_FILE="$ROOT_DIR/tests/integration/fixtures/rocketchat-test-license.txt"

export BETTERCHAT_TEST_ROCKETCHAT_LICENSE="${BETTERCHAT_TEST_ROCKETCHAT_LICENSE:-$(tr -d '\n' < "$TEST_LICENSE_FILE")}"

systemctl --user start podman.socket
podman compose -f "$COMPOSE_FILE" down -v --remove-orphans
