# --- !Ups

ALTER TABLE validation_task_interaction
  ADD is_mobile INT;

# --- !Downs

ALTER TABLE validation_task_interaction
  DROP COLUMN is_mobile;