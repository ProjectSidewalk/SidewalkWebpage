# --- !Ups
ALTER TABLE audit_task
    ADD COLUMN current_mission_id INT,
    ADD COLUMN current_mission_start geometry(Point, 4326),
    ADD FOREIGN KEY (current_mission_id) REFERENCES mission(mission_id);

# --- !Downs
ALTER TABLE audit_task
    DROP COLUMN current_mission_id,
    DROP COLUMN current_mission_start;
