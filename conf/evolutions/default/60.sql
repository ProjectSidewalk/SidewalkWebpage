# --- !Ups
ALTER TABLE validation_task_interaction
  ADD is_mobile BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE label_validation
  ADD is_mobile BOOLEAN NOT NULL DEFAULT FALSE;


# --- !Downs
ALTER TABLE label_validation
  DROP COLUMN is_mobile;

ALTER TABLE validation_task_interaction
  DROP COLUMN is_mobile;
