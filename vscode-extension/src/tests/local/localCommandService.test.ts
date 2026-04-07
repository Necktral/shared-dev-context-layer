import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { LocalCommandService } from "../../local/localCommandService";
import { InMemoryLocalRuntimeStore } from "../../local/localRuntimeStore";
import {
  createInitialProjectRuntimeSnapshot,
  type CodexExecutionResult,
  type LocalTaskDraft,
  type PostRunReconciliationResult,
  type OperationProfile,
} from "../../local/types";
import type { ParsedPlaybook } from "../../platform/playbooks/playbookFrontmatter";
import { WorkspaceBoundaryError, WorkspaceBoundaryGuard } from "../../platform/security/workspaceBoundaryGuard";
import { NoopIndexer, NoopRetriever, NoopTaskBuilder } from "../../local/noopServices";
import type {
  AcquireProjectRunLockInput,
  ChunkRecord,
  ClaimIdempotencyInput,
  ClaimIdempotencyResult,
  CompleteIdempotencyClaimInput,
  CreateIndexRunInput,
  EnsureProjectInput,
  FailIdempotencyClaimInput,
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
  SaveIdempotentResultInput,
  SaveEventInput,
  SaveExecutionArtifactInput,
  SaveExecutionInput,
  SaveTaskContextInput,
  SaveTaskInput,
  ReleaseProjectRunLockInput,
  RenewIdempotencyClaimInput,
  RenewProjectRunLockInput,
  ResolveIdempotentResultInput,
  SearchFileChunksInput,
  SearchIndexedFilesInput,
  CompleteIndexRunInput,
  PostRunReconcileRequest,
  TransitionTaskStateInput,
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
    cancelled: false,
    command: "codex",
    command_line: mode === "healthcheck" ? "codex --version" : "codex exec --json",
    exit_code: 0,
    stdout: mode === "healthcheck" ? "codex-cli 0.116.0" : '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}',
    stderr: "",
    final_message: mode === "run" ? "ok" : null,
    thread_id: mode === "run" ? "thread-1" : null,
    events_count: mode === "run" ? 1 : 0,
    warnings_count: 0,
    usage_tokens: null,
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

  public savedExecutionArtifacts: SaveExecutionArtifactInput[] = [];

  public savedEvents: SaveEventInput[] = [];

  public savedDecisions: SaveDecisionInput[] = [];

  public readonly idempotencyStore = new Map<string, Record<string, unknown>>();

  public taskStates = new Map<string, string>();

  public taskTransitions: TransitionTaskStateInput[] = [];

  public activeProjectLock: { project_id: string; lock_id: string; expires_at: number } | null = null;

  public failLockRenewal = false;

  public failClaimRenewal = false;

  private readonly idempotencyClaims = new Map<
    string,
    {
      status: "in_progress" | "completed" | "failed";
      claim_id: string | null;
      owner: string | null;
      lease_expires_at: number | null;
      response_json: Record<string, unknown> | null;
    }
  >();

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
    this.taskStates.set(input.task.id, input.lifecycle_state ?? "draft");
    return {
      id: input.task.id,
      project_id: input.project_id,
      state: (input.lifecycle_state ?? "draft"),
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
    this.savedExecutionArtifacts.push(input);
    return {
      id: `artifact-${this.savedExecutionArtifacts.length}`,
      execution_id: input.execution_id,
    };
  }

  public async saveDecision(input: SaveDecisionInput): Promise<PersistedDecision> {
    this.savedDecisions.push(input);
    return {
      id: "decision-1",
      project_id: input.project_id,
    };
  }

  public async saveEvent(input: SaveEventInput): Promise<PersistedEvent> {
    this.savedEvents.push(input);
    return {
      id: "event-1",
      project_id: input.project_id,
    };
  }

  public async getTaskLifecycleState(_project_id: string, task_id: string) {
    return (this.taskStates.get(task_id) as any) ?? null;
  }

  public async transitionTaskState(input: TransitionTaskStateInput): Promise<void> {
    const current = this.taskStates.get(input.task_id) ?? null;
    if (input.from_state !== null && current !== input.from_state) {
      throw new Error(`invalid state transition: expected ${input.from_state} but got ${current}`);
    }
    this.taskStates.set(input.task_id, input.to_state);
    this.taskTransitions.push({ ...input });
  }

  public async acquireProjectRunLock(input: AcquireProjectRunLockInput): Promise<boolean> {
    const now = Date.now();
    if (
      this.activeProjectLock &&
      this.activeProjectLock.project_id === input.project_id &&
      this.activeProjectLock.expires_at > now
    ) {
      return false;
    }
    this.activeProjectLock = {
      project_id: input.project_id,
      lock_id: input.lock_id,
      expires_at: now + input.ttl_seconds * 1000,
    };
    return true;
  }

  public async renewProjectRunLock(input: RenewProjectRunLockInput): Promise<boolean> {
    if (this.failLockRenewal) {
      return false;
    }
    const now = Date.now();
    if (
      !this.activeProjectLock ||
      this.activeProjectLock.project_id !== input.project_id ||
      this.activeProjectLock.lock_id !== input.lock_id ||
      this.activeProjectLock.expires_at <= now
    ) {
      return false;
    }
    this.activeProjectLock.expires_at = now + input.ttl_seconds * 1000;
    return true;
  }

  public async releaseProjectRunLock(input: ReleaseProjectRunLockInput): Promise<void> {
    if (
      this.activeProjectLock &&
      this.activeProjectLock.project_id === input.project_id &&
      this.activeProjectLock.lock_id === input.lock_id
    ) {
      this.activeProjectLock = null;
    }
  }

  public async claimIdempotency(input: ClaimIdempotencyInput): Promise<ClaimIdempotencyResult> {
    const key = `${input.project_id}:${input.command}:${input.idempotency_key}`;
    const now = Date.now();
    const existing = this.idempotencyClaims.get(key);
    if (!existing) {
      this.idempotencyClaims.set(key, {
        status: "in_progress",
        claim_id: input.claim_id,
        owner: input.owner,
        lease_expires_at: now + input.ttl_seconds * 1000,
        response_json: null,
      });
      return {
        status: "claimed",
        claim_id: input.claim_id,
        owner: input.owner,
        lease_expires_at: new Date(now + input.ttl_seconds * 1000).toISOString(),
        response_json: null,
      };
    }
    if (existing.status === "completed" || existing.status === "failed") {
      return {
        status: "completed",
        claim_id: existing.claim_id,
        owner: existing.owner,
        lease_expires_at: existing.lease_expires_at ? new Date(existing.lease_expires_at).toISOString() : null,
        response_json: existing.response_json,
      };
    }
    if ((existing.lease_expires_at ?? 0) <= now) {
      existing.status = "in_progress";
      existing.claim_id = input.claim_id;
      existing.owner = input.owner;
      existing.lease_expires_at = now + input.ttl_seconds * 1000;
      existing.response_json = null;
      return {
        status: "reclaimed",
        claim_id: input.claim_id,
        owner: input.owner,
        lease_expires_at: new Date(existing.lease_expires_at).toISOString(),
        response_json: null,
      };
    }
    return {
      status: "in_progress",
      claim_id: existing.claim_id,
      owner: existing.owner,
      lease_expires_at: existing.lease_expires_at ? new Date(existing.lease_expires_at).toISOString() : null,
      response_json: null,
    };
  }

  public async renewIdempotencyClaim(input: RenewIdempotencyClaimInput): Promise<boolean> {
    if (this.failClaimRenewal) {
      return false;
    }
    const key = `${input.project_id}:${input.command}:${input.idempotency_key}`;
    const existing = this.idempotencyClaims.get(key);
    const now = Date.now();
    if (!existing || existing.status !== "in_progress" || existing.claim_id !== input.claim_id) {
      return false;
    }
    if ((existing.lease_expires_at ?? 0) <= now) {
      return false;
    }
    existing.lease_expires_at = now + input.ttl_seconds * 1000;
    return true;
  }

  public async completeIdempotencyClaim(input: CompleteIdempotencyClaimInput): Promise<boolean> {
    const key = `${input.project_id}:${input.command}:${input.idempotency_key}`;
    const existing = this.idempotencyClaims.get(key);
    if (!existing || existing.status !== "in_progress" || existing.claim_id !== input.claim_id) {
      return false;
    }
    existing.status = "completed";
    existing.lease_expires_at = null;
    existing.response_json = input.response_json;
    this.idempotencyStore.set(key, input.response_json);
    return true;
  }

  public async failIdempotencyClaim(input: FailIdempotencyClaimInput): Promise<boolean> {
    const key = `${input.project_id}:${input.command}:${input.idempotency_key}`;
    const existing = this.idempotencyClaims.get(key);
    if (!existing || existing.status !== "in_progress" || existing.claim_id !== input.claim_id) {
      return false;
    }
    existing.status = "failed";
    existing.lease_expires_at = null;
    existing.response_json = input.response_json;
    this.idempotencyStore.set(key, input.response_json);
    return true;
  }

  public async resolveIdempotentResult(input: ResolveIdempotentResultInput): Promise<Record<string, unknown> | null> {
    const key = `${input.project_id}:${input.command}:${input.idempotency_key}`;
    return this.idempotencyStore.get(key) ?? null;
  }

  public async saveIdempotentResult(input: SaveIdempotentResultInput): Promise<void> {
    const key = `${input.project_id}:${input.command}:${input.idempotency_key}`;
    this.idempotencyStore.set(key, input.response_json);
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
    query_trace: {
      raw_intent: "Encontrar index.ts",
      normalized_intent: "encontrar index.ts",
      tokens: ["index.ts", "index"],
      path_hints: ["src/index.ts"],
      filename_hints: ["index.ts"],
    },
    coarse_trace: [
      {
        stage: "coarse",
        file_path: "src/index.ts",
        chunk_index: 0,
        score: 90,
        reasons: ["filename_exact_match", "content_token_match"],
      },
    ],
    selected_chunks: [
      {
        file_path: "src/index.ts",
        chunk_index: 0,
        content: "export const answer = 42;",
        content_hash: "hash-c0",
        score: 120,
        coarse_score: 90,
        evidence: ["filename_exact_match", "content_match"],
      },
    ],
    ranking_evidence: [
      {
        stage: "final",
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
      truncation_reasons: [],
    },
    fallback_trace: null,
  };
}

function buildReconciliationResult(execution: CodexExecutionResult): PostRunReconciliationResult {
  const defaultOutcome = execution.cancelled
    ? "cancelled"
    : execution.ok
      ? execution.warnings_count > 0
        ? "partial_changes"
        : "applied_changes"
      : /timed?\s*out/i.test(execution.error ?? "")
        ? "timeout"
        : "failed";
  const severity =
    defaultOutcome === "partial_changes"
      ? "warning"
      : defaultOutcome === "applied_changes"
        ? "info"
        : "error";
  const anomalyFlags = defaultOutcome === "partial_changes" ? ["warning_severity"] : execution.ok ? [] : ["execution_failed"];
  const classificationReasons =
    defaultOutcome === "partial_changes"
      ? ["execution_ok_with_changes", "warning_detected"]
      : execution.ok
        ? ["execution_ok_with_changes"]
        : ["execution_failed"];
  const changedFilesCount = execution.ok ? 1 : 0;
  const changedPreview = execution.ok ? ["src/index.ts"] : [];

  return {
    execution_result: execution,
    execution_envelope: {
      execution_id: "pending",
      task_id: "task-1",
      command: execution.command,
      command_line: execution.command_line,
      started_at: execution.started_at,
      finished_at: execution.finished_at,
      exit_code: execution.exit_code,
      cancelled: execution.cancelled,
      timeout: false,
      warnings_count: execution.warnings_count,
      error: execution.error,
    },
    workspace_before_snapshot: {
      snapshot_id: "snapshot-before",
      captured_at: "2026-04-05T00:00:00.000Z",
      root_path: "/workspace/repo",
      entries: [
        {
          relative_path: "src/index.ts",
          exists: true,
          size_bytes: 21,
          content_hash: "hash-before",
          modified_at: "2026-04-05T00:00:00.000Z",
        },
      ],
    },
    workspace_after_snapshot: {
      snapshot_id: "snapshot-after",
      captured_at: "2026-04-05T00:00:01.000Z",
      root_path: "/workspace/repo",
      entries: [
        {
          relative_path: "src/index.ts",
          exists: true,
          size_bytes: execution.ok ? 22 : 21,
          content_hash: execution.ok ? "hash-after" : "hash-before",
          modified_at: "2026-04-05T00:00:01.000Z",
        },
      ],
    },
    workspace_diff: {
      created_files: [],
      modified_files: execution.ok ? ["src/index.ts"] : [],
      deleted_files: [],
      unchanged_files: execution.ok ? [] : ["src/index.ts"],
      changed_files_count: changedFilesCount,
      changed_files_preview: changedPreview,
      unchanged_count: execution.ok ? 0 : 1,
    },
    classified_outcome: defaultOutcome,
    classification_reasons: classificationReasons,
    outcome_classification: {
      classified_outcome: defaultOutcome,
      reasons: classificationReasons,
      anomaly_flags: anomalyFlags,
      severity,
    },
    reindex_result: {
      mode: execution.ok ? "scoped" : "skipped",
      status: execution.ok ? "ok" : "skipped",
      ok: true,
      message: execution.ok ? "scoped ok" : "skipped",
      trigger_reason: execution.ok ? "changed_scope" : "no_changes",
      changed_paths: execution.ok ? ["src/index.ts"] : [],
      metrics: {},
      error: null,
    },
    reindex_plan: {
      mode: execution.ok ? "scoped" : "skipped",
      target_paths: execution.ok ? ["src/index.ts"] : [],
      trigger_reason: execution.ok ? "changed_scope" : "no_changes",
      status: execution.ok ? "ok" : "skipped",
      metrics: {},
    },
    review_payload: {
      objective: "obj",
      final_message: execution.final_message,
      outcome: defaultOutcome,
      classified_outcome: defaultOutcome,
      changed_files: {
        created_files: [],
        modified_files: execution.ok ? ["src/index.ts"] : [],
        deleted_files: [],
        changed_files_count: changedFilesCount,
        changed_files_preview: changedPreview,
      },
      warnings: [],
      pending_risks: [],
      next_action: execution.ok ? "Revisar cambios y validar." : "Corregir fallo y reintentar.",
    },
    telemetry: {
      prepare_latency_ms: 10,
      run_latency_ms: execution.duration_ms,
      reconcile_latency_ms: 20,
      reindex_latency_ms: execution.ok ? 10 : 0,
      total_duration_ms: execution.duration_ms + 20,
      changed_files_count: changedFilesCount,
      warnings_count: execution.warnings_count,
      anomaly_count: anomalyFlags.length,
    },
  };
}

function createFakePostRunReconciler(
  mutate?: (
    reconciled: PostRunReconciliationResult,
    execution: CodexExecutionResult,
  ) => PostRunReconciliationResult,
) {
  return {
    reconcile: async (request: PostRunReconcileRequest) => {
      const execution = await request.execute();
      const reconciled = buildReconciliationResult(execution);
      return mutate ? mutate(reconciled, execution) : reconciled;
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
    postRunReconciler: createFakePostRunReconciler(),
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

test("LocalCommandService bloquea local_prepare_task por violación de workspace boundary", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  const boundaryGuard = new WorkspaceBoundaryGuard();
  boundaryGuard.assertSnapshot = () => {
    throw new WorkspaceBoundaryError("snapshot invalid", { reason: "test_boundary" });
  };

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    postRunReconciler: createFakePostRunReconciler(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
    boundaryGuard,
  });

  const result = await service.localPrepareTask("Intento bloqueado por boundary");
  assert.equal(result.status, "blocked");
  assert.equal(result.details?.blocked_reason, "workspace_boundary_violation");
  assert.equal(result.details?.reason, "test_boundary");
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
    postRunReconciler: createFakePostRunReconciler(),
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
  assert.equal(typeof executed.details?.prompt_artifact_id, "string");
  assert.equal(typeof executed.details?.trace_artifact_id, "string");
  assert.equal(typeof executed.details?.result_artifact_id, "string");
  assert.equal(executed.details?.warnings_count, 0);
  assert.equal(executed.details?.classified_outcome, "applied_changes");
  assert.equal(executed.details?.review_decision, "accept");
  assert.equal(typeof executed.details?.next_action_plan, "string");
  assert.equal(executed.details?.changed_files_count, 1);
  assert.equal(executed.details?.reindex_status, "scoped:ok");
  assert.equal(persistence.savedExecutionArtifacts.length, 11);
  assert.deepEqual(
    persistence.savedExecutionArtifacts.map((artifact) => artifact.artifact_type),
    [
      "codex_exec_prompt",
      "codex_exec_trace",
      "codex_exec_result",
      "workspace_before_snapshot_summary",
      "workspace_after_snapshot_summary",
      "workspace_change_summary",
      "changed_files_manifest",
      "execution_outcome_classification",
      "post_run_reindex_summary",
      "post_run_review_payload",
      "post_run_operator_decision",
    ],
  );
  assert.equal(persistence.savedDecisions.length, 1);
  assert.equal(persistence.savedDecisions[0]?.title, "Operator review: accept");
  assert.equal(persistence.savedEvents[0]?.severity, "info");
  assert.equal(persistence.savedEvents[0]?.payload?.review_decision, "accept");
});

test("LocalCommandService agrega operator_playbooks de forma aditiva en local_run_codex", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  const playbooks: ParsedPlaybook[] = [
    {
      frontmatter: {
        id: "pb-post-review-validate",
        title: "Validar diff y riesgos",
        kind: "validation",
        priority: 10,
        applies_to: ["post_review"],
        tags: [],
      },
      body: "Validar salida.",
      sourcePath: "/workspace/.wis/playbooks/pb-post-review-validate.md",
      sourceTier: "workspace",
    },
  ];

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    postRunReconciler: createFakePostRunReconciler(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
    playbookRegistry: {
      resolveForAction: () => playbooks,
    } as unknown as any,
  });

  await service.localPrepareTask("Run con playbooks");
  const executed = await service.localRunCodex();
  assert.equal(executed.status, "ok");
  assert.ok(Array.isArray(executed.details?.operator_playbooks));
  const operatorPlaybooks = executed.details?.operator_playbooks as Array<Record<string, unknown>>;
  assert.equal(operatorPlaybooks.length, 1);
  assert.equal(operatorPlaybooks[0]?.id, "pb-post-review-validate");
  assert.equal(operatorPlaybooks[0]?.source_tier, "workspace");
});

test("LocalCommandService escala review cuando reindex termina degradado", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    postRunReconciler: createFakePostRunReconciler((reconciled) => ({
      ...reconciled,
      reindex_result: {
        ...reconciled.reindex_result,
        mode: "fallback_full",
        status: "error",
        ok: false,
        message: "fallback with error",
        trigger_reason: "reindex_failed",
        error: "reindex failed",
      },
      reindex_plan: {
        ...reconciled.reindex_plan,
        mode: "fallback_full",
        status: "error",
        trigger_reason: "reindex_failed",
      },
    })),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  await service.localPrepareTask("Run con degradación de reindex");
  const executed = await service.localRunCodex();

  assert.equal(executed.status, "ok");
  assert.equal(executed.details?.review_decision, "needs_manual_review");
  assert.equal(typeof executed.details?.next_action_plan, "string");
  assert.equal(executed.details?.next_review_hint, executed.details?.next_action_plan);
  const reasonCodes = executed.details?.review_reason_codes;
  assert.ok(Array.isArray(reasonCodes));
  assert.ok((reasonCodes as string[]).includes("reindex_not_ok"));
  assert.ok((reasonCodes as string[]).includes("reindex_fallback_full"));
  assert.ok((reasonCodes as string[]).includes("decision_escalated_reindex_risk"));
  assert.equal(persistence.savedEvents[0]?.payload?.review_decision, "needs_manual_review");
  const eventReasonCodes = persistence.savedEvents[0]?.payload?.review_reason_codes;
  assert.ok(Array.isArray(eventReasonCodes));
  assert.ok((eventReasonCodes as string[]).includes("reindex_not_ok"));
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
    postRunReconciler: createFakePostRunReconciler(),
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

test("LocalCommandService pasa contexto operativo extendido al codexRunner", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  let capturedRepoRoot: string | null = null;
  let capturedWorkspaceRoot: string | null = null;
  let capturedBranch: string | null = null;
  let capturedActiveFile: string | null = null;

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    postRunReconciler: createFakePostRunReconciler(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async (request: any, _command: string) => {
        capturedRepoRoot = typeof request?.repo_root === "string" ? request.repo_root : null;
        capturedWorkspaceRoot = typeof request?.workspace_root === "string" ? request.workspace_root : null;
        capturedBranch = typeof request?.branch === "string" ? request.branch : null;
        capturedActiveFile = typeof request?.active_file === "string" ? request.active_file : null;
        return okExecution("run");
      },
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  await service.localPrepareTask("Run with full context");
  const executed = await service.localRunCodex();
  assert.equal(executed.status, "ok");
  assert.equal(capturedRepoRoot, "/workspace/repo");
  assert.equal(capturedWorkspaceRoot, "/workspace");
  assert.equal(capturedBranch, "main");
  assert.equal(capturedActiveFile, "/workspace/repo/src/index.ts");
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
    postRunReconciler: createFakePostRunReconciler(),
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
    postRunReconciler: createFakePostRunReconciler(),
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

test("LocalCommandService conserva ok con warnings y sube severidad warning", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  const warningExecution: CodexExecutionResult = {
    ...okExecution("run"),
    stderr: "WARN unstable warning\nERROR non fatal",
    warnings_count: 2,
  };

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    postRunReconciler: createFakePostRunReconciler(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => warningExecution,
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  await service.localPrepareTask("Revisar warning flow");
  const result = await service.localRunCodex();
  assert.equal(result.status, "ok");
  assert.equal(result.details?.warnings_count, 2);
  assert.equal(persistence.savedEvents[0]?.severity, "warning");
});

test("LocalCommandService marca cancelación cuando signal ya está abortada", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  const controller = new AbortController();
  controller.abort();

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    postRunReconciler: createFakePostRunReconciler(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  await service.localPrepareTask("Cancelar run");
  const result = await service.localRunCodex({ abortSignal: controller.signal });
  assert.equal(result.status, "error");
  assert.equal(result.details?.cancelled, true);
  assert.equal(persistence.savedEvents[0]?.severity, "error");
});

test("LocalCommandService bloquea localRunCodex cuando el proyecto ya tiene lock activo", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  persistence.activeProjectLock = {
    project_id: "project-1",
    lock_id: "external-lock",
    expires_at: Date.now() + 60_000,
  };

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    postRunReconciler: createFakePostRunReconciler(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  await service.localPrepareTask("Task con lock");
  const result = await service.localRunCodex();
  assert.equal(result.status, "error");
  assert.equal(result.details?.lock_status, "busy");
  assert.equal(result.details?.classified_outcome, "blocked");
});

test("LocalCommandService replay idempotente en localRunCodex evita nueva ejecución", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  let runInvocations = 0;

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    postRunReconciler: createFakePostRunReconciler(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => {
        runInvocations += 1;
        return okExecution("run");
      },
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  await service.localPrepareTask("Run idempotente");
  const first = await service.localRunCodex();
  const second = await service.localRunCodex();

  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");
  assert.equal(runInvocations, 1);
  assert.equal(second.details?.idempotency_key, first.details?.idempotency_key);
});

test("LocalCommandService bloquea localRunCodex cuando claim de idempotencia ya está in_progress", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  let runInvocations = 0;
  const fixedDraft: LocalTaskDraft = {
    id: "task-claim-progress",
    objective: "Claim in progress",
    context_summary: "ctx",
    candidate_files: ["/workspace/repo/src/index.ts"],
    constraints: [],
    acceptance_criteria: [],
    created_at: "2026-04-06T02:30:00.000Z",
  };
  store.update((current) => ({ ...current, task_draft: fixedDraft }));

  const runIdempotencyKey = createHash("sha256")
    .update(["local_run_codex", "project-1", fixedDraft.id, fixedDraft.created_at, "/workspace/repo", "main"].join("|"))
    .digest("hex");

  await persistence.claimIdempotency({
    project_id: "project-1",
    command: "local_run_codex",
    idempotency_key: runIdempotencyKey,
    claim_id: "active-claim",
    owner: "other-runner",
    ttl_seconds: 180,
  });

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    postRunReconciler: createFakePostRunReconciler(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => {
        runInvocations += 1;
        return okExecution("run");
      },
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  const result = await service.localRunCodex();
  assert.equal(result.status, "error");
  assert.equal(result.details?.blocked_reason, "idempotency_in_progress");
  assert.equal(result.details?.idempotency_claim_status, "in_progress");
  assert.equal(runInvocations, 0);
});

test("LocalCommandService marca blocked cuando pierde lease durante run/reconcile", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  persistence.failLockRenewal = true;
  let runInvocations = 0;

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    postRunReconciler: createFakePostRunReconciler(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => {
        runInvocations += 1;
        return okExecution("run");
      },
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  await service.localPrepareTask("Lease renewal failure");
  const result = await service.localRunCodex();
  assert.equal(result.status, "error");
  assert.equal(result.details?.classified_outcome, "blocked");
  assert.equal(result.details?.lock_lease_lost, true);
  assert.equal(result.details?.blocked_reason, "lock_lease_lost");
  assert.equal(result.details?.idempotency_claim_status, "claimed");
  assert.equal(runInvocations, 0);
});

test("LocalCommandService mueve running->reconciling antes del cierre final", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    postRunReconciler: createFakePostRunReconciler(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  await service.localPrepareTask("Boundary reconciling");
  const result = await service.localRunCodex();
  assert.equal(result.status, "ok");
  const runToReconcilingIndex = persistence.taskTransitions.findIndex(
    (entry) => entry.from_state === "running" && entry.to_state === "reconciling",
  );
  const reconcilingToFinalIndex = persistence.taskTransitions.findIndex(
    (entry) => entry.from_state === "reconciling" && entry.to_state === "completed",
  );
  assert.ok(runToReconcilingIndex >= 0);
  assert.ok(reconcilingToFinalIndex > runToReconcilingIndex);
});

test("LocalCommandService rechaza codexCliCommand compuesto con error trazable", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const persistence = new FakePersistence();
  let runnerInvoked = false;

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    postRunReconciler: createFakePostRunReconciler(),
    codexRunner: {
      healthcheck: async () => {
        runnerInvoked = true;
        return okExecution("healthcheck");
      },
      run: async () => {
        runnerInvoked = true;
        return okExecution("run");
      },
    },
    persistence,
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex --profile dev",
  });

  await service.localPrepareTask("Probar invalid command");
  const result = await service.localRunCodex();
  assert.equal(result.status, "error");
  assert.equal(result.details?.error_code, "invalid_command_configuration");
  assert.match(String(result.details?.error ?? ""), /sin argumentos embebidos/i);
  assert.equal(runnerInvoked, false);
  assert.equal(persistence.savedEvents[0]?.severity, "error");
  assert.equal(persistence.savedEvents[0]?.event_type, "local_run_codex");
});
