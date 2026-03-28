#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TUNNEL_CONTAINER="${TUNNEL_CONTAINER:-wis_context_cloudflared_tunnel}"
COMPOSE_NETWORK="${COMPOSE_NETWORK:-shared-dev-context-layer_wis_context_net}"
UPSTREAM_URL="${UPSTREAM_URL:-http://wis_context_mcp:8002}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-60}"

if ! docker compose ps mcp | grep -q "Up"; then
  echo "ERROR: mcp service is not running. Start stack first with: docker compose up --build -d" >&2
  exit 1
fi

docker rm -f "$TUNNEL_CONTAINER" >/dev/null 2>&1 || true

echo "Starting Cloudflare tunnel container: $TUNNEL_CONTAINER"
docker run -d --rm \
  --name "$TUNNEL_CONTAINER" \
  --network "$COMPOSE_NETWORK" \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --url "$UPSTREAM_URL" >/dev/null

public_url=""
for _ in $(seq 1 "$MAX_WAIT_SECONDS"); do
  public_url="$(docker logs "$TUNNEL_CONTAINER" 2>&1 | grep -Eo 'https://[-a-zA-Z0-9]+\.trycloudflare\.com' | head -n1 || true)"
  if [[ -n "$public_url" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$public_url" ]]; then
  echo "ERROR: tunnel URL was not detected within ${MAX_WAIT_SECONDS}s." >&2
  echo "Inspect logs: docker logs $TUNNEL_CONTAINER" >&2
  exit 1
fi

echo
echo "Tunnel ready."
echo "Public base URL: $public_url"
echo "MCP endpoint URL: ${public_url}/mcp"
echo
echo "Tail logs: docker logs -f $TUNNEL_CONTAINER"
echo "Stop tunnel: $ROOT_DIR/scripts/stop_cloudflare_tunnel.sh"
