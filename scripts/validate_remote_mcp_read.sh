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

TOOL_SCOPES_SOURCE_PATH="$ROOT_DIR/backend/app/mcp/server.py"
if [[ ! -f "$TOOL_SCOPES_SOURCE_PATH" ]]; then
  echo "ERROR: TOOL_SCOPES source not found: $TOOL_SCOPES_SOURCE_PATH" >&2
  exit 1
fi
TOOL_SCOPES_JSON="$(python3 - "$TOOL_SCOPES_SOURCE_PATH" <<'PY'
import ast
import json
import sys

path = sys.argv[1]
source = open(path, "r", encoding="utf-8").read()
module = ast.parse(source, filename=path)

target_value = None
for node in module.body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == "TOOL_SCOPES":
                target_value = node.value
    elif isinstance(node, ast.AnnAssign):
        if isinstance(node.target, ast.Name) and node.target.id == "TOOL_SCOPES":
            target_value = node.value

if target_value is None:
    raise SystemExit("ERROR: TOOL_SCOPES assignment not found in backend/app/mcp/server.py")

try:
    parsed = ast.literal_eval(target_value)
except Exception as exc:  # noqa: BLE001
    raise SystemExit(f"ERROR: failed to parse TOOL_SCOPES literal: {exc}") from exc

if not isinstance(parsed, dict):
    raise SystemExit("ERROR: TOOL_SCOPES must be a dict.")

normalized: dict[str, list[str]] = {}
for key, value in parsed.items():
    if not isinstance(key, str):
        raise SystemExit("ERROR: TOOL_SCOPES keys must be strings.")
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise SystemExit(f"ERROR: TOOL_SCOPES[{key}] must be a list[str].")
    normalized[key] = value

print(json.dumps(normalized, separators=(",", ":"), ensure_ascii=False))
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
tmp_summary="$(mktemp)"
tmp_final="$(mktemp)"
trap 'rm -f "$tmp_headers" "$tmp_body" "$tmp_summary" "$tmp_final"' EXIT

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

docker compose exec -T \
  -e MCP_AUTH_TOKEN="$AUTH_TOKEN" \
  -e MCP_AUTH_HEADER_NAME="$AUTH_HEADER_NAME" \
  -e MCP_AUTH_SCHEME="$AUTH_SCHEME" \
  -e MCP_TOOL_PAYLOADS_JSON="$PAYLOAD_REGISTRY_JSON" \
  -e MCP_TOOL_PAYLOADS_SOURCE="$PAYLOAD_REGISTRY_PATH" \
  -e MCP_TOOL_SCOPES_JSON="$TOOL_SCOPES_JSON" \
  backend python - "$CLIENT_MCP_ENDPOINT" <<'PY' > "$tmp_summary"
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
tool_scopes_raw = os.getenv("MCP_TOOL_SCOPES_JSON") or "{}"

try:
    payload_registry = json.loads(payload_registry_raw)
except json.JSONDecodeError as exc:
    raise RuntimeError(f"Invalid payload registry JSON: {exc}") from exc

if not isinstance(payload_registry, dict):
    raise RuntimeError("Payload registry must be a JSON object: {\"tool\": {payload}}")

for tool_name, payload in payload_registry.items():
    if not isinstance(payload, dict):
        raise RuntimeError(f"Payload registry entry for '{tool_name}' must be an object.")

try:
    tool_scopes = json.loads(tool_scopes_raw)
except json.JSONDecodeError as exc:
    raise RuntimeError(f"Invalid TOOL_SCOPES JSON: {exc}") from exc

if not isinstance(tool_scopes, dict):
    raise RuntimeError("TOOL_SCOPES must be a dict serialized as JSON.")

for tool_name, scopes in tool_scopes.items():
    if not isinstance(tool_name, str):
        raise RuntimeError("TOOL_SCOPES keys must be strings.")
    if not isinstance(scopes, list) or not all(isinstance(scope, str) for scope in scopes):
        raise RuntimeError(f"TOOL_SCOPES[{tool_name}] must be list[str].")

required_params_regex = re.compile(
    r"(required|missing|required argument|validation error|invalid arguments|field required)",
    re.IGNORECASE,
)


def classify_tool(scopes: list[str]) -> str:
    if any(scope.endswith(".write") for scope in scopes):
        return "write"
    return "read"


async def main() -> None:
    headers = None
    if auth_token:
        header_value = f"{auth_scheme} {auth_token}" if auth_header_name == "Authorization" else auth_token
        headers = {auth_header_name: header_value}

    summary: dict[str, object] = {
        "policy": "read_plane",
        "payload_registry": payload_registry_source,
        "tools": [],
        "total_tools": 0,
        "read_tools_total": 0,
        "read_tools_ok": 0,
        "write_tools_total": 0,
        "write_tools_blocked_as_expected": 0,
        "unexpected_failures_count": 0,
        "unexpected_successes_count": 0,
        "unexpected_block_reasons_count": 0,
        "unexpected_failures": [],
        "unexpected_successes": [],
        "unexpected_block_reasons": [],
        "contract_drift": {
            "unknown_published_tools": [],
            "missing_from_published": [],
        },
        "attempted_tools": [],
        "tool_results": {},
    }

    async with streamablehttp_client(endpoint, headers=headers) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            listed = await session.list_tools()
            names = [tool.name for tool in listed.tools]
            if not names:
                raise RuntimeError("No published tools were returned by MCP list_tools().")

            categories = {name: classify_tool(scopes) for name, scopes in tool_scopes.items()}
            unknown_published_tools = sorted(set(names) - set(categories))
            missing_from_published = sorted(set(categories) - set(names))

            unexpected_failures = summary["unexpected_failures"]
            assert isinstance(unexpected_failures, list)
            unexpected_successes = summary["unexpected_successes"]
            assert isinstance(unexpected_successes, list)
            unexpected_block_reasons = summary["unexpected_block_reasons"]
            assert isinstance(unexpected_block_reasons, list)
            attempted_tools = summary["attempted_tools"]
            assert isinstance(attempted_tools, list)
            tool_results = summary["tool_results"]
            assert isinstance(tool_results, dict)

            if unknown_published_tools or missing_from_published:
                unexpected_failures.append(
                    {
                        "reason": "tool_scope_drift",
                        "message": "Mismatch between list_tools and backend TOOL_SCOPES contract.",
                        "unknown_published_tools": unknown_published_tools,
                        "missing_from_published": missing_from_published,
                    }
                )

            read_total = 0
            write_total = 0
            for name in names:
                category = categories.get(name)
                if category == "read":
                    read_total += 1
                elif category == "write":
                    write_total += 1
                else:
                    unexpected_failures.append(
                        {
                            "tool": name,
                            "reason": "tool_scope_unknown",
                            "message": "Published tool is missing from TOOL_SCOPES.",
                        }
                    )

            read_ok = 0
            write_blocked_as_expected = 0

            for name in names:
                category = categories.get(name)
                has_registry_payload = name in payload_registry
                payload = payload_registry.get(name, {})
                payload_source = "registry" if has_registry_payload else "empty_default"
                attempted_tools.append(
                    {
                        "tool": name,
                        "category": category or "unknown",
                        "payload_source": payload_source,
                        "payload": payload,
                    }
                )

                if category is None:
                    tool_results[name] = {
                        "category": "unknown",
                        "result": "unexpected_failure",
                        "reason": "tool_scope_unknown",
                    }
                    continue

                try:
                    response = await session.call_tool(name, arguments=payload)
                    if getattr(response, "isError", False):
                        unexpected_failures.append(
                            {
                                "tool": name,
                                "category": category,
                                "reason": "tool_returned_isError",
                                "payload_source": payload_source,
                                "attempted_payload": payload,
                            }
                        )
                        tool_results[name] = {
                            "category": category,
                            "result": "unexpected_failure",
                            "reason": "tool_returned_isError",
                        }
                        continue

                    structured = response.structuredContent
                    if not isinstance(structured, dict):
                        unexpected_failures.append(
                            {
                                "tool": name,
                                "category": category,
                                "reason": "tool_structured_content_not_object",
                                "payload_source": payload_source,
                                "attempted_payload": payload,
                                "structured": structured,
                            }
                        )
                        tool_results[name] = {
                            "category": category,
                            "result": "unexpected_failure",
                            "reason": "tool_structured_content_not_object",
                        }
                        continue

                    status_value = structured.get("status")
                    error_value = structured.get("error")

                    if category == "read":
                        if status_value in {"forbidden", "unauthorized", "invalid_request", "error"}:
                            unexpected_failures.append(
                                {
                                    "tool": name,
                                    "category": category,
                                    "reason": "read_status_not_ok",
                                    "status": status_value,
                                    "payload_source": payload_source,
                                    "attempted_payload": payload,
                                    "structured": structured,
                                }
                            )
                            tool_results[name] = {
                                "category": category,
                                "result": "unexpected_failure",
                                "reason": "read_status_not_ok",
                                "status": status_value,
                            }
                            continue

                        read_ok += 1
                        tool_results[name] = {
                            "category": category,
                            "result": "read_ok",
                            "status": status_value,
                            "structured": structured,
                        }
                        continue

                    # write tool with read-only token
                    if status_value == "forbidden":
                        if error_value == "insufficient_scope":
                            write_blocked_as_expected += 1
                            tool_results[name] = {
                                "category": category,
                                "result": "write_blocked_as_expected",
                                "status": status_value,
                                "error": error_value,
                                "structured": structured,
                            }
                            continue

                        unexpected_block_reasons.append(
                            {
                                "tool": name,
                                "category": category,
                                "reason": "unexpected_block_reason",
                                "status": status_value,
                                "error": error_value,
                                "payload_source": payload_source,
                                "attempted_payload": payload,
                                "structured": structured,
                            }
                        )
                        tool_results[name] = {
                            "category": category,
                            "result": "unexpected_block_reason",
                            "status": status_value,
                            "error": error_value,
                        }
                        continue

                    if status_value in {"unauthorized", "invalid_request", "error"}:
                        unexpected_failures.append(
                            {
                                "tool": name,
                                "category": category,
                                "reason": "write_status_not_expected",
                                "status": status_value,
                                "payload_source": payload_source,
                                "attempted_payload": payload,
                                "structured": structured,
                            }
                        )
                        tool_results[name] = {
                            "category": category,
                            "result": "unexpected_failure",
                            "reason": "write_status_not_expected",
                            "status": status_value,
                        }
                        continue

                    unexpected_successes.append(
                        {
                            "tool": name,
                            "category": category,
                            "reason": "write_tool_succeeded_with_read_token",
                            "status": status_value,
                            "payload_source": payload_source,
                            "attempted_payload": payload,
                            "structured": structured,
                        }
                    )
                    tool_results[name] = {
                        "category": category,
                        "result": "unexpected_success",
                        "status": status_value,
                    }
                except Exception as exc:  # noqa: BLE001
                    message = str(exc)
                    reason = "invocation_error"
                    if not has_registry_payload and required_params_regex.search(message):
                        reason = "required_params_without_registry_payload"
                    unexpected_failures.append(
                        {
                            "tool": name,
                            "category": category,
                            "reason": reason,
                            "message": message,
                            "payload_source": payload_source,
                            "attempted_payload": payload,
                        }
                    )
                    tool_results[name] = {
                        "category": category,
                        "result": "unexpected_failure",
                        "reason": reason,
                        "message": message,
                    }

            summary["tools"] = names
            summary["total_tools"] = len(names)
            summary["read_tools_total"] = read_total
            summary["read_tools_ok"] = read_ok
            summary["write_tools_total"] = write_total
            summary["write_tools_blocked_as_expected"] = write_blocked_as_expected
            summary["unexpected_failures_count"] = len(unexpected_failures)
            summary["unexpected_successes_count"] = len(unexpected_successes)
            summary["unexpected_block_reasons_count"] = len(unexpected_block_reasons)
            summary["contract_drift"] = {
                "unknown_published_tools": unknown_published_tools,
                "missing_from_published": missing_from_published,
            }

    print(json.dumps(summary, indent=2, ensure_ascii=False))


anyio.run(main)
PY

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

IFS='|' read -r read_total read_ok write_total write_blocked unexpected_failures_count unexpected_successes_count unexpected_block_reasons_count <<<"$(python3 - "$tmp_summary" <<'PY'
import json
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
values = [
    int(data.get("read_tools_total", 0)),
    int(data.get("read_tools_ok", 0)),
    int(data.get("write_tools_total", 0)),
    int(data.get("write_tools_blocked_as_expected", 0)),
    int(data.get("unexpected_failures_count", 0)),
    int(data.get("unexpected_successes_count", 0)),
    int(data.get("unexpected_block_reasons_count", 0)),
]
print("|".join(str(v) for v in values))
PY
)"

python3 - "$tmp_summary" "$delta_tasks" "$delta_decisions" "$delta_events" "$delta_snapshots" "$delta_context_items" "$delta_context_links" "$delta_context_labels" "$delta_sync_batches" "$delta_policy" "$delta_audit" "$delta_write_audit" > "$tmp_final" <<'PY'
import json
import sys

summary_path = sys.argv[1]
(
    delta_tasks,
    delta_decisions,
    delta_events,
    delta_snapshots,
    delta_context_items,
    delta_context_links,
    delta_context_labels,
    delta_sync_batches,
    delta_policy,
    delta_audit,
    delta_write_audit,
) = [int(arg) for arg in sys.argv[2:13]]

with open(summary_path, "r", encoding="utf-8") as f:
    summary = json.load(f)

summary["audit_deltas"] = {
    "publish_audit": delta_audit,
    "context_write_audit": delta_write_audit,
}
summary["domain_deltas"] = {
    "tasks": delta_tasks,
    "approved_decisions": delta_decisions,
    "events": delta_events,
    "context_snapshots": delta_snapshots,
    "context_items": delta_context_items,
    "context_item_links": delta_context_links,
    "context_item_labels": delta_context_labels,
    "context_sync_batches": delta_sync_batches,
    "policy_state": delta_policy,
}

print(json.dumps(summary, indent=2, ensure_ascii=False))
PY

cat "$tmp_final"

echo "__READ_VALIDATION_COUNTS__ read_ok=$read_ok read_total=$read_total write_blocked=$write_blocked write_total=$write_total unexpected_failures=$unexpected_failures_count unexpected_successes=$unexpected_successes_count unexpected_block_reasons=$unexpected_block_reasons_count"

failed="false"

if [[ "$read_total" -le 0 ]]; then
  echo "ERROR: read_plane validation found zero read tools." >&2
  failed="true"
fi
if [[ "$write_total" -le 0 ]]; then
  echo "ERROR: read_plane validation found zero write tools." >&2
  failed="true"
fi
if [[ "$read_ok" -ne "$read_total" ]]; then
  echo "ERROR: read tools did not all pass (read_ok=$read_ok read_total=$read_total)." >&2
  failed="true"
fi
if [[ "$write_blocked" -ne "$write_total" ]]; then
  echo "ERROR: write tools were not blocked as expected (write_blocked=$write_blocked write_total=$write_total)." >&2
  failed="true"
fi
if [[ "$unexpected_failures_count" -ne 0 ]]; then
  echo "ERROR: unexpected_failures_count=$unexpected_failures_count." >&2
  failed="true"
fi
if [[ "$unexpected_successes_count" -ne 0 ]]; then
  echo "ERROR: unexpected_successes_count=$unexpected_successes_count." >&2
  failed="true"
fi
if [[ "$unexpected_block_reasons_count" -ne 0 ]]; then
  echo "ERROR: unexpected_block_reasons_count=$unexpected_block_reasons_count." >&2
  failed="true"
fi

if [[ "$delta_tasks" -ne 0 || "$delta_decisions" -ne 0 || "$delta_events" -ne 0 || "$delta_snapshots" -ne 0 || "$delta_context_items" -ne 0 || "$delta_context_links" -ne 0 || "$delta_context_labels" -ne 0 || "$delta_sync_batches" -ne 0 || "$delta_policy" -ne 0 ]]; then
  echo "ERROR: domain tables changed unexpectedly." >&2
  echo "Delta tasks=$delta_tasks decisions=$delta_decisions events=$delta_events snapshots=$delta_snapshots context_items=$delta_context_items context_links=$delta_context_links context_labels=$delta_context_labels sync_batches=$delta_sync_batches policy=$delta_policy" >&2
  failed="true"
fi

if [[ "$delta_write_audit" -ne 0 ]]; then
  echo "ERROR: expected context_write_audit delta=0, got $delta_write_audit." >&2
  failed="true"
fi

if [[ "$delta_audit" -ne "$read_ok" ]]; then
  echo "ERROR: expected publish_audit delta=$read_ok (read tools OK), got $delta_audit." >&2
  failed="true"
fi

if [[ "$failed" == "true" ]]; then
  exit 1
fi

echo
echo "Remote MCP read-plane validation PASSED"
echo "Host endpoint: $MCP_ENDPOINT"
echo "Client endpoint: $CLIENT_MCP_ENDPOINT"
echo "Tool validation policy: read_plane"
echo "Payload registry: $PAYLOAD_REGISTRY_PATH"
echo "Read tools OK: $read_ok/$read_total"
echo "Write tools blocked as expected: $write_blocked/$write_total"
echo "Domain tables unchanged; publish_audit increased by +$read_ok, context_write_audit delta=0."
