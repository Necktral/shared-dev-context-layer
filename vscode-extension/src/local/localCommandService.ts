import type { EnvironmentSnapshot } from "../environment/environmentInspector";
import type { ContextRetrieverPort, CodexRunnerPort, PersistencePort, TaskBuilderPort, WorkspaceIndexerPort } from "./ports";
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

export class LocalCommandService {
  constructor(private readonly deps: LocalCommandServiceDeps) {}

  public async localRefresh(): Promise<LocalCommandResult> {
    const blocked = this.ensureLocalProfile("local_refresh");
    if (blocked) {
      return blocked;
    }

    const environment = await this.deps.inspector.inspect();
    this.applyEnvironment(environment, "local_refresh");

    const result = this.makeResult("local_refresh", "ok", "Estado local actualizado.", {
      inspector_status: environment.inspector_status,
      workspace_root: environment.workspace_root,
      repo_root: environment.repo_root,
    });
    this.pushResult(result, environment.inspector_status === "error");
    return result;
  }

  public async localIndex(): Promise<LocalCommandResult> {
    const blocked = this.ensureLocalProfile("local_index");
    if (blocked) {
      return blocked;
    }

    const environment = await this.deps.inspector.inspect();
    this.applyEnvironment(environment, "local_index", "running");

    const snapshot = this.deps.store.getSnapshot();
    const indexed = await this.deps.indexer.runIndex(snapshot);
    const result = this.makeResult("local_index", "ok", indexed.message, indexed.details);
    this.pushResult(result, false);
    return result;
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

    const environment = await this.deps.inspector.inspect();
    this.applyEnvironment(environment, "local_prepare_task", "running");

    const snapshot = this.deps.store.getSnapshot();
    const context = await this.deps.retriever.retrieve(cleanIntent, snapshot);
    const draft = await this.deps.taskBuilder.buildTask(cleanIntent, context, snapshot);
    await this.deps.persistence.saveTask(draft);

    this.deps.store.update((current) => ({
      ...current,
      task_draft: draft,
      runtime_state: "ready",
      updated_at: new Date().toISOString(),
    }));

    const result = this.makeResult("local_prepare_task", "ok", "Tarea local preparada.", {
      task_id: draft.id,
      candidate_files: draft.candidate_files.length,
      objective: draft.objective,
    });
    this.pushResult(result, false);
    return result;
  }

  public async localRunCodex(): Promise<LocalCommandResult> {
    const blocked = this.ensureLocalProfile("local_run_codex");
    if (blocked) {
      return blocked;
    }

    const environment = await this.deps.inspector.inspect();
    this.applyEnvironment(environment, "local_run_codex", "running");

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

    const command = this.deps.getCodexCliCommand().trim() || "codex";
    const health = await this.deps.codexRunner.healthcheck(command);
    if (!health.ok) {
      const healthError = this.makeResult(
        "local_run_codex",
        "error",
        `Healthcheck Codex falló. Verifica wisContextSync.codexCliCommand='${command}'.`,
        {
          command,
          error: health.error,
          exit_code: health.exit_code,
          stderr: health.stderr,
        },
      );
      this.pushResult(healthError, true);
      return healthError;
    }

    const execution = await this.deps.codexRunner.run({ task: draft }, command);
    if (execution.ok) {
      await this.deps.persistence.saveExecution(draft.id, execution);
    }

    const result = this.makeResult(
      "local_run_codex",
      execution.ok ? "ok" : "error",
      execution.ok ? "Ejecución Codex completada." : "Ejecución Codex falló.",
      {
        command: execution.command,
        command_line: execution.command_line,
        exit_code: execution.exit_code,
        duration_ms: execution.duration_ms,
        error: execution.error,
      },
    );
    this.pushResult(result, !execution.ok);
    return result;
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
