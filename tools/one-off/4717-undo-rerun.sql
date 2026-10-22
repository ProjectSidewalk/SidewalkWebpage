-- =====================================================================================================================
-- Undo the second run of 4717-consolidate-tiny-streets.sql (#4717). Written against evolution 419.
--
-- On 2026-10-22 the consolidation script ran a second time on ten cities. That copy could not see junctions the first
-- run had already joined a street through, so it joined cross streets across them. This puts every join made on or
-- after -v since= (default 2026-10-21) back the way the first run left it, and leaves the first run's joins alone:
--   * Each street that run removed comes back with its old id and line (street_edge_merge keeps both), and each street
--     it grew is cut back to its own stretch. Region, priority, imagery and OSM way rows come back for the restored
--     streets; the grown street moves back to its old region if the join moved it.
--   * Every audit on a grown street goes to the stretch its labeler actually walked: the stretch most of its panos
--     sit on (from audit_task_interaction), or the one nearest where it stopped. Audits started after the bad run
--     are split the same way. A drop-in's start and a free-exploration audit's covered stretches are re-measured.
--   * Labels follow their audit; a label whose audit is elsewhere goes to the nearest stretch. Comments, issues,
--     clusters, places and the label-position backups follow the same way. A route stop on a grown street becomes
--     stops on the stretches between where the route arrives and where it leaves.
--   * The audits that run marked not completed are marked completed again. Nothing recorded which they were. That
--     run un-completed every completed audit on a street it found short of walked and none on the others, so a grown
--     street with no completed audit left from before it lost all it had; what it had is worked out from the first
--     run. An audit counts as finished before either run when it is completed or logged a TaskEnd, and the first
--     run's rule is replayed (it un-completed every audit on a joined street walked less than -v min_cov= (80%) of
--     its length), with a saved street priority under 1 (see below) as proof that a street kept a finished audit.
--     The summary prints how many audits each run un-completed by this reckoning: check them against the runs' CSVs.
--   * The empty audits that run deleted stay deleted, and its rows in street_edge_merge go. Streets it disabled as
--     too short to keep are opened again.
-- Afterwards: recompute street priority (/adminapi/recalculateStreetPriority) in each city, then run
-- street-gradient-backfill.sh and osm-lineage-backfill.sh (naming these cities, since their positions changed).
--
-- The saved priorities: a CSV of (city, street_edge_id, priority) from before the bad run. Send the runner the CSV
-- loaded into a temp table ahead of this script, so the same file serves every city:
--   { echo 'SET default_transaction_read_only = off;'
--     echo 'CREATE TEMP TABLE priority_snapshot (city TEXT, street_edge_id INTEGER, priority DOUBLE PRECISION);'
--     echo 'COPY priority_snapshot FROM STDIN WITH (FORMAT csv, HEADER);'
--     cat 4717-priority-snapshot.csv; echo '\.'
--     cat tools/one-off/4717-undo-rerun.sql; } > current-query.sql
-- Without it the replay alone decides.
--
-- DRY RUN BY DEFAULT: everything runs in a transaction that is rolled back, and one summary row per city is
-- printed. Built for sidewalk-server-tools/run-query-in-every-city.sh (-m -c "<the ten cities>"): send it a copy with
-- `\set apply 1` in place of the default below. A city with nothing to undo prints zeros. For one city by hand:
--   docker exec -i projectsidewalk-db psql "dbname=sidewalk options=--search_path=sidewalk_st_louis,public" \
--     -U sidewalk_st_louis -v city=st_louis -v apply=0 -f - < tools/one-off/4717-undo-rerun.sql
-- =====================================================================================================================

\set QUIET on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?since}
\else
  \set since '2026-10-21'
\endif
\if :{?touch_m}
\else
  \set touch_m 1.0
\endif
\if :{?min_cov}
\else
  \set min_cov 0.80
\endif

-- The fleet runner opens every connection read-only; temp tables need this off even for a dry run.
SET default_transaction_read_only = off;
SELECT to_regclass('pg_temp.priority_snapshot') IS NOT NULL AS has_snapshot \gset
BEGIN;
-- Without the saved priorities, an empty table stands in, so every rule below reads it the same way.
\if :has_snapshot
\else
CREATE TEMP TABLE priority_snapshot (city TEXT, street_edge_id INTEGER, priority DOUBLE PRECISION) ON COMMIT DROP;
\endif

-- The bad run's joins. The script never wrote a trace for one without a survivor except its deleted residue, and that
-- run deleted none; one showing up here would be a street this script can't put back, so it stops.
CREATE TEMP TABLE bad_merge ON COMMIT DROP AS
SELECT street_edge_merge_id, dropped_street_edge_id AS id, survivor_street_edge_id AS survivor_id, rule,
       dropped_osm_way_id AS osm_way_id, dropped_length_m AS m, dropped_geom AS geom, merged_at
FROM street_edge_merge
WHERE merged_at >= :'since';
DO $$
BEGIN
  IF EXISTS (SELECT FROM bad_merge WHERE survivor_id IS NULL OR rule = 'residue') THEN
    RAISE EXCEPTION 'the run being undone deleted residue streets, which this script does not restore';
  END IF;
  IF EXISTS (SELECT FROM bad_merge JOIN street_edge ON street_edge.street_edge_id = bad_merge.id) THEN
    RAISE EXCEPTION 'a street the run removed exists again; has this undo already been applied?';
  END IF;
END $$;
ALTER TABLE bad_merge ADD PRIMARY KEY (id);
CREATE INDEX ON bad_merge (survivor_id);
ANALYZE bad_merge;

-- When each run happened: everything one run wrote shares its transaction's timestamp.
SELECT coalesce((SELECT min(merged_at) FROM bad_merge), now()) AS bad_run_at,
       coalesce((SELECT min(merged_at) FROM street_edge_merge WHERE merged_at < :'since'), '-infinity') AS first_run_at
\gset

-- 1. The grown streets, and the stretch of each that was its own. Every piece was added at one end, so the pieces
--    cover the line's two ends and the street's own stretch is the gap between them. The cut is snapped to the
--    nearest vertex: the street's own vertices were never moved, so the stretch comes back exactly.
CREATE FUNCTION pg_temp.own_stretch(line geometry, pieces geometry[], touch_m DOUBLE PRECISION) RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  line_m DOUBLE PRECISION := ST_Length(line::geography);
  slack DOUBLE PRECISION := 3 * touch_m / NULLIF(ST_Length(line::geography), 0);
  span RECORD;
  run_lo DOUBLE PRECISION;
  run_hi DOUBLE PRECISION;
  own_lo DOUBLE PRECISION := 0;
  own_hi DOUBLE PRECISION := 1;
  first_vertex INTEGER;
  last_vertex INTEGER;
BEGIN
  IF line_m IS NULL OR line_m = 0 THEN RETURN NULL; END IF;
  -- Merge the pieces' spans along the line into runs; a run must reach one end of the line or the other.
  FOR span IN
    SELECT least(a, b) AS lo, greatest(a, b) AS hi
    FROM unnest(pieces) AS piece (geom)
    CROSS JOIN LATERAL (SELECT ST_LineLocatePoint(line, ST_StartPoint(piece.geom)) AS a,
                               ST_LineLocatePoint(line, ST_EndPoint(piece.geom)) AS b) AS at
    ORDER BY 1
  LOOP
    IF run_lo IS NOT NULL AND span.lo <= run_hi + slack THEN
      run_hi := greatest(run_hi, span.hi);
      CONTINUE;
    END IF;
    IF run_lo IS NOT NULL THEN
      IF run_lo <= slack THEN own_lo := greatest(own_lo, run_hi);
      ELSIF run_hi >= 1 - slack THEN own_hi := least(own_hi, run_lo);
      ELSE RETURN NULL;
      END IF;
    END IF;
    run_lo := span.lo;
    run_hi := span.hi;
  END LOOP;
  IF run_lo IS NOT NULL THEN
    IF run_lo <= slack THEN own_lo := greatest(own_lo, run_hi);
    ELSIF run_hi >= 1 - slack THEN own_hi := least(own_hi, run_lo);
    ELSE RETURN NULL;
    END IF;
  END IF;
  SELECT vertex.path[1] INTO first_vertex FROM ST_DumpPoints(line) AS vertex
  ORDER BY abs(ST_LineLocatePoint(line, vertex.geom) - own_lo), vertex.path[1] LIMIT 1;
  SELECT vertex.path[1] INTO last_vertex FROM ST_DumpPoints(line) AS vertex
  ORDER BY abs(ST_LineLocatePoint(line, vertex.geom) - own_hi), vertex.path[1] DESC LIMIT 1;
  IF first_vertex >= last_vertex THEN RETURN NULL; END IF;
  RETURN (SELECT ST_MakeLine(vertex.geom ORDER BY vertex.path[1]) FROM ST_DumpPoints(line) AS vertex
          WHERE vertex.path[1] BETWEEN first_vertex AND last_vertex);
END $$;

CREATE TEMP TABLE grown ON COMMIT DROP AS
SELECT street_edge.street_edge_id AS id, street_edge.geom AS joined_geom,
       ST_Length(street_edge.geom::geography) AS joined_m, street_edge.status, street_edge.way_type,
       street_edge.timestamp,
       pg_temp.own_stretch(street_edge.geom, (SELECT array_agg(bad_merge.geom) FROM bad_merge
                                              WHERE bad_merge.survivor_id = street_edge.street_edge_id),
                           :touch_m) AS geom
FROM street_edge
WHERE street_edge.street_edge_id IN (SELECT survivor_id FROM bad_merge);
ALTER TABLE grown ADD COLUMN m DOUBLE PRECISION;
UPDATE grown SET m = ST_Length(geom::geography);
-- A cut that doesn't add up (the own stretch plus the pieces should come to the joined length, give or take the
-- touching tolerance at each joint) means the line folds back on itself somewhere; such a street is left joined.
ALTER TABLE grown ADD COLUMN ok BOOLEAN;
UPDATE grown SET ok = geom IS NOT NULL
  AND abs(grown.m + (SELECT sum(bad_merge.m) FROM bad_merge WHERE bad_merge.survivor_id = grown.id) - grown.joined_m)
      <= 2 * :touch_m * (SELECT count(*) FROM bad_merge WHERE bad_merge.survivor_id = grown.id) + 0.5;
ALTER TABLE grown ADD PRIMARY KEY (id);
ANALYZE grown;

-- Every stretch of every grown street: its own, then the pieces, each knowing whether it runs against the grown line.
CREATE TEMP TABLE part ON COMMIT DROP AS
SELECT grown.id AS grown_id, grown.id AS part_id, TRUE AS own, grown.geom, grown.m, FALSE AS reversed,
       NULL::BIGINT AS osm_way_id, NULL::TEXT AS rule
FROM grown WHERE grown.ok
UNION ALL
SELECT bad_merge.survivor_id, bad_merge.id, FALSE, bad_merge.geom, bad_merge.m,
       ST_LineLocatePoint(grown.joined_geom, ST_StartPoint(bad_merge.geom))
         > ST_LineLocatePoint(grown.joined_geom, ST_EndPoint(bad_merge.geom)),
       bad_merge.osm_way_id, bad_merge.rule
FROM bad_merge JOIN grown ON grown.id = bad_merge.survivor_id
WHERE grown.ok;
ALTER TABLE part ADD PRIMARY KEY (part_id);
CREATE INDEX ON part (grown_id);
CREATE INDEX ON part USING gist (geom);
ANALYZE part;

-- 2. Where each audit on a grown street was walked. A pano is counted once per audit; ties go to the street's own
--    stretch, and an audit with no logged pano goes by where it last stood.
CREATE TEMP TABLE grown_task ON COMMIT DROP AS
SELECT audit_task.audit_task_id, audit_task.street_edge_id AS grown_id, audit_task.task_start, audit_task.completed,
       audit_task.start_point_reversed, audit_task.start_offset_m, audit_task.covered_ranges,
       ST_SetSRID(ST_MakePoint(audit_task.current_lng, audit_task.current_lat), 4326) AS last_pt
FROM audit_task
JOIN grown ON grown.id = audit_task.street_edge_id AND grown.ok;
ALTER TABLE grown_task ADD PRIMARY KEY (audit_task_id);
ANALYZE grown_task;

CREATE TEMP TABLE grown_task_part ON COMMIT DROP AS
WITH pano AS (
  SELECT DISTINCT ON (audit_task_interaction.audit_task_id, audit_task_interaction.pano_id)
         audit_task_interaction.audit_task_id,
         ST_SetSRID(ST_MakePoint(audit_task_interaction.lng, audit_task_interaction.lat), 4326) AS pt
  FROM audit_task_interaction
  WHERE audit_task_interaction.audit_task_id IN (SELECT audit_task_id FROM grown_task)
    AND audit_task_interaction.lat IS NOT NULL AND audit_task_interaction.lng IS NOT NULL
  ORDER BY audit_task_interaction.audit_task_id, audit_task_interaction.pano_id, audit_task_interaction.timestamp
), vote AS (
  SELECT pano.audit_task_id, nearest.part_id, count(*) AS panos
  FROM pano
  JOIN grown_task USING (audit_task_id)
  CROSS JOIN LATERAL (SELECT part.part_id FROM part WHERE part.grown_id = grown_task.grown_id
                      ORDER BY part.geom <-> pano.pt, NOT part.own LIMIT 1) AS nearest
  GROUP BY pano.audit_task_id, nearest.part_id
)
SELECT grown_task.audit_task_id, grown_task.grown_id,
       coalesce(best.part_id, by_last.part_id) AS part_id, best.part_id IS NOT NULL AS by_panos,
       coalesce((SELECT count(*) FROM vote WHERE vote.audit_task_id = grown_task.audit_task_id), 0) AS parts_walked
FROM grown_task
LEFT JOIN LATERAL (SELECT vote.part_id FROM vote JOIN part USING (part_id)
                   WHERE vote.audit_task_id = grown_task.audit_task_id
                   ORDER BY vote.panos DESC, NOT part.own, vote.part_id LIMIT 1) AS best ON TRUE
CROSS JOIN LATERAL (SELECT part.part_id FROM part WHERE part.grown_id = grown_task.grown_id
                    ORDER BY part.geom <-> grown_task.last_pt, NOT part.own LIMIT 1) AS by_last;
ALTER TABLE grown_task_part ADD PRIMARY KEY (audit_task_id);
ANALYZE grown_task_part;

-- 3. The replay. "Finished before either run": completed now, or a TaskEnd was logged. The few completed audits that
--    never logged one and that a run un-completed are invisible to it and stay as they are.
CREATE TEMP TABLE finished ON COMMIT DROP AS
SELECT DISTINCT audit_task_interaction.audit_task_id
FROM audit_task_interaction
WHERE audit_task_interaction.action = 'TaskEnd';
ALTER TABLE finished ADD PRIMARY KEY (audit_task_id);
ANALYZE finished;

-- 3a. The first run, on every street it grew, with each as the undo leaves it: a grown street's own stretch, a piece
--     put back, or the street as it is.
CREATE TEMP TABLE first_merge ON COMMIT DROP AS
SELECT dropped_street_edge_id AS id, survivor_street_edge_id AS survivor_id, dropped_length_m AS m,
       dropped_geom AS geom
FROM street_edge_merge
WHERE merged_at < :'since' AND rule <> 'residue';
CREATE INDEX ON first_merge (survivor_id);
ANALYZE first_merge;
CREATE TEMP TABLE first_grown ON COMMIT DROP AS
SELECT first.id, coalesce(part.geom, street_edge.geom) AS geom
FROM (SELECT DISTINCT survivor_id AS id FROM first_merge) AS first
LEFT JOIN part ON part.part_id = first.id
LEFT JOIN street_edge ON street_edge.street_edge_id = first.id
WHERE coalesce(part.geom, street_edge.geom) IS NOT NULL;
ALTER TABLE first_grown ADD COLUMN m DOUBLE PRECISION;
ALTER TABLE first_grown ADD COLUMN own_geom geometry;
UPDATE first_grown SET m = ST_Length(geom::geography),
  own_geom = pg_temp.own_stretch(geom, (SELECT array_agg(first_merge.geom) FROM first_merge
                                        WHERE first_merge.survivor_id = first_grown.id), :touch_m);
ALTER TABLE first_grown ADD PRIMARY KEY (id);
ANALYZE first_grown;
CREATE TEMP TABLE first_part ON COMMIT DROP AS
SELECT first_grown.id AS grown_id, first_grown.id AS part_id, TRUE AS own,
       coalesce(first_grown.own_geom, first_grown.geom) AS geom,
       coalesce(ST_Length(first_grown.own_geom::geography),
                greatest(first_grown.m - (SELECT sum(first_merge.m) FROM first_merge
                                          WHERE first_merge.survivor_id = first_grown.id), 0)) AS m
FROM first_grown
UNION ALL
SELECT first_merge.survivor_id, first_merge.id, FALSE, first_merge.geom, first_merge.m
FROM first_merge JOIN first_grown ON first_grown.id = first_merge.survivor_id;
ALTER TABLE first_part ADD PRIMARY KEY (part_id);
CREATE INDEX ON first_part (grown_id);
ANALYZE first_part;

-- The street each audit started before the first run sits on once the undo is done, and the first run's stretch of
-- it the audit was walked on, found the same way as above.
CREATE TEMP TABLE first_task ON COMMIT DROP AS
SELECT audit_task.audit_task_id, coalesce(grown_task_part.part_id, audit_task.street_edge_id) AS street_id,
       audit_task.completed OR finished.audit_task_id IS NOT NULL AS was_finished,
       ST_SetSRID(ST_MakePoint(audit_task.current_lng, audit_task.current_lat), 4326) AS last_pt
FROM audit_task
LEFT JOIN grown_task_part ON grown_task_part.audit_task_id = audit_task.audit_task_id
LEFT JOIN finished ON finished.audit_task_id = audit_task.audit_task_id
WHERE audit_task.task_start < :'first_run_at'
  AND coalesce(grown_task_part.part_id, audit_task.street_edge_id) IN (SELECT id FROM first_grown);
ALTER TABLE first_task ADD PRIMARY KEY (audit_task_id);
ANALYZE first_task;
CREATE TEMP TABLE first_task_part ON COMMIT DROP AS
WITH pano AS (
  SELECT DISTINCT ON (audit_task_interaction.audit_task_id, audit_task_interaction.pano_id)
         audit_task_interaction.audit_task_id,
         ST_SetSRID(ST_MakePoint(audit_task_interaction.lng, audit_task_interaction.lat), 4326) AS pt
  FROM audit_task_interaction
  WHERE audit_task_interaction.audit_task_id IN (SELECT audit_task_id FROM first_task WHERE was_finished)
    AND audit_task_interaction.lat IS NOT NULL AND audit_task_interaction.lng IS NOT NULL
  ORDER BY audit_task_interaction.audit_task_id, audit_task_interaction.pano_id, audit_task_interaction.timestamp
), vote AS (
  SELECT pano.audit_task_id, nearest.part_id, count(*) AS panos
  FROM pano
  JOIN first_task USING (audit_task_id)
  CROSS JOIN LATERAL (SELECT first_part.part_id FROM first_part WHERE first_part.grown_id = first_task.street_id
                      ORDER BY first_part.geom <-> pano.pt, NOT first_part.own LIMIT 1) AS nearest
  GROUP BY pano.audit_task_id, nearest.part_id
)
SELECT first_task.audit_task_id, first_task.street_id, first_task.was_finished,
       coalesce(best.part_id, by_last.part_id) AS part_id
FROM first_task
LEFT JOIN LATERAL (SELECT vote.part_id FROM vote JOIN first_part USING (part_id)
                   WHERE vote.audit_task_id = first_task.audit_task_id
                   ORDER BY vote.panos DESC, NOT first_part.own, vote.part_id LIMIT 1) AS best ON TRUE
CROSS JOIN LATERAL (SELECT first_part.part_id FROM first_part WHERE first_part.grown_id = first_task.street_id
                    ORDER BY first_part.geom <-> first_task.last_pt, NOT first_part.own LIMIT 1) AS by_last;
ALTER TABLE first_task_part ADD PRIMARY KEY (audit_task_id);
ANALYZE first_task_part;

-- Walked enough under the first run's rule. A saved priority under 1 also settles it: the street still had a finished
-- audit afterwards. A priority of 1 settles nothing, since audits by users the priority doesn't count leave it there.
CREATE TEMP TABLE first_covered ON COMMIT DROP AS
SELECT first_grown.id,
       coalesce((SELECT sum(first_part.m) FROM first_part
                 WHERE first_part.grown_id = first_grown.id
                   AND EXISTS (SELECT FROM first_task_part
                               WHERE first_task_part.part_id = first_part.part_id AND first_task_part.was_finished)),
                0) / NULLIF(first_grown.m, 0) >= :min_cov AS replayed,
       NULL::BOOLEAN AS saved
FROM first_grown;
ALTER TABLE first_covered ADD PRIMARY KEY (id);
UPDATE first_covered SET saved = priority_snapshot.priority < 1.0
FROM priority_snapshot
WHERE priority_snapshot.city = :'city' AND priority_snapshot.street_edge_id = first_covered.id;
ALTER TABLE first_covered ADD COLUMN covered BOOLEAN;
UPDATE first_covered SET covered = coalesce(saved, FALSE) OR replayed;

-- 3b. What each audit on a grown street looked like just before the bad run.
CREATE TEMP TABLE before_bad ON COMMIT DROP AS
SELECT grown_task.audit_task_id, grown_task_part.part_id,
       (grown_task.completed OR finished.audit_task_id IS NOT NULL)
         AND coalesce(first_covered.covered OR grown_task.task_start >= :'first_run_at', TRUE) AS completed
FROM grown_task
JOIN grown_task_part USING (audit_task_id)
LEFT JOIN finished ON finished.audit_task_id = grown_task.audit_task_id
LEFT JOIN first_covered ON first_covered.id = grown_task_part.part_id
WHERE grown_task.task_start < :'bad_run_at';
ALTER TABLE before_bad ADD PRIMARY KEY (audit_task_id);

-- 3c. The bad run's rule needs no replaying: it un-completed every completed audit on a street it found short of
--     walked, and none on the others. So a grown street still holding a completed audit from before that run was
--     covered, and on any other one, every audit that was completed just before it is one it un-completed.
CREATE TEMP TABLE bad_covered ON COMMIT DROP AS
SELECT grown.id,
       EXISTS (SELECT FROM grown_task
               WHERE grown_task.grown_id = grown.id AND grown_task.completed
                 AND grown_task.task_start < :'bad_run_at') AS covered
FROM grown
WHERE grown.ok;
ALTER TABLE bad_covered ADD PRIMARY KEY (id);

-- The audits the bad run un-completed, by the replay.
CREATE TEMP TABLE uncompleted ON COMMIT DROP AS
SELECT before_bad.audit_task_id, grown_task.completed AS completed_now
FROM before_bad
JOIN grown_task USING (audit_task_id)
JOIN bad_covered ON bad_covered.id = grown_task.grown_id
WHERE before_bad.completed AND NOT bad_covered.covered;
ALTER TABLE uncompleted ADD PRIMARY KEY (audit_task_id);

-- 4. Labels and the other things that sit on a street: each follows its audit when the audit is on the same grown
--    street, and otherwise goes to the nearest stretch.
CREATE TEMP TABLE label_part ON COMMIT DROP AS
SELECT label.label_id, label.street_edge_id AS grown_id,
       coalesce(grown_task_part.part_id, nearest.part_id, label.street_edge_id) AS part_id
FROM label
JOIN grown ON grown.id = label.street_edge_id AND grown.ok
LEFT JOIN grown_task_part ON grown_task_part.audit_task_id = label.audit_task_id
                         AND grown_task_part.grown_id = label.street_edge_id
LEFT JOIN label_point ON label_point.label_id = label.label_id
LEFT JOIN LATERAL (SELECT part.part_id FROM part WHERE part.grown_id = label.street_edge_id
                   ORDER BY part.geom <-> label_point.geom, NOT part.own LIMIT 1) AS nearest
  ON label_point.geom IS NOT NULL;
ALTER TABLE label_part ADD PRIMARY KEY (label_id);

CREATE TEMP TABLE comment_part ON COMMIT DROP AS
SELECT audit_task_comment.audit_task_comment_id,
       coalesce(grown_task_part.part_id, nearest.part_id, audit_task_comment.edge_id) AS part_id
FROM audit_task_comment
JOIN grown ON grown.id = audit_task_comment.edge_id AND grown.ok
LEFT JOIN grown_task_part ON grown_task_part.audit_task_id = audit_task_comment.audit_task_id
                         AND grown_task_part.grown_id = audit_task_comment.edge_id
LEFT JOIN LATERAL (SELECT part.part_id FROM part WHERE part.grown_id = audit_task_comment.edge_id
                   ORDER BY part.geom
                              <-> ST_SetSRID(ST_MakePoint(audit_task_comment.lng, audit_task_comment.lat), 4326),
                            NOT part.own
                   LIMIT 1) AS nearest
  ON audit_task_comment.lat IS NOT NULL AND audit_task_comment.lng IS NOT NULL;

-- An issue has no position; it was reported from the audit its user was on at that moment.
CREATE TEMP TABLE issue_part ON COMMIT DROP AS
SELECT street_edge_issue.street_edge_issue_id, coalesce(during.part_id, street_edge_issue.street_edge_id) AS part_id
FROM street_edge_issue
JOIN grown ON grown.id = street_edge_issue.street_edge_id AND grown.ok
LEFT JOIN LATERAL (
  SELECT grown_task_part.part_id
  FROM audit_task
  JOIN grown_task_part ON grown_task_part.audit_task_id = audit_task.audit_task_id
  WHERE audit_task.street_edge_id = street_edge_issue.street_edge_id
    AND audit_task.user_id = street_edge_issue.user_id
    AND street_edge_issue.timestamp BETWEEN audit_task.task_start - interval '5 seconds'
                                        AND coalesce(audit_task.task_end, now()) + interval '5 seconds'
  ORDER BY audit_task.task_start DESC
  LIMIT 1
) AS during ON TRUE;

CREATE TEMP TABLE cluster_part ON COMMIT DROP AS
SELECT cluster.cluster_id, nearest.part_id
FROM cluster
JOIN grown ON grown.id = cluster.street_edge_id AND grown.ok
CROSS JOIN LATERAL (SELECT part.part_id FROM part WHERE part.grown_id = cluster.street_edge_id
                    ORDER BY part.geom <-> cluster.geom, NOT part.own LIMIT 1) AS nearest;

CREATE TEMP TABLE place_part ON COMMIT DROP AS
SELECT place.place_id, nearest.part_id, ST_Distance(place.geom::geography, nearest.geom::geography) AS distance_m
FROM place
JOIN grown ON grown.id = place.nearest_street_edge_id AND grown.ok
CROSS JOIN LATERAL (SELECT part.part_id, part.geom FROM part WHERE part.grown_id = place.nearest_street_edge_id
                    ORDER BY part.geom <-> place.geom, NOT part.own LIMIT 1) AS nearest;

-- 5. Route stops. A stop on a grown street walks the stretches from where the route arrives to where it leaves:
--    the previous stop's far end and the next stop's near end, each matched to the nearest joint. A route's first or
--    last stop has nothing to match on that side, so it keeps the stretches out to the street's end there.
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
                                JOIN grown ON grown.id = route_street.street_edge_id AND grown.ok);
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
  JOIN grown ON grown.id = stop.street_edge_id AND grown.ok
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

-- 6. Write it all.
UPDATE street_edge
SET geom = grown.geom,
    x1 = ST_X(ST_StartPoint(grown.geom)), y1 = ST_Y(ST_StartPoint(grown.geom)),
    x2 = ST_X(ST_EndPoint(grown.geom)), y2 = ST_Y(ST_EndPoint(grown.geom))
FROM grown
WHERE street_edge.street_edge_id = grown.id AND grown.ok;

-- A restored street takes its road type from its own OSM way where the nightly cache knows it, else the grown
-- street's (joins only ever kept the same status).
INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, timestamp, status)
SELECT part.part_id, part.geom, ST_X(ST_StartPoint(part.geom)), ST_Y(ST_StartPoint(part.geom)),
       ST_X(ST_EndPoint(part.geom)), ST_Y(ST_EndPoint(part.geom)),
       coalesce((SELECT enum_value::way_type FROM unnest(enum_range(NULL::way_type)) AS enum_value
                 WHERE enum_value::TEXT = (SELECT osm_way.tags ->> 'highway' FROM osm_way
                                           WHERE osm_way.osm_way_id = part.osm_way_id)),
                grown.way_type),
       grown.timestamp, grown.status
FROM part JOIN grown ON grown.id = part.grown_id
WHERE NOT part.own;

-- A grown street moves back to the region holding most of its own stretch only when the join is what moved it, that
-- is when it now sits where most of the joined line lies.
CREATE TEMP TABLE region_back ON COMMIT DROP AS
SELECT grown.id, own_best.region_id
FROM grown
JOIN street_edge_region ON street_edge_region.street_edge_id = grown.id
CROSS JOIN LATERAL (SELECT region.region_id FROM region
                    WHERE region.geom && grown.joined_geom AND NOT region.deleted
                    ORDER BY ST_Length(ST_Intersection(grown.joined_geom, region.geom)::geography) DESC,
                             region.region_id
                    LIMIT 1) AS joined_best
CROSS JOIN LATERAL (SELECT region.region_id FROM region
                    WHERE region.geom && grown.geom AND NOT region.deleted
                    ORDER BY ST_Length(ST_Intersection(grown.geom, region.geom)::geography) DESC, region.region_id
                    LIMIT 1) AS own_best
WHERE grown.ok AND street_edge_region.region_id = joined_best.region_id AND own_best.region_id <> joined_best.region_id;
UPDATE street_edge_region SET region_id = region_back.region_id
FROM region_back WHERE street_edge_region.street_edge_id = region_back.id;
INSERT INTO street_edge_region (street_edge_id, region_id)
SELECT part.part_id, coalesce(best.region_id, grown_region.region_id)
FROM part
JOIN street_edge_region AS grown_region ON grown_region.street_edge_id = part.grown_id
LEFT JOIN LATERAL (SELECT region.region_id FROM region
                   WHERE region.geom && part.geom AND NOT region.deleted
                   ORDER BY ST_Length(ST_Intersection(part.geom, region.geom)::geography) DESC, region.region_id
                   LIMIT 1) AS best ON TRUE
WHERE NOT part.own;

-- Priority starts unaudited and is set by the next recalculation; imagery is the grown street's, which covered it.
INSERT INTO street_edge_priority (street_edge_id, priority)
SELECT part_id, 1.0 FROM part WHERE NOT own;
INSERT INTO street_imagery (street_edge_id, oldest_capture, newest_capture, n_panos, data_source, updated_at,
                            median_newest_capture)
SELECT part.part_id, street_imagery.oldest_capture, street_imagery.newest_capture, street_imagery.n_panos,
       street_imagery.data_source, street_imagery.updated_at, street_imagery.median_newest_capture
FROM part JOIN street_imagery ON street_imagery.street_edge_id = part.grown_id
WHERE NOT part.own;

-- OSM ways: a restored street gets its own way back (the Infra3d placeholder where the city uses one). The grown
-- street drops each way only a piece brought, unless that would leave it with none; positions are left for the
-- lineage backfill.
SELECT setval(pg_get_serial_sequence('osm_way_street_edge', 'osm_way_street_edge_id'),
              (SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge), false)
  AS osm_way_sequence \gset
CREATE TEMP TABLE piece_way ON COMMIT DROP AS
SELECT part.grown_id, part.part_id, coalesce(part.osm_way_id, placeholder.osm_way_id) AS osm_way_id, part.rule
FROM part
LEFT JOIN LATERAL (SELECT osm_way_street_edge.osm_way_id FROM osm_way_street_edge
                   WHERE osm_way_street_edge.street_edge_id = part.grown_id AND osm_way_street_edge.osm_way_id = -1
                   LIMIT 1) AS placeholder ON TRUE
WHERE NOT part.own;
DELETE FROM osm_way_street_edge
USING (SELECT DISTINCT grown_id, osm_way_id FROM piece_way
       WHERE osm_way_id IS NOT NULL AND osm_way_id <> -1
         AND osm_way_id NOT IN (SELECT osm_way_id FROM piece_way AS same WHERE same.rule = 'same_way'
                                AND same.grown_id = piece_way.grown_id AND same.osm_way_id IS NOT NULL)) AS brought
WHERE osm_way_street_edge.street_edge_id = brought.grown_id
  AND osm_way_street_edge.osm_way_id = brought.osm_way_id
  AND EXISTS (SELECT FROM osm_way_street_edge AS kept
              WHERE kept.street_edge_id = brought.grown_id
                AND kept.osm_way_id NOT IN (SELECT osm_way_id FROM piece_way AS p
                                            WHERE p.grown_id = brought.grown_id AND p.osm_way_id IS NOT NULL
                                              AND p.rule <> 'same_way'));
INSERT INTO osm_way_street_edge (osm_way_id, street_edge_id)
SELECT DISTINCT osm_way_id, part_id FROM piece_way WHERE osm_way_id IS NOT NULL;

-- Audits back onto their stretch. A stretch drawn against the grown line turns a paused audit's start around again;
-- distances along the street are measured on the new line from the same points.
UPDATE audit_task
SET street_edge_id = grown_task_part.part_id,
    start_point_reversed = audit_task.start_point_reversed <> part.reversed,
    start_offset_m = CASE WHEN audit_task.start_offset_m IS NULL THEN NULL
                          ELSE ST_LineLocatePoint(part.geom, ST_LineInterpolatePoint(grown.joined_geom,
                                 least(1.0, audit_task.start_offset_m / NULLIF(grown.joined_m, 0)))) * part.m END,
    covered_ranges = CASE WHEN audit_task.covered_ranges IS NULL OR jsonb_typeof(audit_task.covered_ranges) <> 'array'
                            THEN audit_task.covered_ranges
                          ELSE (SELECT coalesce(jsonb_agg(jsonb_build_array(moved.a, moved.b) ORDER BY moved.a),
                                                '[]'::jsonb)
                                FROM jsonb_array_elements(audit_task.covered_ranges) AS seen (pair)
                                CROSS JOIN LATERAL (
                                  SELECT round((least(x, y) * part.m)::numeric, 1) AS a,
                                         round((greatest(x, y) * part.m)::numeric, 1) AS b
                                  FROM (SELECT ST_LineLocatePoint(part.geom, ST_LineInterpolatePoint(grown.joined_geom,
                                                 least(1.0, (seen.pair ->> 0)::float / NULLIF(grown.joined_m, 0))))
                                                 AS x,
                                               ST_LineLocatePoint(part.geom, ST_LineInterpolatePoint(grown.joined_geom,
                                                 least(1.0, (seen.pair ->> 1)::float / NULLIF(grown.joined_m, 0))))
                                                 AS y) AS located
                                ) AS moved
                                WHERE moved.b > moved.a) END,
    completed = audit_task.completed OR audit_task.audit_task_id IN (SELECT audit_task_id FROM uncompleted)
FROM grown_task_part
JOIN part ON part.part_id = grown_task_part.part_id
JOIN grown ON grown.id = grown_task_part.grown_id
WHERE audit_task.audit_task_id = grown_task_part.audit_task_id;
UPDATE audit_task
SET audited_distance_m = (SELECT sum((pair ->> 1)::float - (pair ->> 0)::float)
                          FROM jsonb_array_elements(audit_task.covered_ranges) AS pair)
WHERE audit_task.audit_task_id IN (SELECT audit_task_id FROM grown_task_part)
  AND jsonb_typeof(audit_task.covered_ranges) = 'array';

UPDATE label SET street_edge_id = label_part.part_id
FROM label_part WHERE label.label_id = label_part.label_id AND label.street_edge_id <> label_part.part_id;
UPDATE label_point
SET centerline_offset_m = label_centerline_offset_m(label_point.geom, street_edge.geom)
FROM label_part, street_edge
WHERE label_point.label_id = label_part.label_id
  AND street_edge.street_edge_id = label_part.part_id
  AND label_point.geom IS NOT NULL;
UPDATE old_label_point_coords SET street_edge_id = label_part.part_id
FROM label_part
WHERE old_label_point_coords.label_id = label_part.label_id
  AND old_label_point_coords.street_edge_id = label_part.grown_id;
UPDATE old_label_point_position SET street_edge_id = label_part.part_id
FROM label_part
WHERE old_label_point_position.label_id = label_part.label_id
  AND old_label_point_position.street_edge_id = label_part.grown_id;
SELECT to_regclass('old_label_point_coords_2') IS NOT NULL AS has_coords_2 \gset
\if :has_coords_2
UPDATE old_label_point_coords_2 SET street_edge_id = label_part.part_id
FROM label_part
WHERE old_label_point_coords_2.label_id = label_part.label_id
  AND old_label_point_coords_2.street_edge_id = label_part.grown_id;
\endif

UPDATE audit_task_comment SET edge_id = comment_part.part_id
FROM comment_part WHERE audit_task_comment.audit_task_comment_id = comment_part.audit_task_comment_id;
UPDATE street_edge_issue SET street_edge_id = issue_part.part_id
FROM issue_part WHERE street_edge_issue.street_edge_issue_id = issue_part.street_edge_issue_id;
UPDATE cluster SET street_edge_id = cluster_part.part_id
FROM cluster_part WHERE cluster.cluster_id = cluster_part.cluster_id;
UPDATE place SET nearest_street_edge_id = place_part.part_id, nearest_street_distance_m = place_part.distance_m
FROM place_part WHERE place.place_id = place_part.place_id;

-- Route stops: the stop keeps its row for one stretch (its own, else the first it walks) and gains a row per other
-- stretch; then each touched route is numbered again in walking order. (route_id, position) is unique and never
-- negative, so every touched route first moves out of the way, past any real position. A walk recorded against
-- the stop moves to the stop for the stretch its audit was on.
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
UPDATE route_street SET position = 1000000 + route_street.position
WHERE route_street.route_id IN (SELECT route_id FROM route_stop);
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
UPDATE audit_task_user_route SET route_street_id = moved.route_street_id
FROM grown_task_part, route_street AS was, route_street AS moved
WHERE audit_task_user_route.audit_task_id = grown_task_part.audit_task_id
  AND was.route_street_id = audit_task_user_route.route_street_id
  AND was.route_street_id IN (SELECT route_street_id FROM route_stop_part)
  AND moved.route_id = was.route_id AND moved.street_edge_id = grown_task_part.part_id
  AND moved.route_street_id <> was.route_street_id;
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

-- Streets the bad run disabled as too short come back as they were.
CREATE TEMP TABLE reopened ON COMMIT DROP AS
SELECT street_edge_status_change.street_edge_id, street_edge_status_change.old_status
FROM street_edge_status_change
WHERE street_edge_status_change.source = 'consolidate_tiny_streets'
  AND street_edge_status_change.changed_at >= :'since'
  AND street_edge_status_change.new_status = 'disabled';
INSERT INTO street_edge_status_change (street_edge_id, old_status, new_status, source)
SELECT reopened.street_edge_id, 'disabled', reopened.old_status, 'consolidate_tiny_streets' FROM reopened;
UPDATE street_edge SET status = reopened.old_status
FROM reopened WHERE street_edge.street_edge_id = reopened.street_edge_id;
INSERT INTO street_edge_priority (street_edge_id, priority)
SELECT reopened.street_edge_id, 1.0 FROM reopened
WHERE NOT EXISTS (SELECT FROM street_edge_priority
                  WHERE street_edge_priority.street_edge_id = reopened.street_edge_id);

DELETE FROM street_edge_merge
WHERE street_edge_merge_id IN (SELECT street_edge_merge_id FROM bad_merge
                               WHERE survivor_id IN (SELECT id FROM grown WHERE ok));
DO $$
BEGIN
  IF EXISTS (SELECT FROM grown WHERE ok) THEN
    TRUNCATE TABLE region_completion;
  END IF;
END $$;

-- 7. Summary, one row. The replay_ columns are to be read against the runs' own CSVs: replay_first_run_uncompleted
--    against the first run's audits_marked_not_completed, replay_bad_run_uncompleted against the bad run's. The
--    check_ columns should all be 0.
SELECT :'city' AS city,
       :apply::int = 1 AS applied,
       :'has_snapshot'::boolean AS used_saved_priority,
       (SELECT count(*) FROM bad_merge) AS bad_joins,
       (SELECT count(*) FROM grown) AS grown_streets,
       (SELECT count(*) FROM part WHERE NOT own) AS streets_restored,
       (SELECT count(*) FROM grown_task) AS audits_placed,
       (SELECT count(*) FROM grown_task_part WHERE NOT by_panos) AS audits_placed_by_last_position,
       (SELECT count(*) FROM grown_task_part JOIN part USING (part_id) WHERE NOT part.own) AS audits_moved,
       (SELECT count(*) FROM grown_task_part JOIN grown_task USING (audit_task_id)
          WHERE grown_task.task_start >= :'bad_run_at' AND grown_task_part.parts_walked > 1) AS later_audits_split,
       (SELECT count(*) FROM first_covered WHERE first_covered.saved IS NOT NULL) AS first_run_streets_saved,
       (SELECT count(*) FROM first_covered WHERE first_covered.saved IS NOT NULL
          AND first_covered.saved <> first_covered.replayed) AS first_run_replay_disagrees_with_saved,
       (SELECT count(*) FROM first_task_part
          JOIN first_covered ON first_covered.id = first_task_part.street_id
          WHERE first_task_part.was_finished AND NOT first_covered.covered) AS replay_first_run_uncompleted,
       (SELECT count(*) FROM uncompleted) AS replay_bad_run_uncompleted,
       (SELECT count(*) FROM uncompleted WHERE NOT completed_now) AS audits_completed_again,
       (SELECT count(*) FROM uncompleted WHERE completed_now) AS replay_already_completed,
       (SELECT count(*) FROM label_part WHERE part_id <> grown_id) AS labels_moved,
       (SELECT count(*) FROM comment_part JOIN part USING (part_id) WHERE NOT part.own) AS comments_moved,
       (SELECT count(*) FROM issue_part JOIN part USING (part_id) WHERE NOT part.own) AS issues_moved,
       (SELECT count(*) FROM cluster_part JOIN part USING (part_id) WHERE NOT part.own) AS clusters_moved,
       (SELECT count(*) FROM place_part JOIN part USING (part_id) WHERE NOT part.own) AS places_moved,
       (SELECT count(DISTINCT route_street_id) FROM route_stop_part) AS route_stops_split,
       (SELECT count(*) FROM route_stop_new) AS route_stops_added,
       (SELECT count(*) FROM region_back) AS grown_streets_region_back,
       (SELECT count(*) FROM reopened) AS streets_reopened,
       (SELECT count(*) FROM grown WHERE NOT ok) AS check_grown_streets_left_joined,
       (SELECT count(*) FROM bad_merge
          WHERE NOT EXISTS (SELECT FROM street_edge WHERE street_edge.street_edge_id = bad_merge.id)
            AND survivor_id IN (SELECT id FROM grown WHERE ok)) AS check_streets_not_restored,
       (SELECT count(*) FROM part WHERE NOT ST_IsSimple(part.geom) OR part.m < :touch_m) AS check_bad_lines,
       (SELECT count(*) FROM route_stop WHERE street_edge_id IN (SELECT id FROM grown WHERE ok)
          AND route_street_id NOT IN (SELECT route_street_id FROM route_stop_part)) AS check_route_stops_unplaced,
       (SELECT count(*) FROM label
          WHERE label.street_edge_id NOT IN (SELECT street_edge_id FROM street_edge)) AS check_labels_on_no_street;

\if :apply
  COMMIT;
\else
  ROLLBACK;
\endif
