import test from "node:test";
import assert from "node:assert/strict";
import { LocalCommandService } from "../../local/localCommandService";
import { InMemoryLocalRuntimeStore } from "../../local/localRuntimeStore";
import {
  createInitialProjectRuntimeSnapshot,
  type CodexExecutionResult,
  type LocalTaskDraft,
  type OperationProfile,
} from "../../local/types";
import { NoopIndexer, NoopRetriever, NoopTaskBuilder } from "../../local/noopServices";
import type {
  ChunkRecord,
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
  PersistencePort,
  PersistenceTransactionPort,
  RetrievedContext,
  RetrievedIndexedChunk,
  RetrievedIndexedFileCandidate,
  SaveDecisionInput,
  SaveEventInput,
  SaveExecutionArtifactInput,
  SaveExecutionInput,
  SaveTaskContextInput,
  SaveTaskInput,
  SearchFileChunksInput,
  SearchIndexedFilesInput,
  CompleteIndexRunInput,
  UpdateIndexRunMetricsInput,
  UpsertIndexedFileInput,
} from "../../local/ports";

function environment() {
  return {
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    branch: "main",
    active_file: "/workspace/repo/src/index.ts",
    timestamp: new Date().toISOString(),
    inspector_status: "ok" as const,
    inspector_error: null,
  };
}

function okExecution(mode: "healthcheck" | "run"): CodexExecutionResult {
  return {
    mode,
    ok: true,
    command: "codex",
    command_line: "codex --help",
    exit_code: 0,
    stdout: "ok",
    stderr: "",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: 10,
    error: null,
    request_preview: null,
  };
}

class FakePersistence implements PersistencePort {
  public savedTaskId = "";

  public savedExecutionTaskId = "";

  public lastSavedTaskContextInput: SaveTaskContextInput | null = null;

  public failHealth = false;

  public failTransaction = false;

  public lastIndexMetrics: UpdateIndexRunMetricsInput | null = null;

  public async healthcheck() {
    if (this.failHealth) {
      return {
        ok: false,
        db_status: "disconnected" as const,
        error: "db down",
        migrations_applied: 0,
      };
    }
    return {
      ok: true,
      db_status: "connected" as const,
      error: null,
      migrations_applied: 1,
    };
  }

  public async ensureProject(input: EnsureProjectInput): Promise<PersistedProject> {
    return {
      id: "project-1",
      project_key: `${input.operation_profile}:${input.repo_root}`,
    };
  }

  public async createIndexRun(input: CreateIndexRunInput): Promise<PersistedIndexRun> {
    return {
      id: "index-run-1",
      project_id: input.project_id,
      status: input.status,
    };
  }

  public async completeIndexRun(_input: CompleteIndexRunInput): Promise<void> {}

  public async createOrUpdateIndexRunMetrics(input: UpdateIndexRunMetricsInput): Promise<void> {
    this.lastIndexMetrics = input;
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
      id: "file-1",
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
    this.savedTaskId = input.task.id;
    return {
      id: input.task.id,
      project_id: input.project_id,
    };
  }

  public async saveTaskContext(input: SaveTaskContextInput): Promise<PersistedTaskContext> {
    this.lastSavedTaskContextInput = input;
    return {
      id: "task-context-1",
      task_id: input.task.id,
    };
  }

  public async saveExecution(input: SaveExecutionInput): Promise<PersistedExecution> {
    this.savedExecutionTaskId = input.task_id;
    return {
      id: "execution-1",
      task_id: input.task_id,
      project_id: input.project_id,
    };
  }

  public async saveExecutionArtifact(input: SaveExecutionArtifactInput): Promise<PersistedExecutionArtifact> {
    return {
      id: "artifact-1",
      execution_id: input.execution_id,
    };
  }

  public async saveDecision(input: SaveDecisionInput): Promise<PersistedDecision> {
    return {
      id: "decision-1",
      project_id: input.project_id,
    };
  }

  public async saveEvent(input: SaveEventInput): Promise<PersistedEvent> {
    return {
      id: "event-1",
      project_id: input.project_id,
    };
  }

  public async runInTransaction<T>(operation: (tx: PersistenceTransactionPort) => Promise<T>): Promise<T> {
    if (this.failTransaction) {
      throw new Error("tx failed");
    }
    return operation(this);
  }
}

function sampleRetrievedContext(): RetrievedContext {
  return {
    summary: "Retrieval listo.",
    candidate_files: ["src/index.ts", "src/retrieval.ts"],
    selected_chunks: [
      {
        file_path: "src/index.ts",
        chunk_index: 0,
        content: "export const answer = 42;",
        score: 120,
        evidence: ["filename_exact_match", "content_match"],
      },
    ],
    ranking_evidence: [
      {
        file_path: "src/index.ts",
        chunk_index: 0,
        score: 120,
        reasons: ["filename_exact_match", "content_match"],
      },
    ],
    budget_stats: {
      max_files: 5,
      max_chunks: 8,
      max_chunks_per_file: 3,
      max_total_chars: 6000,
      selected_files: 2,
      selected_chunks: 1,
      selected_chars: 25,
      truncated: false,
    },
  };
}

test("LocalCommandService bloquea comandos locales cuando profile no es local_private", async () => {
  let profile: OperationProfile = "phase3_control_plane";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  const result = await service.localIndex();
  assert.equal(result.status, "blocked");
  assert.equal(store.getSnapshot().last_result?.status, "blocked");
});

test("LocalCommandService en local_private prepara tarea y ejecuta Codex con persistencia", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  const refreshed = await service.localRefresh();
  assert.equal(refreshed.status, "ok");
  assert.equal(store.getSnapshot().db_status, "connected");

  const indexed = await service.localIndex();
  assert.equal(indexed.status, "ok");
  assert.ok(persistence.lastIndexMetrics !== null);
  assert.equal(persistence.lastIndexMetrics?.scanned_count, 0);

  const prepared = await service.localPrepareTask("Ajustar baseline local");
  assert.equal(prepared.status, "ok");
  assert.ok(persistence.savedTaskId.length > 0);

  const executed = await service.localRunCodex();
  assert.equal(executed.status, "ok");
  assert.equal(persistence.savedExecutionTaskId, persistence.savedTaskId);
  assert.equal(store.getSnapshot().runtime_state, "ready");
  assert.equal(typeof executed.details?.execution_id, "string");
  assert.equal(typeof executed.details?.artifact_id, "string");
});

test("LocalCommandService pasa projectId al retriever y persiste retrieved_context", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  let capturedProjectId = "";

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: {
      retrieve: async (request) => {
        capturedProjectId = request.projectId;
        return sampleRetrievedContext();
      },
    },
    taskBuilder: new NoopTaskBuilder(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  const prepared = await service.localPrepareTask("Encontrar index.ts");
  assert.equal(prepared.status, "ok");
  assert.equal(capturedProjectId, "project-1");
  assert.equal(prepared.details?.selected_chunks, 1);
  assert.equal(prepared.details?.evidence_items, 1);
  assert.equal(persistence.lastSavedTaskContextInput?.retrieved_context.selected_chunks.length, 1);
  assert.equal(persistence.lastSavedTaskContextInput?.retrieved_context.candidate_files[0], "src/index.ts");
});

test("LocalCommandService reporta error cuando DB está desconectada", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  persistence.failHealth = true;

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  const result = await service.localRefresh();
  assert.equal(result.status, "error");
  assert.equal(store.getSnapshot().db_status, "disconnected");
});

test("LocalCommandService reporta error cuando falla la transacción de ejecución", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  persistence.failTransaction = true;

  const draft: LocalTaskDraft = {
    id: "task-fixed",
    objective: "Test",
    context_summary: "ctx",
    candidate_files: ["/workspace/repo/src/index.ts"],
    constraints: [],
    acceptance_criteria: [],
    created_at: new Date().toISOString(),
  };
  store.update((current) => ({ ...current, task_draft: draft }));

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  const result = await service.localRunCodex();
  assert.equal(result.status, "error");
  assert.match(result.message, /tx failed/);
});
