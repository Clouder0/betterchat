#!/usr/bin/env bash
# Dispatch to podman compose or docker compose.
# Override with COMPOSE_TOOL="docker compose" or "podman compose".
set -euo pipefail

TOOL="${COMPOSE_TOOL:-}"
if [ -z "$TOOL" ]; then
  if command -v podman &>/dev/null; then
    TOOL="podman compose"
  else
    TOOL="docker compose"
  fi
fi

exec $TOOL "$@"
