"""Paso 4 — granularidad de aprobación.

Reemplaza el ``approval_mode`` global (muerto) por una política por categoría/tool.
Precedencia: ``by_tool`` > ``by_category`` > ``default``. El default es ``auto``:
mientras la política no marque explícitamente ``ratify`` para una categoría/tool,
NO se gatea (retrocompatibilidad total con el write path actual).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.policy_state import PolicyState

DEFAULT_APPROVAL_POLICY: dict = {"by_tool": {}, "by_category": {}, "default": "auto"}


def get_policy_state(db: Session) -> PolicyState | None:
    return db.execute(select(PolicyState).order_by(PolicyState.updated_at.desc())).scalars().first()


def get_approval_policy(db: Session) -> dict:
    policy_state = get_policy_state(db)
    policy = getattr(policy_state, "approval_policy_json", None)
    return policy if isinstance(policy, dict) and policy else dict(DEFAULT_APPROVAL_POLICY)


def _mode_for(policy: dict, *, tool_name: str | None, category: str | None) -> str:
    if not isinstance(policy, dict):
        return "auto"
    by_tool = policy.get("by_tool") or {}
    if tool_name and tool_name in by_tool:
        return str(by_tool[tool_name])
    by_category = policy.get("by_category") or {}
    if category and category in by_category:
        return str(by_category[category])
    return str(policy.get("default", "auto"))


def requires_ratification(
    policy: dict | None,
    *,
    tool_name: str | None = None,
    category: str | None = None,
) -> bool:
    """True solo si la política marca ``ratify`` para el tool o la categoría."""
    return _mode_for(policy or {}, tool_name=tool_name, category=category) == "ratify"
