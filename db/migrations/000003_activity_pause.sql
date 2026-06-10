-- B-07: pause/resume accounting on activities. Training time excludes paused
-- intervals: effective seconds = (completed_at - started_at) - paused_seconds.
ALTER TABLE activities
    ADD COLUMN IF NOT EXISTS paused_seconds BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
