#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <PUBLIC_URL_OR_MCP_ENDPOINT>" >&2
  echo "Example: $0 https://abcde.trycloudflare.com" >&2
  echo "Optional auth envs:" >&2
  echo "  MCP_AUTH_TOKEN=<token> MCP_AUTH_HEADER_NAME=Authorization MCP_AUTH_SCHEME=Bearer" >&2
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

AUTH_TOKEN="${MCP_AUTH_TOKEN:-${MCP_BEARER_TOKEN:-}}"
AUTH_HEADER_NAME="${MCP_AUTH_HEADER_NAME:-Authorization}"
AUTH_SCHEME="${MCP_AUTH_SCHEME:-Bearer}"
AUTH_HEADER_VALUE=""
if [[ -n "$AUTH_TOKEN" ]]; then
  if [[ "$AUTH_HEADER_NAME" == "Authorization" ]]; then
    AUTH_HEADER_VALUE="${AUTH_SCHEME} ${AUTH_TOKEN}"
  else
    AUTH_HEADER_VALUE="$AUTH_TOKEN"
  fi
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
curl_args=(-sS -o "$tmp_body" -D "$tmp_headers" -w "%{http_code}" -H 'Accept: text/event-stream')
if [[ -n "$AUTH_HEADER_VALUE" ]]; then
  curl_args+=(-H "${AUTH_HEADER_NAME}: ${AUTH_HEADER_VALUE}")
fi
http_code="$(curl "${curl_args[@]}" "$MCP_ENDPOINT" || true)"

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

tmp_validation="$(mktemp)"
trap 'rm -f "$tmp_headers" "$tmp_body" "$tmp_validation"' EXIT

docker compose exec -T \
  -e MCP_AUTH_TOKEN="$AUTH_TOKEN" \
  -e MCP_AUTH_HEADER_NAME="$AUTH_HEADER_NAME" \
  -e MCP_AUTH_SCHEME="$AUTH_SCHEME" \
  backend python - "$CLIENT_MCP_ENDPOINT" <<'PY' | tee "$tmp_validation"
import json
import os
import sys

import anyio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

endpoint = sys.argv[1]
auth_token = (os.getenv("MCP_AUTH_TOKEN") or "").strip()
auth_header_name = (os.getenv("MCP_AUTH_HEADER_NAME") or "Authorization").strip()
auth_scheme = (os.getenv("MCP_AUTH_SCHEME") or "Bearer").strip()

async def main() -> None:
    headers = None
    if auth_token:
        header_value = f"{auth_scheme} {auth_token}" if auth_header_name == "Authorization" else auth_token
        headers = {auth_header_name: header_value}
    async with streamablehttp_client(endpoint, headers=headers) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            listed = await session.list_tools()
            names = [tool.name for tool in listed.tools]
            if not names:
                raise RuntimeError("No published tools were returned by MCP list_tools().")

            results = {}
            failed_tools = {}
            for name in names:
                try:
                    response = await session.call_tool(name, arguments={})
                    if getattr(response, "isError", False):
                        failed_tools[name] = "tool returned isError=true"
                        continue
                    results[name] = response.structuredContent
                except Exception as exc:  # noqa: BLE001
                    failed_tools[name] = str(exc)

            summary = {
                "policy": "all_published",
                "tools": names,
                "total_tools": len(names),
                "successful_tools": len(results),
                "failed_count": len(failed_tools),
                "failed_tools": failed_tools,
                "tool_results": results,
            }
            print(json.dumps(summary, indent=2, ensure_ascii=False))
            print(f"__VALIDATION_COUNTS__ success={len(results)} total={len(names)} failed={len(failed_tools)}")


anyio.run(main)
PY

counts_line="$(grep '^__VALIDATION_COUNTS__' "$tmp_validation" | tail -n1 || true)"
if [[ -z "$counts_line" ]]; then
  echo "ERROR: validation did not produce counts line." >&2
  exit 1
fi

success_count="$(echo "$counts_line" | sed -E 's/.*success=([0-9]+).*/\1/')"
total_count="$(echo "$counts_line" | sed -E 's/.*total=([0-9]+).*/\1/')"
failed_count="$(echo "$counts_line" | sed -E 's/.*failed=([0-9]+).*/\1/')"

if [[ "$total_count" -le 0 ]]; then
  echo "ERROR: MCP returned zero published tools." >&2
  exit 1
fi

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

if [[ "$delta_audit" -ne "$success_count" ]]; then
  echo "ERROR: expected publish_audit delta of $success_count (successful tools), got $delta_audit." >&2
  exit 1
fi

if [[ "$failed_count" -ne 0 ]]; then
  failed_tools="$(python3 - "$tmp_validation" <<'PY'
import json
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    text = f.read()
start = text.find("{")
end = text.rfind("}")
if start == -1 or end == -1 or end < start:
    print("unknown")
    raise SystemExit(0)
data = json.loads(text[start:end+1])
print(", ".join(sorted(data.get("failed_tools", {}).keys())) or "unknown")
PY
)"
  echo "ERROR: failed tools under policy all_published: $failed_tools" >&2
  exit 1
fi

echo
echo "Remote MCP validation PASSED"
echo "Host endpoint: $MCP_ENDPOINT"
echo "Client endpoint: $CLIENT_MCP_ENDPOINT"
if [[ -n "$AUTH_TOKEN" ]]; then
  echo "Auth header used: $AUTH_HEADER_NAME"
fi
echo "Tool validation policy: all_published"
echo "Published tools: $total_count, successful: $success_count"
echo "Domain tables unchanged; publish_audit increased by +$success_count."
