# --- !Ups
UPDATE label SET temporary_label_id = -1 WHERE temporary_label_id IS NULL;
ALTER TABLE label ALTER COLUMN temporary_label_id SET NOT NULL;

UPDATE audit_task_interaction SET temporary_label_id = -1 WHERE temporary_label_id IS NULL;
ALTER TABLE audit_task_interaction ALTER COLUMN temporary_label_id SET NOT NULL;

# --- !Downs
ALTER TABLE label ALTER COLUMN temporary_label_id SET NULL;

ALTER TABLE audit_task_interaction ALTER COLUMN temporary_label_id SET NULL;
