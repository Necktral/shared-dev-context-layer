import { createHash, randomUUID } from "node:crypto";
import type { EnvironmentSnapshot } from "../environment/environmentInspector";
import type {
  ContextRetrieverPort,
  CodexRunnerPort,
  PostRunReconcilerPort,
  PersistedProject,
  PersistenceHealthcheck,
  PersistencePort,
  TaskBuilderPort,
  WorkspaceIndexerPort,
} from "./ports";
import { validateCodexExecutableCommand } from "./codexCommandValidation";
import { capText, countLines, sha256Hex } from "./execution/codexExecutionUtils";
import { InMemoryLocalRuntimeStore } from "./localRuntimeStore";
import type {
  CodexExecutionResult,
  ExecutionOutcome,
  LocalCommandName,
  LocalCommandResult,
  OperationProfile,
  ProjectRuntimeSnapshot,
  TaskLifecycleState,
} from "./types";

export interface EnvironmentInspectorPort {
  inspect(): Promise<EnvironmentSnapshot>;
}

export interface LocalCommandServiceDeps {
  inspector: EnvironmentInspectorPort;
  store: InMemoryLocalRuntimeStore;
  indexer: WorkspaceIndexerPort;
  retriever: ContextRetrieverPort;
  taskBuilder: TaskBuilderPort;
  postRunReconciler: PostRunReconcilerPort;
  codexRunner: CodexRunnerPort;
  persistence: PersistencePort;
  getOperationProfile: () => OperationProfile;
  getCodexCliCommand: () => string;
}

export interface LocalRunCodexOptions {
  abortSignal?: AbortSignal;
}

const PROMPT_ARTIFACT_MAX_CHARS = 12_000;
const TRACE_ARTIFACT_MAX_CHARS = 18_000;
const RESULT_ARTIFACT_MAX_CHARS = 6_000;
const SNAPSHOT_ARTIFACT_MAX_CHARS = 8_000;
const CHANGE_SUMMARY_ARTIFACT_MAX_CHARS = 8_000;
const OUTCOME_ARTIFACT_MAX_CHARS = 4_000;
const REINDEX_ARTIFACT_MAX_CHARS = 6_000;
const REVIEW_ARTIFACT_MAX_CHARS = 8_000;
const PROJECT_RUN_LOCK_TTL_SECONDS = 180;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LocalCommandService {
  constructor(private readonly deps: LocalCommandServiceDeps) {}

  public async localRefresh(): Promise<LocalCommandResult> {
    const blocked = this.ensureLocalProfile("local_refresh");
    if (blocked) {
      return blocked;
    }

    try {
      const environment = await this.deps.inspector.inspect();
      this.applyEnvironment(environment, "local_refresh");

      const health = await this.refreshPersistenceStatus();
      if (!health.ok) {
        const result = this.makeResult(
          "local_refresh",
          "error",
          "Conexión PostgreSQL no disponible. Revisa wisContextSync.localDb.* y el estado del contenedor.",
          {
            db_status: health.db_status,
            db_error: health.error,
            migrations_applied: health.migrations_applied,
          },
        );
        this.pushResult(result, true);
        return result;
      }

      const result = this.makeResult("local_refresh", "ok", "Estado local actualizado.", {
        inspector_status: environment.inspector_status,
        workspace_root: environment.workspace_root,
        repo_root: environment.repo_root,
        db_status: health.db_status,
        migrations_applied: health.migrations_applied,
      });
      this.pushResult(result, false);
      return result;
    } catch (error) {
      const result = this.makeResult("local_refresh", "error", toErrorMessage(error), null);
      this.pushResult(result, true);
      this.updateDbStatus("disconnected", toErrorMessage(error));
      return result;
    }
  }

  public async localIndex(): Promise<LocalCommandResult> {
    const blocked = this.ensureLocalProfile("local_index");
    if (blocked) {
      return blocked;
    }

    try {
      const environment = await this.deps.inspector.inspect();
      this.applyEnvironment(environment, "local_index", "running");

      const health = await this.refreshPersistenceStatus();
      if (!health.ok) {
        const unavailable = this.makeResult(
          "local_index",
          "error",
          "Persistencia PostgreSQL no disponible para Local Index.",
          {
            db_status: health.db_status,
            db_error: health.error,
          },
        );
        this.pushResult(unavailable, true);
        return unavailable;
      }

      const project = await this.ensureProjectFromEnvironment(environment);
      const indexRun = await this.deps.persistence.createIndexRun({
        project_id: project.id,
        status: "started",
        summary: null,
      });

      try {
        const snapshot = this.deps.store.getSnapshot();
        const indexed = await this.deps.indexer.runIndex({
          projectId: project.id,
          snapshot,
        });
        await this.deps.persistence.createOrUpdateIndexRunMetrics({
          index_run_id: indexRun.id,
          scanned_count: indexed.metrics.scanned,
          new_count: indexed.metrics.new,
          modified_count: indexed.metrics.modified,
          deleted_count: indexed.metrics.deleted,
          skipped_count: indexed.metrics.skipped,
          chunk_count: indexed.metrics.chunksWritten,
          error_count: indexed.metrics.errors,
        });
        await this.deps.persistence.completeIndexRun({
          index_run_id: indexRun.id,
          status: "completed",
          summary: indexed.message,
        });

        const result = this.makeResult("local_index", "ok", indexed.message, {
          project_id: project.id,
          index_run_id: indexRun.id,
          root_path: indexed.details.root_path ?? null,
          scanned: indexed.metrics.scanned,
          new: indexed.metrics.new,
          modified: indexed.metrics.modified,
          deleted: indexed.metrics.deleted,
          skipped: indexed.metrics.skipped,
          chunks_written: indexed.metrics.chunksWritten,
          errors: indexed.metrics.errors,
          db_status: health.db_status,
        });
        this.pushResult(result, false);
        return result;
      } catch (error) {
        await this.deps.persistence.createOrUpdateIndexRunMetrics({
          index_run_id: indexRun.id,
          scanned_count: 0,
          new_count: 0,
          modified_count: 0,
          deleted_count: 0,
          skipped_count: 0,
          chunk_count: 0,
          error_count: 1,
        });
        await this.deps.persistence.completeIndexRun({
          index_run_id: indexRun.id,
          status: "failed",
          summary: toErrorMessage(error),
        });
        const failed = this.makeResult("local_index", "error", `Indexación local falló: ${toErrorMessage(error)}`, {
          project_id: project.id,
          index_run_id: indexRun.id,
        });
        this.pushResult(failed, true);
        return failed;
      }
    } catch (error) {
      const result = this.makeResult("local_index", "error", toErrorMessage(error), null);
      this.pushResult(result, true);
      return result;
    }
  }

  public async localPrepareTask(intent: string): Promise<LocalCommandResult> {
    const blocked = this.ensureLocalProfile("local_prepare_task");
    if (blocked) {
      return blocked;
    }

    const cleanIntent = intent.trim();
    if (!cleanIntent) {
      const invalid = this.makeResult(
        "local_prepare_task",
        "error",
        "La intención no puede estar vacía.",
        null,
      );
      this.pushResult(invalid, true);
      return invalid;
    }

    try {
      const environment = await this.deps.inspector.inspect();
      this.applyEnvironment(environment, "local_prepare_task", "running");

      const health = await this.refreshPersistenceStatus();
      if (!health.ok) {
        const unavailable = this.makeResult(
          "local_prepare_task",
          "error",
          "Persistencia PostgreSQL no disponible para preparar tarea.",
          {
            db_status: health.db_status,
            db_error: health.error,
          },
        );
        this.pushResult(unavailable, true);
        return unavailable;
      }

      const project = await this.ensureProjectFromEnvironment(environment);
      const snapshot = this.deps.store.getSnapshot();
      const idempotencyKey = this.buildIdempotencyKey("local_prepare_task", [
        project.id,
        cleanIntent.toLowerCase(),
        snapshot.repo_root ?? "",
        snapshot.branch ?? "",
        snapshot.active_file ?? "",
      ]);
      const idempotent = await this.deps.persistence.resolveIdempotentResult({
        project_id: project.id,
        command: "local_prepare_task",
        idempotency_key: idempotencyKey,
      });
      if (idempotent) {
        const replayed = this.resultFromIdempotent("local_prepare_task", idempotent);
        this.pushResult(replayed, replayed.status !== "ok");
        return replayed;
      }

      const context = await this.deps.retriever.retrieve({
        intent: cleanIntent,
        projectId: project.id,
        snapshot,
      });
      const draft = await this.deps.taskBuilder.buildTask(cleanIntent, context, snapshot);

      const savedTask = await this.deps.persistence.saveTask({
        project_id: project.id,
        task: draft,
        status: "draft",
        lifecycle_state: "draft",
        idempotency_key: idempotencyKey,
      });
      const savedTaskContext = await this.deps.persistence.saveTaskContext({
        project_id: project.id,
        task: draft,
        retrieved_context: context,
      });
      await this.deps.persistence.saveTask({
        project_id: project.id,
        task: draft,
        status: "draft",
        lifecycle_state: "draft",
        retrieval_context_ref: savedTaskContext.id,
        idempotency_key: idempotencyKey,
      });
      await this.deps.persistence.transitionTaskState({
        project_id: project.id,
        task_id: draft.id,
        from_state: "draft",
        to_state: "prepared",
        reason: "local_prepare_task_completed",
      });

      this.deps.store.update((current) => ({
        ...current,
        task_draft: draft,
        runtime_state: "ready",
        updated_at: new Date().toISOString(),
      }));

      const result = this.makeResult("local_prepare_task", "ok", "Tarea local preparada.", {
        project_id: project.id,
        task_id: savedTask.id,
        task_context_id: savedTaskContext.id,
        candidate_files: draft.candidate_files.length,
        selected_chunks: context.selected_chunks.length,
        evidence_items: context.ranking_evidence.length,
        objective: draft.objective,
        task_state: "prepared",
        idempotency_key: idempotencyKey,
      });
      await this.deps.persistence.saveIdempotentResult({
        project_id: project.id,
        command: "local_prepare_task",
        idempotency_key: idempotencyKey,
        status: result.status,
        response_json: result as unknown as Record<string, unknown>,
      });
      this.pushResult(result, false);
      return result;
    } catch (error) {
      const result = this.makeResult("local_prepare_task", "error", toErrorMessage(error), null);
      this.pushResult(result, true);
      return result;
    }
  }

  public async localRunCodex(options?: LocalRunCodexOptions): Promise<LocalCommandResult> {
    const blocked = this.ensureLocalProfile("local_run_codex");
    if (blocked) {
      return blocked;
    }

    let lockId: string | null = null;
    let projectIdForLock: string | null = null;
    let draftIdForState: string | null = null;
    let stateTransitionStarted = false;

    try {
      const environment = await this.deps.inspector.inspect();
      this.applyEnvironment(environment, "local_run_codex", "running");

      const health = await this.refreshPersistenceStatus();
      if (!health.ok) {
        const unavailable = this.makeResult(
          "local_run_codex",
          "error",
          "Persistencia PostgreSQL no disponible para ejecutar Codex.",
          {
            classified_outcome: "blocked",
            db_status: health.db_status,
            db_error: health.error,
          },
        );
        this.pushResult(unavailable, true);
        return unavailable;
      }

      const snapshot = this.deps.store.getSnapshot();
      const draft = snapshot.task_draft;
      if (!draft) {
        const missingTask = this.makeResult(
          "local_run_codex",
          "error",
          "No hay task_draft. Ejecuta primero 'WIS: Local Prepare Task'.",
          {
            classified_outcome: "blocked",
          },
        );
        this.pushResult(missingTask, true);
        return missingTask;
      }

      const project = await this.ensureProjectFromEnvironment(environment);
      projectIdForLock = project.id;
      if (!(environment.repo_root ?? environment.workspace_root)) {
        const missingRoot = this.makeResult(
          "local_run_codex",
          "error",
          "No se pudo resolver repo_root/workspace_root para reconciliación post-run.",
          {
            classified_outcome: "blocked",
            project_id: project.id,
          },
        );
        this.pushResult(missingRoot, true);
        return missingRoot;
      }

      const runIdempotencyKey = this.buildIdempotencyKey("local_run_codex", [
        project.id,
        draft.id,
        draft.created_at,
        snapshot.repo_root ?? "",
        snapshot.branch ?? "",
      ]);
      const idempotentRun = await this.deps.persistence.resolveIdempotentResult({
        project_id: project.id,
        command: "local_run_codex",
        idempotency_key: runIdempotencyKey,
      });
      if (idempotentRun) {
        const replayed = this.resultFromIdempotent("local_run_codex", idempotentRun);
        this.pushResult(replayed, replayed.status !== "ok");
        return replayed;
      }

      lockId = randomUUID();
      const lockAcquired = await this.deps.persistence.acquireProjectRunLock({
        project_id: project.id,
        owner: "local_run_codex",
        lock_id: lockId,
        ttl_seconds: PROJECT_RUN_LOCK_TTL_SECONDS,
      });
      if (!lockAcquired) {
        const lockedResult = this.makeResult(
          "local_run_codex",
          "error",
          "Proyecto bloqueado por ejecución activa. Espera a que termine el run en curso.",
          {
            classified_outcome: "blocked",
            project_id: project.id,
            task_id: draft.id,
            lock_status: "busy",
          },
        );
        this.pushResult(lockedResult, true);
        return lockedResult;
      }

      const commandValidation = validateCodexExecutableCommand(this.deps.getCodexCliCommand());
      if (!commandValidation.ok) {
        const eventId = await this.recordInvalidCommandConfigurationEvent(project.id, draft.id, commandValidation);
        const invalidConfig = this.makeResult(
          "local_run_codex",
          "error",
          "Configuración inválida de wisContextSync.codexCliCommand. Usa solo el ejecutable/ruta, sin argumentos embebidos.",
          {
            classified_outcome: "blocked",
            project_id: project.id,
            task_id: draft.id,
            event_id: eventId,
            error_code: commandValidation.error_code,
            configured_command: commandValidation.configured_command,
            error: commandValidation.reason,
          },
        );
        this.pushResult(invalidConfig, true);
        return invalidConfig;
      }

      draftIdForState = draft.id;
      const currentState = await this.deps.persistence.getTaskLifecycleState(project.id, draft.id);
      if (currentState === null) {
        await this.deps.persistence.transitionTaskState({
          project_id: project.id,
          task_id: draft.id,
          from_state: null,
          to_state: "prepared",
          reason: "task_state_bootstrap_for_run",
        });
      } else if (currentState !== "prepared") {
        const nonPrepared = this.makeResult(
          "local_run_codex",
          "error",
          `Task en estado inválido para ejecución: ${currentState}. Requiere 'prepared'.`,
          {
            classified_outcome: "blocked",
            project_id: project.id,
            task_id: draft.id,
            task_state: currentState,
          },
        );
        this.pushResult(nonPrepared, true);
        return nonPrepared;
      }

      await this.deps.persistence.transitionTaskState({
        project_id: project.id,
        task_id: draft.id,
        from_state: "prepared",
        to_state: "running",
        reason: "local_run_codex_started",
      });
      stateTransitionStarted = true;
      const command = commandValidation.executable;
      const executionRequest = {
        task: draft,
        repo_root: environment.repo_root,
        workspace_root: environment.workspace_root,
        branch: environment.branch,
        active_file: environment.active_file,
      };
      const reconciled = await this.deps.postRunReconciler.reconcile({
        projectId: project.id,
        snapshot,
        task: draft,
        execute: async () => {
          const healthResult = await this.deps.codexRunner.healthcheck(command, {
            abortSignal: options?.abortSignal,
          });
          if (!healthResult.ok) {
            return this.failedRunFromHealthcheck(healthResult, draft.id, draft.objective);
          }
          if (options?.abortSignal?.aborted) {
            return this.cancelledExecution(command, draft.id, draft.objective, "Cancelled before run started.");
          }
          return this.deps.codexRunner.run(executionRequest, command, {
            abortSignal: options?.abortSignal,
          });
        },
      });
      await this.deps.persistence.transitionTaskState({
        project_id: project.id,
        task_id: draft.id,
        from_state: "running",
        to_state: "reconciling",
        reason: "local_run_codex_reconciling",
      });

      const execution = reconciled.execution_result;
      const executionMessage = this.executionMessage(execution, reconciled.classified_outcome);
      const executionSeverity = reconciled.outcome_classification.severity;
      const finalTaskState = this.finalTaskStateFromOutcome(reconciled.classified_outcome);
      const prepareLatencyMs = Math.max(0, Date.now() - Date.parse(draft.created_at));

      const persisted = await this.deps.persistence.runInTransaction(async (tx) => {
        const executionRecord = await tx.saveExecution({
          project_id: project.id,
          task_id: draft.id,
          result: execution,
          idempotency_key: runIdempotencyKey,
          outcome_classification: reconciled.outcome_classification as unknown as Record<string, unknown>,
        });

        const prompt = this.extractPromptFromPreview(execution.request_preview);
        const promptContent = capText(prompt, PROMPT_ARTIFACT_MAX_CHARS);
        const promptArtifact = await tx.saveExecutionArtifact({
          project_id: project.id,
          execution_id: executionRecord.id,
          artifact_type: "codex_exec_prompt",
          content: promptContent,
          metadata: {
            version: "codex_exec_prompt_v1",
            prompt_hash: sha256Hex(promptContent),
            prompt_chars: promptContent.length,
            prompt_lines: countLines(promptContent),
            capped: prompt.length > promptContent.length,
          },
        });

        const traceContent = capText(
          JSON.stringify(
            {
              version: "codex_exec_trace_v1",
              thread_id: execution.thread_id,
              events_count: execution.events_count,
              warnings_count: execution.warnings_count,
              usage_tokens: execution.usage_tokens,
              stdout_jsonl: execution.stdout,
              stderr: execution.stderr,
              warning_reasons: this.extractWarningReasonsFromPreview(execution.request_preview),
            },
            null,
            2,
          ),
          TRACE_ARTIFACT_MAX_CHARS,
        );
        const traceArtifact = await tx.saveExecutionArtifact({
          project_id: project.id,
          execution_id: executionRecord.id,
          artifact_type: "codex_exec_trace",
          content: traceContent,
          metadata: {
            version: "codex_exec_trace_v1",
            trace_hash: sha256Hex(traceContent),
            trace_chars: traceContent.length,
            trace_lines: countLines(traceContent),
          },
        });

        const finalMessage = execution.final_message ?? "";
        const resultContent = capText(finalMessage, RESULT_ARTIFACT_MAX_CHARS);
        const resultArtifact = await tx.saveExecutionArtifact({
          project_id: project.id,
          execution_id: executionRecord.id,
          artifact_type: "codex_exec_result",
          content: resultContent,
          metadata: {
            version: "codex_exec_result_v1",
            final_message_hash: sha256Hex(resultContent),
            final_message_chars: resultContent.length,
            final_message_lines: countLines(resultContent),
            capped: finalMessage.length > resultContent.length,
            command: execution.command,
            command_line: execution.command_line,
            mode: execution.mode,
            exit_code: execution.exit_code,
            duration_ms: execution.duration_ms,
            cancelled: execution.cancelled,
            warnings_count: execution.warnings_count,
            error: execution.error,
          },
        });

        const beforeSnapshotContent = this.cappedJsonContent(
          {
            version: "workspace_snapshot_summary_v1",
            captured_at: reconciled.workspace_before_snapshot.captured_at,
            root_path: reconciled.workspace_before_snapshot.root_path,
            entries_count: reconciled.workspace_before_snapshot.entries.length,
            entries_preview: reconciled.workspace_before_snapshot.entries.slice(0, 40),
          },
          SNAPSHOT_ARTIFACT_MAX_CHARS,
        );
        const beforeSnapshotArtifact = await tx.saveExecutionArtifact({
          project_id: project.id,
          execution_id: executionRecord.id,
          artifact_type: "workspace_before_snapshot_summary",
          content: beforeSnapshotContent,
          metadata: {
            version: "workspace_snapshot_summary_v1",
            content_hash: sha256Hex(beforeSnapshotContent),
            chars: beforeSnapshotContent.length,
            lines: countLines(beforeSnapshotContent),
            entries_count: reconciled.workspace_before_snapshot.entries.length,
          },
        });

        const afterSnapshotContent = this.cappedJsonContent(
          {
            version: "workspace_snapshot_summary_v1",
            captured_at: reconciled.workspace_after_snapshot.captured_at,
            root_path: reconciled.workspace_after_snapshot.root_path,
            entries_count: reconciled.workspace_after_snapshot.entries.length,
            entries_preview: reconciled.workspace_after_snapshot.entries.slice(0, 40),
          },
          SNAPSHOT_ARTIFACT_MAX_CHARS,
        );
        const afterSnapshotArtifact = await tx.saveExecutionArtifact({
          project_id: project.id,
          execution_id: executionRecord.id,
          artifact_type: "workspace_after_snapshot_summary",
          content: afterSnapshotContent,
          metadata: {
            version: "workspace_snapshot_summary_v1",
            content_hash: sha256Hex(afterSnapshotContent),
            chars: afterSnapshotContent.length,
            lines: countLines(afterSnapshotContent),
            entries_count: reconciled.workspace_after_snapshot.entries.length,
          },
        });

        const workspaceChangeContent = this.cappedJsonContent(
          {
            version: "workspace_change_summary_v1",
            ...reconciled.workspace_diff,
            unchanged_files_count: reconciled.workspace_diff.unchanged_files.length,
            unchanged_files_preview: reconciled.workspace_diff.unchanged_files.slice(0, 20),
          },
          CHANGE_SUMMARY_ARTIFACT_MAX_CHARS,
        );
        const workspaceChangeArtifact = await tx.saveExecutionArtifact({
          project_id: project.id,
          execution_id: executionRecord.id,
          artifact_type: "workspace_change_summary",
          content: workspaceChangeContent,
          metadata: {
            version: "workspace_change_summary_v1",
            content_hash: sha256Hex(workspaceChangeContent),
            chars: workspaceChangeContent.length,
            lines: countLines(workspaceChangeContent),
            changed_files_count: reconciled.workspace_diff.changed_files_count,
          },
        });

        const changedFilesManifestContent = JSON.stringify(
          {
            version: "changed_files_manifest_v1",
            created_files: reconciled.workspace_diff.created_files,
            modified_files: reconciled.workspace_diff.modified_files,
            deleted_files: reconciled.workspace_diff.deleted_files,
            changed_files_count: reconciled.workspace_diff.changed_files_count,
          },
          null,
          2,
        );
        const changedFilesManifestArtifact = await tx.saveExecutionArtifact({
          project_id: project.id,
          execution_id: executionRecord.id,
          artifact_type: "changed_files_manifest",
          content: changedFilesManifestContent,
          metadata: {
            version: "changed_files_manifest_v1",
            content_hash: sha256Hex(changedFilesManifestContent),
            chars: changedFilesManifestContent.length,
            lines: countLines(changedFilesManifestContent),
            changed_files_count: reconciled.workspace_diff.changed_files_count,
          },
        });

        const outcomeContent = this.cappedJsonContent(
          {
            version: "execution_outcome_classification_v1",
            ...reconciled.outcome_classification,
            warnings_count: execution.warnings_count,
            telemetry: reconciled.telemetry,
          },
          OUTCOME_ARTIFACT_MAX_CHARS,
        );
        const outcomeArtifact = await tx.saveExecutionArtifact({
          project_id: project.id,
          execution_id: executionRecord.id,
          artifact_type: "execution_outcome_classification",
          content: outcomeContent,
          metadata: {
            version: "execution_outcome_classification_v1",
            content_hash: sha256Hex(outcomeContent),
            chars: outcomeContent.length,
            lines: countLines(outcomeContent),
          },
        });

        const reindexSummaryContent = this.cappedJsonContent(
          {
            version: "post_run_reindex_summary_v1",
            ...reconciled.reindex_result,
          },
          REINDEX_ARTIFACT_MAX_CHARS,
        );
        const reindexArtifact = await tx.saveExecutionArtifact({
          project_id: project.id,
          execution_id: executionRecord.id,
          artifact_type: "post_run_reindex_summary",
          content: reindexSummaryContent,
          metadata: {
            version: "post_run_reindex_summary_v1",
            content_hash: sha256Hex(reindexSummaryContent),
            chars: reindexSummaryContent.length,
            lines: countLines(reindexSummaryContent),
            reindex_mode: reconciled.reindex_result.mode,
            reindex_status: reconciled.reindex_result.status,
          },
        });

        const reviewPayloadContent = this.cappedJsonContent(
          {
            version: "post_run_review_payload_v1",
            ...reconciled.review_payload,
          },
          REVIEW_ARTIFACT_MAX_CHARS,
        );
        const reviewPayloadArtifact = await tx.saveExecutionArtifact({
          project_id: project.id,
          execution_id: executionRecord.id,
          artifact_type: "post_run_review_payload",
          content: reviewPayloadContent,
          metadata: {
            version: "post_run_review_payload_v1",
            content_hash: sha256Hex(reviewPayloadContent),
            chars: reviewPayloadContent.length,
            lines: countLines(reviewPayloadContent),
            classified_outcome: reconciled.classified_outcome,
          },
        });

        const eventRecord = await tx.saveEvent({
          project_id: project.id,
          task_id: draft.id,
          execution_id: executionRecord.id,
          event_type: "local_run_codex",
          severity: executionSeverity,
          message: executionMessage,
          idempotency_key: this.buildIdempotencyKey("event.local_run_codex.final", [
            project.id,
            executionRecord.id,
            runIdempotencyKey,
          ]),
          payload: {
            version: "event_envelope_v2",
            command: execution.command,
            command_line: execution.command_line,
            exit_code: execution.exit_code,
            cancelled: execution.cancelled,
            warnings_count: execution.warnings_count,
            error: execution.error,
            classified_outcome: reconciled.classified_outcome,
            classification_reasons: reconciled.classification_reasons,
            anomaly_flags: reconciled.outcome_classification.anomaly_flags,
            changed_files_count: reconciled.workspace_diff.changed_files_count,
            changed_files_preview: reconciled.workspace_diff.changed_files_preview,
            reindex_status: this.reindexStatusLabel(reconciled.reindex_result.mode, reconciled.reindex_result.status),
            reindex_ok: reconciled.reindex_result.ok,
            closure_complete: true,
            telemetry: {
              prepare_latency_ms: prepareLatencyMs,
              run_latency_ms: execution.duration_ms,
              reconcile_latency_ms: reconciled.telemetry.reconcile_latency_ms,
              reindex_latency_ms: reconciled.telemetry.reindex_latency_ms,
              total_duration_ms: reconciled.telemetry.total_duration_ms,
              changed_files_count: reconciled.telemetry.changed_files_count,
              warnings_count: reconciled.telemetry.warnings_count,
              anomaly_count: reconciled.telemetry.anomaly_count,
            },
          },
        });

        return {
          execution: executionRecord,
          promptArtifact,
          traceArtifact,
          resultArtifact,
          beforeSnapshotArtifact,
          afterSnapshotArtifact,
          workspaceChangeArtifact,
          changedFilesManifestArtifact,
          outcomeArtifact,
          reindexArtifact,
          reviewPayloadArtifact,
          event: eventRecord,
        };
      });
      await this.deps.persistence.transitionTaskState({
        project_id: project.id,
        task_id: draft.id,
        from_state: "reconciling",
        to_state: finalTaskState,
        reason: "local_run_codex_closed",
        execution_id: persisted.execution.id,
      });

      const result = this.makeResult(
        "local_run_codex",
        execution.ok ? "ok" : "error",
        executionMessage,
        {
          project_id: project.id,
          task_id: draft.id,
          execution_id: persisted.execution.id,
          artifact_id: persisted.resultArtifact.id,
          prompt_artifact_id: persisted.promptArtifact.id,
          trace_artifact_id: persisted.traceArtifact.id,
          result_artifact_id: persisted.resultArtifact.id,
          before_snapshot_artifact_id: persisted.beforeSnapshotArtifact.id,
          after_snapshot_artifact_id: persisted.afterSnapshotArtifact.id,
          workspace_change_artifact_id: persisted.workspaceChangeArtifact.id,
          changed_files_manifest_artifact_id: persisted.changedFilesManifestArtifact.id,
          outcome_artifact_id: persisted.outcomeArtifact.id,
          reindex_artifact_id: persisted.reindexArtifact.id,
          review_artifact_id: persisted.reviewPayloadArtifact.id,
          event_id: persisted.event.id,
          command: execution.command,
          command_line: execution.command_line,
          exit_code: execution.exit_code,
          duration_ms: execution.duration_ms,
          cancelled: execution.cancelled,
          final_message: execution.final_message,
          thread_id: execution.thread_id,
          events_count: execution.events_count,
          warnings_count: execution.warnings_count,
          usage_tokens: execution.usage_tokens,
          error: execution.error,
          classified_outcome: reconciled.classified_outcome,
          changed_files_count: reconciled.workspace_diff.changed_files_count,
          changed_files_preview: reconciled.workspace_diff.changed_files_preview,
          reindex_status: this.reindexStatusLabel(reconciled.reindex_result.mode, reconciled.reindex_result.status),
          next_review_hint: reconciled.review_payload.next_action,
          classification_reasons: reconciled.classification_reasons,
          task_state: finalTaskState,
          idempotency_key: runIdempotencyKey,
          telemetry: {
            prepare_latency_ms: prepareLatencyMs,
            run_latency_ms: execution.duration_ms,
            reconcile_latency_ms: reconciled.telemetry.reconcile_latency_ms,
            reindex_latency_ms: reconciled.telemetry.reindex_latency_ms,
            total_duration_ms: reconciled.telemetry.total_duration_ms,
            changed_files_count: reconciled.telemetry.changed_files_count,
            warnings_count: reconciled.telemetry.warnings_count,
            anomaly_count: reconciled.telemetry.anomaly_count,
          },
        },
      );
      await this.deps.persistence.saveIdempotentResult({
        project_id: project.id,
        command: "local_run_codex",
        idempotency_key: runIdempotencyKey,
        status: result.status,
        response_json: result as unknown as Record<string, unknown>,
      });
      this.pushResult(result, !execution.ok);
      return result;
    } catch (error) {
      const result = this.makeResult("local_run_codex", "error", toErrorMessage(error), null);
      if (projectIdForLock && draftIdForState && stateTransitionStarted) {
        await this.tryTransitionTaskToFailure(projectIdForLock, draftIdForState, toErrorMessage(error));
      }
      this.pushResult(result, true);
      return result;
    } finally {
      if (projectIdForLock && lockId) {
        try {
          await this.deps.persistence.releaseProjectRunLock({
            project_id: projectIdForLock,
            lock_id: lockId,
          });
        } catch {
          // best-effort release to avoid masking principal outcome
        }
      }
    }
  }

  private async refreshPersistenceStatus(): Promise<PersistenceHealthcheck> {
    try {
      const health = await this.deps.persistence.healthcheck();
      this.updateDbStatus(health.db_status, health.error);
      return health;
    } catch (error) {
      const message = toErrorMessage(error);
      this.updateDbStatus("disconnected", message);
      return {
        ok: false,
        db_status: "disconnected",
        error: message,
        migrations_applied: 0,
      };
    }
  }

  private async ensureProjectFromEnvironment(environment: EnvironmentSnapshot): Promise<PersistedProject> {
    return this.deps.persistence.ensureProject({
      operation_profile: this.deps.getOperationProfile(),
      workspace_root: environment.workspace_root,
      repo_root: environment.repo_root,
      branch: environment.branch,
    });
  }

  private ensureLocalProfile(command: LocalCommandName): LocalCommandResult | null {
    if (this.deps.getOperationProfile() === "local_private") {
      return null;
    }
    const blocked = this.makeResult(
      command,
      "blocked",
      "Comando local bloqueado. Cambia wisContextSync.operationProfile a 'local_private'.",
      {
        required_profile: "local_private",
        current_profile: this.deps.getOperationProfile(),
      },
    );
    this.pushResult(blocked, true);
    return blocked;
  }

  private applyEnvironment(
    environment: EnvironmentSnapshot,
    action: LocalCommandName,
    runtimeState: ProjectRuntimeSnapshot["runtime_state"] = "ready",
  ): void {
    const nextState: ProjectRuntimeSnapshot["runtime_state"] =
      environment.inspector_status === "error"
        ? "error"
        : environment.inspector_status === "no_workspace"
          ? "idle"
          : runtimeState;

    this.deps.store.update((current) => ({
      ...current,
      operation_profile: this.deps.getOperationProfile(),
      workspace_root: environment.workspace_root,
      repo_root: environment.repo_root,
      branch: environment.branch,
      active_file: environment.active_file,
      runtime_state: nextState,
      last_action: action,
      updated_at: new Date().toISOString(),
    }));
  }

  private updateDbStatus(dbStatus: "connected" | "disconnected", dbError: string | null): void {
    this.deps.store.update((current) => ({
      ...current,
      db_status: dbStatus,
      db_error: dbError,
      updated_at: new Date().toISOString(),
    }));
  }

  private makeResult(
    command: LocalCommandName,
    status: LocalCommandResult["status"],
    message: string,
    details: Record<string, unknown> | null,
  ): LocalCommandResult {
    return {
      command,
      status,
      ok: status === "ok",
      message,
      details,
      timestamp: new Date().toISOString(),
    };
  }

  private pushResult(result: LocalCommandResult, isError: boolean): void {
    this.deps.store.update((current) => ({
      ...current,
      operation_profile: this.deps.getOperationProfile(),
      runtime_state: isError ? "error" : current.runtime_state === "running" ? "ready" : current.runtime_state,
      last_result: result,
      errors: isError ? [...current.errors, result.message].slice(-8) : current.errors,
      updated_at: new Date().toISOString(),
    }));
  }

  private failedRunFromHealthcheck(
    healthcheck: CodexExecutionResult,
    taskId: string,
    objective: string,
  ): CodexExecutionResult {
    return {
      ...healthcheck,
      mode: "run",
      ok: false,
      cancelled: healthcheck.cancelled,
      final_message: null,
      thread_id: null,
      events_count: 0,
      usage_tokens: null,
      request_preview: {
        task_id: taskId,
        objective,
        health_error: healthcheck.error,
      },
    };
  }

  private cancelledExecution(
    command: string,
    taskId: string,
    objective: string,
    reason: string,
  ): CodexExecutionResult {
    const now = new Date().toISOString();
    return {
      mode: "run",
      ok: false,
      cancelled: true,
      command,
      command_line: command,
      exit_code: null,
      stdout: "",
      stderr: "",
      final_message: null,
      thread_id: null,
      events_count: 0,
      warnings_count: 0,
      usage_tokens: null,
      started_at: now,
      finished_at: now,
      duration_ms: 0,
      error: reason,
      request_preview: {
        task_id: taskId,
        objective,
        cancel_reason: reason,
      },
    };
  }

  private executionSeverityFromOutcome(outcome: ExecutionOutcome): "info" | "warning" | "error" {
    if (outcome === "partial_changes") {
      return "warning";
    }
    if (outcome === "no_op" || outcome === "applied_changes") {
      return "info";
    }
    return "error";
  }

  private executionMessage(execution: CodexExecutionResult, outcome: ExecutionOutcome): string {
    if (execution.cancelled || outcome === "cancelled") {
      return "Ejecucion Codex cancelada por usuario.";
    }
    switch (outcome) {
      case "blocked":
        return "Ejecucion Codex bloqueada por precondiciones.";
      case "timeout":
        return "Ejecucion Codex expirada por timeout.";
      case "failed":
        return "Ejecucion Codex fallo.";
      case "no_op":
        return "Ejecucion Codex completada sin cambios en workspace.";
      case "partial_changes":
        return "Ejecucion Codex completada con cambios parciales/anomalías.";
      case "applied_changes":
        return execution.warnings_count > 0
          ? "Ejecucion Codex completada con advertencias no severas."
          : "Ejecucion Codex completada con cambios aplicados.";
      default:
        return execution.ok ? "Ejecucion Codex completada." : "Ejecucion Codex fallo.";
    }
  }

  private reindexStatusLabel(mode: string, status: string): string {
    return `${mode}:${status}`;
  }

  private cappedJsonContent(value: Record<string, unknown>, maxChars: number): string {
    const raw = JSON.stringify(value, null, 2);
    return capText(raw, maxChars);
  }

  private buildIdempotencyKey(command: string, parts: string[]): string {
    const payload = [command, ...parts].join("|");
    return createHash("sha256").update(payload).digest("hex");
  }

  private resultFromIdempotent(command: LocalCommandName, payload: Record<string, unknown>): LocalCommandResult {
    const status = payload.status;
    const ok = payload.ok;
    const message = payload.message;
    const details = payload.details;
    if (
      (status === "ok" || status === "error" || status === "blocked") &&
      typeof ok === "boolean" &&
      typeof message === "string"
    ) {
      return {
        command,
        status,
        ok,
        message,
        details: details && typeof details === "object" ? (details as Record<string, unknown>) : null,
        timestamp: new Date().toISOString(),
      };
    }
    return this.makeResult(command, "error", "Resultado idempotente inválido.", null);
  }

  private finalTaskStateFromOutcome(outcome: ExecutionOutcome): TaskLifecycleState {
    switch (outcome) {
      case "applied_changes":
      case "no_op":
        return "completed";
      case "partial_changes":
        return "partial";
      case "cancelled":
        return "cancelled";
      case "timeout":
        return "timeout";
      case "failed":
        return "failed";
      case "blocked":
      default:
        return "blocked";
    }
  }

  private async tryTransitionTaskToFailure(projectId: string, taskId: string, reason: string): Promise<void> {
    try {
      const current = await this.deps.persistence.getTaskLifecycleState(projectId, taskId);
      if (current === "running") {
        await this.deps.persistence.transitionTaskState({
          project_id: projectId,
          task_id: taskId,
          from_state: "running",
          to_state: "failed",
          reason: `local_run_codex_exception:${reason}`,
        });
        return;
      }
      if (current === "reconciling") {
        await this.deps.persistence.transitionTaskState({
          project_id: projectId,
          task_id: taskId,
          from_state: "reconciling",
          to_state: "failed",
          reason: `local_run_codex_exception:${reason}`,
        });
      }
    } catch {
      // best-effort state cleanup
    }
  }

  private extractPromptFromPreview(preview: Record<string, unknown> | null): string {
    if (!preview || typeof preview.prompt !== "string") {
      return "";
    }
    return preview.prompt;
  }

  private extractWarningReasonsFromPreview(preview: Record<string, unknown> | null): string[] {
    if (!preview || !Array.isArray(preview.stderr_warning_reasons)) {
      return [];
    }
    return preview.stderr_warning_reasons
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  private async recordInvalidCommandConfigurationEvent(
    projectId: string,
    taskId: string,
    invalidCommand: {
      error_code: "invalid_command_configuration";
      configured_command: string;
      reason: string;
    },
  ): Promise<string | null> {
    try {
      const event = await this.deps.persistence.saveEvent({
        project_id: projectId,
        task_id: taskId,
        execution_id: null,
        event_type: "local_run_codex",
        severity: "error",
        message: "Configuración inválida de codexCliCommand.",
        idempotency_key: this.buildIdempotencyKey("event.invalid_codex_command", [
          projectId,
          taskId,
          invalidCommand.configured_command,
        ]),
        payload: {
          error_code: invalidCommand.error_code,
          configured_command: invalidCommand.configured_command,
          reason: invalidCommand.reason,
        },
      });
      return event.id;
    } catch {
      return null;
    }
  }
}
