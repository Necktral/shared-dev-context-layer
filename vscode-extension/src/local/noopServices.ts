import { randomUUID } from "node:crypto";
import type {
  AcquireProjectRunLockInput,
  ChunkRecord,
  ContextRetrieverPort,
  CreateIndexRunInput,
  EnsureProjectInput,
  GetFileChunksByFileIdsInput,
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
  RetrievalRequest,
  RetrievedContext,
  SaveDecisionInput,
  SaveIdempotentResultInput,
  SaveEventInput,
  SaveExecutionArtifactInput,
  SaveExecutionInput,
  SaveTaskContextInput,
  SaveTaskInput,
  SearchFileChunksInput,
  SearchIndexedFilesInput,
  ReleaseProjectRunLockInput,
  ResolveIdempotentResultInput,
  TransitionTaskStateInput,
  TaskBuilderPort,
  WorkspaceIndexerPort,
  CompleteIndexRunInput,
  RetrievedIndexedChunk,
  RetrievedIndexedFileCandidate,
  WorkspaceIndexRequest,
  WorkspaceIndexByPathsRequest,
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

  public async runIndexByPaths(request: WorkspaceIndexByPathsRequest): Promise<WorkspaceIndexResult> {
    const result = await this.runIndex(request);
    return {
      ...result,
      message: "Indexación local por paths no implementada aún (Noop baseline).",
      details: {
        ...result.details,
        mode: "scoped",
        target_paths: request.paths,
      },
    };
  }
}

export class NoopRetriever implements ContextRetrieverPort {
  public async retrieve(request: RetrievalRequest): Promise<RetrievedContext> {
    const candidates = request.snapshot.active_file ? [request.snapshot.active_file] : [];
    return {
      summary: `Contexto stub para: ${request.intent}`,
      candidate_files: candidates,
      query_trace: {
        raw_intent: request.intent,
        normalized_intent: request.intent.trim().toLowerCase(),
        tokens: [],
        path_hints: [],
        filename_hints: [],
      },
      coarse_trace: [],
      selected_chunks: [],
      ranking_evidence: candidates.length > 0
        ? [
            {
              stage: "final",
              file_path: candidates[0],
              score: 1,
              reasons: ["active_file_fallback"],
            },
          ]
        : [],
      budget_stats: {
        max_files: 5,
        max_chunks: 8,
        max_chunks_per_file: 3,
        max_total_chars: 6000,
        selected_files: candidates.length,
        selected_chunks: 0,
        selected_chars: 0,
        truncated: false,
        truncation_reasons: [],
      },
      fallback_trace: candidates.length > 0
        ? {
            used: true,
            reason: "active_file_fallback",
            source_file: candidates[0],
          }
        : {
            used: true,
            reason: "no_index_hits",
            source_file: null,
          },
    };
  }
}

export class NoopTaskBuilder implements TaskBuilderPort {
  public async buildTask(intent: string, context: RetrievedContext, _snapshot: ProjectRuntimeSnapshot): Promise<LocalTaskDraft> {
    const now = new Date().toISOString();
    const candidateFiles = context.candidate_files.slice(0, 5);
    const constraints = [
      "Paquete 1 baseline: no ejecutar mutaciones automáticas de dominio.",
      "Mantener ejecución supervisada por usuario.",
    ];
    const acceptanceCriteria = [
      "Resultado estructurado generado por adapter Codex.",
      "Registro de estado y salida disponible en panel/output.",
    ];
    return {
      id: randomUUID(),
      objective: intent,
      context_summary: context.summary,
      candidate_files: candidateFiles,
      constraints,
      acceptance_criteria: acceptanceCriteria,
      execution_brief: {
        version: "v2",
        objective_compact: intent,
        candidate_files: candidateFiles,
        key_evidence: [context.summary],
        run_constraints: constraints,
        acceptance_checks: acceptanceCriteria,
      },
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

  public async searchIndexedFiles(_input: SearchIndexedFilesInput): Promise<RetrievedIndexedFileCandidate[]> {
    return [];
  }

  public async searchFileChunks(_input: SearchFileChunksInput): Promise<RetrievedIndexedChunk[]> {
    return [];
  }

  public async getFileChunksByFileIds(_input: GetFileChunksByFileIdsInput): Promise<RetrievedIndexedChunk[]> {
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
      state: input.lifecycle_state ?? "draft",
    };
  }

  public async saveTaskContext(input: SaveTaskContextInput): Promise<PersistedTaskContext> {
    void input.retrieved_context;
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

  public async getTaskLifecycleState(_project_id: string, _task_id: string) {
    return null;
  }

  public async transitionTaskState(_input: TransitionTaskStateInput): Promise<void> {
    // No-op by design.
  }

  public async acquireProjectRunLock(_input: AcquireProjectRunLockInput): Promise<boolean> {
    return true;
  }

  public async releaseProjectRunLock(_input: ReleaseProjectRunLockInput): Promise<void> {
    // No-op by design.
  }

  public async resolveIdempotentResult(_input: ResolveIdempotentResultInput): Promise<Record<string, unknown> | null> {
    return null;
  }

  public async saveIdempotentResult(_input: SaveIdempotentResultInput): Promise<void> {
    // No-op by design.
  }

  public async runInTransaction<T>(operation: (tx: PersistenceTransactionPort) => Promise<T>): Promise<T> {
    return operation(this);
  }
}
