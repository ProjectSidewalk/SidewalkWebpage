# --- !Ups
ALTER TABLE audit_task ADD COLUMN current_lat DOUBLE PRECISION;
ALTER TABLE audit_task ADD COLUMN current_lng DOUBLE PRECISION;
ALTER TABLE audit_task ADD COLUMN start_point_reversed BOOLEAN DEFAULT FALSE;

UPDATE audit_task
SET current_lat = y2, current_lng = x2
FROM street_edge
WHERE audit_task.street_edge_id = street_edge.street_edge_id
  AND completed = FALSE;

UPDATE audit_task
SET current_lat = y1, current_lng = x1
FROM street_edge
WHERE audit_task.street_edge_id = street_edge.street_edge_id
  AND completed = TRUE;

ALTER TABLE audit_task ALTER COLUMN current_lat SET NOT NULL;
ALTER TABLE audit_task ALTER COLUMN current_lng SET NOT NULL;


ALTER TABLE mission
    ADD COLUMN current_audit_task_id INT,
    ADD CONSTRAINT mission_current_audit_task_id_fkey FOREIGN KEY (current_audit_task_id) REFERENCES audit_task(audit_task_id);

# --- !Downs
ALTER TABLE mission
    DROP CONSTRAINT IF EXISTS mission_current_audit_task_id_fkey,
    DROP COLUMN current_audit_task_id;


ALTER TABLE audit_task DROP COLUMN start_point_reversed;
ALTER TABLE audit_task DROP COLUMN current_lat;
ALTER TABLE audit_task DROP COLUMN current_lng;
