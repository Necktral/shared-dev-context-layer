import type { WISToolName, WISToolStatus } from "../../domain/operationalContext";

export const WIS_TOOLS: readonly WISToolName[] = [
  "get_active_task",
  "get_context_snapshot",
  "get_validation_status",
  "get_approved_decisions",
  "get_recent_errors",
];

export const REMOTE_STATUSES: readonly WISToolStatus[] = [
  "ok",
  "no_active_task",
  "no_scope",
  "scope_invalid",
  "scope_not_found",
  "scope_conflict",
];

const BASE_REQUIRED_FIELDS = ["status"] as const;

const OK_REQUIRED_FIELDS: Record<WISToolName, readonly string[]> = {
  get_active_task: ["status", "task", "scope", "resolution_metadata"],
  get_context_snapshot: ["status", "snapshot", "metadata", "consumer_context", "scope", "resolution_metadata"],
  get_validation_status: ["status", "current_status", "scope", "resolution_metadata"],
  get_approved_decisions: ["status", "decisions", "total", "scope", "resolution_metadata"],
  get_recent_errors: ["status", "errors", "total", "scope", "resolution_metadata"],
};

const REMOTE_ERROR_REQUIRED_FIELDS = ["status", "scope", "resolution_metadata"] as const;

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasRequiredFields(payload: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => field in payload);
}

export function isKnownRemoteStatus(value: unknown): value is WISToolStatus {
  return typeof value === "string" && REMOTE_STATUSES.includes(value as WISToolStatus);
}

export function requiredFieldsForStatus(tool: WISToolName, status: WISToolStatus): readonly string[] {
  if (status === "ok") {
    return OK_REQUIRED_FIELDS[tool];
  }
  if (status === "no_active_task" || status === "no_scope" || status.startsWith("scope_")) {
    return REMOTE_ERROR_REQUIRED_FIELDS;
  }
  return BASE_REQUIRED_FIELDS;
}

export function scopeArguments(input: {
  consumer: string;
  session_key: string;
  scope?: { workspace_id?: string | null; project_id?: string | null; task_id?: string | null };
}): Record<string, unknown> {
  const args: Record<string, unknown> = {
    consumer: input.consumer,
    session_key: input.session_key,
  };

  if (input.scope?.workspace_id) {
    args.workspace_id = input.scope.workspace_id;
  }
  if (input.scope?.project_id) {
    args.project_id = input.scope.project_id;
  }
  if (input.scope?.task_id) {
    args.task_id = input.scope.task_id;
  }

  return args;
}
