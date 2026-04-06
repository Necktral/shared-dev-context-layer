export type OperationProfile = "phase3_control_plane" | "local_private";

export type LocalCommandName = "local_index" | "local_prepare_task" | "local_run_codex" | "local_refresh";

export type LocalCommandStatus = "ok" | "blocked" | "error";

export type TaskLifecycleState =
  | "draft"
  | "prepared"
  | "running"
  | "reconciling"
  | "completed"
  | "partial"
  | "failed"
  | "timeout"
  | "cancelled"
  | "blocked";

export interface LocalCommandResult {
  command: LocalCommandName;
  status: LocalCommandStatus;
  ok: boolean;
  message: string;
  timestamp: string;
  details: Record<string, unknown> | null;
}

export interface LocalTaskDraft {
  id: string;
  objective: string;
  context_summary: string;
  candidate_files: string[];
  constraints: string[];
  acceptance_criteria: string[];
  execution_brief?: LocalTaskExecutionBrief;
  created_at: string;
}

export interface TaskSpecV2 {
  task_id: string;
  project_id: string;
  objective: string;
  constraints: string[];
  acceptance_criteria: string[];
  retrieval_context_ref: string | null;
  created_at: string;
}

export interface LocalTaskExecutionBrief {
  version: "v2";
  objective_compact: string;
  candidate_files: string[];
  key_evidence: string[];
  run_constraints: string[];
  acceptance_checks: string[];
}

export interface CodexExecutionRequest {
  task: LocalTaskDraft;
  repo_root: string | null;
  workspace_root: string | null;
  branch: string | null;
  active_file: string | null;
}

export type CodexExecutionMode = "healthcheck" | "run";

export interface CodexUsageTokens {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
}

export interface CodexExecutionResult {
  mode: CodexExecutionMode;
  ok: boolean;
  cancelled: boolean;
  command: string;
  command_line: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  final_message: string | null;
  thread_id: string | null;
  events_count: number;
  warnings_count: number;
  usage_tokens: CodexUsageTokens | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  error: string | null;
  request_preview: Record<string, unknown> | null;
}

export interface ExecutionEnvelopeV2 {
  execution_id: string;
  task_id: string;
  command: string;
  command_line: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  cancelled: boolean;
  timeout: boolean;
  warnings_count: number;
  error: string | null;
}

export interface WorkspaceFileSnapshotEntry {
  relative_path: string;
  exists: boolean;
  size_bytes: number;
  content_hash: string | null;
  modified_at: string | null;
}

export interface WorkspaceSnapshot {
  snapshot_id: string;
  captured_at: string;
  root_path: string;
  entries: WorkspaceFileSnapshotEntry[];
}

export interface WorkspaceDiffSummary {
  created_files: string[];
  modified_files: string[];
  deleted_files: string[];
  unchanged_files: string[];
  changed_files_count: number;
  changed_files_preview: string[];
  unchanged_count: number;
}

export type ExecutionOutcome =
  | "blocked"
  | "failed"
  | "timeout"
  | "cancelled"
  | "no_op"
  | "applied_changes"
  | "partial_changes";

export interface PostRunReindexResult {
  mode: "scoped" | "fallback_full" | "skipped";
  status: "ok" | "error" | "skipped";
  ok: boolean;
  message: string;
  trigger_reason: string;
  changed_paths: string[];
  metrics: Record<string, unknown>;
  error: string | null;
}

export interface ReindexPlanV2 {
  mode: "scoped" | "fallback_full" | "skipped";
  target_paths: string[];
  trigger_reason: string;
  status: "ok" | "error" | "skipped";
  metrics: Record<string, unknown>;
}

export interface OutcomeClassificationV2 {
  classified_outcome: ExecutionOutcome;
  reasons: string[];
  anomaly_flags: string[];
  severity: "info" | "warning" | "error";
}

export interface EventEnvelopeV2 {
  event_id: string;
  execution_id: string | null;
  seq_no: number | null;
  event_type: string;
  severity: "info" | "warning" | "error";
  payload_json: Record<string, unknown>;
  created_at: string;
}

export interface PostRunReviewPayload {
  objective: string;
  final_message: string | null;
  outcome: ExecutionOutcome;
  classified_outcome: ExecutionOutcome;
  changed_files: {
    created_files: string[];
    modified_files: string[];
    deleted_files: string[];
    changed_files_count: number;
    changed_files_preview: string[];
  };
  warnings: string[];
  pending_risks: string[];
  next_action: string;
}

export type ReviewDecision =
  | "accept"
  | "accept_with_warnings"
  | "needs_manual_review"
  | "retry_recommended"
  | "blocked"
  | "reject";

export interface OperatorReviewResult {
  review_decision: ReviewDecision;
  review_summary: string;
  review_risks: string[];
  changed_files_focus: string[];
  next_action_plan: string;
  source_execution_id: string;
  source_task_id: string;
  reason_codes: string[];
}

export interface PostRunTelemetry {
  prepare_latency_ms: number;
  run_latency_ms: number;
  reconcile_latency_ms: number;
  reindex_latency_ms: number;
  total_duration_ms: number;
  changed_files_count: number;
  warnings_count: number;
  anomaly_count: number;
}

export interface PostRunReconciliationResult {
  execution_result: CodexExecutionResult;
  execution_envelope: ExecutionEnvelopeV2;
  workspace_before_snapshot: WorkspaceSnapshot;
  workspace_after_snapshot: WorkspaceSnapshot;
  workspace_diff: WorkspaceDiffSummary;
  classified_outcome: ExecutionOutcome;
  classification_reasons: string[];
  outcome_classification: OutcomeClassificationV2;
  reindex_result: PostRunReindexResult;
  reindex_plan: ReindexPlanV2;
  review_payload: PostRunReviewPayload;
  telemetry: PostRunTelemetry;
}

export interface ProjectRuntimeSnapshot {
  operation_profile: OperationProfile;
  workspace_root: string | null;
  repo_root: string | null;
  branch: string | null;
  active_file: string | null;
  db_status: "unknown" | "connected" | "disconnected";
  db_error: string | null;
  runtime_state: "idle" | "ready" | "running" | "error";
  last_action: LocalCommandName | null;
  task_draft: LocalTaskDraft | null;
  last_result: LocalCommandResult | null;
  errors: string[];
  updated_at: string;
}

export function createInitialProjectRuntimeSnapshot(profile: OperationProfile): ProjectRuntimeSnapshot {
  return {
    operation_profile: profile,
    workspace_root: null,
    repo_root: null,
    branch: null,
    active_file: null,
    db_status: "unknown",
    db_error: null,
    runtime_state: "idle",
    last_action: null,
    task_draft: null,
    last_result: null,
    errors: [],
    updated_at: new Date().toISOString(),
  };
}
