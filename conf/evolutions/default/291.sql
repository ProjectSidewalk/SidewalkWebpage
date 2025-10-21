# --- !Ups
ALTER TABLE label_point ALTER COLUMN zoom TYPE DOUBLE PRECISION;
ALTER TABLE audit_task_interaction ALTER COLUMN zoom TYPE DOUBLE PRECISION;

# --- !Downs
ALTER TABLE audit_task_interaction ALTER COLUMN zoom TYPE INTEGER USING round(zoom)::integer;
ALTER TABLE label_point ALTER COLUMN zoom TYPE INTEGER USING round(zoom)::integer;
