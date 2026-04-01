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

export interface PersistencePort {
  saveTask(task: LocalTaskDraft): Promise<void>;
  saveExecution(taskId: string, result: CodexExecutionResult): Promise<void>;
}
