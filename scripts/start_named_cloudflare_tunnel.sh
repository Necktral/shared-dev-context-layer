#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TUNNEL_CONTAINER="${TUNNEL_CONTAINER:-wis_context_cloudflared_named_tunnel}"
COMPOSE_NETWORK="${COMPOSE_NETWORK:-shared-dev-context-layer_wis_context_net}"
UPSTREAM_URL="${UPSTREAM_URL:-http://wis_context_mcp:8002}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-60}"

if [[ -z "${CF_NAMED_TUNNEL_TOKEN:-}" ]]; then
  echo "ERROR: CF_NAMED_TUNNEL_TOKEN is required for named tunnel startup." >&2
  exit 1
fi

if [[ -z "${CF_MCP_PUBLIC_BASE_URL:-}" ]]; then
  echo "ERROR: CF_MCP_PUBLIC_BASE_URL is required (example: https://mcp.dev.example.com)." >&2
  exit 1
fi

if ! docker compose ps mcp | grep -q "Up"; then
  echo "ERROR: mcp service is not running. Start stack first with: docker compose up --build -d" >&2
  exit 1
fi

docker rm -f "$TUNNEL_CONTAINER" >/dev/null 2>&1 || true

echo "Starting named Cloudflare tunnel container: $TUNNEL_CONTAINER"
docker run -d --rm \
  --name "$TUNNEL_CONTAINER" \
  --network "$COMPOSE_NETWORK" \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --url "$UPSTREAM_URL" run --token "$CF_NAMED_TUNNEL_TOKEN" >/dev/null

public_url="${CF_MCP_PUBLIC_BASE_URL%/}"
mcp_url="${public_url}/mcp"

ok=0
for _ in $(seq 1 "$MAX_WAIT_SECONDS"); do
  if curl -sS -D - -o /dev/null -H "Accept: text/event-stream" "$mcp_url" | grep -qi '^mcp-session-id:'; then
    ok=1
    break
  fi
  sleep 1
done

if [[ "$ok" -ne 1 ]]; then
  echo "WARNING: named tunnel container is running but MCP endpoint did not become reachable within ${MAX_WAIT_SECONDS}s." >&2
  echo "Inspect logs: docker logs $TUNNEL_CONTAINER" >&2
fi

echo
echo "Named tunnel started."
echo "Public base URL: $public_url"
echo "MCP endpoint URL: $mcp_url"
echo
echo "Check status: $ROOT_DIR/scripts/check_named_cloudflare_tunnel.sh"
echo "Stop tunnel: $ROOT_DIR/scripts/stop_named_cloudflare_tunnel.sh"
