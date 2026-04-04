import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Pool } from "pg";
import { PostgresPersistenceAdapter } from "../../local/persistence/postgresPersistenceAdapter";
import type { LocalDbConfig } from "../../config";
import type { CodexExecutionResult, LocalTaskDraft } from "../../local/types";
import type { RetrievedContext } from "../../local/ports";

const run = process.env.LOCAL_DB_TESTS === "1" ? test : test.skip;

let parsedDotEnv: Record<string, string> | null = null;

function parseDotEnv(): Record<string, string> {
  if (parsedDotEnv) {
    return parsedDotEnv;
  }

  const envPath = path.resolve(process.cwd(), "..", ".env");
  try {
    const raw = readFileSync(envPath, "utf8");
    const parsed: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separator = trimmed.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      parsed[key] = value;
    }
    parsedDotEnv = parsed;
    return parsed;
  } catch {
    parsedDotEnv = {};
    return parsedDotEnv;
  }
}

function envOrDotEnv(name: string, fallback: string): string {
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.trim().length > 0) {
    return fromProcess.trim();
  }
  const fromFile = parseDotEnv()[name];
  if (fromFile && fromFile.trim().length > 0) {
    return fromFile.trim();
  }
  return fallback;
}

function baseConfig(schema: string, portOverride?: number): LocalDbConfig {
  return {
    enabled: true,
    host: envOrDotEnv("LOCAL_DB_HOST", "localhost"),
    port: Number(process.env.LOCAL_DB_PORT ?? portOverride ?? envOrDotEnv("POSTGRES_HOST_PORT", "5432")),
    database: envOrDotEnv("LOCAL_DB_NAME", envOrDotEnv("POSTGRES_DB", "wis_context")),
    user: envOrDotEnv("LOCAL_DB_USER", envOrDotEnv("POSTGRES_USER", "wis_admin")),
    password: envOrDotEnv("LOCAL_DB_PASSWORD", envOrDotEnv("POSTGRES_PASSWORD", "")),
    schema,
    ssl: false,
  };
}

function makeSchemaName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function makeTask(): LocalTaskDraft {
  return {
    id: randomUUID(),
    objective: "Persistir draft local",
    context_summary: "ctx",
    candidate_files: ["/workspace/repo/src/index.ts"],
    constraints: ["none"],
    acceptance_criteria: ["saved"],
    created_at: new Date().toISOString(),
  };
}

function makeExecution(): CodexExecutionResult {
  return {
    mode: "run",
    ok: true,
    command: "node",
    command_line: "node --version",
    exit_code: 0,
    stdout: "v20",
    stderr: "",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: 12,
    error: null,
    request_preview: { task_id: "x" },
  };
}

function makeRetrievedContext(): RetrievedContext {
  return {
    summary: "retrieval ok",
    candidate_files: ["src/index.ts"],
    selected_chunks: [
      {
        file_path: "src/index.ts",
        chunk_index: 0,
        content: "export const value = 1;",
        score: 90,
        evidence: ["content_match"],
      },
    ],
    ranking_evidence: [
      {
        file_path: "src/index.ts",
        chunk_index: 0,
        score: 90,
        reasons: ["content_match"],
      },
    ],
    budget_stats: {
      max_files: 5,
      max_chunks: 8,
      max_chunks_per_file: 3,
      max_total_chars: 6000,
      selected_files: 1,
      selected_chunks: 1,
      selected_chars: 23,
      truncated: false,
    },
  };
}

async function countRows(config: LocalDbConfig, schema: string, table: string): Promise<number> {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: false,
  });
  try {
    const query = `SELECT count(*)::int AS total FROM "${schema}"."${table}"`;
    const result = await pool.query(query);
    return Number(result.rows[0]?.total ?? 0);
  } finally {
    await pool.end();
  }
}

async function readFileRow(
  config: LocalDbConfig,
  schema: string,
  filePath: string,
): Promise<{ is_deleted: boolean; content_hash: string; last_indexed_at: string } | null> {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: false,
  });

  try {
    const query = `SELECT is_deleted, content_hash, last_indexed_at FROM "${schema}"."files" WHERE path = $1`;
    const result = await pool.query(query, [filePath]);
    if (result.rows.length === 0) {
      return null;
    }
    return {
      is_deleted: Boolean(result.rows[0].is_deleted),
      content_hash: String(result.rows[0].content_hash),
      last_indexed_at: String(result.rows[0].last_indexed_at),
    };
  } finally {
    await pool.end();
  }
}

async function readTaskContextPayload(
  config: LocalDbConfig,
  schema: string,
): Promise<Record<string, unknown> | null> {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: false,
  });

  try {
    const query = `SELECT payload_json FROM "${schema}"."task_context" LIMIT 1`;
    const result = await pool.query(query);
    return (result.rows[0]?.payload_json as Record<string, unknown> | undefined) ?? null;
  } finally {
    await pool.end();
  }
}

run("I-01/I-02 healthcheck y migraciones idempotentes sin pgvector", async () => {
  const schema = makeSchemaName("local_private_it");
  const config = baseConfig(schema);
  const adapter = new PostgresPersistenceAdapter({
    config,
    extensionPath: process.cwd(),
  });

  const first = await adapter.healthcheck();
  assert.equal(first.ok, true);
  assert.equal(first.db_status, "connected");
  assert.ok(first.migrations_applied >= 1);

  const second = await adapter.healthcheck();
  assert.equal(second.ok, true);
  assert.equal(second.migrations_applied, 0);

  await adapter.dispose();
});

run("I-03/I-04 create project + index_run en schema aislado", async () => {
  const schema = makeSchemaName("local_private_it");
  const config = baseConfig(schema);
  const adapter = new PostgresPersistenceAdapter({ config, extensionPath: process.cwd() });
  await adapter.healthcheck();

  const project = await adapter.ensureProject({
    operation_profile: "local_private",
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    branch: "main",
  });
  assert.ok(project.id.length > 0);

  const runCreated = await adapter.createIndexRun({
    project_id: project.id,
    status: "started",
    summary: null,
  });
  await adapter.completeIndexRun({
    index_run_id: runCreated.id,
    status: "completed",
    summary: "noop",
  });

  const runs = await countRows(config, schema, "index_runs");
  assert.equal(runs, 1);

  await adapter.dispose();
});

run("I-05/I-06 save task + task_context", async () => {
  const schema = makeSchemaName("local_private_it");
  const config = baseConfig(schema);
  const adapter = new PostgresPersistenceAdapter({ config, extensionPath: process.cwd() });
  await adapter.healthcheck();

  const project = await adapter.ensureProject({
    operation_profile: "local_private",
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    branch: "main",
  });
  const task = makeTask();

  const savedTask = await adapter.saveTask({
    project_id: project.id,
    task,
    status: "draft",
  });
  const savedContext = await adapter.saveTaskContext({
    project_id: project.id,
    task,
    retrieved_context: makeRetrievedContext(),
  });

  assert.equal(savedTask.id, task.id);
  assert.equal(savedContext.task_id, task.id);
  assert.equal(await countRows(config, schema, "tasks"), 1);
  assert.equal(await countRows(config, schema, "task_context"), 1);
  const payload = await readTaskContextPayload(config, schema);
  assert.ok(Array.isArray(payload?.selected_chunks));
  assert.ok(Array.isArray(payload?.ranking_evidence));

  await adapter.dispose();
});

run("I-07 transaction: execution + artifact + event", async () => {
  const schema = makeSchemaName("local_private_it");
  const config = baseConfig(schema);
  const adapter = new PostgresPersistenceAdapter({ config, extensionPath: process.cwd() });
  await adapter.healthcheck();

  const project = await adapter.ensureProject({
    operation_profile: "local_private",
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    branch: "main",
  });
  const task = makeTask();
  await adapter.saveTask({ project_id: project.id, task, status: "draft" });

  await adapter.runInTransaction(async (tx) => {
    const execution = await tx.saveExecution({
      project_id: project.id,
      task_id: task.id,
      result: makeExecution(),
    });
    await tx.saveExecutionArtifact({
      project_id: project.id,
      execution_id: execution.id,
      artifact_type: "stdout",
      content: "ok",
      metadata: { source: "test" },
    });
    await tx.saveEvent({
      project_id: project.id,
      task_id: task.id,
      execution_id: execution.id,
      event_type: "local_run_codex",
      severity: "info",
      message: "ok",
      payload: {},
    });
  });

  assert.equal(await countRows(config, schema, "executions"), 1);
  assert.equal(await countRows(config, schema, "execution_artifacts"), 1);
  assert.equal(await countRows(config, schema, "events"), 1);

  await adapter.dispose();
});

run("I-08 rollback real por FK inválida en artifact", async () => {
  const schema = makeSchemaName("local_private_it");
  const config = baseConfig(schema);
  const adapter = new PostgresPersistenceAdapter({ config, extensionPath: process.cwd() });
  await adapter.healthcheck();

  const project = await adapter.ensureProject({
    operation_profile: "local_private",
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    branch: "main",
  });
  const task = makeTask();
  await adapter.saveTask({ project_id: project.id, task, status: "draft" });

  await assert.rejects(async () => {
    await adapter.runInTransaction(async (tx) => {
      await tx.saveExecution({
        project_id: project.id,
        task_id: task.id,
        result: makeExecution(),
      });
      await tx.saveExecutionArtifact({
        project_id: project.id,
        execution_id: randomUUID(),
        artifact_type: "stdout",
        content: "should fail",
        metadata: {},
      });
    });
  });

  assert.equal(await countRows(config, schema, "executions"), 0);
  assert.equal(await countRows(config, schema, "execution_artifacts"), 0);

  await adapter.dispose();
});

run("I-09/I-10 estado disconnected explícito con configuración inválida", async () => {
  const schema = makeSchemaName("local_private_it");
  const badConfig = baseConfig(schema, 65433);
  const adapter = new PostgresPersistenceAdapter({
    config: badConfig,
    extensionPath: process.cwd(),
  });

  const health = await adapter.healthcheck();
  assert.equal(health.ok, false);
  assert.equal(health.db_status, "disconnected");
  assert.ok(health.error !== null);

  await adapter.dispose();
});

run("I-11 indexación incremental: upsert file + chunks + soft delete + reactivación", async () => {
  const schema = makeSchemaName("local_private_it");
  const config = baseConfig(schema);
  const adapter = new PostgresPersistenceAdapter({ config, extensionPath: process.cwd() });
  await adapter.healthcheck();

  const project = await adapter.ensureProject({
    operation_profile: "local_private",
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    branch: "main",
  });

  const first = await adapter.upsertIndexedFile({
    project_id: project.id,
    path: "src/index.ts",
    content_hash: "hash-v1",
    size_bytes: 120,
    modified_at: new Date().toISOString(),
    language: "ts",
  });

  const chunksWritten = await adapter.replaceFileChunks(first.id, project.id, [
    { chunkIndex: 0, content: "chunk A", contentHash: "cA" },
    { chunkIndex: 1, content: "chunk B", contentHash: "cB" },
  ]);
  assert.equal(chunksWritten, 2);

  const updated = await adapter.upsertIndexedFile({
    project_id: project.id,
    path: "src/index.ts",
    content_hash: "hash-v2",
    size_bytes: 140,
    modified_at: new Date().toISOString(),
    language: "ts",
  });
  assert.equal(updated.id, first.id);

  const replacedChunks = await adapter.replaceFileChunks(updated.id, project.id, [
    { chunkIndex: 0, content: "chunk only", contentHash: "c1" },
  ]);
  assert.equal(replacedChunks, 1);

  const deletedIds = await adapter.markFilesDeleted(project.id, ["src/index.ts"]);
  assert.deepEqual(deletedIds, [first.id]);
  const deletedChunks = await adapter.deleteChunksByFileIds(deletedIds);
  assert.equal(deletedChunks, 1);

  const deletedRow = await readFileRow(config, schema, "src/index.ts");
  assert.ok(deletedRow);
  assert.equal(deletedRow?.is_deleted, true);
  assert.equal(deletedRow?.content_hash, "hash-v2");
  assert.equal(await countRows(config, schema, "file_chunks"), 0);

  const reactivated = await adapter.upsertIndexedFile({
    project_id: project.id,
    path: "src/index.ts",
    content_hash: "hash-v3",
    size_bytes: 180,
    modified_at: new Date().toISOString(),
    language: "ts",
  });
  assert.equal(reactivated.id, first.id);

  const reactivatedRow = await readFileRow(config, schema, "src/index.ts");
  assert.equal(reactivatedRow?.is_deleted, false);
  assert.equal(reactivatedRow?.content_hash, "hash-v3");

  await adapter.dispose();
});

run("I-12 index_runs guarda métricas reales de indexación", async () => {
  const schema = makeSchemaName("local_private_it");
  const config = baseConfig(schema);
  const adapter = new PostgresPersistenceAdapter({ config, extensionPath: process.cwd() });
  await adapter.healthcheck();

  const project = await adapter.ensureProject({
    operation_profile: "local_private",
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    branch: "main",
  });

  const indexRun = await adapter.createIndexRun({
    project_id: project.id,
    status: "started",
    summary: null,
  });

  await adapter.createOrUpdateIndexRunMetrics({
    index_run_id: indexRun.id,
    scanned_count: 12,
    new_count: 3,
    modified_count: 2,
    deleted_count: 1,
    skipped_count: 6,
    chunk_count: 7,
    error_count: 0,
  });
  await adapter.completeIndexRun({
    index_run_id: indexRun.id,
    status: "completed",
    summary: "ok",
  });

  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: false,
  });
  try {
    const query = `
      SELECT scanned_count, new_count, modified_count, deleted_count, skipped_count, chunk_count, error_count
      FROM "${schema}"."index_runs"
      WHERE id = $1
    `;
    const result = await pool.query(query, [indexRun.id]);
    assert.equal(result.rows.length, 1);
    assert.equal(Number(result.rows[0].scanned_count), 12);
    assert.equal(Number(result.rows[0].new_count), 3);
    assert.equal(Number(result.rows[0].modified_count), 2);
    assert.equal(Number(result.rows[0].deleted_count), 1);
    assert.equal(Number(result.rows[0].skipped_count), 6);
    assert.equal(Number(result.rows[0].chunk_count), 7);
    assert.equal(Number(result.rows[0].error_count), 0);
  } finally {
    await pool.end();
    await adapter.dispose();
  }
});

run("I-13 retrieval queries leen activos y excluyen soft delete", async () => {
  const schema = makeSchemaName("local_private_it");
  const config = baseConfig(schema);
  const adapter = new PostgresPersistenceAdapter({ config, extensionPath: process.cwd() });
  await adapter.healthcheck();

  const project = await adapter.ensureProject({
    operation_profile: "local_private",
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    branch: "main",
  });

  const authFile = await adapter.upsertIndexedFile({
    project_id: project.id,
    path: "src/authService.ts",
    content_hash: "hash-auth",
    size_bytes: 120,
    modified_at: new Date().toISOString(),
    language: "ts",
  });
  await adapter.replaceFileChunks(authFile.id, project.id, [
    { chunkIndex: 0, content: "refresh token validation token", contentHash: "auth-c0" },
    { chunkIndex: 1, content: "audit trail", contentHash: "auth-c1" },
  ]);

  const deletedFile = await adapter.upsertIndexedFile({
    project_id: project.id,
    path: "src/deletedService.ts",
    content_hash: "hash-deleted",
    size_bytes: 90,
    modified_at: new Date().toISOString(),
    language: "ts",
  });
  await adapter.replaceFileChunks(deletedFile.id, project.id, [
    { chunkIndex: 0, content: "token should disappear", contentHash: "deleted-c0" },
  ]);
  const deletedIds = await adapter.markFilesDeleted(project.id, ["src/deletedService.ts"]);
  await adapter.deleteChunksByFileIds(deletedIds);

  const fileHits = await adapter.searchIndexedFiles({
    projectId: project.id,
    tokens: ["authservice.ts"],
    limit: 5,
  });
  assert.deepEqual(fileHits.map((entry) => entry.path), ["src/authService.ts"]);

  const chunkHits = await adapter.searchFileChunks({
    projectId: project.id,
    tokens: ["token"],
    limit: 10,
  });
  assert.deepEqual(chunkHits.map((entry) => entry.file_path), ["src/authService.ts"]);

  const lookupChunks = await adapter.getFileChunksByFileIds({
    projectId: project.id,
    fileIds: [authFile.id, deletedFile.id],
    limitPerFile: 1,
  });
  assert.deepEqual(lookupChunks.map((entry) => entry.file_path), ["src/authService.ts"]);
  assert.deepEqual(lookupChunks.map((entry) => entry.chunk_index), [0]);

  await adapter.dispose();
});
