-- DC-fork reconciliation before replaying mainline evolutions 15..343 (issue #4700).
-- Applied by replay.sh --reset immediately after restoring the legacy dump.
SET search_path TO sidewalk, public;

-- DC's custom evolutions 15-19 diverge from mainline; the replay restarts at mainline 15.
DELETE FROM play_evolutions WHERE id >= 15;

-- DC's fork created the version table (its evo 15); mainline 20.sql recreates it and the chain
-- re-seeds every version row from 21 onward.
DROP TABLE version;

-- DC's evo 17 made its own old_label_metadata (label_id, old_sv_image_x, old_sv_image_y) holding
-- the TRUE pre-CV-fix coordinates. Move it out of 179's way; patches/179.sql copies these values
-- into the mainline-shaped table for provenance. Dropped by 999-postclean once verified.
ALTER TABLE old_label_metadata RENAME TO dc_old_label_metadata_backup;

-- DC's evo 15 backported mainline 135 minus center_heading; add it so the sandbox matches the
-- exact post-135 state (135 is then skipped, and 149's unguarded DROP COLUMN center_heading works).
ALTER TABLE gsv_data ADD COLUMN center_heading FLOAT;

-- Perf: 28.sql's nearest-street backfill does a spatial scan per label; the official gist index
-- only arrives at 270.sql. Temp index, dropped by 999-postclean.
CREATE INDEX dc_tmp_street_edge_geom_idx ON street_edge USING gist (geom);

-- pg_restore doesn't analyze; give the planner real stats before the data-migration evolutions.
ANALYZE;
