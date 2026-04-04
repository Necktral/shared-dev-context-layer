ALTER TABLE files
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_indexed_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE index_runs
  ADD COLUMN IF NOT EXISTS scanned_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS modified_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chunk_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_files_project_deleted ON files(project_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_index_runs_project_created_desc ON index_runs(project_id, created_at DESC);
