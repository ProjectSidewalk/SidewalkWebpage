# --- !Ups
ALTER TABLE audit_task
    ADD COLUMN mission_id INT,
    ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

# --- !Downs
ALTER TABLE audit_task
    DROP COLUMN mission_id;