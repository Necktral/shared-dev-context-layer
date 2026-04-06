import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type { LocalIndexConfig } from "../config";
import { normalizeProjectPath, toComparablePathKey } from "./pathNormalization";
import { WorkspaceFileScanner } from "./indexing/workspaceFileScanner";
import type { ProjectRuntimeSnapshot, WorkspaceFileSnapshotEntry, WorkspaceSnapshot } from "./types";

export interface CaptureWorkspaceSnapshotInput {
  snapshot: ProjectRuntimeSnapshot;
  seed_paths?: string[];
}

export interface WorkspaceSnapshotterOptions {
  getIndexConfig: () => LocalIndexConfig;
}

function comparePaths(left: string, right: string): number {
  return toComparablePathKey(left).localeCompare(toComparablePathKey(right)) || left.localeCompare(right);
}

function buildEntry(input: {
  relativePath: string;
  exists: boolean;
  sizeBytes: number;
  contentHash: string | null;
  modifiedAt: string | null;
}): WorkspaceFileSnapshotEntry {
  return {
    relative_path: input.relativePath,
    exists: input.exists,
    size_bytes: input.sizeBytes,
    content_hash: input.contentHash,
    modified_at: input.modifiedAt,
  };
}

export class WorkspaceSnapshotter {
  private readonly scanner = new WorkspaceFileScanner();

  constructor(private readonly options: WorkspaceSnapshotterOptions) {}

  public async capture(input: CaptureWorkspaceSnapshotInput): Promise<WorkspaceSnapshot> {
    const rootPath = input.snapshot.repo_root ?? input.snapshot.workspace_root;
    if (!rootPath) {
      throw new Error("No se pudo capturar snapshot: repo_root/workspace_root ausentes.");
    }

    const resolvedRoot = path.resolve(rootPath);
    const config = this.options.getIndexConfig();
    const scan = await this.scanner.scan(resolvedRoot, config);
    const entriesByPath = new Map<string, WorkspaceFileSnapshotEntry>();

    for (const candidate of scan.candidates) {
      entriesByPath.set(
        candidate.relativePath,
        buildEntry({
          relativePath: candidate.relativePath,
          exists: true,
          sizeBytes: candidate.sizeBytes,
          contentHash: candidate.contentHash,
          modifiedAt: candidate.modifiedAt,
        }),
      );
    }

    const seedPaths = [...new Set((input.seed_paths ?? [])
      .map((entry) => normalizeProjectPath(entry))
      .filter((entry) => entry.length > 0))]
      .sort(comparePaths);

    for (const seedPath of seedPaths) {
      if (entriesByPath.has(seedPath)) {
        continue;
      }
      entriesByPath.set(
        seedPath,
        buildEntry({
          relativePath: seedPath,
          exists: false,
          sizeBytes: 0,
          contentHash: null,
          modifiedAt: null,
        }),
      );
    }

    const entries = [...entriesByPath.values()].sort((left, right) => comparePaths(left.relative_path, right.relative_path));
    return {
      snapshot_id: randomUUID(),
      captured_at: new Date().toISOString(),
      root_path: resolvedRoot,
      entries,
    };
  }
}
