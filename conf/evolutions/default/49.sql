# --- !Ups
ALTER TABLE mission
    ADD COLUMN current_audit_task_id INT,
    ADD CONSTRAINT mission_current_audit_task_id_fkey FOREIGN KEY (current_audit_task_id) REFERENCES audit_task(audit_task_id);

# --- !Downs
ALTER TABLE mission
    DROP CONSTRAINT IF EXISTS mission_current_audit_task_id_fkey,
    DROP COLUMN current_audit_task_id;
