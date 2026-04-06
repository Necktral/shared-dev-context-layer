import type { CodexExecutionResult, ExecutionOutcome, WorkspaceDiffSummary } from "./types";

const SEVERE_WARNING_REASONS = new Set(["stderr_error", "transport_warning"]);

export interface ExecutionOutcomeClassifierInput {
  execution: CodexExecutionResult;
  workspaceDiff: WorkspaceDiffSummary;
  warningReasons: string[];
  reindexMode: "scoped" | "fallback_full" | "skipped";
  reindexOk: boolean;
  blockedReason?: string | null;
}

export interface ExecutionOutcomeClassification {
  outcome: ExecutionOutcome;
  reasons: string[];
  anomaly_flags: string[];
  severity: "info" | "warning" | "error";
}

function isTimeoutMessage(value: string | null): boolean {
  if (!value) {
    return false;
  }
  return /\btime(?:d)?\s*out\b/i.test(value) || /\btimeout\b/i.test(value);
}

export function extractSevereWarningReasons(warningReasons: string[]): string[] {
  const seen = new Set<string>();
  const severe: string[] = [];
  for (const reason of warningReasons) {
    const normalized = reason.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    if (SEVERE_WARNING_REASONS.has(normalized)) {
      severe.push(normalized);
    }
  }
  return severe.sort((left, right) => left.localeCompare(right));
}

export function classifyExecutionOutcome(input: ExecutionOutcomeClassifierInput): ExecutionOutcomeClassification {
  const severeWarnings = extractSevereWarningReasons(input.warningReasons);
  const reasons: string[] = [];

  if (input.blockedReason && input.blockedReason.trim().length > 0) {
    reasons.push(`blocked:${input.blockedReason.trim()}`);
    return {
      outcome: "blocked",
      reasons,
      anomaly_flags: severeWarnings,
      severity: "error",
    };
  }

  if (input.execution.cancelled) {
    reasons.push("execution_cancelled");
    return {
      outcome: "cancelled",
      reasons,
      anomaly_flags: severeWarnings,
      severity: "error",
    };
  }

  if (isTimeoutMessage(input.execution.error)) {
    reasons.push("execution_timeout");
    return {
      outcome: "timeout",
      reasons,
      anomaly_flags: severeWarnings,
      severity: "error",
    };
  }

  if (!input.execution.ok) {
    reasons.push("execution_failed");
    return {
      outcome: "failed",
      reasons,
      anomaly_flags: severeWarnings,
      severity: "error",
    };
  }

  if (input.workspaceDiff.changed_files_count === 0) {
    reasons.push("execution_ok_without_changes");
    return {
      outcome: "no_op",
      reasons,
      anomaly_flags: severeWarnings,
      severity: "info",
    };
  }

  const anomalyReasons: string[] = [];
  if (severeWarnings.length > 0) {
    anomalyReasons.push(...severeWarnings.map((reason) => `severe_warning:${reason}`));
  }
  if (!input.reindexOk) {
    anomalyReasons.push("reindex_failed");
  }
  if (input.reindexMode === "fallback_full") {
    anomalyReasons.push("fallback_full_reindex");
  }

  if (anomalyReasons.length > 0) {
    return {
      outcome: "partial_changes",
      reasons: anomalyReasons,
      anomaly_flags: anomalyReasons,
      severity: "warning",
    };
  }

  reasons.push("execution_ok_with_changes");
  return {
    outcome: "applied_changes",
    reasons,
    anomaly_flags: severeWarnings,
    severity: "info",
  };
}
