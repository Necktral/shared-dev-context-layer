from typing import Any

SENSITIVE_KEYS = {
    "secret",
    "token",
    "password",
    "api_key",
    "credential",
}

TOOL_ALLOWLISTS: dict[str, set[str]] = {
    "get_active_task": {"status", "task", "mode", "scope", "resolution_metadata"},
    "get_context_snapshot": {
        "task_id",
        "status",
        "source",
        "scope",
        "consumer_context",
        "resolution_metadata",
        "snapshot",
        "metadata",
    },
    "get_recent_errors": {"status", "task_id", "scope", "resolution_metadata", "window_hours", "limit", "total", "errors"},
    "get_validation_status": {
        "status",
        "task_id",
        "scope",
        "resolution_metadata",
        "current_status",
        "last_validation_type",
        "last_validation_source",
        "last_validation_at",
        "summary",
        "details",
    },
    "get_approved_decisions": {"status", "task_id", "scope", "resolution_metadata", "total", "decisions"},
    "search_context": {"status", "scope", "resolution_metadata", "query", "total", "items", "limit", "offset"},
    "get_context_by_id": {"status", "scope", "resolution_metadata", "context_item_id", "item"},
    "list_context_windows": {
        "status",
        "scope",
        "resolution_metadata",
        "window_hours",
        "since",
        "items_total",
        "errors_total",
        "snapshots_total",
        "items",
    },
    "resolve_related_items": {
        "status",
        "scope",
        "resolution_metadata",
        "context_item_id",
        "total",
        "related",
    },
    "get_sync_status": {"status", "scope", "resolution_metadata", "total", "batches"},
    "preview_write_impact": {
        "status",
        "scope",
        "resolution_metadata",
        "operation",
        "dry_run",
        "impact",
        "requires_scopes",
    },
    "upsert_context_item": {
        "status",
        "scope",
        "resolution_metadata",
        "dry_run",
        "request_id",
        "result",
        "before",
        "after",
        "idempotent_replay",
        "audit_ref",
    },
    "append_context_event": {
        "status",
        "scope",
        "resolution_metadata",
        "dry_run",
        "request_id",
        "result",
        "event",
        "idempotent_replay",
        "audit_ref",
    },
    "link_context_entities": {
        "status",
        "scope",
        "resolution_metadata",
        "dry_run",
        "request_id",
        "result",
        "before",
        "after",
        "idempotent_replay",
        "audit_ref",
    },
    "set_context_labels": {
        "status",
        "scope",
        "resolution_metadata",
        "dry_run",
        "request_id",
        "result",
        "before",
        "after",
        "idempotent_replay",
        "audit_ref",
    },
    "archive_context_item": {
        "status",
        "scope",
        "resolution_metadata",
        "dry_run",
        "request_id",
        "result",
        "before",
        "after",
        "idempotent_replay",
        "audit_ref",
    },
    "apply_sync_batch": {
        "status",
        "scope",
        "resolution_metadata",
        "dry_run",
        "request_id",
        "result",
        "summary",
        "results",
        "batch",
        "idempotent_replay",
        "audit_ref",
    },
}


def apply_delegated_limited_policy(tool_name: str, payload: dict[str, Any]) -> tuple[dict[str, Any], list[str], list[str]]:
    allowlist = TOOL_ALLOWLISTS.get(tool_name, set(payload.keys()))
    filtered_root = {key: payload[key] for key in payload if key in allowlist}
    redacted_paths: list[str] = []

    def _redact(value: Any, path: str) -> Any:
        if isinstance(value, dict):
            cleaned: dict[str, Any] = {}
            for key, nested in value.items():
                nested_path = f"{path}.{key}" if path else key
                key_lower = key.lower()
                if any(marker in key_lower for marker in SENSITIVE_KEYS):
                    redacted_paths.append(nested_path)
                    cleaned[key] = "[REDACTED]"
                else:
                    cleaned[key] = _redact(nested, nested_path)
            return cleaned
        if isinstance(value, list):
            return [_redact(item, f"{path}[{index}]") for index, item in enumerate(value)]
        return value

    filtered = _redact(filtered_root, "")
    included_fields = sorted(filtered_root.keys())
    redacted_fields = sorted(set(redacted_paths))
    return filtered, included_fields, redacted_fields
