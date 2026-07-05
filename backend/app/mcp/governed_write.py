"""Pipeline gobernado de escritura (WP-0.8).

Extrae la cadena de gates común a las tools de escritura del bus MCP a una función
reutilizable — `run_governed_write` — invocable también por el despachador de
`apply_sync_batch` (WP-0.3) y por `vault_sync` (WP-3.3), fuera del contexto de una
tool MCP. El `_scope_guard` permanece en la tool (depende del transporte). El commit
único del camino de escritura vive aquí (reubicado desde `_write_audit_and_filter`
en WP-0.4).

Estos helpers vivían en `server.py`; se movieron aquí para romper el ciclo de import
(este módulo NO importa `server.py`; `server.py` importa de aquí).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, cast

from mcp.server.auth.middleware.auth_context import get_access_token

from app.audit.service import record_publish_audit
from app.audit.write_audit_service import get_existing_request_audit, record_write_audit
from app.auth.jwt_verifier import decode_unverified_claims
from app.policies.delegated_limited import apply_delegated_limited_policy
from app.services import approval_policy_service as _approval_policy
from app.services import proposal_service as _proposals
from app.services.focus_resolver import ResolvedScope


# ---------------------------------------------------------------------------
# Helpers de gate (movidos desde server.py en WP-0.8; comportamiento idéntico)
# ---------------------------------------------------------------------------


def _invalid_request(
    message: str, scope_payload: dict[str, Any], resolution_metadata: dict[str, Any], **extra: Any
) -> dict[str, Any]:
    payload = {
        "status": "invalid_request",
        "message": message,
        "scope": scope_payload,
        "resolution_metadata": resolution_metadata,
    }
    payload.update(extra)
    return payload


def _extract_actor_context() -> dict[str, Any]:
    token = get_access_token()
    scopes = sorted(set(token.scopes)) if token and token.scopes else []
    claims = decode_unverified_claims(token.token) if token else {}
    actor_sub = str(claims.get("sub") or token.client_id if token else "local_bypass")
    return {
        "token": token,
        "scopes": scopes,
        "claims": claims,
        "actor_sub": actor_sub,
    }


def _ensure_idempotency_key(
    *, resolved: ResolvedScope, idempotency_key: str | None, dry_run: bool
) -> dict[str, Any] | None:
    if dry_run:
        return None
    if idempotency_key and idempotency_key.strip():
        return None
    return _invalid_request(
        "idempotency_key es obligatorio cuando dry_run=false.",
        resolved.scope_payload(),
        resolved.resolution_metadata,
        dry_run=dry_run,
    )


def _existing_replay_payload(
    db: Any, *, resolved: ResolvedScope, tool_name: str, request_id: str, dry_run: bool
) -> dict[str, Any] | None:
    existing = get_existing_request_audit(
        db, workspace_id=resolved.workspace.id, tool_name=tool_name, request_id=request_id
    )
    if existing is None:
        return None
    payload = {
        "status": "ok",
        "scope": resolved.scope_payload(),
        "resolution_metadata": resolved.resolution_metadata,
        "dry_run": dry_run,
        "request_id": request_id,
        "result": existing.result,
        "idempotent_replay": True,
        "audit_ref": {
            "write_audit_id": str(existing.id),
            "created_at": existing.created_at.isoformat() if existing.created_at else None,
        },
    }
    filtered, _, _ = apply_delegated_limited_policy(tool_name, payload)
    return filtered


def _require_ratification(
    db: Any,
    resolved: Any,
    *,
    tool_name: str,
    target_kind: str,
    target_key: str,
    category: str | None,
    dry_run: bool,
) -> dict[str, Any] | None:
    """Gate de ratificación (I1). Default de política = auto (no gatea). dry_run es
    siempre preview. Rechazo explícito si falta Proposal ratificada (sin fallback)."""
    if dry_run:
        return None
    policy = _approval_policy.get_approval_policy(db)
    if not _approval_policy.requires_ratification(policy, tool_name=tool_name, category=category):
        return None
    if (
        _proposals.find_ratified_proposal(
            db, workspace_id=resolved.workspace.id, target_kind=target_kind, target_key=target_key
        )
        is not None
    ):
        return None
    return {
        "status": "ratification_required",
        "error": "no_ratified_proposal",
        "message": "Este commit requiere una Proposal ratificada por un humano.",
        "target": {"kind": target_kind, "key": target_key},
        "tool": tool_name,
        "scope": resolved.scope_payload(),
        "resolution_metadata": resolved.resolution_metadata,
    }


def _write_audit_and_filter(
    db: Any,
    *,
    tool_name: str,
    resolved: ResolvedScope,
    request_id: str,
    dry_run: bool,
    result: str,
    subject_id: str | None,
    before_payload: Any,
    after_payload: Any,
    response_payload: dict[str, Any],
) -> dict[str, Any]:
    actor_context = _extract_actor_context()
    audit_row = record_write_audit(
        db=db,
        workspace_id=resolved.workspace.id,
        project_id=resolved.project.id if resolved.project else None,
        task_id=resolved.task.id if resolved.task else None,
        tool_name=tool_name,
        subject_id=subject_id,
        request_id=request_id,
        actor_sub=actor_context["actor_sub"],
        scopes=cast(list[str], actor_context["scopes"]),
        before_payload=before_payload,
        after_payload=after_payload,
        result=result,
        dry_run=dry_run,
        metadata={
            "consumer_context": resolved.consumer_payload(),
            "resolution_metadata": resolved.resolution_metadata,
        },
    )
    record_publish_audit(
        db=db,
        task_id=resolved.task.id,
        destination="chatgpt_developer_mode",
        package_type=tool_name,
        fields_included=sorted(response_payload.keys()),
        fields_redacted=[],
        result=result,
        commit=False,
    )
    response_payload["audit_ref"] = {
        "write_audit_id": str(audit_row.id),
        "created_at": audit_row.created_at.isoformat() if audit_row.created_at else None,
    }
    # WP-0.4: commit único del camino de escritura — dominio (flush en el servicio),
    # write_audit y publish_audit en una sola transacción atómica.
    db.commit()
    filtered, _, _ = apply_delegated_limited_policy(tool_name, response_payload)
    return filtered


# ---------------------------------------------------------------------------
# Pipeline gobernado (WP-0.8)
# ---------------------------------------------------------------------------


@dataclass
class RatificationSpec:
    """Objetivo del gate de ratificación para una operación de escritura."""

    target_kind: str
    target_key: str
    category: str | None = None


@dataclass
class WriteOutcome:
    """Resultado de `apply_fn`: qué se aplicó y cómo componer la respuesta.

    `extra` son los campos específicos de la tool que se fusionan en el sobre estándar
    (p.ej. {"before": ..., "after": ...} o {"event": ...} o {"summary": ..., "batch": ...}).
    """

    result: str
    subject_id: str | None
    before_payload: Any
    after_payload: Any
    extra: dict[str, Any] = field(default_factory=dict)
    idempotent_replay: bool = False


def run_governed_write(
    db: Any,
    *,
    tool_name: str,
    resolved: ResolvedScope,
    dry_run: bool,
    idempotency_key: str | None,
    ratification: RatificationSpec | None,
    apply_fn: Callable[[Any, str], "WriteOutcome | dict[str, Any]"],
    pre_ratification_fn: Callable[[], dict[str, Any] | None] | None = None,
) -> dict[str, Any]:
    """Cadena de gates común del plano de escritura (el `_scope_guard` queda en la tool).

    Orden: idempotencia → request_id → replay → [pre-validación] → ratificación →
    `apply_fn` (solo flush) → auditoría → commit único → filtro delegated_limited.

    `apply_fn(db, request_id)` devuelve un `WriteOutcome`, o un `dict` (payload de
    error, p.ej. UUID inválido) que se propaga tal cual. `pre_ratification_fn` (opcional)
    corre entre replay y ratificación — preserva el orden de validación de UUID de
    `set_context_labels`/`archive_context_item`, que validan ANTES del gate.
    """
    key_error = _ensure_idempotency_key(resolved=resolved, idempotency_key=idempotency_key, dry_run=dry_run)
    if key_error is not None:
        return key_error
    request_id = f"dryrun-{uuid.uuid4()}" if dry_run else cast(str, idempotency_key)
    replay = _existing_replay_payload(
        db, resolved=resolved, tool_name=tool_name, request_id=request_id, dry_run=dry_run
    )
    if replay is not None:
        return replay
    if pre_ratification_fn is not None:
        pre_error = pre_ratification_fn()
        if pre_error is not None:
            return pre_error
    if ratification is not None:
        gate = _require_ratification(
            db,
            resolved,
            tool_name=tool_name,
            target_kind=ratification.target_kind,
            target_key=ratification.target_key,
            category=ratification.category,
            dry_run=dry_run,
        )
        if gate is not None:
            return gate
    outcome = apply_fn(db, request_id)
    if isinstance(outcome, dict):
        # apply_fn cortó con un payload de error (no muta; el commit no llega a ejecutarse).
        return outcome
    response = {
        "status": "ok",
        "scope": resolved.scope_payload(),
        "resolution_metadata": resolved.resolution_metadata,
        "dry_run": dry_run,
        "request_id": request_id,
        "result": outcome.result,
        "idempotent_replay": outcome.idempotent_replay,
        **outcome.extra,
    }
    return _write_audit_and_filter(
        db,
        tool_name=tool_name,
        resolved=resolved,
        request_id=request_id,
        dry_run=dry_run,
        result=str(outcome.result),
        subject_id=outcome.subject_id,
        before_payload=outcome.before_payload,
        after_payload=outcome.after_payload,
        response_payload=response,
    )
