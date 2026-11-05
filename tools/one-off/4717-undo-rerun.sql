-- =====================================================================================================================
-- Undo the second run of 4717-consolidate-tiny-streets.sql (#4717). Written against evolution 419.
--
-- On 2026-10-22 the consolidation script ran a second time on ten cities. That copy could not see junctions the first
-- run had already joined a street through, so it joined cross streets across them. This puts every street that run
-- touched back the way the 2026-10-20 nightly backup has it, which is after the first run and before the second:
--   * The streets it joined away come back with their old id and line, the ones it grew go back to their old line, and
--     the ones it disabled as too short open again. Their regions, priority, imagery, OSM ways, gradients, sidewalk
--     presence and access scores come back from the backup too, and so does the status history of the restored ones.
--   * Audits, labels, comments, issues, clusters, places, label-position backups and route stops that were on those
--     streets go back to the street, completed flag and position the backup has.
--   * The rest changed after the backup was taken. An audit picked up again since goes back to its old street and is
--     completed if it was then, is now, or logged a TaskEnd before the run. One started since goes to the stretch most
--     of its panos sit on, completed the same way. A new label goes to the nearest stretch, as the app files labels;
--     new comments, clusters and places too. An issue goes with its audit, and a route made since gets a stop per
--     stretch it walks.
--   * The empty audits that run deleted stay deleted, and its rows in street_edge_merge go.
-- Afterwards: recompute street priority (/adminapi/recalculateStreetPriority) in each city, then run
-- street-gradient-backfill.sh and osm-lineage-backfill.sh naming these cities.
--
-- The backup rows come in one restore file per city. To make them:
--   1. On the server, 4717-undo-extract-backup.sh pulls the ten cities out of the nightly dump; load that locally into
--      a database of its own (sidewalk_pre4717).
--   2. Run 4717-undo-rerun-list.sql on prod (it lists the streets the run touched, with its timestamp).
--   3. 4717-undo-make-restore-files.sh <that CSV> 4717-undo-restore writes 4717-undo-restore/<city>.sql.
-- Copy the folder next to current-query.sql. This reads 4717-undo-restore/<city>.sql and stops if it's missing, if
-- it doesn't match the run it finds, or if there's nothing left to undo.
--
-- DRY RUN BY DEFAULT: everything runs in a transaction that is rolled back, and one summary row per city is
-- printed. Built for sidewalk-server-tools/run-query-in-every-city.sh (-m -c "<the ten cities>"): send it a copy with
-- `\set apply 1` in place of the default below. For one city by hand, from the folder holding 4717-undo-restore/:
--   psql "dbname=sidewalk options=--search_path=sidewalk_st_louis,public" -U sidewalk_st_louis \
--     -v city=st_louis -v apply=0 -f 4717-undo-rerun.sql
-- =====================================================================================================================

\set QUIET on
\if :{?apply}
\else
  \set apply 0
\endif

-- The fleet runner opens every connection read-only; temp tables need this off even for a dry run.
SET default_transaction_read_only = off;
BEGIN;
-- Someone auditing a touched street can block this; give up rather than hold the app up, and rerun the city.
SET LOCAL lock_timeout = '10s';

\set restore_file 4717-undo-restore/ :city .sql
\ir :restore_file

-- 1. Every row one run wrote shares its timestamp, so matching on it never mistakes a later run's joins for this one's.
CREATE TEMP TABLE touched (id INTEGER PRIMARY KEY, kind TEXT, survivor_id INTEGER) ON COMMIT DROP;
INSERT INTO touched SELECT street_edge_id, kind, survivor_street_edge_id FROM pre_list;
ANALYZE touched;
CREATE TEMP TABLE bad_merge (street_edge_merge_id INTEGER PRIMARY KEY, id INTEGER, survivor_id INTEGER) ON COMMIT DROP;
INSERT INTO bad_merge
SELECT street_edge_merge_id, dropped_street_edge_id, survivor_street_edge_id
FROM street_edge_merge
WHERE merged_at = :'bad_run_at'::timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM bad_merge) THEN
    RAISE EXCEPTION 'none of the run''s joins are left; has this undo already been applied?';
  END IF;
  IF EXISTS (SELECT id, survivor_id FROM bad_merge
             EXCEPT SELECT id, survivor_id FROM touched WHERE kind = 'dropped')
     OR EXISTS (SELECT id, survivor_id FROM touched WHERE kind = 'dropped'
                EXCEPT SELECT id, survivor_id FROM bad_merge) THEN
    RAISE EXCEPTION 'the restore file lists different joins than street_edge_merge has for that run';
  END IF;
  IF EXISTS (SELECT FROM touched WHERE NOT EXISTS (SELECT FROM pre_street_edge
                                                   WHERE pre_street_edge.street_edge_id = touched.id)) THEN
    RAISE EXCEPTION 'the restore file is missing some of the streets the run touched';
  END IF;
  IF EXISTS (SELECT FROM touched JOIN street_edge ON street_edge.street_edge_id = touched.id
             WHERE touched.kind = 'dropped') THEN
    RAISE EXCEPTION 'a street the run joined away exists again';
  END IF;
END $$;

-- 2. The stretches of each grown street: its own old line and each street it took in, each knowing whether it runs
--    against the grown line. Used to place what was added after the backup, and to move positions along the line.
CREATE TEMP TABLE grown (id INTEGER PRIMARY KEY, joined_geom geometry, joined_m DOUBLE PRECISION) ON COMMIT DROP;
INSERT INTO grown
SELECT street_edge.street_edge_id, street_edge.geom, ST_Length(street_edge.geom::geography)
FROM street_edge
WHERE street_edge.street_edge_id IN (SELECT id FROM touched WHERE kind = 'grown');
ANALYZE grown;
CREATE TEMP TABLE part (part_id INTEGER PRIMARY KEY, grown_id INTEGER, own BOOLEAN, geom geometry,
                        m DOUBLE PRECISION, reversed BOOLEAN) ON COMMIT DROP;
INSERT INTO part
SELECT pre_street_edge.street_edge_id, grown.id, pre_street_edge.street_edge_id = grown.id, pre_street_edge.geom,
       ST_Length(pre_street_edge.geom::geography),
       ST_LineLocatePoint(grown.joined_geom, ST_StartPoint(pre_street_edge.geom))
         > ST_LineLocatePoint(grown.joined_geom, ST_EndPoint(pre_street_edge.geom))
FROM touched
JOIN grown ON grown.id = coalesce(touched.survivor_id, touched.id)
JOIN pre_street_edge ON pre_street_edge.street_edge_id = touched.id
WHERE touched.kind IN ('grown', 'dropped');
CREATE INDEX ON part (grown_id);
ANALYZE part;

-- A distance along the grown line, as the same point's distance along one of its stretches.
CREATE FUNCTION pg_temp.along_part(m DOUBLE PRECISION, joined geometry, joined_m DOUBLE PRECISION, part_geom geometry,
                                   part_m DOUBLE PRECISION) RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE AS $$
  SELECT ST_LineLocatePoint(part_geom,
                            ST_LineInterpolatePoint(joined, least(1.0, greatest(0.0, m / NULLIF(joined_m, 0)))))
         * part_m
$$;

-- 3. Audits. "Untouched since" means its task_end is what the backup has: the app moves task_end on every save.
CREATE TEMP TABLE task_fix (audit_task_id INTEGER PRIMARY KEY, how TEXT, from_grown_id INTEGER, part_id INTEGER,
                            was_completed BOOLEAN, completed BOOLEAN, by_task_end BOOLEAN DEFAULT FALSE)
  ON COMMIT DROP;
INSERT INTO task_fix (audit_task_id, was_completed, how, from_grown_id, part_id)
SELECT audit_task.audit_task_id, audit_task.completed,
       CASE WHEN pre_audit_task.audit_task_id IS NULL THEN 'late'
            WHEN audit_task.task_end IS NOT DISTINCT FROM pre_audit_task.task_end THEN 'quiet'
            ELSE 'active' END,
       grown.id, pre_audit_task.street_edge_id
FROM audit_task
LEFT JOIN pre_audit_task ON pre_audit_task.audit_task_id = audit_task.audit_task_id
LEFT JOIN grown ON grown.id = audit_task.street_edge_id
WHERE pre_audit_task.audit_task_id IS NOT NULL OR grown.id IS NOT NULL;
ANALYZE task_fix;

-- An audit started after the backup goes to the stretch most of its distinct panos sit on (ties to the street's own
-- stretch), or the one nearest where it last stood.
WITH pano AS (
  SELECT DISTINCT ON (audit_task_interaction.audit_task_id, audit_task_interaction.pano_id)
         audit_task_interaction.audit_task_id,
         ST_SetSRID(ST_MakePoint(audit_task_interaction.lng, audit_task_interaction.lat), 4326) AS pt
  FROM audit_task_interaction
  WHERE audit_task_interaction.audit_task_id IN (SELECT audit_task_id FROM task_fix WHERE how = 'late')
    AND audit_task_interaction.lat IS NOT NULL AND audit_task_interaction.lng IS NOT NULL
  ORDER BY audit_task_interaction.audit_task_id, audit_task_interaction.pano_id, audit_task_interaction.timestamp
), vote AS (
  SELECT pano.audit_task_id, nearest.part_id, count(*) AS panos
  FROM pano
  JOIN task_fix USING (audit_task_id)
  CROSS JOIN LATERAL (SELECT part.part_id FROM part WHERE part.grown_id = task_fix.from_grown_id
                      ORDER BY ST_DistanceSphere(part.geom, pano.pt), NOT part.own LIMIT 1) AS nearest
  GROUP BY pano.audit_task_id, nearest.part_id
)
UPDATE task_fix
SET part_id = coalesce(
  (SELECT vote.part_id FROM vote JOIN part USING (part_id)
   WHERE vote.audit_task_id = task_fix.audit_task_id
   ORDER BY vote.panos DESC, NOT part.own, vote.part_id LIMIT 1),
  (SELECT part.part_id FROM part, audit_task
   WHERE part.grown_id = task_fix.from_grown_id AND audit_task.audit_task_id = task_fix.audit_task_id
   ORDER BY ST_DistanceSphere(part.geom,
                              ST_SetSRID(ST_MakePoint(audit_task.current_lng, audit_task.current_lat), 4326)),
            NOT part.own
   LIMIT 1),
  task_fix.from_grown_id)
WHERE task_fix.how = 'late';

-- Completed: what the backup says for an untouched audit. For one worked on since, also if it is completed now or
-- logged a TaskEnd before the run, since only the run took completion away.
UPDATE task_fix SET by_task_end = TRUE
WHERE task_fix.how <> 'quiet'
  AND EXISTS (SELECT FROM audit_task_interaction
              WHERE audit_task_interaction.audit_task_id = task_fix.audit_task_id
                AND audit_task_interaction.action = 'TaskEnd'
                AND audit_task_interaction.timestamp < :'bad_run_at'::timestamptz);
UPDATE task_fix
SET completed = CASE WHEN task_fix.how = 'quiet' THEN pre_audit_task.completed
                     ELSE coalesce(pre_audit_task.completed, FALSE) OR audit_task.completed OR task_fix.by_task_end END
FROM audit_task
LEFT JOIN pre_audit_task ON pre_audit_task.audit_task_id = audit_task.audit_task_id
WHERE audit_task.audit_task_id = task_fix.audit_task_id;

-- 4. Labels: back to the backup's street, or for one made since, the nearest stretch (the app's rule), falling back
--    to its audit's stretch when it has no position.
CREATE TEMP TABLE label_fix (label_id INTEGER PRIMARY KEY, from_id INTEGER, to_id INTEGER, late BOOLEAN)
  ON COMMIT DROP;
INSERT INTO label_fix
SELECT label.label_id, label.street_edge_id, pre_label.street_edge_id, FALSE
FROM label JOIN pre_label ON pre_label.label_id = label.label_id;
INSERT INTO label_fix
SELECT label.label_id, label.street_edge_id,
       coalesce((SELECT part.part_id FROM part, label_point
                 WHERE part.grown_id = label.street_edge_id AND label_point.label_id = label.label_id
                   AND label_point.geom IS NOT NULL
                 ORDER BY ST_DistanceSphere(part.geom, label_point.geom), NOT part.own LIMIT 1),
                (SELECT task_fix.part_id FROM task_fix
                 WHERE task_fix.audit_task_id = label.audit_task_id AND task_fix.from_grown_id = label.street_edge_id),
                label.street_edge_id),
       TRUE
FROM label
WHERE label.street_edge_id IN (SELECT id FROM grown)
  AND NOT EXISTS (SELECT FROM pre_label WHERE pre_label.label_id = label.label_id);

-- Comments, issues, clusters and places the same way: the backup's street, else the nearest stretch (an issue has no
-- position, so it goes with the audit its user was on at the time).
CREATE TEMP TABLE comment_fix (audit_task_comment_id INTEGER PRIMARY KEY, to_id INTEGER, late BOOLEAN) ON COMMIT DROP;
INSERT INTO comment_fix
SELECT audit_task_comment.audit_task_comment_id, pre_audit_task_comment.edge_id, FALSE
FROM audit_task_comment
JOIN pre_audit_task_comment ON pre_audit_task_comment.audit_task_comment_id = audit_task_comment.audit_task_comment_id;
INSERT INTO comment_fix
SELECT audit_task_comment.audit_task_comment_id,
       coalesce((SELECT part.part_id FROM part
                 WHERE part.grown_id = audit_task_comment.edge_id
                   AND audit_task_comment.lat IS NOT NULL AND audit_task_comment.lng IS NOT NULL
                 ORDER BY ST_DistanceSphere(part.geom, ST_SetSRID(ST_MakePoint(audit_task_comment.lng,
                                                                               audit_task_comment.lat), 4326)),
                          NOT part.own
                 LIMIT 1),
                (SELECT task_fix.part_id FROM task_fix
                 WHERE task_fix.audit_task_id = audit_task_comment.audit_task_id
                   AND task_fix.from_grown_id = audit_task_comment.edge_id),
                audit_task_comment.edge_id),
       TRUE
FROM audit_task_comment
WHERE audit_task_comment.edge_id IN (SELECT id FROM grown)
  AND NOT EXISTS (SELECT FROM pre_audit_task_comment
                  WHERE pre_audit_task_comment.audit_task_comment_id = audit_task_comment.audit_task_comment_id);

CREATE TEMP TABLE issue_fix (street_edge_issue_id INTEGER PRIMARY KEY, to_id INTEGER, late BOOLEAN) ON COMMIT DROP;
INSERT INTO issue_fix
SELECT street_edge_issue.street_edge_issue_id, pre_street_edge_issue.street_edge_id, FALSE
FROM street_edge_issue
JOIN pre_street_edge_issue ON pre_street_edge_issue.street_edge_issue_id = street_edge_issue.street_edge_issue_id;
INSERT INTO issue_fix
SELECT street_edge_issue.street_edge_issue_id,
       coalesce((SELECT task_fix.part_id
                 FROM audit_task JOIN task_fix ON task_fix.audit_task_id = audit_task.audit_task_id
                 WHERE task_fix.from_grown_id = street_edge_issue.street_edge_id
                   AND audit_task.user_id = street_edge_issue.user_id
                   AND street_edge_issue.timestamp BETWEEN audit_task.task_start - interval '5 seconds'
                                                       AND audit_task.task_end + interval '5 seconds'
                 ORDER BY audit_task.task_start DESC
                 LIMIT 1),
                street_edge_issue.street_edge_id),
       TRUE
FROM street_edge_issue
WHERE street_edge_issue.street_edge_id IN (SELECT id FROM grown)
  AND NOT EXISTS (SELECT FROM pre_street_edge_issue
                  WHERE pre_street_edge_issue.street_edge_issue_id = street_edge_issue.street_edge_issue_id);

-- The nightly clustering may have rebuilt clusters since, so an id the backup doesn't know is placed by position.
CREATE TEMP TABLE cluster_fix (cluster_id INTEGER PRIMARY KEY, to_id INTEGER, late BOOLEAN) ON COMMIT DROP;
INSERT INTO cluster_fix
SELECT cluster.cluster_id, pre_cluster.street_edge_id, FALSE
FROM cluster JOIN pre_cluster ON pre_cluster.cluster_id = cluster.cluster_id;
INSERT INTO cluster_fix
SELECT cluster.cluster_id,
       (SELECT part.part_id FROM part WHERE part.grown_id = cluster.street_edge_id
        ORDER BY ST_DistanceSphere(part.geom, cluster.geom), NOT part.own LIMIT 1),
       TRUE
FROM cluster
WHERE cluster.street_edge_id IN (SELECT id FROM grown)
  AND NOT EXISTS (SELECT FROM pre_cluster WHERE pre_cluster.cluster_id = cluster.cluster_id);

CREATE TEMP TABLE place_fix (place_id INTEGER PRIMARY KEY, to_id INTEGER, distance_m DOUBLE PRECISION, late BOOLEAN)
  ON COMMIT DROP;
INSERT INTO place_fix
SELECT place.place_id, pre_place.nearest_street_edge_id, pre_place.nearest_street_distance_m, FALSE
FROM place JOIN pre_place ON pre_place.place_id = place.place_id;
INSERT INTO place_fix
SELECT place.place_id, nearest.part_id, ST_Distance(place.geom::geography, nearest.geom::geography), TRUE
FROM place
CROSS JOIN LATERAL (SELECT part.part_id, part.geom FROM part WHERE part.grown_id = place.nearest_street_edge_id
                    ORDER BY ST_DistanceSphere(part.geom, place.geom), NOT part.own LIMIT 1) AS nearest
WHERE place.nearest_street_edge_id IN (SELECT id FROM grown)
  AND NOT EXISTS (SELECT FROM pre_place WHERE pre_place.place_id = place.place_id);

-- 5. Routes made after the backup. A stop on a grown street walks the stretches from where the route arrives to where
--    it leaves: the previous stop's far end and the next stop's near end, each matched to the nearest joint. A route's
--    first or last stop has nothing to match on that side, so it keeps the stretches out to the street's end there.
--    Routes the backup has are simply put back (step 7).
CREATE TEMP TABLE route_stop ON COMMIT DROP AS
SELECT route_street.route_street_id, route_street.route_id, route_street.position, route_street.street_edge_id,
       route_street.reverse,
       CASE WHEN route_street.reverse THEN ST_StartPoint(street_edge.geom) ELSE ST_EndPoint(street_edge.geom) END
         AS exit_pt,
       CASE WHEN route_street.reverse THEN ST_EndPoint(street_edge.geom) ELSE ST_StartPoint(street_edge.geom) END
         AS entry_pt
FROM route_street
JOIN street_edge ON street_edge.street_edge_id = route_street.street_edge_id
WHERE route_street.route_id IN (SELECT route_street.route_id FROM route_street
                                WHERE route_street.street_edge_id IN (SELECT id FROM grown))
  AND route_street.route_id NOT IN (SELECT route_id FROM pre_route);
CREATE TEMP TABLE route_stop_part ON COMMIT DROP AS
WITH stop AS (
  SELECT route_stop.*,
         lag(route_stop.exit_pt) OVER walk AS arrive_pt,
         lead(route_stop.entry_pt) OVER walk AS leave_pt
  FROM route_stop
  WINDOW walk AS (PARTITION BY route_stop.route_id ORDER BY route_stop.position, route_stop.route_street_id)
), placed AS (
  -- Each stretch's place along the grown line in the direction the route walks it (0 where the walk starts), with
  -- the points where the walk enters and leaves it.
  SELECT stop.route_street_id, part.part_id, part.own, stop.reverse <> part.reversed AS reverse,
         stop.arrive_pt, stop.leave_pt, walk.lo AS walk_lo, walk.hi AS walk_hi,
         ST_LineInterpolatePoint(grown.joined_geom, CASE WHEN stop.reverse THEN 1 - walk.lo ELSE walk.lo END)
           AS walk_in_pt,
         ST_LineInterpolatePoint(grown.joined_geom, CASE WHEN stop.reverse THEN 1 - walk.hi ELSE walk.hi END)
           AS walk_out_pt
  FROM stop
  JOIN grown ON grown.id = stop.street_edge_id
  JOIN part ON part.grown_id = grown.id
  CROSS JOIN LATERAL (
    SELECT least(ST_LineLocatePoint(grown.joined_geom, ST_StartPoint(part.geom)),
                 ST_LineLocatePoint(grown.joined_geom, ST_EndPoint(part.geom))) AS lo,
           greatest(ST_LineLocatePoint(grown.joined_geom, ST_StartPoint(part.geom)),
                    ST_LineLocatePoint(grown.joined_geom, ST_EndPoint(part.geom))) AS hi
  ) AS along
  CROSS JOIN LATERAL (
    SELECT CASE WHEN stop.reverse THEN 1 - along.hi ELSE along.lo END AS lo,
           CASE WHEN stop.reverse THEN 1 - along.lo ELSE along.hi END AS hi
  ) AS walk
), walk_from AS (
  SELECT DISTINCT ON (route_street_id) route_street_id, walk_lo AS from_at
  FROM placed
  ORDER BY route_street_id,
           CASE WHEN arrive_pt IS NULL THEN walk_lo ELSE ST_Distance(arrive_pt::geography, walk_in_pt::geography) END,
           walk_lo
), walk_to AS (
  SELECT DISTINCT ON (route_street_id) route_street_id, walk_hi AS to_at
  FROM placed
  ORDER BY route_street_id,
           CASE WHEN leave_pt IS NULL THEN -walk_hi ELSE ST_Distance(leave_pt::geography, walk_out_pt::geography) END,
           walk_hi DESC
)
-- A stop whose two ends match the wrong way round keeps every stretch.
SELECT placed.route_street_id, placed.part_id, placed.own, placed.reverse,
       row_number() OVER (PARTITION BY placed.route_street_id ORDER BY placed.walk_lo) AS step
FROM placed
JOIN walk_from USING (route_street_id)
JOIN walk_to USING (route_street_id)
WHERE walk_from.from_at > walk_to.to_at
   OR (placed.walk_lo >= walk_from.from_at - 1e-9 AND placed.walk_hi <= walk_to.to_at + 1e-9);

-- 6. Write the streets. Only the run's disabled streets take the backup's status; a grown one may have had a
--    legitimate status change since.
UPDATE street_edge
SET geom = pre_street_edge.geom, x1 = pre_street_edge.x1, y1 = pre_street_edge.y1, x2 = pre_street_edge.x2,
    y2 = pre_street_edge.y2, way_type = pre_street_edge.way_type,
    status = CASE WHEN pre_street_edge.street_edge_id IN (SELECT id FROM touched WHERE kind = 'disabled')
                  THEN pre_street_edge.status ELSE street_edge.status END
FROM pre_street_edge
WHERE street_edge.street_edge_id = pre_street_edge.street_edge_id;
INSERT INTO street_edge
SELECT * FROM pre_street_edge WHERE street_edge_id IN (SELECT id FROM touched WHERE kind = 'dropped');

-- Each table holding facts about a street gets the backup's rows for every touched street in place of its own. A row
-- id here is never pointed at from elsewhere, so the backup's rows take fresh ones; the counter is brought up to the
-- table first, since a restored schema can leave it behind.
CREATE FUNCTION pg_temp.fresh_id_sequence(tbl regclass, col TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  seq TEXT;
  top BIGINT;
BEGIN
  SELECT substring(pg_get_expr(pg_attrdef.adbin, pg_attrdef.adrelid) FROM 'nextval\(''([^'']+)''') INTO seq
  FROM pg_attrdef
  JOIN pg_attribute ON pg_attribute.attrelid = pg_attrdef.adrelid AND pg_attribute.attnum = pg_attrdef.adnum
  WHERE pg_attrdef.adrelid = tbl AND pg_attribute.attname = col;
  EXECUTE format('SELECT max(%I) FROM %s', col, tbl) INTO top;
  PERFORM setval(seq, coalesce(top, 0) + 1, false);
  RETURN seq;
END $$;

SELECT pg_temp.fresh_id_sequence('street_edge_region', 'street_edge_region_id') AS seq \gset
UPDATE pre_street_edge_region SET street_edge_region_id = nextval(:'seq');
DELETE FROM street_edge_region WHERE street_edge_id IN (SELECT id FROM touched);
INSERT INTO street_edge_region SELECT * FROM pre_street_edge_region;

SELECT pg_temp.fresh_id_sequence('street_edge_priority', 'street_edge_priority_id') AS seq \gset
UPDATE pre_street_edge_priority SET street_edge_priority_id = nextval(:'seq');
DELETE FROM street_edge_priority WHERE street_edge_id IN (SELECT id FROM touched);
INSERT INTO street_edge_priority SELECT * FROM pre_street_edge_priority;

SELECT pg_temp.fresh_id_sequence('osm_way_street_edge', 'osm_way_street_edge_id') AS seq \gset
UPDATE pre_osm_way_street_edge SET osm_way_street_edge_id = nextval(:'seq');
DELETE FROM osm_way_street_edge WHERE street_edge_id IN (SELECT id FROM touched);
INSERT INTO osm_way_street_edge SELECT * FROM pre_osm_way_street_edge;

SELECT pg_temp.fresh_id_sequence('street_access_score', 'street_access_score_id') AS seq \gset
UPDATE pre_street_access_score SET street_access_score_id = nextval(:'seq');
DELETE FROM street_access_score WHERE street_edge_id IN (SELECT id FROM touched);
INSERT INTO street_access_score SELECT * FROM pre_street_access_score;

DELETE FROM street_imagery WHERE street_edge_id IN (SELECT id FROM touched);
INSERT INTO street_imagery SELECT * FROM pre_street_imagery;
DELETE FROM street_gradient WHERE street_edge_id IN (SELECT id FROM touched);
INSERT INTO street_gradient SELECT * FROM pre_street_gradient;
DELETE FROM sidewalk_presence WHERE street_edge_id IN (SELECT id FROM touched);
INSERT INTO sidewalk_presence SELECT * FROM pre_sidewalk_presence;

-- History and admin state is only added back for the streets that were deleted; the rest kept theirs. The run's own
-- status changes go, since the statuses they recorded are undone.
-- The counter is set before the DELETE: it survives a rollback, which brings the deleted rows back.
SELECT pg_temp.fresh_id_sequence('street_edge_status_change', 'street_edge_status_change_id') AS seq \gset
DELETE FROM street_edge_status_change
WHERE source = 'consolidate_tiny_streets' AND changed_at = :'bad_run_at'::timestamptz;
UPDATE pre_street_edge_status_change SET street_edge_status_change_id = nextval(:'seq');
INSERT INTO street_edge_status_change
SELECT * FROM pre_street_edge_status_change WHERE street_edge_id IN (SELECT id FROM touched WHERE kind = 'dropped');
INSERT INTO street_reopen_candidate
SELECT * FROM pre_street_reopen_candidate WHERE street_edge_id IN (SELECT id FROM touched WHERE kind = 'dropped');
-- Intersections are rebuilt every night, so only links to intersections that still exist come back.
SELECT pg_temp.fresh_id_sequence('intersection_street_edge', 'intersection_street_edge_id') AS seq \gset
UPDATE pre_intersection_street_edge SET intersection_street_edge_id = nextval(:'seq');
INSERT INTO intersection_street_edge
SELECT * FROM pre_intersection_street_edge
WHERE street_edge_id IN (SELECT id FROM touched WHERE kind = 'dropped')
  AND intersection_id IN (SELECT intersection_id FROM intersection);

-- 7. Write everything that sits on a street. A started-since audit's start turns around if its stretch runs against
--    the grown line; one picked up again keeps the backup's start, which was set on its own street.
UPDATE audit_task
SET street_edge_id = pre_audit_task.street_edge_id, completed = pre_audit_task.completed,
    start_point_reversed = pre_audit_task.start_point_reversed, start_offset_m = pre_audit_task.start_offset_m,
    covered_ranges = pre_audit_task.covered_ranges, audited_distance_m = pre_audit_task.audited_distance_m
FROM task_fix
JOIN pre_audit_task USING (audit_task_id)
WHERE audit_task.audit_task_id = task_fix.audit_task_id AND task_fix.how = 'quiet';
UPDATE audit_task
SET street_edge_id = task_fix.part_id, completed = task_fix.completed,
    start_point_reversed = CASE WHEN task_fix.how = 'active' THEN pre_audit_task.start_point_reversed
                                ELSE audit_task.start_point_reversed <> coalesce(part.reversed, FALSE) END,
    start_offset_m = CASE WHEN audit_task.start_offset_m IS NULL OR grown.id IS NULL OR part.part_id IS NULL
                            THEN audit_task.start_offset_m
                          ELSE pg_temp.along_part(audit_task.start_offset_m, grown.joined_geom, grown.joined_m,
                                                  part.geom, part.m) END,
    covered_ranges = CASE WHEN grown.id IS NULL OR part.part_id IS NULL
                            OR jsonb_typeof(audit_task.covered_ranges) IS DISTINCT FROM 'array'
                            THEN audit_task.covered_ranges
                          ELSE (SELECT coalesce(jsonb_agg(jsonb_build_array(moved.a, moved.b) ORDER BY moved.a),
                                                '[]'::jsonb)
                                FROM jsonb_array_elements(audit_task.covered_ranges) AS seen (pair)
                                CROSS JOIN LATERAL (
                                  SELECT pg_temp.along_part((seen.pair ->> 0)::float, grown.joined_geom, grown.joined_m,
                                                            part.geom, part.m) AS x,
                                         pg_temp.along_part((seen.pair ->> 1)::float, grown.joined_geom, grown.joined_m,
                                                            part.geom, part.m) AS y
                                ) AS located
                                CROSS JOIN LATERAL (SELECT round(least(located.x, located.y)::numeric, 1) AS a,
                                                           round(greatest(located.x, located.y)::numeric, 1) AS b
                                ) AS moved
                                WHERE moved.b > moved.a) END
FROM task_fix
LEFT JOIN pre_audit_task USING (audit_task_id)
LEFT JOIN grown ON grown.id = task_fix.from_grown_id
LEFT JOIN part ON part.part_id = task_fix.part_id AND part.grown_id = task_fix.from_grown_id
WHERE audit_task.audit_task_id = task_fix.audit_task_id AND task_fix.how <> 'quiet';
UPDATE audit_task
SET audited_distance_m = coalesce((SELECT sum((pair ->> 1)::float - (pair ->> 0)::float)
                                   FROM jsonb_array_elements(audit_task.covered_ranges) AS pair), 0)
WHERE audit_task.audit_task_id IN (SELECT audit_task_id FROM task_fix WHERE how <> 'quiet')
  AND jsonb_typeof(audit_task.covered_ranges) = 'array';

UPDATE label SET street_edge_id = label_fix.to_id
FROM label_fix WHERE label.label_id = label_fix.label_id AND label.street_edge_id <> label_fix.to_id;
UPDATE label_point
SET centerline_offset_m = label_centerline_offset_m(label_point.geom, street_edge.geom)
FROM label, street_edge
WHERE label_point.label_id = label.label_id
  AND street_edge.street_edge_id = label.street_edge_id
  AND label.street_edge_id IN (SELECT id FROM touched)
  AND label_point.geom IS NOT NULL;
UPDATE old_label_point_coords SET street_edge_id = pre_old_label_point_coords.street_edge_id
FROM pre_old_label_point_coords
WHERE old_label_point_coords.label_point_id = pre_old_label_point_coords.label_point_id;
UPDATE old_label_point_position SET street_edge_id = pre_old_label_point_position.street_edge_id
FROM pre_old_label_point_position
WHERE old_label_point_position.label_point_id = pre_old_label_point_position.label_point_id;

UPDATE audit_task_comment SET edge_id = comment_fix.to_id
FROM comment_fix WHERE audit_task_comment.audit_task_comment_id = comment_fix.audit_task_comment_id;
UPDATE street_edge_issue SET street_edge_id = issue_fix.to_id
FROM issue_fix WHERE street_edge_issue.street_edge_issue_id = issue_fix.street_edge_issue_id;
UPDATE cluster SET street_edge_id = cluster_fix.to_id
FROM cluster_fix WHERE cluster.cluster_id = cluster_fix.cluster_id;
UPDATE place SET nearest_street_edge_id = place_fix.to_id, nearest_street_distance_m = place_fix.distance_m
FROM place_fix WHERE place.place_id = place_fix.place_id;

-- Routes the backup has get its stops back as they were, including the repeats the run deleted (with their old ids,
-- which the walks recorded against them name). (route_id, position) is unique and never negative, so every touched
-- route first moves out of the way, past any real position.
UPDATE route_street SET position = 1000000 + route_street.position
WHERE route_street.route_id IN (SELECT route_id FROM pre_route UNION SELECT route_id FROM route_stop);
UPDATE route_street
SET street_edge_id = pre_route_street.street_edge_id, reverse = pre_route_street.reverse,
    position = pre_route_street.position
FROM pre_route_street
WHERE route_street.route_street_id = pre_route_street.route_street_id;
INSERT INTO route_street
SELECT * FROM pre_route_street
WHERE NOT EXISTS (SELECT FROM route_street WHERE route_street.route_street_id = pre_route_street.route_street_id);
UPDATE audit_task_user_route SET route_street_id = pre_audit_task_user_route.route_street_id
FROM pre_audit_task_user_route
WHERE audit_task_user_route.audit_task_user_route_id = pre_audit_task_user_route.audit_task_user_route_id;

-- A route made since keeps its stop's row for one stretch (its own, else the first it walks) and gains a row per other
-- stretch; then the route is numbered again in walking order.
CREATE TEMP TABLE route_stop_keep ON COMMIT DROP AS
SELECT DISTINCT ON (route_street_id) route_street_id, part_id, reverse, step
FROM route_stop_part ORDER BY route_street_id, own DESC, step;
CREATE TEMP TABLE route_stop_new ON COMMIT DROP AS
SELECT row_number() OVER (ORDER BY route_stop_part.route_street_id, route_stop_part.step) AS n,
       route_stop.route_id, route_stop.position, route_stop_part.step, route_stop_part.part_id,
       route_stop_part.reverse
FROM route_stop_part
JOIN route_stop USING (route_street_id)
WHERE NOT EXISTS (SELECT FROM route_stop_keep WHERE route_stop_keep.route_street_id = route_stop_part.route_street_id
                  AND route_stop_keep.part_id = route_stop_part.part_id);
CREATE TEMP TABLE route_order ON COMMIT DROP AS
SELECT route_stop.route_street_id, route_stop.route_id, route_stop.position, coalesce(route_stop_keep.step, 0) AS step
FROM route_stop LEFT JOIN route_stop_keep USING (route_street_id);
UPDATE route_street SET street_edge_id = route_stop_keep.part_id, reverse = route_stop_keep.reverse
FROM route_stop_keep WHERE route_street.route_street_id = route_stop_keep.route_street_id;
WITH added AS (
  INSERT INTO route_street (route_id, street_edge_id, reverse, position)
  SELECT route_id, part_id, reverse, 2000000 + n FROM route_stop_new
  RETURNING route_street_id, route_id, position
)
INSERT INTO route_order (route_street_id, route_id, position, step)
SELECT added.route_street_id, added.route_id, route_stop_new.position, route_stop_new.step
FROM added JOIN route_stop_new ON 2000000 + route_stop_new.n = added.position;
UPDATE route_street SET position = renumbered.position
FROM (
  SELECT route_order.route_street_id,
         row_number() OVER (PARTITION BY route_order.route_id
                            ORDER BY route_order.position, route_order.step, route_order.route_street_id)
           - 1 + min(route_order.position) OVER (PARTITION BY route_order.route_id) AS position
  FROM route_order
) AS renumbered
WHERE route_street.route_street_id = renumbered.route_street_id;

-- A walk recorded since against a stop on a different stretch than its audit now sits on moves to the same route's
-- stop for the audit's stretch.
CREATE TEMP TABLE route_stop_now ON COMMIT DROP AS
SELECT route_street.route_street_id, route_street.route_id, route_street.street_edge_id, route_street.position
FROM route_street
WHERE route_street.route_id IN (SELECT route_id FROM pre_route UNION SELECT route_id FROM route_stop);
CREATE TEMP TABLE walk_fix ON COMMIT DROP AS
SELECT audit_task_user_route.audit_task_user_route_id,
       (SELECT route_stop_now.route_street_id FROM route_stop_now
        WHERE route_stop_now.route_id = route_street.route_id AND route_stop_now.street_edge_id = task_fix.part_id
        ORDER BY route_stop_now.position LIMIT 1) AS to_id
FROM audit_task_user_route
JOIN task_fix ON task_fix.audit_task_id = audit_task_user_route.audit_task_id AND task_fix.how <> 'quiet'
JOIN route_street ON route_street.route_street_id = audit_task_user_route.route_street_id
WHERE route_street.route_id IN (SELECT route_id FROM route_stop_now)
  AND route_street.street_edge_id <> task_fix.part_id
  AND NOT EXISTS (SELECT FROM pre_audit_task_user_route
                  WHERE pre_audit_task_user_route.audit_task_user_route_id
                        = audit_task_user_route.audit_task_user_route_id);
UPDATE audit_task_user_route SET route_street_id = walk_fix.to_id
FROM walk_fix
WHERE audit_task_user_route.audit_task_user_route_id = walk_fix.audit_task_user_route_id AND walk_fix.to_id IS NOT NULL;

UPDATE route
SET distance_meters = pre_route.distance_meters, street_count = pre_route.street_count
FROM pre_route WHERE route.route_id = pre_route.route_id;
UPDATE route
SET distance_meters = coalesce(stats.distance_meters, 0), street_count = coalesce(stats.street_count, 0)
FROM (
  SELECT route_street.route_id, sum(ST_Length(street_edge.geom::geography)) AS distance_meters,
         count(*) AS street_count
  FROM route_street
  JOIN street_edge ON street_edge.street_edge_id = route_street.street_edge_id
  WHERE route_street.route_id IN (SELECT route_id FROM route_stop)
  GROUP BY route_street.route_id
) AS stats
WHERE route.route_id = stats.route_id;

-- 8. The run's trace goes. Region completion refills on the next landing-page load; emptying it locks the table, so a
--    dry run leaves it alone.
DELETE FROM street_edge_merge WHERE street_edge_merge_id IN (SELECT street_edge_merge_id FROM bad_merge);
\if :apply
  TRUNCATE TABLE region_completion;
\endif

-- 9. Summary, one row. The check_ columns should all be 0, and an apply only commits if they are.
CREATE TEMP TABLE summary ON COMMIT DROP AS
SELECT :'city' AS city,
       :apply::int = 1 AS applied,
       (SELECT count(*) FROM bad_merge) AS bad_joins,
       (SELECT count(*) FROM grown) AS grown_streets,
       (SELECT count(*) FROM touched WHERE kind = 'dropped') AS streets_restored,
       (SELECT count(*) FROM touched WHERE kind = 'disabled') AS streets_reopened,
       (SELECT count(*) FROM task_fix WHERE how = 'quiet') AS audits_from_backup,
       (SELECT count(*) FROM task_fix WHERE how = 'active') AS audits_worked_on_since,
       (SELECT count(*) FROM task_fix WHERE how = 'late') AS audits_started_since,
       (SELECT count(*) FROM task_fix WHERE completed AND NOT was_completed) AS audits_completed_again,
       (SELECT count(*) FROM task_fix
          WHERE completed AND NOT was_completed AND how <> 'quiet' AND by_task_end
            AND NOT EXISTS (SELECT FROM pre_audit_task
                            WHERE pre_audit_task.audit_task_id = task_fix.audit_task_id AND pre_audit_task.completed))
         AS completed_again_by_task_end,
       (SELECT count(*) FROM task_fix WHERE was_completed AND NOT completed) AS check_audits_uncompleted,
       (SELECT count(*) FROM pre_audit_task
          WHERE NOT EXISTS (SELECT FROM audit_task WHERE audit_task.audit_task_id = pre_audit_task.audit_task_id))
         AS empty_audits_left_deleted,
       (SELECT count(*) FROM label_fix WHERE NOT late AND from_id <> to_id) AS labels_moved_back,
       (SELECT count(*) FROM label_fix WHERE late) AS labels_made_since,
       (SELECT count(*) FROM comment_fix WHERE late) AS comments_made_since,
       (SELECT count(*) FROM issue_fix WHERE late) AS issues_made_since,
       (SELECT count(*) FROM cluster_fix WHERE late) AS clusters_made_since,
       (SELECT count(*) FROM place_fix WHERE late) AS places_made_since,
       (SELECT count(*) FROM pre_route) AS routes_from_backup,
       (SELECT count(DISTINCT route_id) FROM route_stop) AS routes_made_since,
       (SELECT count(*) FROM route_stop_new) AS route_stops_added,
       -- A grown line that doesn't come to its stretches' lengths (give or take a meter a joint) changed between the
       -- backup and the run, so the backup's lines for it can't be trusted.
       (SELECT count(*) FROM grown
          WHERE abs(grown.joined_m - (SELECT sum(part.m) FROM part WHERE part.grown_id = grown.id))
                > 1.0 + (SELECT count(*) FROM part WHERE part.grown_id = grown.id)) AS check_lines_dont_add_up,
       (SELECT count(*) FROM touched
          WHERE NOT EXISTS (SELECT FROM street_edge JOIN pre_street_edge USING (street_edge_id)
                            WHERE street_edge.street_edge_id = touched.id
                              AND ST_Equals(street_edge.geom, pre_street_edge.geom)
                              AND (touched.kind <> 'disabled' OR street_edge.status = pre_street_edge.status)))
         AS check_streets_not_restored,
       (SELECT count(*) FROM task_fix WHERE part_id IS NULL) AS check_audits_unplaced,
       (SELECT count(*) FROM route_street WHERE position >= 1000000) AS check_route_stops_unplaced,
       (SELECT count(*) FROM pre_route_street JOIN route_street USING (route_street_id)
          WHERE route_street.route_id <> pre_route_street.route_id) AS check_route_stop_ids_taken,
       (SELECT count(*) FROM label
          WHERE NOT EXISTS (SELECT FROM street_edge WHERE street_edge.street_edge_id = label.street_edge_id))
         AS check_labels_on_no_street;
SELECT * FROM summary;

\if :apply
  DO $$
  BEGIN
    IF EXISTS (SELECT FROM summary, jsonb_each_text(to_jsonb(summary)) AS col
               WHERE col.key LIKE 'check\_%' AND col.value <> '0') THEN
      RAISE EXCEPTION 'a check_ column is not 0, so nothing was changed';
    END IF;
  END $$;
  COMMIT;
\else
  ROLLBACK;
\endif
