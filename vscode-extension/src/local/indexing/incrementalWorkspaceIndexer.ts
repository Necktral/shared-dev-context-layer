import type { LocalIndexConfig } from "../../config";
import type {
  FileChangeSet,
  IndexRunMetrics,
  PersistencePort,
  WorkspaceIndexerPort,
  WorkspaceIndexRequest,
  WorkspaceIndexResult,
} from "../ports";
import { BasicChunker } from "./basicChunker";
import { WorkspaceFileScanner } from "./workspaceFileScanner";

export interface IncrementalWorkspaceIndexerOptions {
  persistence: PersistencePort;
  getIndexConfig: () => LocalIndexConfig;
}

function inferLanguageFromExtension(extension: string): string | null {
  if (!extension) {
    return null;
  }
  return extension.startsWith(".") ? extension.slice(1).toLowerCase() : extension.toLowerCase();
}

export class IncrementalWorkspaceIndexer implements WorkspaceIndexerPort {
  private readonly scanner = new WorkspaceFileScanner();

  constructor(private readonly options: IncrementalWorkspaceIndexerOptions) {}

  public async runIndex(request: WorkspaceIndexRequest): Promise<WorkspaceIndexResult> {
    const rootPath = request.snapshot.repo_root ?? request.snapshot.workspace_root;
    if (!rootPath) {
      throw new Error("No se pudo resolver root de indexación (repo_root/workspace_root ausentes).");
    }

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

    const metrics: IndexRunMetrics = {
      scanned: scanResult.candidates.length,
      new: 0,
      modified: 0,
      deleted: 0,
      skipped: scanResult.skipped,
      chunksWritten: 0,
      errors: scanResult.errors,
    };

    for (const candidate of scanResult.candidates) {
      scannedPaths.add(candidate.relativePath);
      const existing = existingByPath.get(candidate.relativePath);

      let changeKind: FileChangeSet["kind"] = "unchanged";
      let shouldRewriteChunks = false;

      if (!existing) {
        changeKind = "new";
        shouldRewriteChunks = true;
        metrics.new += 1;
      } else if (existing.is_deleted) {
        changeKind = "reactivated";
        shouldRewriteChunks = true;
        metrics.modified += 1;
      } else if (existing.content_hash !== candidate.contentHash) {
        changeKind = "modified";
        shouldRewriteChunks = true;
        metrics.modified += 1;
      }

      try {
        const savedFile = await this.options.persistence.upsertIndexedFile({
          project_id: request.projectId,
          path: candidate.relativePath,
          content_hash: candidate.contentHash,
          size_bytes: candidate.sizeBytes,
          modified_at: candidate.modifiedAt,
          language: inferLanguageFromExtension(candidate.extension),
        });

        if (shouldRewriteChunks) {
          const chunks = chunker.chunk(candidate.content);
          const written = await this.options.persistence.replaceFileChunks(savedFile.id, request.projectId, chunks);
          metrics.chunksWritten += written;
        }
      } catch {
        metrics.errors += 1;
      }

      changes.push({
        kind: changeKind,
        path: candidate.relativePath,
      });
    }

    const activeKnownPaths = existingFiles.filter((file) => !file.is_deleted).map((file) => file.path);
    const deletedPaths = activeKnownPaths.filter((knownPath) => !scannedPaths.has(knownPath));

    if (deletedPaths.length > 0) {
      const deletedFileIds = await this.options.persistence.markFilesDeleted(request.projectId, deletedPaths);
      await this.options.persistence.deleteChunksByFileIds(deletedFileIds);
      metrics.deleted += deletedFileIds.length;

      for (const deletedPath of deletedPaths) {
        changes.push({
          kind: "deleted",
          path: deletedPath,
        });
      }
    }

    const message = `Indexación incremental completada. scanned=${metrics.scanned}, new=${metrics.new}, modified=${metrics.modified}, deleted=${metrics.deleted}, skipped=${metrics.skipped}`;

    return {
      message,
      metrics,
      details: {
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
}
