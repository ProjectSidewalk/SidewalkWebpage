-- Final shaping of a replayed DC sandbox, run by harness/postclean.sh after the audit tables were exported and
-- /tmp/dc-play-evolutions.csv was written from the reference schema (issue #4700).
SET search_path TO sidewalk, sidewalk_login, public;

DROP INDEX IF EXISTS dc_tmp_street_edge_geom_idx;
DROP INDEX IF EXISTS dc_tmp_ate_task_idx;
DROP INDEX IF EXISTS dc_tmp_wa_ip_idx;
ALTER TABLE street_edge_region DROP CONSTRAINT IF EXISTS dc_tmp_one_region_per_street;
DROP TABLE IF EXISTS dc_old_label_metadata_backup;
DROP TABLE IF EXISTS dc_migration_anon_user;
DROP TABLE IF EXISTS dc_migration_dropped_label;
DROP TABLE IF EXISTS dc_migration_dropped_task;
DROP TABLE IF EXISTS dc_migration_nulled_label_point;
DROP TABLE IF EXISTS dc_migration_street_region_dropped;
DROP TABLE IF EXISTS dc_migration_stub_pano;
DROP TABLE IF EXISTS dc_migration_event;
DROP TABLE IF EXISTS dc_migration_label_time;
DROP TABLE IF EXISTS dc_migration_legacy_mission;
DROP TABLE IF EXISTS dc_migration_legacy_mission_user;
DROP TABLE IF EXISTS dc_migration_milestone;
DROP TABLE IF EXISTS dc_migration_task_mission;
DROP TABLE IF EXISTS dc_migration_mission;
DROP TABLE IF EXISTS dc_migration_parent_edge;
DROP TABLE IF EXISTS dc_migration_osm_way_pick;

-- Three indexes every prod city carries that no evolution creates (added by hand on the server at some point).
CREATE INDEX IF NOT EXISTS label_mission_id_idx ON label (mission_id);
CREATE INDEX IF NOT EXISTS mission_user_id_idx ON mission (user_id);
CREATE INDEX IF NOT EXISTS mission_time_end_idx ON mission (mission_end);

-- play_evolutions: DC's own rows 1-14 stay (byte-identical to mainline); 15.. are the reference schema's rows, so
-- Play sees the mainline scripts and hashes it will compare against the repo files.
DELETE FROM play_evolutions WHERE id >= 15;
\copy play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) FROM '/tmp/dc-play-evolutions.csv' CSV
UPDATE play_evolutions SET applied_at = now() WHERE id >= 15;

ANALYZE;

SELECT 'play_evolutions' AS what, count(*) AS n, max(id) AS max_id FROM play_evolutions;
