# --- !Ups
DELETE FROM validation_task_comment WHERE timestamp IS NULL;

ALTER TABLE validation_task_comment ALTER COLUMN timestamp SET NOT NULL;

# --- !Downs
ALTER TABLE validation_task_comment ALTER COLUMN timestamp DROP NOT NULL;
