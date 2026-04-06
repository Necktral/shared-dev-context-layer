import { toComparablePathKey } from "./pathNormalization";
import type { WorkspaceDiffSummary, WorkspaceFileSnapshotEntry, WorkspaceSnapshot } from "./types";

const CHANGED_PREVIEW_LIMIT = 20;

function comparePaths(left: string, right: string): number {
  return toComparablePathKey(left).localeCompare(toComparablePathKey(right)) || left.localeCompare(right);
}

function hasEntryChanged(before: WorkspaceFileSnapshotEntry, after: WorkspaceFileSnapshotEntry): boolean {
  const beforeHash = before.content_hash;
  const afterHash = after.content_hash;
  if (beforeHash && afterHash) {
    return beforeHash !== afterHash;
  }
  if (beforeHash !== afterHash) {
    return true;
  }
  return before.size_bytes !== after.size_bytes || before.modified_at !== after.modified_at;
}

function toComparableMap(entries: WorkspaceFileSnapshotEntry[]): Map<string, WorkspaceFileSnapshotEntry> {
  const map = new Map<string, WorkspaceFileSnapshotEntry>();
  for (const entry of entries) {
    map.set(toComparablePathKey(entry.relative_path), entry);
  }
  return map;
}

export class WorkspaceDiffAnalyzer {
  public analyze(before: WorkspaceSnapshot, after: WorkspaceSnapshot): WorkspaceDiffSummary {
    const beforeMap = toComparableMap(before.entries);
    const afterMap = toComparableMap(after.entries);
    const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort((left, right) => left.localeCompare(right));

    const created: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const unchanged: string[] = [];

    for (const key of keys) {
      const beforeEntry = beforeMap.get(key);
      const afterEntry = afterMap.get(key);
      const path = afterEntry?.relative_path ?? beforeEntry?.relative_path;
      if (!path) {
        continue;
      }

      const beforeExists = beforeEntry?.exists ?? false;
      const afterExists = afterEntry?.exists ?? false;

      if (!beforeExists && afterExists) {
        created.push(path);
        continue;
      }

      if (beforeExists && !afterExists) {
        deleted.push(path);
        continue;
      }

      if (beforeExists && afterExists) {
        if (beforeEntry && afterEntry && hasEntryChanged(beforeEntry, afterEntry)) {
          modified.push(path);
        } else {
          unchanged.push(path);
        }
        continue;
      }

      unchanged.push(path);
    }

    created.sort(comparePaths);
    modified.sort(comparePaths);
    deleted.sort(comparePaths);
    unchanged.sort(comparePaths);

    const changedFiles = [...created, ...modified, ...deleted].sort(comparePaths);
    return {
      created_files: created,
      modified_files: modified,
      deleted_files: deleted,
      unchanged_files: unchanged,
      changed_files_count: changedFiles.length,
      changed_files_preview: changedFiles.slice(0, CHANGED_PREVIEW_LIMIT),
      unchanged_count: unchanged.length,
    };
  }
}
