# --- !Ups
ALTER TABLE audit_task_environment
    ADD COLUMN css_zoom INT NOT NULL DEFAULT 100,
    ADD COLUMN timestamp TIMESTAMPTZ;

ALTER TABLE validation_task_environment
    ADD COLUMN css_zoom INT NOT NULL DEFAULT 100,
    ADD COLUMN timestamp TIMESTAMPTZ;

# --- !Downs
ALTER TABLE validation_task_environment
    DROP COLUMN css_zoom,
    DROP COLUMN timestamp;

ALTER TABLE audit_task_environment
    DROP COLUMN css_zoom,
    DROP COLUMN timestamp;
