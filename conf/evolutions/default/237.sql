# --- !Ups
ALTER TABLE validation_task_interaction
    ADD COLUMN source TEXT NOT NULL DEFAULT 'ValidateDesktop';

UPDATE validation_task_interaction
SET source = 'ValidateMobile'
WHERE is_mobile = TRUE;

ALTER TABLE validation_task_interaction
    ALTER COLUMN source DROP DEFAULT,
    DROP COLUMN is_mobile;

# --- !Downs
ALTER TABLE validation_task_interaction
    ADD COLUMN is_mobile BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE validation_task_interaction
SET is_mobile = TRUE
WHERE source = 'ValidateMobile';

ALTER TABLE validation_task_interaction
    DROP COLUMN source;
