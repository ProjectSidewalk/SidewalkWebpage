-- 168 added audit_task.current_mission_id (the mission a task was last worked in) with no backfill; on mainline it
-- filled in as users kept auditing. DC's tasks are all historical, so fill it from the placement patches/16.sql
-- recorded (issue #4700).
UPDATE audit_task SET current_mission_id = tm.mission_id
FROM dc_migration_task_mission tm WHERE tm.audit_task_id = audit_task.audit_task_id;
