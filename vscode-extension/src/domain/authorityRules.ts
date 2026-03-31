import type { LocalEnvironmentContext, ToolResult, WISContext } from "./operationalContext";

export const CANONICAL_WIS_FIELDS = [
  "active_task",
  "context_snapshot",
  "validation_status",
  "approved_decisions",
  "recent_errors",
  "scope",
  "resolution_metadata",
] as const;

export const LOCAL_HINT_FIELDS = [
  "workspace_root",
  "repo_root",
  "branch",
  "active_file",
  "inspector_status",
  "inspector_error",
] as const;

function extractResolutionConflictFlags(toolResult: ToolResult | null): string[] {
  if (!toolResult || !toolResult.payload) {
    return [];
  }
  const metadata = (toolResult.payload as { resolution_metadata?: { conflict_flags?: unknown } }).resolution_metadata;
  if (!metadata || !Array.isArray(metadata.conflict_flags)) {
    return [];
  }
  return metadata.conflict_flags.filter((value): value is string => typeof value === "string");
}

function extractWISTaskBranch(activeTask: ToolResult | null): string | null {
  if (!activeTask || !activeTask.payload) {
    return null;
  }
  const task = (activeTask.payload as { task?: { branch?: unknown } }).task;
  return task && typeof task.branch === "string" ? task.branch : null;
}

export function collectAuthorityConflictFlags(
  localEnvironment: LocalEnvironmentContext,
  wisContext: WISContext,
): string[] {
  const flags = new Set<string>();

  for (const toolResult of [
    wisContext.active_task,
    wisContext.context_snapshot,
    wisContext.validation_status,
    wisContext.approved_decisions,
    wisContext.recent_errors,
  ]) {
    for (const flag of extractResolutionConflictFlags(toolResult)) {
      flags.add(flag);
    }
  }

  const localBranch = localEnvironment.branch;
  const wisBranch = extractWISTaskBranch(wisContext.active_task);
  if (localBranch && wisBranch && localBranch !== wisBranch) {
    flags.add("local_branch_vs_wis_branch_mismatch");
  }

  return [...flags];
}
