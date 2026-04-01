#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <PUBLIC_URL_OR_MCP_ENDPOINT>" >&2
  echo "Requires MCP_AUTH_TOKEN with write scopes." >&2
  exit 1
fi

if [[ -z "${MCP_AUTH_TOKEN:-}" ]]; then
  echo "ERROR: MCP_AUTH_TOKEN is required for write validation." >&2
  exit 1
fi

RAW_URL="$1"
if [[ "$RAW_URL" == */mcp ]]; then
  MCP_ENDPOINT="${RAW_URL%/}"
else
  MCP_ENDPOINT="${RAW_URL%/}/mcp"
fi

AUTH_HEADER_NAME="${MCP_AUTH_HEADER_NAME:-Authorization}"
AUTH_SCHEME="${MCP_AUTH_SCHEME:-Bearer}"

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
          (SELECT COUNT(*) FROM context_items),
          (SELECT COUNT(*) FROM events),
          (SELECT COUNT(*) FROM context_sync_batches),
          (SELECT COUNT(*) FROM publish_audit),
          (SELECT COUNT(*) FROM context_write_audit);"
}

IFS='|' read -r pre_items pre_events pre_batches pre_publish pre_write_audit <<<"$(read_counts)"

run_id="$(date +%s)"
item_key="write-validate-${run_id}"

python3 - "$MCP_ENDPOINT" "$MCP_AUTH_TOKEN" "$AUTH_HEADER_NAME" "$AUTH_SCHEME" "$item_key" <<'PY'
import json
import sys

import anyio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

endpoint = sys.argv[1]
token = sys.argv[2]
header_name = sys.argv[3]
scheme = sys.argv[4]
item_key = sys.argv[5]

headers = {header_name: f"{scheme} {token}" if header_name == "Authorization" else token}

async def main() -> None:
    async with streamablehttp_client(endpoint, headers=headers) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            dry_run = await session.call_tool(
                "upsert_context_item",
                arguments={
                    "item_key": f"{item_key}-dryrun",
                    "item_type": "note",
                    "title": "Write validation dry run",
                    "dry_run": True,
                },
            )
            commit = await session.call_tool(
                "upsert_context_item",
                arguments={
                    "item_key": item_key,
                    "item_type": "note",
                    "title": "Write validation commit",
                    "content": {"kind": "validation"},
                    "labels": ["validation"],
                    "dry_run": False,
                    "idempotency_key": f"{item_key}-upsert",
                },
            )
            event = await session.call_tool(
                "append_context_event",
                arguments={
                    "event_type": "info",
                    "summary": "write validation event",
                    "dry_run": False,
                    "idempotency_key": f"{item_key}-event",
                },
            )
            batch = await session.call_tool(
                "apply_sync_batch",
                arguments={
                    "operations": [{"operation": "upsert_context_item"}],
                    "dry_run": False,
                    "idempotency_key": f"{item_key}-batch",
                },
            )

            out = {
                "dry_run": dry_run.structuredContent,
                "commit": commit.structuredContent,
                "event": event.structuredContent,
                "batch": batch.structuredContent,
            }
            print(json.dumps(out, indent=2, ensure_ascii=False))
            for key in ("dry_run", "commit", "event", "batch"):
                status = out[key].get("status") if isinstance(out[key], dict) else None
                if status != "ok":
                    raise RuntimeError(f"{key} returned status={status}")

anyio.run(main)
PY

IFS='|' read -r post_items post_events post_batches post_publish post_write_audit <<<"$(read_counts)"

delta_items=$((post_items - pre_items))
delta_events=$((post_events - pre_events))
delta_batches=$((post_batches - pre_batches))
delta_publish=$((post_publish - pre_publish))
delta_write_audit=$((post_write_audit - pre_write_audit))

if [[ "$delta_items" -lt 1 ]]; then
  echo "ERROR: expected context_items to increase by >=1, got $delta_items." >&2
  exit 1
fi
if [[ "$delta_events" -lt 1 ]]; then
  echo "ERROR: expected events to increase by >=1, got $delta_events." >&2
  exit 1
fi
if [[ "$delta_batches" -lt 1 ]]; then
  echo "ERROR: expected context_sync_batches to increase by >=1, got $delta_batches." >&2
  exit 1
fi
if [[ "$delta_publish" -lt 4 ]]; then
  echo "ERROR: expected publish_audit to increase by >=4, got $delta_publish." >&2
  exit 1
fi
if [[ "$delta_write_audit" -lt 4 ]]; then
  echo "ERROR: expected context_write_audit to increase by >=4, got $delta_write_audit." >&2
  exit 1
fi

echo
echo "Remote MCP write validation PASSED"
echo "Endpoint: $MCP_ENDPOINT"
echo "delta context_items=$delta_items events=$delta_events sync_batches=$delta_batches publish_audit=$delta_publish context_write_audit=$delta_write_audit"

