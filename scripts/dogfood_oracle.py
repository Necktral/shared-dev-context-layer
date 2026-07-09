#!/usr/bin/env python3
"""Dogfood (Paso 5 del ADR de ratificación) — el oráculo money-path como la
PRIMERA corrida real del loop de ratificación.

Ejercita I1/I2/I3 en un caso de alto riesgo (plata): una IA propone las
suposiciones A1–A8 + las 7 invariantes del coffee-sale como una `Proposal`
(decision), y el humano la ratifica → `ApprovedDecision` canónico con
`approved_by` = identidad verificada del token.

Uso:
    python scripts/dogfood_oracle.py                       # http://localhost:8002/mcp
    MCP_URL=https://tu-dominio/mcp MCP_BEARER=<token> python scripts/dogfood_oracle.py

Requiere: mcp + anyio (ya en backend/requirements.txt).
NOTA: las suposiciones/invariantes de abajo son representativas — reemplázalas
por las reales del coffee-sale antes de ratificar en serio.
"""
from __future__ import annotations

import os
import sys

import anyio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

URL = os.environ.get("MCP_URL", "http://localhost:8002/mcp")
BEARER = os.environ.get("MCP_BEARER")

MONEY_PATH_PAYLOAD = {
    "decision_key": "money_path.coffee_sale.v1",
    "title": "Money path — coffee sale (suposiciones + invariantes)",
    "category": "money_path",
    "decision": "Se fijan las suposiciones A1–A8 y las 7 invariantes del coffee-sale.",
    "assumptions": {
        "A1": "El precio unitario se expresa en la moneda del workspace.",
        "A2": "Un pago cubre exactamente una orden (sin split).",
        "A3": "Los impuestos se calculan sobre el subtotal, no sobre el total.",
        "A4": "No hay propinas en el money-path v1.",
        "A5": "Un refund revierte el 100% o nada (sin parciales) en v1.",
        "A6": "La orden es inmutable una vez pagada.",
        "A7": "La conciliación usa el settlement del procesador como verdad.",
        "A8": "Toda mutación de dinero pasa por el write plane auditado.",
    },
    "invariants": [
        "I1: subtotal = sum(line_item.qty * unit_price)",
        "I2: total = subtotal + tax - discount",
        "I3: paid_amount == total en una orden 'paid'",
        "I4: refund_amount <= paid_amount",
        "I5: balance = paid_amount - refunded_amount >= 0",
        "I6: cada evento de dinero tiene idempotency_key",
        "I7: la suma de settlements concilia con la suma de orders pagadas",
    ],
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
    await _wait_ready(headers)
    async with streamablehttp_client(URL, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()

            print("[1] Proponiendo el money-path como Proposal (decision)…")
            proposed = (
                await session.call_tool(
                    "propose_change",
                    {
                        "target_kind": "decision",
                        "target_key": MONEY_PATH_PAYLOAD["decision_key"],
                        "rationale": "Primera corrida real del loop de ratificación (dogfood).",
                        "proposed_payload": MONEY_PATH_PAYLOAD,
                        # WP-0.2: propose_change es dry_run=True por defecto; para crear
                        # la Proposal real hay que pedirlo explícitamente.
                        "dry_run": False,
                        "idempotency_key": "dogfood-propose-money-path",
                    },
                )
            ).structuredContent
            if not isinstance(proposed, dict) or proposed.get("status") != "ok":
                print("[FAIL] propose_change:", proposed)
                return 1
            proposal = proposed["proposal"]
            print(f"      Proposal {proposal['id']} -> status={proposal['status']}")

            print("[2] Ratificando (yo decido)…")
            ratified = (
                await session.call_tool(
                    "ratify_proposal",
                    {
                        "proposal_id": proposal["id"],
                        # WP-0.2: la ratificación exige el operator-token (verificado siempre).
                        "operator_token": os.environ.get("OPERATOR_RATIFY_TOKEN", ""),
                    },
                )
            ).structuredContent
            if not isinstance(ratified, dict) or ratified.get("status") != "ok":
                print("[FAIL] ratify_proposal:", ratified)
                return 1
            print(
                f"      status={ratified['proposal']['status']} "
                f"ratified_by={ratified['proposal']['ratified_by']} "
                f"ApprovedDecision={ratified.get('ratified_decision_id')}"
            )
            print(f"      staleness invalidada: {ratified.get('staleness')}")

            print("\nDOGFOOD: PASS — el money-path quedó canónico vía ratificación humana.")
            return 0


if __name__ == "__main__":
    try:
        sys.exit(anyio.run(main))
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] no se pudo completar el dogfood contra {URL}: {exc}")
        sys.exit(1)
