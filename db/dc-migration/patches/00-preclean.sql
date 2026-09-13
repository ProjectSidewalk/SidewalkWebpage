-- DC-fork reconciliation before replaying mainline evolutions 15.. (issue #4700).
-- Applied by replay.sh --reset immediately after cloning the baseline. Every step here is a decision Mikey made on
-- 2026-09-02 about the legacy data itself; the mechanical fork fix-ups are at the bottom.
SET search_path TO sidewalk, public;

-- DC's custom evolutions 15-19 diverge from mainline; the replay restarts at mainline 15.
DELETE FROM play_evolutions WHERE id >= 15;

-- DC's fork created the version table (its evo 15); mainline 20.sql recreates it and the chain re-seeds every
-- version row from 21 onward.
DROP TABLE version;

-- ---------------------------------------------------------------------------------------------------------------
-- The original 192 neighborhoods (region_id 0-191) were superseded by the finer 179-region set (195-373) before
-- Sept 2016: no MissionComplete event ever names one, and nothing but street_edge_region, region_property and the
-- legacy mission table (dropped by 16) references them. Remove them so every later region choice is among the
-- neighborhoods DC actually showed.
DELETE FROM mission_user WHERE mission_id IN (SELECT mission_id FROM mission JOIN region USING (region_id) WHERE region.deleted);
DELETE FROM mission WHERE region_id IN (SELECT region_id FROM region WHERE deleted);
DELETE FROM street_edge_region WHERE region_id IN (SELECT region_id FROM region WHERE deleted);
DELETE FROM region_property WHERE region_id IN (SELECT region_id FROM region WHERE deleted);
DELETE FROM region WHERE deleted;

-- DC never split streets at neighborhood boundaries, so 2,321 streets sit in more than one live region. Modern
-- schemas have exactly one region per street (338 adds UNIQUE (street_edge_id)), and mission synthesis needs one
-- region per task. Keep the region holding the largest share of the street's geometry; ties go to the lowest id.
-- The dropped pairs are kept in dc_migration_street_region_dropped for the post-clean report.
CREATE TABLE dc_migration_street_region_dropped AS
SELECT ser.street_edge_region_id, ser.street_edge_id, ser.region_id
FROM street_edge_region ser
WHERE ser.street_edge_region_id NOT IN (
  SELECT DISTINCT ON (ser2.street_edge_id) ser2.street_edge_region_id
  FROM street_edge_region ser2
  JOIN region ON region.region_id = ser2.region_id
  JOIN street_edge ON street_edge.street_edge_id = ser2.street_edge_id
  ORDER BY ser2.street_edge_id, ST_Length(ST_Intersection(street_edge.geom, region.geom)) DESC, ser2.region_id
);
DELETE FROM street_edge_region WHERE street_edge_region_id IN (SELECT street_edge_region_id FROM dc_migration_street_region_dropped);
ALTER TABLE street_edge_region ADD CONSTRAINT dc_tmp_one_region_per_street UNIQUE (street_edge_id);

-- 154 anonymous-user audit tasks have no audit_task_environment row: bursts of duplicate rows sharing one
-- task_start, none with a label. They are the residue of a bug, not work; drop them and everything that hangs off
-- them (a dc_migration_dropped_task list survives for the report).
CREATE TABLE dc_migration_dropped_task AS
SELECT audit_task.audit_task_id, audit_task.user_id, audit_task.street_edge_id, audit_task.task_start
FROM audit_task
WHERE audit_task.user_id = '97760883-8ef0-4309-9a5e-0c086ef27573'
  AND NOT EXISTS (SELECT 1 FROM audit_task_environment WHERE audit_task_environment.audit_task_id = audit_task.audit_task_id)
  AND NOT EXISTS (SELECT 1 FROM label WHERE label.audit_task_id = audit_task.audit_task_id);
DELETE FROM audit_task_interaction WHERE audit_task_id IN (SELECT audit_task_id FROM dc_migration_dropped_task);
DELETE FROM audit_task_incomplete WHERE audit_task_id IN (SELECT audit_task_id FROM dc_migration_dropped_task);
DELETE FROM audit_task WHERE audit_task_id IN (SELECT audit_task_id FROM dc_migration_dropped_task);

-- The 2015-era tables had no FKs; a couple of side-table rows reference audit_tasks that no longer exist, and two
-- user_role rows name users that don't (no user row, no data). The eventual FK adds (16, 252's login split, 337)
-- require them gone, and they describe rows that are already gone.
DELETE FROM audit_task_incomplete WHERE NOT EXISTS
  (SELECT 1 FROM audit_task WHERE audit_task.audit_task_id = audit_task_incomplete.audit_task_id);
DELETE FROM user_role WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE "user".user_id = user_role.user_id);
-- 130 label_point rows (label ids 21-150, the first days of the pilot) have no label; 337's FK add needs them gone.
DELETE FROM label_point WHERE NOT EXISTS (SELECT 1 FROM label WHERE label.label_id = label_point.label_id);

-- ---------------------------------------------------------------------------------------------------------------
-- DC's evo 17 made its own old_label_metadata (label_id, old_sv_image_x, old_sv_image_y) holding the TRUE pre-CV-fix
-- coordinates (which are byte-identical to the live ones: the fix never applied). Move it out of 179's way;
-- patches/179.sql copies these values into the mainline-shaped table for provenance. Its FK to label goes too:
-- 298 deletes labels and only knows to clear mainline's old_label_metadata first.
ALTER TABLE old_label_metadata RENAME TO dc_old_label_metadata_backup;
ALTER TABLE dc_old_label_metadata_backup DROP CONSTRAINT old_label_metadata_label_id_fkey;

-- DC's evo 15 backported mainline 135 minus center_heading; add it so the sandbox matches the exact post-135 state
-- (135 is then skipped, and 149's unguarded DROP COLUMN center_heading works).
ALTER TABLE gsv_data ADD COLUMN center_heading FLOAT;

-- Perf: 28.sql's nearest-street backfill does a spatial scan per label; the official gist index only arrives at
-- 270.sql. Temp index, dropped by the post-clean.
CREATE INDEX dc_tmp_street_edge_geom_idx ON street_edge USING gist (geom);

-- pg_restore doesn't analyze; give the planner real stats before the data-migration evolutions.
ANALYZE;

-- Report.
SELECT 'regions kept' AS what, count(*) FROM region
UNION ALL SELECT 'street_edge_region pairs dropped', count(*) FROM dc_migration_street_region_dropped
UNION ALL SELECT 'streets with a region', count(*) FROM street_edge_region
UNION ALL SELECT 'ip-less anon tasks dropped', count(*) FROM dc_migration_dropped_task
UNION ALL SELECT 'audit tasks', count(*) FROM audit_task
UNION ALL SELECT 'labels', count(*) FROM label;
