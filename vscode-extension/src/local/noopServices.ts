import { randomUUID } from "node:crypto";
import type {
  ChunkRecord,
  ContextRetrieverPort,
  CreateIndexRunInput,
  EnsureProjectInput,
  PersistedDecision,
  PersistedEvent,
  PersistedExecution,
  PersistedExecutionArtifact,
  PersistedIndexRun,
  PersistedIndexedFile,
  PersistedProject,
  PersistedTask,
  PersistedTaskContext,
  PersistenceHealthcheck,
  PersistencePort,
  PersistenceTransactionPort,
  RetrievedContext,
  SaveDecisionInput,
  SaveEventInput,
  SaveExecutionArtifactInput,
  SaveExecutionInput,
  SaveTaskContextInput,
  SaveTaskInput,
  TaskBuilderPort,
  WorkspaceIndexerPort,
  CompleteIndexRunInput,
  WorkspaceIndexRequest,
  WorkspaceIndexResult,
  UpsertIndexedFileInput,
  UpdateIndexRunMetricsInput,
} from "./ports";
import type { LocalTaskDraft, ProjectRuntimeSnapshot } from "./types";

export class NoopIndexer implements WorkspaceIndexerPort {
  public async runIndex(request: WorkspaceIndexRequest): Promise<WorkspaceIndexResult> {
    const snapshot = request.snapshot;
    return {
      message: "Indexación local no implementada aún (Paquete 1 baseline).",
      details: {
        workspace_root: snapshot.workspace_root,
        repo_root: snapshot.repo_root,
        project_id: request.projectId,
        mode: "noop",
        scanned: 0,
        new: 0,
        modified: 0,
        deleted: 0,
        skipped: 0,
        chunks_written: 0,
        errors: 0,
      },
      metrics: {
        scanned: 0,
        new: 0,
        modified: 0,
        deleted: 0,
        skipped: 0,
        chunksWritten: 0,
        errors: 0,
      },
    };
  }
}

export class NoopRetriever implements ContextRetrieverPort {
  public async retrieve(intent: string, snapshot: ProjectRuntimeSnapshot): Promise<RetrievedContext> {
    const candidates = snapshot.active_file ? [snapshot.active_file] : [];
    return {
      summary: `Contexto stub para: ${intent}`,
      candidate_files: candidates,
    };
  }
}

export class NoopTaskBuilder implements TaskBuilderPort {
  public async buildTask(intent: string, context: RetrievedContext): Promise<LocalTaskDraft> {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      objective: intent,
      context_summary: context.summary,
      candidate_files: context.candidate_files.slice(0, 5),
      constraints: [
        "Paquete 1 baseline: no ejecutar mutaciones automáticas de dominio.",
        "Mantener ejecución supervisada por usuario.",
      ],
      acceptance_criteria: [
        "Resultado estructurado generado por adapter Codex.",
        "Registro de estado y salida disponible en panel/output.",
      ],
      created_at: now,
    };
  }
}

export interface NoopPersistenceOptions {
  dbStatus?: "connected" | "disconnected";
  reason?: string | null;
}

export class NoopPersistence implements PersistencePort {
  private readonly dbStatus: "connected" | "disconnected";

  private readonly reason: string | null;

  constructor(options?: NoopPersistenceOptions) {
    this.dbStatus = options?.dbStatus ?? "disconnected";
    this.reason = options?.reason ?? "Persistence adapter no configurado.";
  }

  public async healthcheck(): Promise<PersistenceHealthcheck> {
    return {
      ok: this.dbStatus === "connected",
      db_status: this.dbStatus,
      error: this.dbStatus === "connected" ? null : this.reason,
      migrations_applied: 0,
    };
  }

  public async ensureProject(input: EnsureProjectInput): Promise<PersistedProject> {
    return {
      id: randomUUID(),
      project_key: `${input.operation_profile}:${input.workspace_root ?? "no_workspace"}:${input.repo_root ?? "no_repo"}`,
    };
  }

  public async createIndexRun(input: CreateIndexRunInput): Promise<PersistedIndexRun> {
    return {
      id: randomUUID(),
      project_id: input.project_id,
      status: input.status,
    };
  }

  public async completeIndexRun(_input: CompleteIndexRunInput): Promise<void> {
    // No-op by design.
  }

  public async createOrUpdateIndexRunMetrics(_input: UpdateIndexRunMetricsInput): Promise<void> {
    // No-op by design.
  }

  public async listProjectFiles(_project_id: string, _includeDeleted = false): Promise<PersistedIndexedFile[]> {
    return [];
  }

  public async upsertIndexedFile(input: UpsertIndexedFileInput): Promise<PersistedIndexedFile> {
    return {
      id: randomUUID(),
      path: input.path,
      content_hash: input.content_hash,
      is_deleted: false,
    };
  }

  public async markFilesDeleted(_project_id: string, _paths: string[]): Promise<string[]> {
    return [];
  }

  public async replaceFileChunks(_file_id: string, _project_id: string, chunks: ChunkRecord[]): Promise<number> {
    return chunks.length;
  }

  public async deleteChunksByFileIds(_file_ids: string[]): Promise<number> {
    return 0;
  }

  public async saveTask(input: SaveTaskInput): Promise<PersistedTask> {
    return {
      id: input.task.id,
      project_id: input.project_id,
    };
  }

  public async saveTaskContext(input: SaveTaskContextInput): Promise<PersistedTaskContext> {
    return {
      id: randomUUID(),
      task_id: input.task.id,
    };
  }

  public async saveExecution(input: SaveExecutionInput): Promise<PersistedExecution> {
    return {
      id: randomUUID(),
      task_id: input.task_id,
      project_id: input.project_id,
    };
  }

  public async saveExecutionArtifact(input: SaveExecutionArtifactInput): Promise<PersistedExecutionArtifact> {
    return {
      id: randomUUID(),
      execution_id: input.execution_id,
    };
  }

  public async saveDecision(input: SaveDecisionInput): Promise<PersistedDecision> {
    return {
      id: randomUUID(),
      project_id: input.project_id,
    };
  }

  public async saveEvent(input: SaveEventInput): Promise<PersistedEvent> {
    return {
      id: randomUUID(),
      project_id: input.project_id,
    };
  }

  public async runInTransaction<T>(operation: (tx: PersistenceTransactionPort) => Promise<T>): Promise<T> {
    return operation(this);
  }
}
