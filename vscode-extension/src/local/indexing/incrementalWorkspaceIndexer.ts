import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { LocalIndexConfig } from "../../config";
import type {
  FileChangeSet,
  IndexRunMetrics,
  IndexedFileCandidate,
  PersistencePort,
  WorkspaceIndexByPathsRequest,
  WorkspaceIndexerPort,
  WorkspaceIndexRequest,
  WorkspaceIndexResult,
} from "../ports";
import { normalizeProjectPath, normalizeRelativePathFromRoot, toComparablePathKey } from "../pathNormalization";
import { BasicChunker } from "./basicChunker";
import { FileHasher } from "./fileHasher";
import { WorkspaceFileScanner } from "./workspaceFileScanner";
import { TextFileDetector } from "./textFileDetector";

export interface IncrementalWorkspaceIndexerOptions {
  persistence: PersistencePort;
  getIndexConfig: () => LocalIndexConfig;
}

type CandidateLoadResult =
  | { status: "missing"; relativePath: string }
  | { status: "skipped"; relativePath: string }
  | { status: "error"; relativePath: string }
  | { status: "candidate"; candidate: IndexedFileCandidate };

function inferLanguageFromExtension(extension: string): string | null {
  if (!extension) {
    return null;
  }
  return extension.startsWith(".") ? extension.slice(1).toLowerCase() : extension.toLowerCase();
}

function normalizeExtension(extension: string): string {
  if (!extension) {
    return "";
  }
  return extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
}

function comparePaths(left: string, right: string): number {
  return toComparablePathKey(left).localeCompare(toComparablePathKey(right)) || left.localeCompare(right);
}

function makeEmptyMetrics(scanned: number, skipped: number, errors: number): IndexRunMetrics {
  return {
    scanned,
    new: 0,
    modified: 0,
    deleted: 0,
    skipped,
    chunksWritten: 0,
    errors,
  };
}

function resolveIndexRoot(snapshot: WorkspaceIndexRequest["snapshot"]): string {
  const rootPath = snapshot.repo_root ?? snapshot.workspace_root;
  if (!rootPath) {
    throw new Error("No se pudo resolver root de indexación (repo_root/workspace_root ausentes).");
  }
  return path.resolve(rootPath);
}

function uniqueSortedPaths(paths: string[]): string[] {
  return [...new Set(paths
    .map((entry) => normalizeProjectPath(entry))
    .filter((entry) => entry.length > 0))]
    .sort(comparePaths);
}

export class IncrementalWorkspaceIndexer implements WorkspaceIndexerPort {
  private readonly scanner = new WorkspaceFileScanner();

  constructor(private readonly options: IncrementalWorkspaceIndexerOptions) {}

  public async runIndex(request: WorkspaceIndexRequest): Promise<WorkspaceIndexResult> {
    const rootPath = resolveIndexRoot(request.snapshot);
    const indexConfig = this.options.getIndexConfig();
    const chunker = new BasicChunker({
      chunkSizeChars: indexConfig.chunkSizeChars,
      chunkOverlapChars: indexConfig.chunkOverlapChars,
    });

    const scanResult = await this.scanner.scan(rootPath, indexConfig);
    const existingFiles = await this.options.persistence.listProjectFiles(request.projectId, true);
    const existingByPath = new Map(existingFiles.map((file) => [file.path, file]));
    const scannedPaths = new Set<string>();
    const changes: FileChangeSet[] = [];
    const metrics = makeEmptyMetrics(scanResult.candidates.length, scanResult.skipped, scanResult.errors);

    for (const candidate of scanResult.candidates) {
      scannedPaths.add(candidate.relativePath);
      const existing = existingByPath.get(candidate.relativePath);
      const result = await this.persistCandidate({
        projectId: request.projectId,
        chunker,
        candidate,
        existing,
      });

      changes.push({
        kind: result.changeKind,
        path: candidate.relativePath,
      });
      metrics.new += result.newCount;
      metrics.modified += result.modifiedCount;
      metrics.chunksWritten += result.chunksWritten;
      metrics.errors += result.errorCount;
    }

    const activeKnownPaths = existingFiles.filter((file) => !file.is_deleted).map((file) => file.path);
    const deletedPaths = activeKnownPaths.filter((knownPath) => !scannedPaths.has(knownPath));
    await this.softDeletePaths({
      projectId: request.projectId,
      paths: deletedPaths,
      metrics,
      changes,
    });

    const message = `Indexación incremental completada. scanned=${metrics.scanned}, new=${metrics.new}, modified=${metrics.modified}, deleted=${metrics.deleted}, skipped=${metrics.skipped}`;
    return {
      message,
      metrics,
      details: {
        mode: "full",
        root_path: rootPath,
        scanned: metrics.scanned,
        new: metrics.new,
        modified: metrics.modified,
        deleted: metrics.deleted,
        skipped: metrics.skipped,
        chunks_written: metrics.chunksWritten,
        errors: metrics.errors,
        changes,
      },
    };
  }

  public async runIndexByPaths(request: WorkspaceIndexByPathsRequest): Promise<WorkspaceIndexResult> {
    const rootPath = resolveIndexRoot(request.snapshot);
    const indexConfig = this.options.getIndexConfig();
    const chunker = new BasicChunker({
      chunkSizeChars: indexConfig.chunkSizeChars,
      chunkOverlapChars: indexConfig.chunkOverlapChars,
    });

    const targetPaths = uniqueSortedPaths(request.paths);
    const metrics = makeEmptyMetrics(targetPaths.length, 0, 0);
    const changes: FileChangeSet[] = [];
    if (targetPaths.length === 0) {
      return {
        message: "Indexación incremental por paths omitida: scope vacío.",
        metrics,
        details: {
          mode: "scoped",
          root_path: rootPath,
          target_paths: [],
          changes: [],
        },
      };
    }

    const existingFiles = await this.options.persistence.listProjectFiles(request.projectId, true);
    const existingByPath = new Map(existingFiles.map((file) => [file.path, file]));
    const toSoftDelete: string[] = [];

    for (const relativePath of targetPaths) {
      const existing = existingByPath.get(relativePath);
      const loaded = await this.loadCandidateFromPath({
        rootPath,
        relativePath,
        indexConfig,
      });

      if (loaded.status === "error") {
        metrics.errors += 1;
        continue;
      }

      if (loaded.status === "missing") {
        if (existing && !existing.is_deleted) {
          toSoftDelete.push(relativePath);
        } else {
          changes.push({ kind: "unchanged", path: relativePath });
        }
        continue;
      }

      if (loaded.status === "skipped") {
        metrics.skipped += 1;
        if (existing && !existing.is_deleted) {
          toSoftDelete.push(relativePath);
        } else {
          changes.push({ kind: "skipped", path: relativePath });
        }
        continue;
      }

      const result = await this.persistCandidate({
        projectId: request.projectId,
        chunker,
        candidate: loaded.candidate,
        existing,
      });

      changes.push({
        kind: result.changeKind,
        path: loaded.candidate.relativePath,
      });
      metrics.new += result.newCount;
      metrics.modified += result.modifiedCount;
      metrics.chunksWritten += result.chunksWritten;
      metrics.errors += result.errorCount;
    }

    await this.softDeletePaths({
      projectId: request.projectId,
      paths: toSoftDelete,
      metrics,
      changes,
    });

    changes.sort((left, right) => comparePaths(left.path, right.path));
    const message = `Indexación incremental por paths completada. scanned=${metrics.scanned}, new=${metrics.new}, modified=${metrics.modified}, deleted=${metrics.deleted}, skipped=${metrics.skipped}`;
    return {
      message,
      metrics,
      details: {
        mode: "scoped",
        root_path: rootPath,
        target_paths: targetPaths,
        scanned: metrics.scanned,
        new: metrics.new,
        modified: metrics.modified,
        deleted: metrics.deleted,
        skipped: metrics.skipped,
        chunks_written: metrics.chunksWritten,
        errors: metrics.errors,
        changes,
      },
    };
  }

  private async persistCandidate(input: {
    projectId: string;
    chunker: BasicChunker;
    candidate: IndexedFileCandidate;
    existing:
      | {
          id: string;
          path: string;
          content_hash: string;
          is_deleted: boolean;
        }
      | undefined;
  }): Promise<{
    changeKind: FileChangeSet["kind"];
    newCount: number;
    modifiedCount: number;
    chunksWritten: number;
    errorCount: number;
  }> {
    let changeKind: FileChangeSet["kind"] = "unchanged";
    let shouldRewriteChunks = false;
    let newCount = 0;
    let modifiedCount = 0;
    let chunksWritten = 0;
    let errorCount = 0;

    if (!input.existing) {
      changeKind = "new";
      shouldRewriteChunks = true;
      newCount = 1;
    } else if (input.existing.is_deleted) {
      changeKind = "reactivated";
      shouldRewriteChunks = true;
      modifiedCount = 1;
    } else if (input.existing.content_hash !== input.candidate.contentHash) {
      changeKind = "modified";
      shouldRewriteChunks = true;
      modifiedCount = 1;
    }

    try {
      const savedFile = await this.options.persistence.upsertIndexedFile({
        project_id: input.projectId,
        path: input.candidate.relativePath,
        content_hash: input.candidate.contentHash,
        size_bytes: input.candidate.sizeBytes,
        modified_at: input.candidate.modifiedAt,
        language: inferLanguageFromExtension(input.candidate.extension),
      });

      if (shouldRewriteChunks) {
        const chunks = input.chunker.chunk(input.candidate.content);
        chunksWritten = await this.options.persistence.replaceFileChunks(savedFile.id, input.projectId, chunks);
      }
    } catch {
      errorCount = 1;
    }

    return {
      changeKind,
      newCount,
      modifiedCount,
      chunksWritten,
      errorCount,
    };
  }

  private async softDeletePaths(input: {
    projectId: string;
    paths: string[];
    metrics: IndexRunMetrics;
    changes: FileChangeSet[];
  }): Promise<void> {
    const paths = uniqueSortedPaths(input.paths);
    if (paths.length === 0) {
      return;
    }

    const deletedFileIds = await this.options.persistence.markFilesDeleted(input.projectId, paths);
    if (deletedFileIds.length > 0) {
      await this.options.persistence.deleteChunksByFileIds(deletedFileIds);
    }
    input.metrics.deleted += deletedFileIds.length;

    for (const deletedPath of paths) {
      input.changes.push({
        kind: "deleted",
        path: deletedPath,
      });
    }
  }

  private async loadCandidateFromPath(input: {
    rootPath: string;
    relativePath: string;
    indexConfig: LocalIndexConfig;
  }): Promise<CandidateLoadResult> {
    const normalizedRelative = normalizeProjectPath(input.relativePath);
    if (!normalizedRelative || normalizedRelative.startsWith("..")) {
      return { status: "skipped", relativePath: input.relativePath };
    }

    const normalizedSegments = normalizedRelative.split("/").filter((segment) => segment.length > 0);
    const excludeSet = new Set(input.indexConfig.excludeDirs.map((entry) => entry.trim()).filter((entry) => entry.length > 0));
    if (normalizedSegments.some((segment) => excludeSet.has(segment))) {
      return { status: "skipped", relativePath: normalizedRelative };
    }

    const includeSet = new Set(
      input.indexConfig.includeExtensions
        .map((entry) => normalizeExtension(entry))
        .filter((entry) => entry.length > 0),
    );
    const extension = normalizeExtension(path.extname(normalizedRelative));
    if (!includeSet.has(extension)) {
      return { status: "skipped", relativePath: normalizedRelative };
    }

    const absolutePath = path.resolve(input.rootPath, normalizedRelative);
    let relativePathFromRoot: string;
    try {
      relativePathFromRoot = normalizeRelativePathFromRoot(input.rootPath, absolutePath);
    } catch {
      return { status: "skipped", relativePath: normalizedRelative };
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "missing", relativePath: relativePathFromRoot };
      }
      return { status: "error", relativePath: relativePathFromRoot };
    }

    if (!stat.isFile()) {
      return { status: "missing", relativePath: relativePathFromRoot };
    }

    if (stat.size > input.indexConfig.maxFileBytes) {
      return { status: "skipped", relativePath: relativePathFromRoot };
    }

    let rawContent: Buffer;
    try {
      rawContent = await fs.readFile(absolutePath);
    } catch {
      return { status: "error", relativePath: relativePathFromRoot };
    }

    if (!TextFileDetector.isLikelyText(rawContent)) {
      return { status: "skipped", relativePath: relativePathFromRoot };
    }

    return {
      status: "candidate",
      candidate: {
        absolutePath,
        relativePath: relativePathFromRoot,
        extension,
        sizeBytes: stat.size,
        contentHash: FileHasher.sha256FromBuffer(rawContent),
        content: rawContent.toString("utf8"),
        modifiedAt: stat.mtime.toISOString(),
      },
    };
  }
}
