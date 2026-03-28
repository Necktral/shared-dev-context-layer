from typing import Any

SENSITIVE_KEYS = {
    "secret",
    "token",
    "password",
    "api_key",
    "credential",
}

TOOL_ALLOWLISTS: dict[str, set[str]] = {
    "get_active_task": {"task", "mode"},
    "get_context_snapshot": {"task_id", "status", "source", "snapshot", "metadata"},
    "get_recent_errors": {"task_id", "window_hours", "limit", "total", "errors"},
    "get_validation_status": {
        "task_id",
        "current_status",
        "last_validation_type",
        "last_validation_source",
        "last_validation_at",
        "summary",
        "details",
    },
    "get_approved_decisions": {"task_id", "total", "decisions"},
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
