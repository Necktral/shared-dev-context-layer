#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <PUBLIC_URL_OR_MCP_ENDPOINT>" >&2
  echo "Example: $0 https://abcde.trycloudflare.com" >&2
  exit 1
fi

RAW_URL="$1"
if [[ "$RAW_URL" == */mcp ]]; then
  MCP_ENDPOINT="${RAW_URL%/}"
else
  MCP_ENDPOINT="${RAW_URL%/}/mcp"
fi

CLIENT_MCP_ENDPOINT="$MCP_ENDPOINT"
# When validator client runs inside backend container, localhost targets itself.
# For host-local endpoint checks, switch client path to the compose service URL.
if [[ "$MCP_ENDPOINT" =~ ^https?://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?/mcp$ ]]; then
  CLIENT_MCP_ENDPOINT="http://mcp:8002/mcp"
fi

if ! docker compose ps postgres backend mcp | grep -q "Up"; then
  echo "ERROR: stack is not fully running. Use: docker compose up --build -d" >&2
  exit 1
fi

# shellcheck source=/dev/null
set -a
source "$ROOT_DIR/.env"
set +a

read_counts() {
  docker exec wis_context_postgres psql \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -tA -F '|' \
    -c "SELECT
          (SELECT COUNT(*) FROM tasks),
          (SELECT COUNT(*) FROM approved_decisions),
          (SELECT COUNT(*) FROM events),
          (SELECT COUNT(*) FROM context_snapshots),
          (SELECT COUNT(*) FROM policy_state),
          (SELECT COUNT(*) FROM publish_audit);"
}

IFS='|' read -r pre_tasks pre_decisions pre_events pre_snapshots pre_policy pre_audit <<<"$(read_counts)"

tmp_headers="$(mktemp)"
tmp_body="$(mktemp)"
trap 'rm -f "$tmp_headers" "$tmp_body"' EXIT
http_code="$(curl -sS -o "$tmp_body" -D "$tmp_headers" -w "%{http_code}" -H 'Accept: text/event-stream' "$MCP_ENDPOINT" || true)"

if [[ -z "$http_code" ]]; then
  echo "ERROR: failed to contact endpoint: $MCP_ENDPOINT" >&2
  exit 1
fi

if [[ "$http_code" -ge 500 ]]; then
  echo "ERROR: MCP endpoint returned server error ($http_code)." >&2
  cat "$tmp_body" >&2
  exit 1
fi

if ! grep -qi '^mcp-session-id:' "$tmp_headers"; then
  echo "ERROR: response headers did not include mcp-session-id; endpoint may be incorrect." >&2
  cat "$tmp_headers" >&2
  exit 1
fi

echo "MCP reachability check OK: HTTP $http_code with mcp-session-id header"
echo "MCP client endpoint: $CLIENT_MCP_ENDPOINT"

docker compose exec -T backend python - "$CLIENT_MCP_ENDPOINT" <<'PY'
import json
import sys

import anyio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

endpoint = sys.argv[1]
required = [
    "get_active_task",
    "get_context_snapshot",
    "get_recent_errors",
    "get_validation_status",
    "get_approved_decisions",
]


async def main() -> None:
    async with streamablehttp_client(endpoint) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            listed = await session.list_tools()
            names = [tool.name for tool in listed.tools]
            missing = [name for name in required if name not in names]
            if missing:
                raise RuntimeError(f"Missing required tools: {missing}")

            results = {}
            for name in required:
                response = await session.call_tool(name, arguments={})
                if getattr(response, "isError", False):
                    raise RuntimeError(f"Tool returned error: {name}")
                results[name] = response.structuredContent

            print(json.dumps({"tools": names, "tool_results": results}, indent=2, ensure_ascii=False))


anyio.run(main)
PY

IFS='|' read -r post_tasks post_decisions post_events post_snapshots post_policy post_audit <<<"$(read_counts)"

delta_tasks=$((post_tasks - pre_tasks))
delta_decisions=$((post_decisions - pre_decisions))
delta_events=$((post_events - pre_events))
delta_snapshots=$((post_snapshots - pre_snapshots))
delta_policy=$((post_policy - pre_policy))
delta_audit=$((post_audit - pre_audit))

if [[ "$delta_tasks" -ne 0 || "$delta_decisions" -ne 0 || "$delta_events" -ne 0 || "$delta_snapshots" -ne 0 || "$delta_policy" -ne 0 ]]; then
  echo "ERROR: domain tables changed unexpectedly." >&2
  echo "Delta tasks=$delta_tasks decisions=$delta_decisions events=$delta_events snapshots=$delta_snapshots policy=$delta_policy" >&2
  exit 1
fi

if [[ "$delta_audit" -ne 5 ]]; then
  echo "ERROR: expected publish_audit delta of 5, got $delta_audit." >&2
  exit 1
fi

echo
echo "Remote MCP validation PASSED"
echo "Host endpoint: $MCP_ENDPOINT"
echo "Client endpoint: $CLIENT_MCP_ENDPOINT"
echo "Domain tables unchanged; publish_audit increased by +5."
