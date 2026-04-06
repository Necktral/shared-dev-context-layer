import type { PostRunReconcileRequest, PostRunReconcilerPort, WorkspaceIndexerPort } from "./ports";
import { toComparablePathKey } from "./pathNormalization";
import { classifyExecutionOutcome } from "./executionOutcomeClassifier";
import { WorkspaceDiffAnalyzer } from "./workspaceDiffAnalyzer";
import { WorkspaceSnapshotter } from "./workspaceSnapshotter";
import type {
  PostRunReconciliationResult,
  PostRunReindexResult,
  PostRunReviewPayload,
  WorkspaceDiffSummary,
} from "./types";

const DEFAULT_MAX_SCOPED_REINDEX_PATHS = 200;

export interface PostRunReconcilerOptions {
  snapshotter: WorkspaceSnapshotter;
  indexer: WorkspaceIndexerPort;
  diffAnalyzer?: WorkspaceDiffAnalyzer;
  maxScopedReindexPaths?: number;
}

function comparePaths(left: string, right: string): number {
  return toComparablePathKey(left).localeCompare(toComparablePathKey(right)) || left.localeCompare(right);
}

function warningReasonsFromRequestPreview(preview: Record<string, unknown> | null): string[] {
  if (!preview || !Array.isArray(preview.stderr_warning_reasons)) {
    return [];
  }
  return [...new Set(preview.stderr_warning_reasons
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function computeChangedPaths(diff: WorkspaceDiffSummary): string[] {
  return [...new Set([...diff.created_files, ...diff.modified_files, ...diff.deleted_files])].sort(comparePaths);
}

function nextActionHint(outcome: PostRunReconciliationResult["classified_outcome"]): string {
  switch (outcome) {
    case "no_op":
      return "No hubo cambios. Ajusta la intención o el prompt y vuelve a ejecutar.";
    case "applied_changes":
      return "Revisa los archivos afectados y ejecuta validaciones locales del proyecto.";
    case "partial_changes":
      return "Valida manualmente cambios y advertencias antes de continuar.";
    case "failed":
      return "Corrige el fallo de ejecución y reintenta.";
    case "timeout":
      return "Reduce alcance de la tarea o aumenta tolerancia operativa y reintenta.";
    case "cancelled":
      return "Reanuda la ejecución cuando tengas alcance y contexto cerrados.";
    case "blocked":
      return "Corrige la precondición bloqueante y vuelve a correr.";
    default:
      return "Revisa el resultado y continúa con verificación manual.";
  }
}

function buildPendingRisks(input: {
  classificationReasons: string[];
  reindexResult: PostRunReindexResult;
}): string[] {
  const risks: string[] = [];
  for (const reason of input.classificationReasons) {
    if (reason.startsWith("severe_warning:")) {
      risks.push(`Warning severo detectado: ${reason.replace("severe_warning:", "")}`);
    }
  }
  if (!input.reindexResult.ok) {
    risks.push("Reindex post-run no exitoso.");
  } else if (input.reindexResult.mode === "fallback_full") {
    risks.push("Reindex cayó a full scan; revisar costo y precisión del scope.");
  }
  return risks;
}

export class PostRunReconciler implements PostRunReconcilerPort {
  private readonly diffAnalyzer: WorkspaceDiffAnalyzer;
  private readonly maxScopedReindexPaths: number;

  constructor(private readonly options: PostRunReconcilerOptions) {
    this.diffAnalyzer = options.diffAnalyzer ?? new WorkspaceDiffAnalyzer();
    this.maxScopedReindexPaths = options.maxScopedReindexPaths ?? DEFAULT_MAX_SCOPED_REINDEX_PATHS;
  }

  public async reconcile(request: PostRunReconcileRequest): Promise<PostRunReconciliationResult> {
    const overallStartedAt = Date.now();
    const beforeStartedAt = Date.now();
    const before = await this.options.snapshotter.capture({
      snapshot: request.snapshot,
    });
    const beforeLatencyMs = Date.now() - beforeStartedAt;
    const beforePaths = before.entries.filter((entry) => entry.exists).map((entry) => entry.relative_path);

    const runStartedAt = Date.now();
    const executionResult = await request.execute();
    const runLatencyMs = Date.now() - runStartedAt;

    const afterStartedAt = Date.now();
    const after = await this.options.snapshotter.capture({
      snapshot: request.snapshot,
      seed_paths: beforePaths,
    });
    const afterLatencyMs = Date.now() - afterStartedAt;

    const diffStartedAt = Date.now();
    const workspaceDiff = this.diffAnalyzer.analyze(before, after);
    const diffLatencyMs = Date.now() - diffStartedAt;
    const changedPaths = computeChangedPaths(workspaceDiff);
    const reindexStartedAt = Date.now();
    const reindexResult = await this.runPostRunReindex({
      changedPaths,
      projectId: request.projectId,
      snapshot: request.snapshot,
    });
    const reindexLatencyMs = Date.now() - reindexStartedAt;

    const classifyStartedAt = Date.now();
    const warningReasons = warningReasonsFromRequestPreview(executionResult.request_preview);
    const classification = classifyExecutionOutcome({
      execution: executionResult,
      workspaceDiff,
      warningReasons,
      reindexMode: reindexResult.mode,
      reindexOk: reindexResult.ok,
    });
    const classifyLatencyMs = Date.now() - classifyStartedAt;

    const reviewPayload: PostRunReviewPayload = {
      objective: request.task.objective,
      final_message: executionResult.final_message,
      outcome: classification.outcome,
      classified_outcome: classification.outcome,
      changed_files: {
        created_files: workspaceDiff.created_files,
        modified_files: workspaceDiff.modified_files,
        deleted_files: workspaceDiff.deleted_files,
        changed_files_count: workspaceDiff.changed_files_count,
        changed_files_preview: workspaceDiff.changed_files_preview,
      },
      warnings: warningReasons,
      pending_risks: buildPendingRisks({
        classificationReasons: classification.reasons,
        reindexResult,
      }),
      next_action: nextActionHint(classification.outcome),
    };

    return {
      execution_result: executionResult,
      execution_envelope: {
        execution_id: "pending",
        task_id: request.task.id,
        command: executionResult.command,
        command_line: executionResult.command_line,
        started_at: executionResult.started_at,
        finished_at: executionResult.finished_at,
        exit_code: executionResult.exit_code,
        cancelled: executionResult.cancelled,
        timeout: /\btime(?:d)?\s*out\b/i.test(executionResult.error ?? "") || /\btimeout\b/i.test(executionResult.error ?? ""),
        warnings_count: executionResult.warnings_count,
        error: executionResult.error,
      },
      workspace_before_snapshot: before,
      workspace_after_snapshot: after,
      workspace_diff: workspaceDiff,
      classified_outcome: classification.outcome,
      classification_reasons: classification.reasons,
      outcome_classification: {
        classified_outcome: classification.outcome,
        reasons: classification.reasons,
        anomaly_flags: classification.anomaly_flags,
        severity: classification.severity,
      },
      reindex_result: reindexResult,
      reindex_plan: {
        mode: reindexResult.mode,
        target_paths: reindexResult.changed_paths,
        trigger_reason: reindexResult.trigger_reason,
        status: reindexResult.status,
        metrics: reindexResult.metrics,
      },
      review_payload: reviewPayload,
      telemetry: {
        prepare_latency_ms: beforeLatencyMs,
        run_latency_ms: runLatencyMs,
        reconcile_latency_ms: afterLatencyMs + diffLatencyMs + classifyLatencyMs + reindexLatencyMs,
        reindex_latency_ms: reindexLatencyMs,
        total_duration_ms: Date.now() - overallStartedAt,
        changed_files_count: workspaceDiff.changed_files_count,
        warnings_count: executionResult.warnings_count,
        anomaly_count: classification.anomaly_flags.length,
      },
    };
  }

  private async runPostRunReindex(input: {
    projectId: string;
    snapshot: PostRunReconcileRequest["snapshot"];
    changedPaths: string[];
  }): Promise<PostRunReindexResult> {
    if (input.changedPaths.length === 0) {
      return {
        mode: "skipped",
        status: "skipped",
        ok: true,
        message: "Sin cambios en workspace; no se ejecutó reindex.",
        trigger_reason: "no_changes",
        changed_paths: [],
        metrics: {},
        error: null,
      };
    }

    if (input.changedPaths.length > this.maxScopedReindexPaths) {
      return this.runFallbackFullReindex({
        projectId: input.projectId,
        snapshot: input.snapshot,
        changedPaths: input.changedPaths,
        reason: "changed_paths_limit_exceeded",
      });
    }

    try {
      const scoped = await this.options.indexer.runIndexByPaths({
        projectId: input.projectId,
        snapshot: input.snapshot,
        paths: input.changedPaths,
      });
      return {
        mode: "scoped",
        status: "ok",
        ok: true,
        message: scoped.message,
        trigger_reason: "changed_scope",
        changed_paths: input.changedPaths,
        metrics: {
          ...scoped.metrics,
          details: scoped.details,
        },
        error: null,
      };
    } catch (error) {
      return this.runFallbackFullReindex({
        projectId: input.projectId,
        snapshot: input.snapshot,
        changedPaths: input.changedPaths,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async runFallbackFullReindex(input: {
    projectId: string;
    snapshot: PostRunReconcileRequest["snapshot"];
    changedPaths: string[];
    reason: string;
  }): Promise<PostRunReindexResult> {
    try {
      const full = await this.options.indexer.runIndex({
        projectId: input.projectId,
        snapshot: input.snapshot,
      });
      return {
        mode: "fallback_full",
        status: "ok",
        ok: true,
        message: full.message,
        trigger_reason: input.reason,
        changed_paths: input.changedPaths,
        metrics: {
          ...full.metrics,
          details: full.details,
          fallback_reason: input.reason,
        },
        error: null,
      };
    } catch (error) {
      return {
        mode: "fallback_full",
        status: "error",
        ok: false,
        message: "Reindex post-run falló en fallback full.",
        trigger_reason: input.reason,
        changed_paths: input.changedPaths,
        metrics: {
          fallback_reason: input.reason,
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
