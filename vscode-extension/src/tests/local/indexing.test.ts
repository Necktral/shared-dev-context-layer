import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeRelativePath } from "../../local/indexing/pathNormalizer";
import { FileHasher } from "../../local/indexing/fileHasher";
import { TextFileDetector } from "../../local/indexing/textFileDetector";
import { BasicChunker } from "../../local/indexing/basicChunker";
import { WorkspaceFileScanner } from "../../local/indexing/workspaceFileScanner";
import { IncrementalWorkspaceIndexer } from "../../local/indexing/incrementalWorkspaceIndexer";
import type {
  ChunkRecord,
  CompleteIndexRunInput,
  CreateIndexRunInput,
  EnsureProjectInput,
  GetFileChunksByFileIdsInput,
  PersistedDecision,
  PersistedEvent,
  PersistedExecution,
  PersistedExecutionArtifact,
  PersistedIndexRun,
  PersistedIndexedFile,
  PersistedProject,
  PersistedTask,
  PersistedTaskContext,
  PersistenceHealthcheck,
  PersistencePort,
  PersistenceTransactionPort,
  RetrievedIndexedChunk,
  RetrievedIndexedFileCandidate,
  SaveDecisionInput,
  SaveEventInput,
  SaveExecutionArtifactInput,
  SaveExecutionInput,
  SaveTaskContextInput,
  SaveTaskInput,
  SearchFileChunksInput,
  SearchIndexedFilesInput,
  UpdateIndexRunMetricsInput,
  UpsertIndexedFileInput,
} from "../../local/ports";
import type { LocalTaskDraft } from "../../local/types";
import type { LocalIndexConfig } from "../../config";

const defaultIndexConfig: LocalIndexConfig = {
  excludeDirs: [".git", "node_modules", "dist", "build", ".next", "coverage", ".turbo", ".cache", "out", "tmp", "vendor"],
  includeExtensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".css", ".html", ".xml", ".yml", ".yaml", ".env", ".sql", ".sh"],
  maxFileBytes: 2_097_152,
  chunkSizeChars: 1200,
  chunkOverlapChars: 120,
};

class InMemoryPersistence implements PersistencePort {
  public readonly filesByPath = new Map<string, PersistedIndexedFile>();

  public readonly chunksByFileId = new Map<string, ChunkRecord[]>();

  public async healthcheck(): Promise<PersistenceHealthcheck> {
    return {
      ok: true,
      db_status: "connected",
      error: null,
      migrations_applied: 0,
    };
  }

  public async ensureProject(_input: EnsureProjectInput): Promise<PersistedProject> {
    return { id: "project-1", project_key: "project-key" };
  }

  public async createIndexRun(input: CreateIndexRunInput): Promise<PersistedIndexRun> {
    return { id: "index-run-1", project_id: input.project_id, status: input.status };
  }

  public async completeIndexRun(_input: CompleteIndexRunInput): Promise<void> {}

  public async createOrUpdateIndexRunMetrics(_input: UpdateIndexRunMetricsInput): Promise<void> {}

  public async listProjectFiles(_project_id: string, includeDeleted = false): Promise<PersistedIndexedFile[]> {
    const items = [...this.filesByPath.values()];
    return includeDeleted ? items : items.filter((item) => !item.is_deleted);
  }

  public async searchIndexedFiles(_input: SearchIndexedFilesInput): Promise<RetrievedIndexedFileCandidate[]> {
    return [];
  }

  public async searchFileChunks(_input: SearchFileChunksInput): Promise<RetrievedIndexedChunk[]> {
    return [];
  }

  public async getFileChunksByFileIds(_input: GetFileChunksByFileIdsInput): Promise<RetrievedIndexedChunk[]> {
    return [];
  }

  public async upsertIndexedFile(input: UpsertIndexedFileInput): Promise<PersistedIndexedFile> {
    const previous = this.filesByPath.get(input.path);
    const next: PersistedIndexedFile = {
      id: previous?.id ?? randomUUID(),
      path: input.path,
      content_hash: input.content_hash,
      is_deleted: false,
    };
    this.filesByPath.set(input.path, next);
    return next;
  }

  public async markFilesDeleted(_project_id: string, paths: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const filePath of paths) {
      const existing = this.filesByPath.get(filePath);
      if (!existing || existing.is_deleted) {
        continue;
      }
      this.filesByPath.set(filePath, {
        ...existing,
        is_deleted: true,
      });
      ids.push(existing.id);
    }
    return ids;
  }

  public async replaceFileChunks(file_id: string, _project_id: string, chunks: ChunkRecord[]): Promise<number> {
    this.chunksByFileId.set(file_id, [...chunks]);
    return chunks.length;
  }

  public async deleteChunksByFileIds(file_ids: string[]): Promise<number> {
    let deleted = 0;
    for (const fileId of file_ids) {
      if (this.chunksByFileId.delete(fileId)) {
        deleted += 1;
      }
    }
    return deleted;
  }

  public async saveTask(input: SaveTaskInput): Promise<PersistedTask> {
    return { id: input.task.id, project_id: input.project_id };
  }

  public async saveTaskContext(input: SaveTaskContextInput): Promise<PersistedTaskContext> {
    void input.retrieved_context;
    return { id: "task-context", task_id: input.task.id };
  }

  public async saveExecution(input: SaveExecutionInput): Promise<PersistedExecution> {
    return { id: "execution", task_id: input.task_id, project_id: input.project_id };
  }

  public async saveExecutionArtifact(input: SaveExecutionArtifactInput): Promise<PersistedExecutionArtifact> {
    return { id: "artifact", execution_id: input.execution_id };
  }

  public async saveDecision(input: SaveDecisionInput): Promise<PersistedDecision> {
    return { id: "decision", project_id: input.project_id };
  }

  public async saveEvent(input: SaveEventInput): Promise<PersistedEvent> {
    return { id: "event", project_id: input.project_id };
  }

  public async runInTransaction<T>(operation: (tx: PersistenceTransactionPort) => Promise<T>): Promise<T> {
    return operation(this);
  }
}

function taskStub(): LocalTaskDraft {
  return {
    id: randomUUID(),
    objective: "objetivo",
    context_summary: "resumen",
    candidate_files: [],
    constraints: [],
    acceptance_criteria: [],
    created_at: new Date().toISOString(),
  };
}

test("normalizeRelativePath devuelve path POSIX relativo", () => {
  const root = path.join("/tmp", "repo");
  const absolute = path.join(root, "src", "index.ts");
  const normalized = normalizeRelativePath(root, absolute);
  assert.equal(normalized, "src/index.ts");
});

test("FileHasher mantiene hash estable para contenido idéntico", () => {
  const first = FileHasher.sha256FromText("hola");
  const second = FileHasher.sha256FromText("hola");
  const different = FileHasher.sha256FromText("hola mundo");

  assert.equal(first, second);
  assert.notEqual(first, different);
});

test("TextFileDetector distingue texto y binario básico", () => {
  const text = Buffer.from("console.log('ok')\n", "utf8");
  const binary = Buffer.from([0, 120, 1, 2, 3]);

  assert.equal(TextFileDetector.isLikelyText(text), true);
  assert.equal(TextFileDetector.isLikelyText(binary), false);
});

test("BasicChunker aplica overlap para archivos largos", () => {
  const chunker = new BasicChunker({
    chunkSizeChars: 10,
    chunkOverlapChars: 2,
  });
  const chunks = chunker.chunk("01234567890123456789");

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].content, "0123456789");
  assert.equal(chunks[1].content.startsWith("89"), true);
});

test("WorkspaceFileScanner excluye node_modules y respeta includeExtensions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wis-scanner-"));

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "lib"), { recursive: true });

    await writeFile(path.join(root, "src", "index.ts"), "export const ok = true;\n", "utf8");
    await writeFile(path.join(root, "README.md"), "docs\n", "utf8");
    await writeFile(path.join(root, "node_modules", "lib", "skip.ts"), "should skip\n", "utf8");
    await writeFile(path.join(root, "image.png"), Buffer.from([137, 80, 78, 71]));

    const scanner = new WorkspaceFileScanner();
    const result = await scanner.scan(root, {
      ...defaultIndexConfig,
      includeExtensions: [".ts", ".md"],
      excludeDirs: ["node_modules"],
    });

    assert.equal(result.errors, 0);
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.relativePath),
      ["README.md", "src/index.ts"],
    );
    assert.ok(result.skipped >= 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("IncrementalWorkspaceIndexer detecta new/modified/deleted y actualiza chunks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wis-indexer-"));
  const persistence = new InMemoryPersistence();
  const indexer = new IncrementalWorkspaceIndexer({
    persistence,
    getIndexConfig: () => defaultIndexConfig,
  });

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    const filePath = path.join(root, "src", "app.ts");

    await writeFile(filePath, "export const value = 1;\n", "utf8");

    const first = await indexer.runIndex({
      projectId: "project-1",
      snapshot: {
        operation_profile: "local_private",
        workspace_root: root,
        repo_root: root,
        branch: "main",
        active_file: filePath,
        db_status: "connected",
        db_error: null,
        runtime_state: "ready",
        last_action: null,
        task_draft: null,
        last_result: null,
        errors: [],
        updated_at: new Date().toISOString(),
      },
    });

    assert.equal(first.metrics.new, 1);
    assert.equal(first.metrics.modified, 0);
    assert.equal(first.metrics.deleted, 0);

    const firstFile = persistence.filesByPath.get("src/app.ts");
    assert.ok(firstFile);
    assert.ok((persistence.chunksByFileId.get(firstFile.id) ?? []).length > 0);

    await writeFile(filePath, "export const value = 2;\n", "utf8");
    const second = await indexer.runIndex({
      projectId: "project-1",
      snapshot: {
        operation_profile: "local_private",
        workspace_root: root,
        repo_root: root,
        branch: "main",
        active_file: filePath,
        db_status: "connected",
        db_error: null,
        runtime_state: "ready",
        last_action: null,
        task_draft: taskStub(),
        last_result: null,
        errors: [],
        updated_at: new Date().toISOString(),
      },
    });

    assert.equal(second.metrics.modified, 1);

    await rm(filePath, { force: true });
    const third = await indexer.runIndex({
      projectId: "project-1",
      snapshot: {
        operation_profile: "local_private",
        workspace_root: root,
        repo_root: root,
        branch: "main",
        active_file: null,
        db_status: "connected",
        db_error: null,
        runtime_state: "ready",
        last_action: null,
        task_draft: null,
        last_result: null,
        errors: [],
        updated_at: new Date().toISOString(),
      },
    });

    assert.equal(third.metrics.deleted, 1);
    assert.equal(persistence.filesByPath.get("src/app.ts")?.is_deleted, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
