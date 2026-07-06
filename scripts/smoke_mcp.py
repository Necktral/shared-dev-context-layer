#!/usr/bin/env python3
"""Smoke test del MCP de WIS Context Sync.

Conecta a un endpoint MCP (streamable-http), lista las tools publicadas y ejerce
el read plane + una escritura en dry_run (NO muta datos). Sirve para confirmar en
segundos que el stack responde correctamente.

Uso:
    python scripts/smoke_mcp.py                          # http://localhost:8002/mcp
    MCP_URL=https://tu-dominio/mcp python scripts/smoke_mcp.py
    MCP_BEARER=<access_token> python scripts/smoke_mcp.py   # remoto con Auth0

Requiere: mcp + anyio (ya vienen en backend/requirements.txt).
Sale con código 0 si PASA, 1 si algo falla.
"""
from __future__ import annotations

import os
import sys

import anyio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

URL = os.environ.get("MCP_URL", "http://localhost:8002/mcp")
BEARER = os.environ.get("MCP_BEARER")

EXPECTED_TOOLS = {
    # read plane
    "get_active_task", "get_context_snapshot", "get_recent_errors",
    "get_validation_status", "get_approved_decisions", "search_context",
    "get_context_by_id", "list_context_windows", "resolve_related_items",
    "get_sync_status",
    # write plane
    "preview_write_impact", "upsert_context_item", "append_context_event",
    "link_context_entities", "set_context_labels", "archive_context_item",
    "apply_sync_batch",
    # plano deliberativo
    "propose_change", "list_proposals", "ratify_proposal", "reject_proposal",
}


async def _wait_ready(headers) -> None:
    # Tolera cold-start: reintenta conexión/initialize hasta que el server responde.
    for attempt in range(1, 13):
        try:
            async with streamablehttp_client(URL, headers=headers) as (r, w, _):
                async with ClientSession(r, w) as s:
                    await s.initialize()
                    return
        except Exception:  # noqa: BLE001
            if attempt == 12:
                raise
            await anyio.sleep(0.7)


async def main() -> int:
    headers = {"Authorization": f"Bearer {BEARER}"} if BEARER else None
    ok = True
    await _wait_ready(headers)
    async with streamablehttp_client(URL, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            print(f"[ok]   conectado e inicializado: {URL}")

            tools = {t.name for t in (await session.list_tools()).tools}
            print(f"[ok]   tools publicadas: {len(tools)}")
            # WP-0.7: igualdad exacta (antes solo subconjunto) — detecta drift de contrato.
            missing = EXPECTED_TOOLS - tools
            extra = tools - EXPECTED_TOOLS
            if missing:
                print(f"[FAIL] faltan tools esperadas: {sorted(missing)}")
                ok = False
            if extra:
                print(f"[FAIL] tools no esperadas (drift de contrato): {sorted(extra)}")
                ok = False

            at = (await session.call_tool("get_active_task", {})).structuredContent
            status = at.get("status") if isinstance(at, dict) else None
            transport_ok = isinstance(at, dict) and "status" in at
            print(f"[{'ok' if transport_ok else 'FAIL'}]   read get_active_task -> status={status}")
            ok = ok and transport_ok

            up = (await session.call_tool(
                "upsert_context_item",
                {"item_key": "smoke.check", "item_type": "note",
                 "title": "smoke", "content": {}, "dry_run": True},
            )).structuredContent
            up_ok = isinstance(up, dict) and up.get("status") in {"ok", "no_active_task"}
            print(f"[{'ok' if up_ok else 'FAIL'}]   write upsert_context_item(dry_run) -> "
                  f"status={up.get('status') if isinstance(up, dict) else None}")
            ok = ok and up_ok

    print("\nSMOKE:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    try:
        sys.exit(anyio.run(main))
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] no se pudo hablar con el MCP en {URL}: {exc}")
        sys.exit(1)
