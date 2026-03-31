import type { OperationalIssue } from "./errorModel";
import type { LoadState, TransportStatus } from "./loadState";

export type RuntimeMode = "mcp" | "offline_fixture";

export type WISToolName =
  | "get_active_task"
  | "get_context_snapshot"
  | "get_validation_status"
  | "get_approved_decisions"
  | "get_recent_errors";

export type WISToolStatus =
  | "ok"
  | "no_active_task"
  | "no_scope"
  | "scope_invalid"
  | "scope_not_found"
  | "scope_conflict";

export type ToolResultKind = "ok" | "remote_error" | "transport_error" | "schema_error" | "unavailable";

export interface ScopePayload {
  workspace_id: string | null;
  project_id: string | null;
  task_id: string | null;
}

export interface ResolutionMetadata {
  source: string;
  fallback_level: string;
  conflict_flags: string[];
  requested: Record<string, unknown>;
  resolved_scope: ScopePayload;
}

export interface SessionInfo {
  consumer: string;
  session_key: string;
  session_created_at: string;
  session_state: "created" | "reused" | "reset";
}

export interface LocalEnvironmentContext {
  workspace_root: string | null;
  repo_root: string | null;
  branch: string | null;
  active_file: string | null;
  inspector_status: "ok" | "no_workspace" | "no_repo" | "error";
  inspector_error: string | null;
  timestamp: string;
}

export interface TransportDiagnostics {
  endpoint: string;
  runtime_mode: RuntimeMode;
  timeout_ms: number;
  fetched_at: string;
  available_tools?: string[];
  missing_tools?: string[];
}

export interface ToolResult<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  tool: WISToolName;
  kind: ToolResultKind;
  status: WISToolStatus | null;
  payload: TPayload | null;
  issues: OperationalIssue[];
  raw: unknown;
}

export interface WISBundleResult {
  status: "success" | "partial" | "failure";
  tool_results: Record<WISToolName, ToolResult>;
  transport_diagnostics: TransportDiagnostics;
  issues: OperationalIssue[];
}

export interface AuthorityMap {
  canonical_fields: string[];
  local_hint_fields: string[];
  conflict_flags: string[];
}

export interface OperationalContextMeta {
  consumer: string;
  session_key: string;
  endpoint: string;
  runtime_mode: RuntimeMode;
  fetched_at: string;
  transport_status: TransportStatus;
  load_state: LoadState;
}

export interface WISContext {
  active_task: ToolResult | null;
  context_snapshot: ToolResult | null;
  validation_status: ToolResult | null;
  approved_decisions: ToolResult | null;
  recent_errors: ToolResult | null;
}

export interface OperationalContextEnvelope {
  meta: OperationalContextMeta;
  local_environment: LocalEnvironmentContext;
  wis_context: WISContext;
  issues: OperationalIssue[];
  authority_map: AuthorityMap;
  transport_diagnostics: TransportDiagnostics;
}
