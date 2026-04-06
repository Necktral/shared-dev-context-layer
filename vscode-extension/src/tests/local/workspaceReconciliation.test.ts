import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { LocalIndexConfig } from "../../config";
import { classifyExecutionOutcome } from "../../local/executionOutcomeClassifier";
import { PostRunReconciler } from "../../local/postRunReconciler";
import { WorkspaceDiffAnalyzer } from "../../local/workspaceDiffAnalyzer";
import { WorkspaceSnapshotter } from "../../local/workspaceSnapshotter";
import type {
  WorkspaceIndexerPort,
  WorkspaceIndexByPathsRequest,
  WorkspaceIndexRequest,
  WorkspaceIndexResult,
} from "../../local/ports";
import type { CodexExecutionResult, ProjectRuntimeSnapshot } from "../../local/types";

const indexConfig: LocalIndexConfig = {
  excludeDirs: [".git", "node_modules", "dist", "coverage"],
  includeExtensions: [".ts", ".md", ".txt"],
  maxFileBytes: 2_097_152,
  chunkSizeChars: 1200,
  chunkOverlapChars: 120,
};

function makeSnapshot(root: string): ProjectRuntimeSnapshot {
  return {
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
  };
}

function makeExecution(overrides?: Partial<CodexExecutionResult>): CodexExecutionResult {
  return {
    mode: "run",
    ok: true,
    cancelled: false,
    command: "codex",
    command_line: "codex exec --json",
    exit_code: 0,
    stdout: "",
    stderr: "",
    final_message: "ok",
    thread_id: "thread-1",
    events_count: 1,
    warnings_count: 0,
    usage_tokens: null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: 15,
    error: null,
    request_preview: null,
    ...overrides,
  };
}

class TrackingIndexer implements WorkspaceIndexerPort {
  public readonly scopedCalls: WorkspaceIndexByPathsRequest[] = [];

  public readonly fullCalls: WorkspaceIndexRequest[] = [];

  public async runIndex(request: WorkspaceIndexRequest): Promise<WorkspaceIndexResult> {
    this.fullCalls.push(request);
    return {
      message: "full",
      metrics: {
        scanned: 0,
        new: 0,
        modified: 0,
        deleted: 0,
        skipped: 0,
        chunksWritten: 0,
        errors: 0,
      },
      details: { mode: "full" },
    };
  }

  public async runIndexByPaths(request: WorkspaceIndexByPathsRequest): Promise<WorkspaceIndexResult> {
    this.scopedCalls.push(request);
    return {
      message: "scoped",
      metrics: {
        scanned: request.paths.length,
        new: 0,
        modified: request.paths.length,
        deleted: 0,
        skipped: 0,
        chunksWritten: request.paths.length,
        errors: 0,
      },
      details: {
        mode: "scoped",
        target_paths: request.paths,
      },
    };
  }
}

test("WorkspaceSnapshotter captura before/after determinista y materializa borrados con seed_paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wis-snapshot-"));
  const snapshotter = new WorkspaceSnapshotter({
    getIndexConfig: () => indexConfig,
  });

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "dep"), { recursive: true });
    await writeFile(path.join(root, "src", "app.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(root, "node_modules", "dep", "skip.ts"), "skip\n", "utf8");
    await writeFile(path.join(root, "src", "image.png"), Buffer.from([0, 1, 2, 3]));

    const before = await snapshotter.capture({ snapshot: makeSnapshot(root) });
    assert.deepEqual(
      before.entries.map((entry) => entry.relative_path),
      ["src/app.ts"],
    );
    assert.equal(before.entries[0]?.exists, true);

    await unlink(path.join(root, "src", "app.ts"));
    const after = await snapshotter.capture({
      snapshot: makeSnapshot(root),
      seed_paths: before.entries.map((entry) => entry.relative_path),
    });

    assert.deepEqual(
      after.entries.map((entry) => `${entry.relative_path}:${entry.exists ? "exists" : "missing"}`),
      ["src/app.ts:missing"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("WorkspaceDiffAnalyzer detecta created/modified/deleted/unchanged y preview estable", () => {
  const diff = new WorkspaceDiffAnalyzer().analyze(
    {
      snapshot_id: "before",
      captured_at: "2026-04-05T00:00:00.000Z",
      root_path: "/repo",
      entries: [
        { relative_path: "src/a.ts", exists: true, size_bytes: 10, content_hash: "h-a", modified_at: "2026-04-05T00:00:00.000Z" },
        { relative_path: "src/b.ts", exists: true, size_bytes: 20, content_hash: "h-b", modified_at: "2026-04-05T00:00:00.000Z" },
        { relative_path: "src/c.ts", exists: true, size_bytes: 30, content_hash: "h-c", modified_at: "2026-04-05T00:00:00.000Z" },
      ],
    },
    {
      snapshot_id: "after",
      captured_at: "2026-04-05T00:00:01.000Z",
      root_path: "/repo",
      entries: [
        { relative_path: "src/a.ts", exists: true, size_bytes: 10, content_hash: "h-a", modified_at: "2026-04-05T00:00:01.000Z" },
        { relative_path: "src/b.ts", exists: true, size_bytes: 22, content_hash: "h-b-2", modified_at: "2026-04-05T00:00:01.000Z" },
        { relative_path: "src/d.ts", exists: true, size_bytes: 11, content_hash: "h-d", modified_at: "2026-04-05T00:00:01.000Z" },
      ],
    },
  );

  assert.deepEqual(diff.created_files, ["src/d.ts"]);
  assert.deepEqual(diff.modified_files, ["src/b.ts"]);
  assert.deepEqual(diff.deleted_files, ["src/c.ts"]);
  assert.deepEqual(diff.unchanged_files, ["src/a.ts"]);
  assert.equal(diff.unchanged_count, 1);
  assert.equal(diff.changed_files_count, 3);
  assert.deepEqual(diff.changed_files_preview, ["src/b.ts", "src/c.ts", "src/d.ts"]);
});

test("executionOutcomeClassifier cubre reglas operativas", () => {
  const baseDiff = {
    created_files: [],
    modified_files: [],
    deleted_files: [],
    unchanged_files: [],
    unchanged_count: 0,
    changed_files_count: 0,
    changed_files_preview: [],
  };

  assert.equal(
    classifyExecutionOutcome({
      execution: makeExecution(),
      workspaceDiff: baseDiff,
      warningReasons: [],
      reindexMode: "skipped",
      reindexOk: true,
    }).outcome,
    "no_op",
  );

  assert.equal(
    classifyExecutionOutcome({
      execution: makeExecution(),
      workspaceDiff: { ...baseDiff, changed_files_count: 1, modified_files: ["src/a.ts"], changed_files_preview: ["src/a.ts"] },
      warningReasons: [],
      reindexMode: "scoped",
      reindexOk: true,
    }).outcome,
    "applied_changes",
  );

  assert.equal(
    classifyExecutionOutcome({
      execution: makeExecution(),
      workspaceDiff: { ...baseDiff, changed_files_count: 1, modified_files: ["src/a.ts"], changed_files_preview: ["src/a.ts"] },
      warningReasons: ["transport_warning"],
      reindexMode: "scoped",
      reindexOk: true,
    }).outcome,
    "partial_changes",
  );

  assert.equal(
    classifyExecutionOutcome({
      execution: makeExecution({ ok: false, error: "Command exited with code 1" }),
      workspaceDiff: baseDiff,
      warningReasons: [],
      reindexMode: "skipped",
      reindexOk: true,
    }).outcome,
    "failed",
  );

  assert.equal(
    classifyExecutionOutcome({
      execution: makeExecution({ ok: false, error: "Command timed out after 1000ms" }),
      workspaceDiff: baseDiff,
      warningReasons: [],
      reindexMode: "skipped",
      reindexOk: true,
    }).outcome,
    "timeout",
  );

  assert.equal(
    classifyExecutionOutcome({
      execution: makeExecution({ ok: false, cancelled: true, error: "Execution cancelled by user." }),
      workspaceDiff: baseDiff,
      warningReasons: [],
      reindexMode: "skipped",
      reindexOk: true,
    }).outcome,
    "cancelled",
  );

  assert.equal(
    classifyExecutionOutcome({
      execution: makeExecution(),
      workspaceDiff: baseDiff,
      warningReasons: [],
      reindexMode: "skipped",
      reindexOk: true,
      blockedReason: "invalid_command_configuration",
    }).outcome,
    "blocked",
  );
});

test("PostRunReconciler reconcilia cambios y dispara reindex scoped por paths afectados", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wis-reconciler-"));
  const snapshotter = new WorkspaceSnapshotter({
    getIndexConfig: () => indexConfig,
  });
  const indexer = new TrackingIndexer();
  const reconciler = new PostRunReconciler({
    snapshotter,
    indexer,
  });

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    const filePath = path.join(root, "src", "app.ts");
    await writeFile(filePath, "export const value = 1;\n", "utf8");

    const result = await reconciler.reconcile({
      projectId: "project-1",
      snapshot: makeSnapshot(root),
      task: {
        id: "task-1",
        objective: "Actualizar app.ts",
        context_summary: "ctx",
        candidate_files: ["src/app.ts"],
        constraints: [],
        acceptance_criteria: [],
        created_at: new Date().toISOString(),
      },
      execute: async () => {
        await writeFile(filePath, "export const value = 2;\n", "utf8");
        return makeExecution({
          request_preview: {
            stderr_warning_reasons: [],
          },
        });
      },
    });

    assert.equal(result.classified_outcome, "applied_changes");
    assert.equal(result.workspace_diff.changed_files_count, 1);
    assert.deepEqual(result.workspace_diff.modified_files, ["src/app.ts"]);
    assert.equal(result.reindex_result.mode, "scoped");
    assert.equal(indexer.scopedCalls.length, 1);
    assert.deepEqual(indexer.scopedCalls[0]?.paths, ["src/app.ts"]);
    assert.equal(indexer.fullCalls.length, 0);
    assert.doesNotThrow(() => JSON.stringify(result));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PostRunReconciler cae a fallback_full cuando el scope supera el límite", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wis-reconciler-fallback-"));
  const snapshotter = new WorkspaceSnapshotter({
    getIndexConfig: () => indexConfig,
  });
  const indexer = new TrackingIndexer();
  const reconciler = new PostRunReconciler({
    snapshotter,
    indexer,
  });

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    const result = await reconciler.reconcile({
      projectId: "project-1",
      snapshot: makeSnapshot(root),
      task: {
        id: "task-1",
        objective: "Crear corpus masivo",
        context_summary: "ctx",
        candidate_files: [],
        constraints: [],
        acceptance_criteria: [],
        created_at: new Date().toISOString(),
      },
      execute: async () => {
        for (let index = 0; index < 205; index += 1) {
          await writeFile(path.join(root, "src", `file-${index}.ts`), `export const value${index} = ${index};\n`, "utf8");
        }
        return makeExecution();
      },
    });

    assert.equal(result.workspace_diff.changed_files_count, 205);
    assert.equal(result.reindex_result.mode, "fallback_full");
    assert.equal(result.classified_outcome, "partial_changes");
    assert.equal(indexer.scopedCalls.length, 0);
    assert.equal(indexer.fullCalls.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
