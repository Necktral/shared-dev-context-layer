import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Pool } from "pg";
import type { LocalDbConfig } from "../../config";
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
} from "../ports";

export interface PostgresPersistenceAdapterOptions {
  config: LocalDbConfig;
  extensionPath: string;
}

interface MigrationFile {
  version: string;
  fullPath: string;
}

interface QueryClient {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function isValidSchemaName(schema: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema);
}

function ensureSchemaName(schema: string): string {
  if (!isValidSchemaName(schema)) {
    throw new Error(`localDb.schema inválido: '${schema}'.`);
  }
  return schema;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function mapPostgresError(error: unknown): string {
  if (error instanceof Error) {
    const anyError = error as Error & { code?: string; detail?: string };
    const code = anyError.code;

    if (code === "ECONNREFUSED") {
      return "No se pudo conectar a PostgreSQL (ECONNREFUSED).";
    }
    if (code === "28P01") {
      return "Credenciales de PostgreSQL inválidas (28P01).";
    }
    if (code === "3D000") {
      return "Base de datos PostgreSQL no existe (3D000).";
    }
    if (code === "3F000") {
      return "Schema PostgreSQL no existe (3F000).";
    }
    if (code === "42P01") {
      return "Tabla requerida no existe (42P01). Ejecuta Local Refresh para migrar.";
    }
    if (code === "23503") {
      return "Violación de integridad referencial (23503).";
    }
    if (code === "23505") {
      return "Conflicto por clave única duplicada (23505).";
    }

    if (anyError.message.includes("connect ECONNREFUSED")) {
      return "No se pudo conectar a PostgreSQL en host/puerto configurado.";
    }
    if (anyError.message.includes("password authentication failed")) {
      return "Autenticación PostgreSQL falló. Revisa usuario/password.";
    }

    return anyError.message;
  }

  return "Error desconocido de persistencia PostgreSQL.";
}

export class PostgresPersistenceAdapter implements PersistencePort {
  private readonly config: LocalDbConfig;

  private readonly pool: Pool;

  private readonly schema: string;

  private readonly schemaQuoted: string;

  private readonly migrationsDir: string;

  private migrationsReady = false;

  constructor(options: PostgresPersistenceAdapterOptions) {
    this.config = options.config;
    this.schema = ensureSchemaName(options.config.schema);
    this.schemaQuoted = quoteIdentifier(this.schema);
    this.migrationsDir = path.join(options.extensionPath, "migrations", "local_private");

    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  public async healthcheck(): Promise<PersistenceHealthcheck> {
    if (!this.config.enabled) {
      return {
        ok: false,
        db_status: "disconnected",
        error: "Persistencia local deshabilitada por configuración (wisContextSync.localDb.enabled=false).",
        migrations_applied: 0,
      };
    }

    try {
      await this.pool.query("SELECT 1");
      const migrationsApplied = await this.ensureMigrations();
      return {
        ok: true,
        db_status: "connected",
        error: null,
        migrations_applied: migrationsApplied,
      };
    } catch (error) {
      return {
        ok: false,
        db_status: "disconnected",
        error: mapPostgresError(error),
        migrations_applied: 0,
      };
    }
  }

  public async ensureProject(input: EnsureProjectInput): Promise<PersistedProject> {
    await this.ensureMigrations();
    const projectKey = this.buildProjectKey(input);
    const projectId = randomUUID();
    const now = nowIso();
    const table = this.table("projects");

    const result = await this.query(
      `INSERT INTO ${table} (id, project_key, operation_profile, workspace_root, repo_root, branch, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (project_key)
       DO UPDATE SET
         operation_profile = EXCLUDED.operation_profile,
         workspace_root = EXCLUDED.workspace_root,
         repo_root = EXCLUDED.repo_root,
         branch = EXCLUDED.branch,
         updated_at = EXCLUDED.updated_at
       RETURNING id, project_key`,
      [
        projectId,
        projectKey,
        input.operation_profile,
        input.workspace_root,
        input.repo_root,
        input.branch,
        now,
        now,
      ],
    );

    const row = result.rows[0] as { id: string; project_key: string };
    return {
      id: row.id,
      project_key: row.project_key,
    };
  }

  public async createIndexRun(input: CreateIndexRunInput): Promise<PersistedIndexRun> {
    await this.ensureMigrations();
    const indexRunId = randomUUID();
    const now = nowIso();
    const table = this.table("index_runs");

    await this.query(
      `INSERT INTO ${table} (id, project_id, status, summary, started_at, finished_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [indexRunId, input.project_id, input.status, input.summary, now, null, now, now],
    );

    return {
      id: indexRunId,
      project_id: input.project_id,
      status: input.status,
    };
  }

  public async completeIndexRun(input: CompleteIndexRunInput): Promise<void> {
    await this.ensureMigrations();
    const now = nowIso();
    const table = this.table("index_runs");
    await this.query(
      `UPDATE ${table}
       SET status = $2,
           summary = $3,
           finished_at = $4,
           updated_at = $4
       WHERE id = $1`,
      [input.index_run_id, input.status, input.summary, now],
    );
  }

  public async createOrUpdateIndexRunMetrics(input: UpdateIndexRunMetricsInput): Promise<void> {
    await this.ensureMigrations();
    const table = this.table("index_runs");
    await this.query(
      `UPDATE ${table}
       SET scanned_count = $2,
           new_count = $3,
           modified_count = $4,
           deleted_count = $5,
           skipped_count = $6,
           chunk_count = $7,
           error_count = $8,
           updated_at = $9
       WHERE id = $1`,
      [
        input.index_run_id,
        input.scanned_count,
        input.new_count,
        input.modified_count,
        input.deleted_count,
        input.skipped_count,
        input.chunk_count,
        input.error_count,
        nowIso(),
      ],
    );
  }

  public async listProjectFiles(project_id: string, includeDeleted = false): Promise<PersistedIndexedFile[]> {
    await this.ensureMigrations();
    const table = this.table("files");
    const result = includeDeleted
      ? await this.query(
          `SELECT id, path, COALESCE(content_hash, '') AS content_hash, is_deleted
           FROM ${table}
           WHERE project_id = $1
           ORDER BY path ASC`,
          [project_id],
        )
      : await this.query(
          `SELECT id, path, COALESCE(content_hash, '') AS content_hash, is_deleted
           FROM ${table}
           WHERE project_id = $1 AND is_deleted = false
           ORDER BY path ASC`,
          [project_id],
        );

    return result.rows.map((row) => ({
      id: String(row.id),
      path: String(row.path),
      content_hash: String(row.content_hash),
      is_deleted: Boolean(row.is_deleted),
    }));
  }

  public async searchIndexedFiles(input: SearchIndexedFilesInput): Promise<RetrievedIndexedFileCandidate[]> {
    await this.ensureMigrations();
    const normalizedTokens = this.normalizeTokens(input.tokens);
    if (normalizedTokens.length === 0 || input.limit <= 0) {
      return [];
    }

    const table = this.table("files");
    const values: unknown[] = [input.projectId];
    const likeClause = this.buildLikeClause("path", normalizedTokens, values, false);
    const result = await this.query(
      `SELECT id AS file_id, path, COALESCE(content_hash, '') AS content_hash
       FROM ${table}
       WHERE project_id = $1
         AND is_deleted = false
         AND (${likeClause})
       ORDER BY path ASC
       LIMIT $${values.length + 1}`,
      [...values, input.limit],
    );

    return result.rows.map((row) => ({
      file_id: String(row.file_id),
      path: String(row.path),
      content_hash: String(row.content_hash),
    }));
  }

  public async searchFileChunks(input: SearchFileChunksInput): Promise<RetrievedIndexedChunk[]> {
    await this.ensureMigrations();
    const normalizedTokens = this.normalizeTokens(input.tokens);
    if (normalizedTokens.length === 0 || input.limit <= 0) {
      return [];
    }

    const fileTable = this.table("files");
    const chunkTable = this.table("file_chunks");
    const values: unknown[] = [input.projectId];
    const conditions = [
      "f.project_id = $1",
      "f.is_deleted = false",
      this.buildLikeClause("fc.content", normalizedTokens, values, false),
    ];

    if (input.fileIds && input.fileIds.length > 0) {
      conditions.push(`fc.file_id = ANY($${values.length + 1}::text[])`);
      values.push(input.fileIds);
    }

    const result = await this.query(
      `SELECT fc.file_id, f.path AS file_path, fc.chunk_index, fc.content, COALESCE(fc.content_hash, '') AS content_hash
       FROM ${chunkTable} fc
       INNER JOIN ${fileTable} f ON f.id = fc.file_id
       WHERE ${conditions.join("\n         AND ")}
       ORDER BY f.path ASC, fc.chunk_index ASC
       LIMIT $${values.length + 1}`,
      [...values, input.limit],
    );

    return result.rows.map((row) => ({
      file_id: String(row.file_id),
      file_path: String(row.file_path),
      chunk_index: Number(row.chunk_index),
      content: String(row.content),
      content_hash: String(row.content_hash),
    }));
  }

  public async getFileChunksByFileIds(input: GetFileChunksByFileIdsInput): Promise<RetrievedIndexedChunk[]> {
    await this.ensureMigrations();
    if (input.fileIds.length === 0 || input.limitPerFile <= 0) {
      return [];
    }

    const fileTable = this.table("files");
    const chunkTable = this.table("file_chunks");
    const result = await this.query(
      `SELECT ranked.file_id, ranked.file_path, ranked.chunk_index, ranked.content, ranked.content_hash
       FROM (
         SELECT
           fc.file_id,
           f.path AS file_path,
           fc.chunk_index,
           fc.content,
           COALESCE(fc.content_hash, '') AS content_hash,
           ROW_NUMBER() OVER (PARTITION BY fc.file_id ORDER BY fc.chunk_index ASC) AS row_number
         FROM ${chunkTable} fc
         INNER JOIN ${fileTable} f ON f.id = fc.file_id
         WHERE f.project_id = $1
           AND f.is_deleted = false
           AND fc.file_id = ANY($2::text[])
       ) ranked
       WHERE ranked.row_number <= $3
       ORDER BY ranked.file_path ASC, ranked.chunk_index ASC`,
      [input.projectId, input.fileIds, input.limitPerFile],
    );

    return result.rows.map((row) => ({
      file_id: String(row.file_id),
      file_path: String(row.file_path),
      chunk_index: Number(row.chunk_index),
      content: String(row.content),
      content_hash: String(row.content_hash),
    }));
  }

  public async upsertIndexedFile(input: UpsertIndexedFileInput): Promise<PersistedIndexedFile> {
    await this.ensureMigrations();
    const table = this.table("files");
    const now = nowIso();
    const fileId = randomUUID();

    const result = await this.query(
      `INSERT INTO ${table}
       (id, project_id, path, content_hash, language, size_bytes, modified_at, is_deleted, deleted_at, last_indexed_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,NULL,$8,$8,$8)
       ON CONFLICT (project_id, path)
       DO UPDATE SET
         content_hash = EXCLUDED.content_hash,
         language = EXCLUDED.language,
         size_bytes = EXCLUDED.size_bytes,
         modified_at = EXCLUDED.modified_at,
         is_deleted = false,
         deleted_at = NULL,
         last_indexed_at = EXCLUDED.last_indexed_at,
         updated_at = EXCLUDED.updated_at
       RETURNING id, path, COALESCE(content_hash, '') AS content_hash, is_deleted`,
      [
        fileId,
        input.project_id,
        input.path,
        input.content_hash,
        input.language,
        input.size_bytes,
        input.modified_at,
        now,
      ],
    );

    const row = result.rows[0];
    return {
      id: String(row.id),
      path: String(row.path),
      content_hash: String(row.content_hash),
      is_deleted: Boolean(row.is_deleted),
    };
  }

  public async markFilesDeleted(project_id: string, paths: string[]): Promise<string[]> {
    await this.ensureMigrations();
    if (paths.length === 0) {
      return [];
    }

    const table = this.table("files");
    const now = nowIso();
    const result = await this.query(
      `UPDATE ${table}
       SET is_deleted = true,
           deleted_at = $3,
           updated_at = $3
       WHERE project_id = $1
         AND path = ANY($2::text[])
         AND is_deleted = false
       RETURNING id`,
      [project_id, paths, now],
    );

    return result.rows.map((row) => String(row.id));
  }

  public async replaceFileChunks(file_id: string, project_id: string, chunks: ChunkRecord[]): Promise<number> {
    await this.ensureMigrations();
    const table = this.table("file_chunks");
    const client = await this.pool.connect();
    const now = nowIso();

    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM ${table} WHERE file_id = $1`, [file_id]);

      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO ${table}
           (id, file_id, project_id, chunk_index, content, content_hash, embedding_status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$7)`,
          [
            randomUUID(),
            file_id,
            project_id,
            chunk.chunkIndex,
            chunk.content,
            chunk.contentHash,
            now,
          ],
        );
      }

      await client.query("COMMIT");
      return chunks.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(mapPostgresError(error));
    } finally {
      client.release();
    }
  }

  public async deleteChunksByFileIds(file_ids: string[]): Promise<number> {
    await this.ensureMigrations();
    if (file_ids.length === 0) {
      return 0;
    }
    const table = this.table("file_chunks");
    try {
      const result = await this.pool.query(
        `DELETE FROM ${table}
         WHERE file_id = ANY($1::text[])`,
        [file_ids],
      );
      return result.rowCount ?? 0;
    } catch (error) {
      throw new Error(mapPostgresError(error));
    }
  }

  public async saveTask(input: SaveTaskInput): Promise<PersistedTask> {
    await this.ensureMigrations();
    const table = this.table("tasks");
    const payload = {
      objective: input.task.objective,
      context_summary: input.task.context_summary,
      candidate_files: input.task.candidate_files,
      constraints: input.task.constraints,
      acceptance_criteria: input.task.acceptance_criteria,
    };

    await this.query(
      `INSERT INTO ${table} (id, project_id, objective, context_summary, status, payload_json, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       ON CONFLICT (id)
       DO UPDATE SET
         objective = EXCLUDED.objective,
         context_summary = EXCLUDED.context_summary,
         status = EXCLUDED.status,
         payload_json = EXCLUDED.payload_json,
         updated_at = EXCLUDED.updated_at`,
      [
        input.task.id,
        input.project_id,
        input.task.objective,
        input.task.context_summary,
        input.status,
        JSON.stringify(payload),
        input.task.created_at,
        nowIso(),
      ],
    );

    return {
      id: input.task.id,
      project_id: input.project_id,
    };
  }

  public async saveTaskContext(input: SaveTaskContextInput): Promise<PersistedTaskContext> {
    await this.ensureMigrations();
    const contextId = randomUUID();
    const table = this.table("task_context");
    const payload = {
      selected_chunks: input.retrieved_context.selected_chunks,
      ranking_evidence: input.retrieved_context.ranking_evidence,
      budget_stats: input.retrieved_context.budget_stats,
    };

    await this.query(
      `INSERT INTO ${table} (id, task_id, project_id, summary, candidate_files, constraints, acceptance_criteria, payload_json, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9)`,
      [
        contextId,
        input.task.id,
        input.project_id,
        input.task.context_summary,
        JSON.stringify(input.task.candidate_files),
        JSON.stringify(input.task.constraints),
        JSON.stringify(input.task.acceptance_criteria),
        JSON.stringify(payload),
        nowIso(),
      ],
    );

    return {
      id: contextId,
      task_id: input.task.id,
    };
  }

  public async saveExecution(input: SaveExecutionInput): Promise<PersistedExecution> {
    await this.ensureMigrations();
    return this.saveExecutionWithClient(this.pool, input);
  }

  public async saveExecutionArtifact(input: SaveExecutionArtifactInput): Promise<PersistedExecutionArtifact> {
    await this.ensureMigrations();
    return this.saveExecutionArtifactWithClient(this.pool, input);
  }

  public async saveDecision(input: SaveDecisionInput): Promise<PersistedDecision> {
    await this.ensureMigrations();
    const decisionId = randomUUID();
    const table = this.table("decisions");
    await this.query(
      `INSERT INTO ${table} (id, project_id, title, statement, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [decisionId, input.project_id, input.title, input.statement, input.source, nowIso()],
    );
    return {
      id: decisionId,
      project_id: input.project_id,
    };
  }

  public async saveEvent(input: SaveEventInput): Promise<PersistedEvent> {
    await this.ensureMigrations();
    return this.saveEventWithClient(this.pool, input);
  }

  public async runInTransaction<T>(operation: (tx: PersistenceTransactionPort) => Promise<T>): Promise<T> {
    await this.ensureMigrations();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const txPort: PersistenceTransactionPort = {
        saveExecution: (input) => this.saveExecutionWithClient(client, input),
        saveExecutionArtifact: (input) => this.saveExecutionArtifactWithClient(client, input),
        saveEvent: (input) => this.saveEventWithClient(client, input),
      };
      const result = await operation(txPort);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(mapPostgresError(error));
    } finally {
      client.release();
    }
  }

  public async dispose(): Promise<void> {
    await this.pool.end();
  }

  private table(name: string): string {
    return `${this.schemaQuoted}.${quoteIdentifier(name)}`;
  }

  private async query(text: string, values: unknown[] = []): Promise<{ rows: Array<Record<string, unknown>> }> {
    try {
      return await this.pool.query(text, values);
    } catch (error) {
      throw new Error(mapPostgresError(error));
    }
  }

  private buildProjectKey(input: EnsureProjectInput): string {
    return createHash("sha256")
      .update([input.operation_profile, input.workspace_root ?? "", input.repo_root ?? ""].join("|"))
      .digest("hex");
  }

  private normalizeTokens(tokens: string[]): string[] {
    return [...new Set(tokens.map((token) => token.trim().toLowerCase()).filter((token) => token.length > 0))];
  }

  private buildLikeClause(column: string, tokens: string[], values: unknown[], caseSensitive: boolean): string {
    const operator = caseSensitive ? "LIKE" : "ILIKE";
    const clauses: string[] = [];
    for (const token of tokens) {
      values.push(`%${this.escapeLikePattern(token)}%`);
      clauses.push(`${column} ${operator} $${values.length} ESCAPE '\\'`);
    }
    if (clauses.length === 0) {
      return "false";
    }
    return clauses.join(" OR ");
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/([\\%_])/g, "\\$1");
  }

  private async ensureMigrations(): Promise<number> {
    if (this.migrationsReady) {
      return 0;
    }

    const pending = await this.listPendingMigrations();
    let applied = 0;
    for (const migration of pending) {
      const sql = await fs.readFile(migration.fullPath, "utf8");
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${this.schemaQuoted}`);
        await client.query(
          `CREATE TABLE IF NOT EXISTS ${this.table("schema_migrations")} (
             version text PRIMARY KEY,
             applied_at timestamptz NOT NULL
           )`,
        );
        await client.query(`SET LOCAL search_path TO ${this.schemaQuoted}, public`);
        await client.query(sql);
        await client.query(`INSERT INTO ${this.table("schema_migrations")} (version, applied_at) VALUES ($1,$2)`, [
          migration.version,
          nowIso(),
        ]);
        await client.query("COMMIT");
        applied += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(mapPostgresError(error));
      } finally {
        client.release();
      }
    }

    this.migrationsReady = true;
    return applied;
  }

  private async listPendingMigrations(): Promise<MigrationFile[]> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schemaQuoted}`);
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table("schema_migrations")} (
         version text PRIMARY KEY,
         applied_at timestamptz NOT NULL
       )`,
    );

    const entries = await fs.readdir(this.migrationsDir, { withFileTypes: true });
    const migrations = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => ({
        version: entry.name,
        fullPath: path.join(this.migrationsDir, entry.name),
      }))
      .sort((a, b) => a.version.localeCompare(b.version));

    const existing = await this.pool.query(`SELECT version FROM ${this.table("schema_migrations")}`);
    const existingVersions = new Set(existing.rows.map((row: Record<string, unknown>) => String(row.version)));

    return migrations.filter((migration) => !existingVersions.has(migration.version));
  }

  private async saveExecutionWithClient(client: QueryClient, input: SaveExecutionInput): Promise<PersistedExecution> {
    const executionId = randomUUID();
    const table = this.table("executions");
    const status = input.result.ok ? "ok" : "error";
    await client.query(
      `INSERT INTO ${table}
       (id, task_id, project_id, status, command, command_line, exit_code, duration_ms, stdout, stderr, error, started_at, finished_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        executionId,
        input.task_id,
        input.project_id,
        status,
        input.result.command,
        input.result.command_line,
        input.result.exit_code,
        input.result.duration_ms,
        input.result.stdout,
        input.result.stderr,
        input.result.error,
        input.result.started_at,
        input.result.finished_at,
        nowIso(),
      ],
    );

    return {
      id: executionId,
      task_id: input.task_id,
      project_id: input.project_id,
    };
  }

  private async saveExecutionArtifactWithClient(
    client: QueryClient,
    input: SaveExecutionArtifactInput,
  ): Promise<PersistedExecutionArtifact> {
    const artifactId = randomUUID();
    const table = this.table("execution_artifacts");
    await client.query(
      `INSERT INTO ${table} (id, execution_id, project_id, artifact_type, content, metadata_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        artifactId,
        input.execution_id,
        input.project_id,
        input.artifact_type,
        input.content,
        JSON.stringify(input.metadata),
        nowIso(),
      ],
    );

    return {
      id: artifactId,
      execution_id: input.execution_id,
    };
  }

  private async saveEventWithClient(client: QueryClient, input: SaveEventInput): Promise<PersistedEvent> {
    const eventId = randomUUID();
    const table = this.table("events");
    await client.query(
      `INSERT INTO ${table}
       (id, project_id, task_id, execution_id, event_type, severity, message, payload_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        eventId,
        input.project_id,
        input.task_id,
        input.execution_id,
        input.event_type,
        input.severity,
        input.message,
        JSON.stringify(input.payload),
        nowIso(),
      ],
    );

    return {
      id: eventId,
      project_id: input.project_id,
    };
  }
}
