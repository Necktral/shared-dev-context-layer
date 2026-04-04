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
import { InMemoryLocalRuntimeStore } from "./localRuntimeStore";
import type { LocalCommandName, LocalCommandResult, OperationProfile, ProjectRuntimeSnapshot } from "./types";

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
        const indexed = await this.deps.indexer.runIndex(snapshot);
        await this.deps.persistence.completeIndexRun({
          index_run_id: indexRun.id,
          status: "completed",
          summary: indexed.message,
        });

        const result = this.makeResult("local_index", "ok", indexed.message, {
          ...indexed.details,
          project_id: project.id,
          index_run_id: indexRun.id,
          db_status: health.db_status,
        });
        this.pushResult(result, false);
        return result;
      } catch (error) {
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
      const context = await this.deps.retriever.retrieve(cleanIntent, snapshot);
      const draft = await this.deps.taskBuilder.buildTask(cleanIntent, context, snapshot);

      const savedTask = await this.deps.persistence.saveTask({
        project_id: project.id,
        task: draft,
        status: "draft",
      });
      const savedTaskContext = await this.deps.persistence.saveTaskContext({
        project_id: project.id,
        task: draft,
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

  public async localRunCodex(): Promise<LocalCommandResult> {
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
      const healthResult = await this.deps.codexRunner.healthcheck(command);

      const execution = healthResult.ok
        ? await this.deps.codexRunner.run({ task: draft }, command)
        : {
            ...healthResult,
            mode: "run" as const,
            request_preview: {
              task_id: draft.id,
              objective: draft.objective,
              health_error: healthResult.error,
            },
          };

      const persisted = await this.deps.persistence.runInTransaction(async (tx) => {
        const executionRecord = await tx.saveExecution({
          project_id: project.id,
          task_id: draft.id,
          result: execution,
        });

        const artifactRecord = await tx.saveExecutionArtifact({
          project_id: project.id,
          execution_id: executionRecord.id,
          artifact_type: "codex_cli_result",
          content: JSON.stringify(
            {
              stdout: execution.stdout,
              stderr: execution.stderr,
            },
            null,
            2,
          ),
          metadata: {
            command: execution.command,
            command_line: execution.command_line,
            mode: execution.mode,
            exit_code: execution.exit_code,
            duration_ms: execution.duration_ms,
            error: execution.error,
          },
        });

        const eventRecord = await tx.saveEvent({
          project_id: project.id,
          task_id: draft.id,
          execution_id: executionRecord.id,
          event_type: "local_run_codex",
          severity: execution.ok ? "info" : "error",
          message: execution.ok ? "Ejecución Codex completada." : "Ejecución Codex falló.",
          payload: {
            command: execution.command,
            command_line: execution.command_line,
            exit_code: execution.exit_code,
            error: execution.error,
          },
        });

        return {
          execution: executionRecord,
          artifact: artifactRecord,
          event: eventRecord,
        };
      });

      const result = this.makeResult(
        "local_run_codex",
        execution.ok ? "ok" : "error",
        execution.ok ? "Ejecución Codex completada." : "Ejecución Codex falló.",
        {
          project_id: project.id,
          task_id: draft.id,
          execution_id: persisted.execution.id,
          artifact_id: persisted.artifact.id,
          event_id: persisted.event.id,
          command: execution.command,
          command_line: execution.command_line,
          exit_code: execution.exit_code,
          duration_ms: execution.duration_ms,
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
}
