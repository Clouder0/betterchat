#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/backend-harness-common.sh"
COMPOSE_FILE="$ROOT_DIR/tests/integration/podman-compose.yml"

compose() {
  podman compose -f "$COMPOSE_FILE" "$@"
}

ensure_podman_socket() {
  systemctl --user start podman.socket
}

wait_for_mongo() {
  local attempts=${1:-60}

  for ((i = 1; i <= attempts; i += 1)); do
    if compose exec -T mongo mongosh --quiet --port 37017 --eval "db.adminCommand({ ping: 1 }).ok" >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
  done

  echo "MongoDB did not become ready in time" >&2
  return 1
}

init_mongo_replica_set() {
  compose exec -T mongo mongosh --quiet --port 37017 --eval "try { rs.status().ok } catch (error) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:37017' }] }).ok }" >/dev/null
}

clear_seed_manifest
ensure_podman_socket
compose up -d --build
wait_for_mongo
init_mongo_replica_set
bun run "$ROOT_DIR/scripts/wait-backend-stack.ts"
bun run "$ROOT_DIR/scripts/seed-backend-fixtures.ts"
