#!/usr/bin/env bash
set -euo pipefail

TUNNEL_CONTAINER="${TUNNEL_CONTAINER:-wis_context_cloudflared_tunnel}"

if docker ps --format '{{.Names}}' | grep -qx "$TUNNEL_CONTAINER"; then
  docker rm -f "$TUNNEL_CONTAINER" >/dev/null
  echo "Stopped tunnel container: $TUNNEL_CONTAINER"
else
  echo "Tunnel container is not running: $TUNNEL_CONTAINER"
fi
