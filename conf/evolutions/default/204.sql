# --- !Ups
ALTER TABLE label ALTER COLUMN temporaryLabelId SET NOT NULL;

ALTER TABLE AuditTaskInteractionTable ALTER COLUMN temporaryLabelId SET NOT NULL;

# --- !Downs
ALTER TABLE label ALTER COLUMN temporaryLabelId SET NULL;

ALTER TABLE audit_task_interaction ALTER COLUMN temporaryLabelId SET NULL;
