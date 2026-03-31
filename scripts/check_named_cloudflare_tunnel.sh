#!/usr/bin/env bash
set -euo pipefail

TUNNEL_CONTAINER="${TUNNEL_CONTAINER:-wis_context_cloudflared_named_tunnel}"
public_url="${CF_MCP_PUBLIC_BASE_URL:-}"

if [[ -z "$public_url" ]]; then
  echo "ERROR: CF_MCP_PUBLIC_BASE_URL is required." >&2
  exit 1
fi

public_url="${public_url%/}"
mcp_url="${public_url}/mcp"

if docker ps --format '{{.Names}}' | grep -qx "$TUNNEL_CONTAINER"; then
  echo "Container status: running ($TUNNEL_CONTAINER)"
else
  echo "ERROR: container not running ($TUNNEL_CONTAINER)" >&2
  exit 1
fi

host="$(printf '%s\n' "$public_url" | sed -E 's#^https?://##; s#/.*$##')"
if getent hosts "$host" >/dev/null 2>&1; then
  echo "DNS status: ok ($host)"
else
  echo "ERROR: DNS lookup failed for $host" >&2
  exit 1
fi

http_code="$(curl -sS -o /tmp/wis_named_tunnel_body.$$ -D /tmp/wis_named_tunnel_headers.$$ -w "%{http_code}" -H "Accept: text/event-stream" "$mcp_url" || true)"
trap 'rm -f /tmp/wis_named_tunnel_body.$$ /tmp/wis_named_tunnel_headers.$$' EXIT

if [[ -z "$http_code" ]]; then
  echo "ERROR: no HTTP response from $mcp_url" >&2
  exit 1
fi

if grep -qi '^mcp-session-id:' /tmp/wis_named_tunnel_headers.$$; then
  echo "MCP header check: ok (HTTP $http_code, mcp-session-id present)"
else
  echo "ERROR: mcp-session-id header missing (HTTP $http_code)" >&2
  cat /tmp/wis_named_tunnel_headers.$$ >&2
  exit 1
fi

echo "Endpoint check passed: $mcp_url"
