import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresPersistenceAdapter } from "../../local/persistence/postgresPersistenceAdapter";
import type { LocalDbConfig } from "../../config";
import type { CodexExecutionResult, LocalTaskDraft } from "../../local/types";

const run = process.env.LOCAL_DB_TESTS === "1" ? test : test.skip;

function baseConfig(schema: string, portOverride?: number): LocalDbConfig {
  return {
    enabled: true,
    host: process.env.LOCAL_DB_HOST ?? "localhost",
    port: Number(process.env.LOCAL_DB_PORT ?? portOverride ?? 5432),
    database: process.env.LOCAL_DB_NAME ?? process.env.POSTGRES_DB ?? "wis_context",
    user: process.env.LOCAL_DB_USER ?? process.env.POSTGRES_USER ?? "wis_admin",
    password: process.env.LOCAL_DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? "",
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

async function countRows(config: LocalDbConfig, schema: string, table: string): Promise<number> {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password || undefined,
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
  });

  assert.equal(savedTask.id, task.id);
  assert.equal(savedContext.task_id, task.id);
  assert.equal(await countRows(config, schema, "tasks"), 1);
  assert.equal(await countRows(config, schema, "task_context"), 1);

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
