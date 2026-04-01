#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <PUBLIC_URL_OR_MCP_ENDPOINT>" >&2
  echo "Example: $0 https://abcde.trycloudflare.com" >&2
  echo "Optional auth envs:" >&2
  echo "  MCP_AUTH_TOKEN=<token> MCP_AUTH_HEADER_NAME=Authorization MCP_AUTH_SCHEME=Bearer" >&2
  echo "Optional payload registry env:" >&2
  echo "  MCP_TOOL_PAYLOAD_REGISTRY_PATH=<path/to/mcp_validation_payloads.json>" >&2
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

PAYLOAD_REGISTRY_PATH="${MCP_TOOL_PAYLOAD_REGISTRY_PATH:-$ROOT_DIR/scripts/mcp_validation_payloads.json}"
if [[ ! -f "$PAYLOAD_REGISTRY_PATH" ]]; then
  echo "ERROR: payload registry not found: $PAYLOAD_REGISTRY_PATH" >&2
  exit 1
fi
PAYLOAD_REGISTRY_JSON="$(python3 - "$PAYLOAD_REGISTRY_PATH" <<'PY'
import json
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
print(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
PY
)"

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
          (SELECT COUNT(*) FROM context_items),
          (SELECT COUNT(*) FROM context_item_links),
          (SELECT COUNT(*) FROM context_item_labels),
          (SELECT COUNT(*) FROM context_sync_batches),
          (SELECT COUNT(*) FROM policy_state),
          (SELECT COUNT(*) FROM publish_audit),
          (SELECT COUNT(*) FROM context_write_audit);"
}

IFS='|' read -r pre_tasks pre_decisions pre_events pre_snapshots pre_context_items pre_context_links pre_context_labels pre_sync_batches pre_policy pre_audit pre_write_audit <<<"$(read_counts)"

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

if [[ "$http_code" -eq 401 || "$http_code" -eq 403 ]]; then
  echo "ERROR: MCP endpoint requires valid auth (HTTP $http_code)." >&2
  echo "Set MCP_AUTH_TOKEN and retry. Header=$AUTH_HEADER_NAME scheme=$AUTH_SCHEME" >&2
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
  -e MCP_TOOL_PAYLOADS_JSON="$PAYLOAD_REGISTRY_JSON" \
  -e MCP_TOOL_PAYLOADS_SOURCE="$PAYLOAD_REGISTRY_PATH" \
  backend python - "$CLIENT_MCP_ENDPOINT" <<'PY' | tee "$tmp_validation"
import json
import os
import re
import sys

import anyio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

endpoint = sys.argv[1]
auth_token = (os.getenv("MCP_AUTH_TOKEN") or "").strip()
auth_header_name = (os.getenv("MCP_AUTH_HEADER_NAME") or "Authorization").strip()
auth_scheme = (os.getenv("MCP_AUTH_SCHEME") or "Bearer").strip()
payload_registry_source = (os.getenv("MCP_TOOL_PAYLOADS_SOURCE") or "scripts/mcp_validation_payloads.json").strip()
payload_registry_raw = os.getenv("MCP_TOOL_PAYLOADS_JSON") or "{}"

try:
    payload_registry = json.loads(payload_registry_raw)
except json.JSONDecodeError as exc:
    raise RuntimeError(f"Invalid payload registry JSON: {exc}") from exc

if not isinstance(payload_registry, dict):
    raise RuntimeError("Payload registry must be a JSON object: {\"tool\": {payload}}")

for tool_name, payload in payload_registry.items():
    if not isinstance(payload, dict):
        raise RuntimeError(f"Payload registry entry for '{tool_name}' must be an object.")

required_params_regex = re.compile(
    r"(required|missing|required argument|validation error|invalid arguments|field required)",
    re.IGNORECASE,
)

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
            attempted_tools = []
            for name in names:
                has_registry_payload = name in payload_registry
                payload = payload_registry.get(name, {})
                payload_source = "registry" if has_registry_payload else "empty_default"
                attempted_tools.append(
                    {
                        "tool": name,
                        "payload_source": payload_source,
                        "payload": payload,
                    }
                )
                try:
                    response = await session.call_tool(name, arguments=payload)
                    if getattr(response, "isError", False):
                        failed_tools[name] = {
                            "reason": "tool_returned_error",
                            "message": "tool returned isError=true",
                            "payload_source": payload_source,
                            "attempted_payload": payload,
                        }
                        continue
                    structured = response.structuredContent
                    status_value = structured.get("status") if isinstance(structured, dict) else None
                    if status_value in {"forbidden", "unauthorized", "invalid_request", "error"}:
                        failed_tools[name] = {
                            "reason": "tool_status_not_ok",
                            "message": f"tool returned status={status_value}",
                            "payload_source": payload_source,
                            "attempted_payload": payload,
                            "structured": structured,
                        }
                        continue
                    results[name] = structured
                except Exception as exc:  # noqa: BLE001
                    message = str(exc)
                    reason = "invocation_error"
                    if not has_registry_payload and required_params_regex.search(message):
                        reason = "required_params_without_registry_payload"
                    failed_tools[name] = {
                        "reason": reason,
                        "message": message,
                        "payload_source": payload_source,
                        "attempted_payload": payload,
                    }

            summary = {
                "policy": "all_published",
                "payload_registry": payload_registry_source,
                "tools": names,
                "total_tools": len(names),
                "attempted_count": len(attempted_tools),
                "successful_tools": len(results),
                "failed_count": len(failed_tools),
                "attempted_tools": attempted_tools,
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

IFS='|' read -r post_tasks post_decisions post_events post_snapshots post_context_items post_context_links post_context_labels post_sync_batches post_policy post_audit post_write_audit <<<"$(read_counts)"

delta_tasks=$((post_tasks - pre_tasks))
delta_decisions=$((post_decisions - pre_decisions))
delta_events=$((post_events - pre_events))
delta_snapshots=$((post_snapshots - pre_snapshots))
delta_context_items=$((post_context_items - pre_context_items))
delta_context_links=$((post_context_links - pre_context_links))
delta_context_labels=$((post_context_labels - pre_context_labels))
delta_sync_batches=$((post_sync_batches - pre_sync_batches))
delta_policy=$((post_policy - pre_policy))
delta_audit=$((post_audit - pre_audit))
delta_write_audit=$((post_write_audit - pre_write_audit))

if [[ "$delta_tasks" -ne 0 || "$delta_decisions" -ne 0 || "$delta_events" -ne 0 || "$delta_snapshots" -ne 0 || "$delta_context_items" -ne 0 || "$delta_context_links" -ne 0 || "$delta_context_labels" -ne 0 || "$delta_sync_batches" -ne 0 || "$delta_policy" -ne 0 ]]; then
  echo "ERROR: domain tables changed unexpectedly." >&2
  echo "Delta tasks=$delta_tasks decisions=$delta_decisions events=$delta_events snapshots=$delta_snapshots context_items=$delta_context_items context_links=$delta_context_links context_labels=$delta_context_labels sync_batches=$delta_sync_batches policy=$delta_policy" >&2
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
failed = data.get("failed_tools", {}) or {}
parts = []
for name in sorted(failed.keys()):
    reason = failed.get(name, {}).get("reason", "unknown")
    parts.append(f"{name}({reason})")
print(", ".join(parts) or "unknown")
PY
)"
  echo "ERROR: failed tools under policy all_published: $failed_tools" >&2
  if grep -q 'required_params_without_registry_payload' "$tmp_validation"; then
    echo "ERROR: one or more published tools require payload registry entries in $PAYLOAD_REGISTRY_PATH." >&2
  fi
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
echo "Payload registry: $PAYLOAD_REGISTRY_PATH"
echo "Published tools: $total_count, successful: $success_count"
echo "Domain tables unchanged; publish_audit increased by +$success_count, context_write_audit delta=$delta_write_audit."
