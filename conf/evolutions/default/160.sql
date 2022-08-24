# --- !Ups
ALTER TABLE audit_task
    ADD COLUMN mission_id INT,
    ADD COLUMN mission_start geometry(Point, 4326),
    ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

# --- !Downs
ALTER TABLE audit_task
    DROP COLUMN mission_id,
    DROP COLUMN mission_start;
    