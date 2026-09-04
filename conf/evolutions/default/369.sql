# --- !Ups
ALTER TABLE user_route ADD COLUMN paused BOOLEAN NOT NULL DEFAULT FALSE;

-- Three queries filter audit_task_user_route by user_route_id, and an FK constraint doesn't index its column.
CREATE INDEX audit_task_user_route_user_route_id_idx ON audit_task_user_route (user_route_id);

# --- !Downs
DROP INDEX audit_task_user_route_user_route_id_idx;

ALTER TABLE user_route DROP COLUMN paused;
