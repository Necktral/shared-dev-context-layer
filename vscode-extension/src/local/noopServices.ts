import { randomUUID } from "node:crypto";
import type { ContextRetrieverPort, PersistencePort, RetrievedContext, TaskBuilderPort, WorkspaceIndexerPort } from "./ports";
import type { LocalTaskDraft, ProjectRuntimeSnapshot } from "./types";

export class NoopIndexer implements WorkspaceIndexerPort {
  public async runIndex(snapshot: ProjectRuntimeSnapshot): Promise<{ message: string; details: Record<string, unknown> }> {
    return {
      message: "Indexación local no implementada aún (Paquete 1 baseline).",
      details: {
        workspace_root: snapshot.workspace_root,
        repo_root: snapshot.repo_root,
        mode: "noop",
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

export class NoopPersistence implements PersistencePort {
  public async saveTask(_task: LocalTaskDraft): Promise<void> {
    // No-op by design in package 1.
  }

  public async saveExecution(_taskId: string, _result: { ok: boolean }): Promise<void> {
    // No-op by design in package 1.
  }
}
