CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  project_key text NOT NULL UNIQUE,
  operation_profile text NOT NULL,
  workspace_root text,
  repo_root text,
  branch text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_operation_profile ON projects(operation_profile);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);

CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path text NOT NULL,
  content_hash text,
  language text,
  size_bytes bigint,
  modified_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files(updated_at DESC);

CREATE TABLE IF NOT EXISTS file_chunks (
  id text PRIMARY KEY,
  file_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  content_hash text,
  embedding_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(file_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_file_chunks_project_id ON file_chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_file_chunks_embedding_status ON file_chunks(embedding_status);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  objective text NOT NULL,
  context_summary text,
  status text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);

CREATE TABLE IF NOT EXISTS task_context (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  summary text,
  candidate_files jsonb NOT NULL,
  constraints jsonb NOT NULL,
  acceptance_criteria jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_context_task_id ON task_context(task_id);
CREATE INDEX IF NOT EXISTS idx_task_context_project_id ON task_context(project_id);

CREATE TABLE IF NOT EXISTS executions (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL,
  command text NOT NULL,
  command_line text NOT NULL,
  exit_code integer,
  duration_ms integer,
  stdout text,
  stderr text,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_executions_project_id ON executions(project_id);
CREATE INDEX IF NOT EXISTS idx_executions_task_id ON executions(task_id);
CREATE INDEX IF NOT EXISTS idx_executions_created_at ON executions(created_at DESC);

CREATE TABLE IF NOT EXISTS execution_artifacts (
  id text PRIMARY KEY,
  execution_id text NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_type text NOT NULL,
  content text NOT NULL,
  metadata_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_execution_artifacts_execution_id ON execution_artifacts(execution_id);
CREATE INDEX IF NOT EXISTS idx_execution_artifacts_project_id ON execution_artifacts(project_id);

CREATE TABLE IF NOT EXISTS decisions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  statement text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decisions_project_id ON decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id text REFERENCES tasks(id) ON DELETE SET NULL,
  execution_id text REFERENCES executions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  severity text NOT NULL,
  message text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id);
CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_execution_id ON events(execution_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);

CREATE TABLE IF NOT EXISTS index_runs (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL,
  summary text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_index_runs_project_id ON index_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_index_runs_created_at ON index_runs(created_at DESC);
