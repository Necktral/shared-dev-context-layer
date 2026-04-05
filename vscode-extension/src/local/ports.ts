import type { CodexExecutionRequest, CodexExecutionResult, LocalTaskDraft, ProjectRuntimeSnapshot } from "./types";

export interface RetrievedChunk {
  file_path: string;
  chunk_index: number;
  content: string;
  score: number;
  coarse_score: number;
  content_hash: string | null;
  evidence: string[];
}

export type RetrievalEvidenceStage = "coarse" | "final";

export interface RetrievalRankingEvidence {
  stage: RetrievalEvidenceStage;
  file_path: string;
  chunk_index?: number;
  score: number;
  reasons: string[];
}

export interface RetrievalBudgetStats {
  max_files: number;
  max_chunks: number;
  max_chunks_per_file: number;
  max_total_chars: number;
  selected_files: number;
  selected_chunks: number;
  selected_chars: number;
  truncated: boolean;
  truncation_reasons: string[];
}

export interface RetrievalQueryTrace {
  raw_intent: string;
  normalized_intent: string;
  tokens: string[];
  path_hints: string[];
  filename_hints: string[];
}

export interface RetrievalFallbackTrace {
  used: boolean;
  reason: string;
  source_file: string | null;
}

export interface RetrievedContext {
  summary: string;
  candidate_files: string[];
  query_trace: RetrievalQueryTrace;
  coarse_trace: RetrievalRankingEvidence[];
  selected_chunks: RetrievedChunk[];
  ranking_evidence: RetrievalRankingEvidence[];
  budget_stats: RetrievalBudgetStats;
  fallback_trace: RetrievalFallbackTrace | null;
}

export interface RetrievalRequest {
  intent: string;
  projectId: string;
  snapshot: ProjectRuntimeSnapshot;
}

export interface IndexedFileCandidate {
  absolutePath: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  contentHash: string;
  content: string;
  modifiedAt: string;
}

export interface ChunkRecord {
  chunkIndex: number;
  content: string;
  contentHash: string;
}

export type FileChangeKind = "new" | "modified" | "unchanged" | "deleted" | "skipped" | "reactivated";

export interface FileChangeSet {
  kind: FileChangeKind;
  path: string;
}

export interface IndexRunMetrics {
  scanned: number;
  new: number;
  modified: number;
  deleted: number;
  skipped: number;
  chunksWritten: number;
  errors: number;
}

export interface WorkspaceIndexRequest {
  projectId: string;
  snapshot: ProjectRuntimeSnapshot;
}

export interface WorkspaceIndexResult {
  message: string;
  details: Record<string, unknown>;
  metrics: IndexRunMetrics;
}

export interface WorkspaceIndexerPort {
  runIndex(request: WorkspaceIndexRequest): Promise<WorkspaceIndexResult>;
}

export interface ContextRetrieverPort {
  retrieve(request: RetrievalRequest): Promise<RetrievedContext>;
}

export interface TaskBuilderPort {
  buildTask(intent: string, context: RetrievedContext, snapshot: ProjectRuntimeSnapshot): Promise<LocalTaskDraft>;
}

export interface CodexRunnerExecuteOptions {
  abortSignal?: AbortSignal;
}

export interface CodexRunnerPort {
  healthcheck(command: string, options?: CodexRunnerExecuteOptions): Promise<CodexExecutionResult>;
  run(
    request: CodexExecutionRequest,
    command: string,
    options?: CodexRunnerExecuteOptions,
  ): Promise<CodexExecutionResult>;
}

export interface PersistenceHealthcheck {
  ok: boolean;
  db_status: "connected" | "disconnected";
  error: string | null;
  migrations_applied: number;
}

export interface PersistedProject {
  id: string;
  project_key: string;
}

export interface PersistedIndexRun {
  id: string;
  project_id: string;
  status: string;
}

export interface PersistedTask {
  id: string;
  project_id: string;
}

export interface PersistedTaskContext {
  id: string;
  task_id: string;
}

export interface PersistedExecution {
  id: string;
  task_id: string;
  project_id: string;
}

export interface PersistedExecutionArtifact {
  id: string;
  execution_id: string;
}

export interface PersistedDecision {
  id: string;
  project_id: string;
}

export interface PersistedEvent {
  id: string;
  project_id: string;
}

export interface PersistedIndexedFile {
  id: string;
  path: string;
  content_hash: string;
  is_deleted: boolean;
}

export interface RetrievedIndexedFileCandidate {
  file_id: string;
  path: string;
  content_hash: string;
  coarse_score: number;
  coarse_reasons: string[];
  path_token_hits: number;
  filename_token_hits: number;
}

export interface RetrievedIndexedChunk {
  file_id: string;
  file_path: string;
  chunk_index: number;
  content: string;
  content_hash: string;
  coarse_score: number;
  coarse_reasons: string[];
  path_token_hits: number;
  filename_token_hits: number;
  content_token_hits: number;
}

export interface EnsureProjectInput {
  operation_profile: string;
  workspace_root: string | null;
  repo_root: string | null;
  branch: string | null;
}

export interface CreateIndexRunInput {
  project_id: string;
  status: string;
  summary: string | null;
}

export interface CompleteIndexRunInput {
  index_run_id: string;
  status: string;
  summary: string | null;
}

export interface UpdateIndexRunMetricsInput {
  index_run_id: string;
  scanned_count: number;
  new_count: number;
  modified_count: number;
  deleted_count: number;
  skipped_count: number;
  chunk_count: number;
  error_count: number;
}

export interface UpsertIndexedFileInput {
  project_id: string;
  path: string;
  content_hash: string;
  size_bytes: number;
  modified_at: string;
  language: string | null;
}

export interface SaveTaskInput {
  project_id: string;
  task: LocalTaskDraft;
  status: string;
}

export interface SaveTaskContextInput {
  project_id: string;
  task: LocalTaskDraft;
  retrieved_context: RetrievedContext;
}

export interface SearchIndexedFilesInput {
  projectId: string;
  tokens: string[];
  pathHints: string[];
  filenameHints: string[];
  limit: number;
}

export interface SearchFileChunksInput {
  projectId: string;
  tokens: string[];
  pathHints: string[];
  filenameHints: string[];
  limit: number;
  fileIds?: string[];
}

export interface GetFileChunksByFileIdsInput {
  projectId: string;
  fileIds: string[];
  limitPerFile: number;
}

export interface SaveExecutionInput {
  project_id: string;
  task_id: string;
  result: CodexExecutionResult;
}

export interface SaveExecutionArtifactInput {
  project_id: string;
  execution_id: string;
  artifact_type: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface SaveDecisionInput {
  project_id: string;
  title: string;
  statement: string;
  source: string;
}

export interface SaveEventInput {
  project_id: string;
  task_id: string | null;
  execution_id: string | null;
  event_type: string;
  severity: "info" | "warning" | "error";
  message: string;
  payload: Record<string, unknown>;
}

export interface PersistenceTransactionPort {
  saveExecution(input: SaveExecutionInput): Promise<PersistedExecution>;
  saveExecutionArtifact(input: SaveExecutionArtifactInput): Promise<PersistedExecutionArtifact>;
  saveEvent(input: SaveEventInput): Promise<PersistedEvent>;
}

export interface PersistencePort extends PersistenceTransactionPort {
  healthcheck(): Promise<PersistenceHealthcheck>;
  ensureProject(input: EnsureProjectInput): Promise<PersistedProject>;
  createIndexRun(input: CreateIndexRunInput): Promise<PersistedIndexRun>;
  completeIndexRun(input: CompleteIndexRunInput): Promise<void>;
  createOrUpdateIndexRunMetrics(input: UpdateIndexRunMetricsInput): Promise<void>;
  listProjectFiles(project_id: string, includeDeleted?: boolean): Promise<PersistedIndexedFile[]>;
  searchIndexedFiles(input: SearchIndexedFilesInput): Promise<RetrievedIndexedFileCandidate[]>;
  searchFileChunks(input: SearchFileChunksInput): Promise<RetrievedIndexedChunk[]>;
  getFileChunksByFileIds(input: GetFileChunksByFileIdsInput): Promise<RetrievedIndexedChunk[]>;
  upsertIndexedFile(input: UpsertIndexedFileInput): Promise<PersistedIndexedFile>;
  markFilesDeleted(project_id: string, paths: string[]): Promise<string[]>;
  replaceFileChunks(file_id: string, project_id: string, chunks: ChunkRecord[]): Promise<number>;
  deleteChunksByFileIds(file_ids: string[]): Promise<number>;
  saveTask(input: SaveTaskInput): Promise<PersistedTask>;
  saveTaskContext(input: SaveTaskContextInput): Promise<PersistedTaskContext>;
  saveDecision(input: SaveDecisionInput): Promise<PersistedDecision>;
  runInTransaction<T>(operation: (tx: PersistenceTransactionPort) => Promise<T>): Promise<T>;
}
