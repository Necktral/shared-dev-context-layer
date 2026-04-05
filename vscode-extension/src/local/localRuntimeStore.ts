import type { ProjectRuntimeSnapshot } from "./types";

type Listener = (snapshot: ProjectRuntimeSnapshot) => void;

function cloneSnapshot(snapshot: ProjectRuntimeSnapshot): ProjectRuntimeSnapshot {
  return {
    ...snapshot,
    errors: [...snapshot.errors],
    task_draft: snapshot.task_draft
      ? {
          ...snapshot.task_draft,
          candidate_files: [...snapshot.task_draft.candidate_files],
          constraints: [...snapshot.task_draft.constraints],
          acceptance_criteria: [...snapshot.task_draft.acceptance_criteria],
          execution_brief: snapshot.task_draft.execution_brief
            ? {
                ...snapshot.task_draft.execution_brief,
                candidate_files: [...snapshot.task_draft.execution_brief.candidate_files],
                key_evidence: [...snapshot.task_draft.execution_brief.key_evidence],
                run_constraints: [...snapshot.task_draft.execution_brief.run_constraints],
                acceptance_checks: [...snapshot.task_draft.execution_brief.acceptance_checks],
              }
            : undefined,
        }
      : null,
    last_result: snapshot.last_result
      ? {
          ...snapshot.last_result,
          details: snapshot.last_result.details ? { ...snapshot.last_result.details } : null,
        }
      : null,
  };
}

export class InMemoryLocalRuntimeStore {
  private snapshot: ProjectRuntimeSnapshot;

  private readonly listeners = new Set<Listener>();

  constructor(initialSnapshot: ProjectRuntimeSnapshot) {
    this.snapshot = cloneSnapshot(initialSnapshot);
  }

  public getSnapshot(): ProjectRuntimeSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  public setSnapshot(next: ProjectRuntimeSnapshot): void {
    this.snapshot = cloneSnapshot(next);
    this.emit();
  }

  public update(updater: (current: ProjectRuntimeSnapshot) => ProjectRuntimeSnapshot): ProjectRuntimeSnapshot {
    this.snapshot = cloneSnapshot(updater(this.getSnapshot()));
    this.emit();
    return this.getSnapshot();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
