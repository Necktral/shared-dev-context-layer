ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS retrieval_context_ref text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS warnings_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timeout boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS outcome_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS seq_no bigint,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE TABLE IF NOT EXISTS project_run_locks (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  lock_id text NOT NULL,
  owner text NOT NULL,
  acquired_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  command text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(project_id, command, idempotency_key)
);

CREATE TABLE IF NOT EXISTS task_state_transitions (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  reason text NOT NULL,
  execution_id text REFERENCES executions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_execution_seq
  ON events(execution_id, seq_no)
  WHERE execution_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_project_type_idempotency
  ON events(project_id, event_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_project_state_created
  ON tasks(project_id, lifecycle_state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_executions_project_created_desc
  ON executions(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_idempotency_project_command_key
  ON idempotency_records(project_id, command, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_task_state_transitions_task_created
  ON task_state_transitions(task_id, created_at DESC);
