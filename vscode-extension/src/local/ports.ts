import type { CodexExecutionRequest, CodexExecutionResult, LocalTaskDraft, ProjectRuntimeSnapshot } from "./types";

export interface RetrievedContext {
  summary: string;
  candidate_files: string[];
}

export interface WorkspaceIndexerPort {
  runIndex(snapshot: ProjectRuntimeSnapshot): Promise<{ message: string; details: Record<string, unknown> }>;
}

export interface ContextRetrieverPort {
  retrieve(intent: string, snapshot: ProjectRuntimeSnapshot): Promise<RetrievedContext>;
}

export interface TaskBuilderPort {
  buildTask(intent: string, context: RetrievedContext, snapshot: ProjectRuntimeSnapshot): Promise<LocalTaskDraft>;
}

export interface CodexRunnerPort {
  healthcheck(command: string): Promise<CodexExecutionResult>;
  run(request: CodexExecutionRequest, command: string): Promise<CodexExecutionResult>;
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

export interface SaveTaskInput {
  project_id: string;
  task: LocalTaskDraft;
  status: string;
}

export interface SaveTaskContextInput {
  project_id: string;
  task: LocalTaskDraft;
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
  saveTask(input: SaveTaskInput): Promise<PersistedTask>;
  saveTaskContext(input: SaveTaskContextInput): Promise<PersistedTaskContext>;
  saveDecision(input: SaveDecisionInput): Promise<PersistedDecision>;
  runInTransaction<T>(operation: (tx: PersistenceTransactionPort) => Promise<T>): Promise<T>;
}
