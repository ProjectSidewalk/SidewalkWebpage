# --- !Ups
ALTER TABLE audit_task
    ADD COLUMN low_quality BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN incomplete BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN stale BOOLEAN NOT NULL DEFAULT FALSE;

# --- !Downs
ALTER TABLE validation_task_environment
    DROP COLUMN low_quality,
    DROP COLUMN incomplete,
    DROP COLUMN stale;
