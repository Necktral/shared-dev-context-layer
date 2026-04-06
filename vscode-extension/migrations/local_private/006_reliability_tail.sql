ALTER TABLE idempotency_records
  ADD COLUMN IF NOT EXISTS claim_id text,
  ADD COLUMN IF NOT EXISTS owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

UPDATE idempotency_records
SET status = 'completed'
WHERE status IN ('ok', 'error', 'blocked');

UPDATE idempotency_records
SET started_at = COALESCE(started_at, created_at),
    finished_at = COALESCE(finished_at, updated_at)
WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_idempotency_lease_expires_at
  ON idempotency_records(lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_idempotency_status
  ON idempotency_records(status);
