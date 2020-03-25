# --- !Ups
ALTER TABLE audit_task_environment ADD COLUMN language TEXT NOT NULL DEFAULT 'en';

# --- !Downs
ALTER TABLE audit_task_environment DROP COLUMN language;
