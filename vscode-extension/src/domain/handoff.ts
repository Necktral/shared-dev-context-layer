import type { LoadState, TransportStatus } from "./loadState";
import type { OperationalIssue, IssueSeverity } from "./errorModel";

export type HandoffTarget = "codex" | "chatgpt" | "github_copilot" | "custom";
export type HandoffDetailLevel = "compact" | "standard" | "full";

export interface HandoffIntent {
  user_intent: string;
  local_focus?: string[];
  detail_level?: HandoffDetailLevel;
}

export interface HandoffTaskSummary {
  id: string | null;
  title: string | null;
  status: string | null;
  priority: string | null;
}

export interface HandoffValidationState {
  status: string;
  summary: string | null;
  source: string | null;
}

export interface HandoffRecentErrorsSummary {
  status: "available" | "unavailable" | "no_data";
  total: number | null;
  highlights: string[];
}

export interface HandoffLocalFocus {
  active_file: string | null;
  branch: string | null;
  requested_focus: string[];
}

export interface HandoffArtifactMeta {
  generated_at: string;
  target: HandoffTarget;
  target_label: string;
  source_consumer: string;
  session_key: string;
  runtime_mode: "mcp" | "offline_fixture";
  load_state: LoadState;
  transport_status: TransportStatus;
  uncertainty_note: string | null;
}

export interface HandoffArtifact {
  task_summary: HandoffTaskSummary;
  current_goal: string | null;
  approved_constraints: string[];
  validation_state: HandoffValidationState;
  recent_errors_summary: HandoffRecentErrorsSummary;
  local_focus: HandoffLocalFocus;
  candidate_files: string[];
  open_risks: string[];
  recommended_next_action: string;
  codex_ask_prompt: string;
  codex_code_prompt: string;
  meta: HandoffArtifactMeta;
}

export type HandoffBuildStatus = "ready" | "partial" | "blocked";

export interface HandoffBuildResult {
  status: HandoffBuildStatus;
  artifact: HandoffArtifact | null;
  issues: OperationalIssue[];
}

export function handoffIssue(message: string, severity: IssueSeverity, recoverable: boolean, evidenceHint: string): OperationalIssue {
  return {
    kind: "domain",
    source: "handoff_builder",
    severity,
    message,
    recoverable,
    evidence_hint: evidenceHint,
  };
}
