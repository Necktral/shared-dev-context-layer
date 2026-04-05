import type { EnvironmentSnapshot } from "../environment/environmentInspector";
import type {
  ContextRetrieverPort,
  CodexRunnerPort,
  PersistedProject,
  PersistenceHealthcheck,
  PersistencePort,
  TaskBuilderPort,
  WorkspaceIndexerPort,
} from "./ports";
import { capText, countLines, sha256Hex } from "./execution/codexExecutionUtils";
import { InMemoryLocalRuntimeStore } from "./localRuntimeStore";
import type { CodexExecutionResult, LocalCommandName, LocalCommandResult, OperationProfile, ProjectRuntimeSnapshot } from "./types";

export interface EnvironmentInspectorPort {
  inspect(): Promise<EnvironmentSnapshot>;
}

export interface LocalCommandServiceDeps {
  inspector: EnvironmentInspectorPort;
  store: InMemoryLocalRuntimeStore;
  indexer: WorkspaceIndexerPort;
  retriever: ContextRetrieverPort;
  taskBuilder: TaskBuilderPort;
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
      });
      const savedTaskContext = await this.deps.persistence.saveTaskContext({
        project_id: project.id,
        task: draft,
        retrieved_context: context,
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
          null,
        );
        this.pushResult(missingTask, true);
        return missingTask;
      }

      const project = await this.ensureProjectFromEnvironment(environment);
      const command = this.deps.getCodexCliCommand().trim() || "codex";
      const healthResult = await this.deps.codexRunner.healthcheck(command, {
        abortSignal: options?.abortSignal,
      });

      const executionRequest = {
        task: draft,
        repo_root: environment.repo_root,
        workspace_root: environment.workspace_root,
        branch: environment.branch,
        active_file: environment.active_file,
      };

      const execution = healthResult.ok
        ? options?.abortSignal?.aborted
          ? this.cancelledExecution(command, draft.id, draft.objective, "Cancelled before run started.")
          : await this.deps.codexRunner.run(executionRequest, command, {
              abortSignal: options?.abortSignal,
            })
        : this.failedRunFromHealthcheck(healthResult, draft.id, draft.objective);

      const executionMessage = this.executionMessage(execution);
      const executionSeverity = this.executionSeverity(execution);

      const persisted = await this.deps.persistence.runInTransaction(async (tx) => {
        const executionRecord = await tx.saveExecution({
          project_id: project.id,
          task_id: draft.id,
          result: execution,
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

        const eventRecord = await tx.saveEvent({
          project_id: project.id,
          task_id: draft.id,
          execution_id: executionRecord.id,
          event_type: "local_run_codex",
          severity: executionSeverity,
          message: executionMessage,
          payload: {
            command: execution.command,
            command_line: execution.command_line,
            exit_code: execution.exit_code,
            cancelled: execution.cancelled,
            warnings_count: execution.warnings_count,
            error: execution.error,
          },
        });

        return {
          execution: executionRecord,
          promptArtifact,
          traceArtifact,
          resultArtifact,
          event: eventRecord,
        };
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
        },
      );
      this.pushResult(result, !execution.ok);
      return result;
    } catch (error) {
      const result = this.makeResult("local_run_codex", "error", toErrorMessage(error), null);
      this.pushResult(result, true);
      return result;
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

  private executionSeverity(execution: CodexExecutionResult): "info" | "warning" | "error" {
    if (execution.cancelled || !execution.ok) {
      return "error";
    }
    if (execution.warnings_count > 0) {
      return "warning";
    }
    return "info";
  }

  private executionMessage(execution: CodexExecutionResult): string {
    if (execution.cancelled) {
      return "Ejecucion Codex cancelada por usuario.";
    }
    if (execution.ok && execution.warnings_count > 0) {
      return "Ejecucion Codex completada con advertencias.";
    }
    return execution.ok ? "Ejecucion Codex completada." : "Ejecucion Codex fallo.";
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
}
