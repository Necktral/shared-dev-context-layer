export type OperationProfile = "phase3_control_plane" | "local_private";

export type LocalCommandName = "local_index" | "local_prepare_task" | "local_run_codex" | "local_refresh";

export type LocalCommandStatus = "ok" | "blocked" | "error";

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
  created_at: string;
}

export interface CodexExecutionRequest {
  task: LocalTaskDraft;
}

export type CodexExecutionMode = "healthcheck" | "run";

export interface CodexExecutionResult {
  mode: CodexExecutionMode;
  ok: boolean;
  command: string;
  command_line: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  error: string | null;
  request_preview: Record<string, unknown> | null;
}

export interface ProjectRuntimeSnapshot {
  operation_profile: OperationProfile;
  workspace_root: string | null;
  repo_root: string | null;
  branch: string | null;
  active_file: string | null;
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
    runtime_state: "idle",
    last_action: null,
    task_draft: null,
    last_result: null,
    errors: [],
    updated_at: new Date().toISOString(),
  };
}
