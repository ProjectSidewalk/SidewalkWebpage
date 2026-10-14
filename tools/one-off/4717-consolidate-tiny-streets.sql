-- =====================================================================================================================
-- Consolidate tiny streets (#4717). Written against evolution 417.
--
-- Cities built before tools/city/onboard_city.py (every one but Newport and Laurens, as of 2026-10) are full of
-- streets a few metres long: pieces a region border cut off a road, roundabout arcs, stubs between a dual
-- carriageway's links. Nobody can audit a 2 m street (the end-of-street check fires at 25 m), so they linger as the
-- unauditable tail of every region. This brings an existing city in line with what the pipeline now builds, with the
-- same rules and the same numbers:
--   1. A street under 20 m (-v merge_m=) joins a touching street of the same OSM way: the shorter neighbour when
--      there are two, never one that would close a ring. Repeats until nothing is left to join, so a chain of
--      slivers collapses into one street.
--   2. Two streets that meet end to end where no third street does are one road (the pipeline joins consecutive OSM
--      ways between intersections, and heals what a region border cut), whatever their way ids or lengths. Two
--      exceptions, as in the pipeline: a street that genuinely crosses a region border, with 30 m (-v border_m=) or
--      more on each side and neither side running along the border (within -v rider_m= of the other side's
--      region), stays cut; and once a joined street runs through a junction, the streets still ending there stay
--      cut (the pipeline's end-to-end joins happen before its tiny-segment merges, so they never see that junction
--      as a dead end).
--   3. In a city without OSM way ids (the Infra3d cities carry -1 everywhere, and the ids never mattered there), a
--      street under 20 m at an intersection joins the neighbour that continues it most nearly straight, if that
--      bends less than -v straight_deg= (45).
--   4. Whatever is still under 15 m (-v drop_m=) with nothing to join is removed: deleted outright when nothing real
--      hangs off it, otherwise set 'disabled' (the status remove_streets uses) and left out of auditing.
-- Every join is between streets of the same status, so no open street is buried in a closed one or the other way
-- round, and none is made when the joined line would cross or touch itself or close a ring. A street with an audit
-- from the last day sits the run out (its user may be on it, and the app's writes could deadlock with this one);
-- the summary counts them, and a later run picks them up.
--
-- DRY RUN BY DEFAULT: everything runs inside a transaction that is rolled back, and one summary row per city is
-- printed. Pass -v apply=1 to commit; -v list=1 prints one row per touched street (with its WKT) instead of the
-- summary, for a look in QGIS before applying; -v plan=1 decides everything but writes nothing, not even inside the
-- transaction, so it needs no evolution 416 and takes no row locks: the way to preview a live city. Built for
-- sidewalk-server-tools/run-query-in-every-city.sh (-m), which sets the search_path and the city variable and passes
-- no other: send it a copy with `\set apply 1` (or `\set plan 1`, `\set list 1`) in place of the default below.
-- For one city by hand:
--   docker exec -i projectsidewalk-db psql "dbname=sidewalk options=--search_path=sidewalk_seattle,public" \
--     -U sidewalk_seattle -v city=seattle -v apply=0 -f - < tools/one-off/4717-consolidate-tiny-streets.sql
--
-- What happens to a joined street's data (the moves of 3067-merge-duplicate-streets.sql, with a growing survivor):
--   * The survivor keeps its id and its direction; the sliver is added at one end, so its start/end points change
--     and its street_gradient row and OSM way positions go stale. Run sidewalk-server-tools/street-gradient-backfill.sh
--     and osm-lineage-backfill.sh afterwards: both pick up changed geometry. The survivor moves region only if most
--     of it now lies in another live one.
--   * Labels move to the survivor, and their distance from the centre line (which left/right comes from) is
--     re-measured for every label on the survivor, since its line changed.
--   * Audits, route stops, issues, clusters, comments and places move to the survivor. A completed audit stays
--     completed only while the parts actually walked (the survivor's own line if it had one, plus each joined piece
--     that had one) cover -v min_cov= (80%) of the joined street; otherwise every completed audit on it is marked not
--     completed, so the street goes back into the pool instead of counting unwalked length as audited. An audit
--     with nothing on it (no labels, comments or route record) is deleted instead of becoming a bogus resume. Where
--     the sliver was drawn the other way, routes and paused audits are flipped; a drop-in audit's distance along the
--     street and a free-exploration audit's covered stretches are re-measured on the new line. Every route walking
--     a joined or grown street has its cached length and street count refreshed.
--   * Its OSM way links move to the survivor, which then lists every way either street lay on. The positions along
--     those ways (#5741) are cleared, since the survivor's line changed: the lineage backfill recomputes them, so it
--     runs after this. Priority and imagery rows go, then the street itself. street_edge_merge (evolution 416) keeps
--     its id, geometry, way id and survivor.
-- A removed street is deleted outright only when it has no labels (its own, or placed from its audits), no comments,
-- no route stops and no audit a route walk recorded: its bare audits and issues go with it, and places pointing at
-- it are re-pointed. Otherwise it is set 'disabled' with a street_edge_status_change row (source
-- consolidate_tiny_streets) and its labels are re-filed under the nearest open street within -v refile_m= (25 m,
-- about a block face's width; what is further is on an isolated fragment, and moving it would be a guess).
-- The nightly jobs rebuild priority, sidewalk presence, clusters, intersections, access scores and user distance;
-- region completion is cleared and refills on the next landing-page load.
--
-- The tutorial street and 'disabled' streets take no part.
-- =====================================================================================================================

\set QUIET on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?list}
\else
  \set list 0
\endif
\if :{?plan}
\else
  \set plan 0
\endif
\if :{?merge_m}
\else
  \set merge_m 20.0
\endif
\if :{?border_m}
\else
  \set border_m 30.0
\endif
\if :{?drop_m}
\else
  \set drop_m 15.0
\endif
\if :{?touch_m}
\else
  \set touch_m 1.0
\endif
\if :{?refile_m}
\else
  \set refile_m 25.0
\endif
\if :{?rider_m}
\else
  \set rider_m 15.0
\endif
\if :{?straight_deg}
\else
  \set straight_deg 45.0
\endif
\if :{?min_cov}
\else
  \set min_cov 0.80
\endif

-- The fleet runner opens every connection read-only; temp tables need this off even for a dry run.
SET default_transaction_read_only = off;
BEGIN;

-- The street_edge_merge table and the consolidate_tiny_streets source value arrived together in evolution 416, and
-- the way positions this clears in evolution 417, each checked by its presence rather than by number: on a dev
-- machine another branch's evolution can hold the same number for a while.
\if :plan
\else
DO $$
BEGIN
  IF to_regclass('street_edge_merge') IS NULL
     OR NOT EXISTS (SELECT FROM pg_enum WHERE enumlabel = 'consolidate_tiny_streets'
                    AND enumtypid = 'street_edge_status_change_source'::regtype)
     OR to_regclass('osm_way_street_edge_primary') IS NULL THEN
    RAISE EXCEPTION 'evolutions 416 and 417 are not both applied in this schema; deploy a release that carries them';
  END IF;
END $$;
\endif

-- psql doesn't fill its variables in inside a $$ block, so the loop reads these as settings.
SET LOCAL consolidate.merge_m = :merge_m;
SET LOCAL consolidate.border_m = :border_m;
SET LOCAL consolidate.touch_m = :touch_m;
SET LOCAL consolidate.straight_deg = :straight_deg;

-- 1. The streets in play. A way id of -1 is the Infra3d placeholder, not a way. A loop (start = end) is never a
--    sliver and never a survivor: the pipeline keeps them as OSM maps them, and joining one confuses the app's
--    end-of-street check. A street shorter than twice the touching tolerance has its ends that close together
--    without being a loop (Seattle has 888 under a metre). way_ids starts as the street's own way and grows with each
--    join, so a sliver of an absorbed way still finds its way under rule 1.
--    Every column is computed here rather than by an UPDATE afterwards: an index built in the same transaction after
--    the table was updated is unusable by that transaction (Postgres's HOT-chain rule).
CREATE TEMP TABLE edge ON COMMIT DROP AS
SELECT street.*, street.m < :merge_m AND NOT street.is_loop AND NOT street.active AS pending,
       CASE WHEN street.osm_way_id IS NULL THEN '{}'::bigint[] ELSE ARRAY[street.osm_way_id] END AS way_ids
FROM (
  SELECT street_edge.street_edge_id AS id, street_edge.geom, street_edge.status,
         (SELECT NULLIF(osm_way_street_edge_primary.osm_way_id, -1) FROM osm_way_street_edge_primary
          WHERE osm_way_street_edge_primary.street_edge_id = street_edge.street_edge_id) AS osm_way_id,
         EXISTS (SELECT FROM audit_task
                 WHERE audit_task.street_edge_id = street_edge.street_edge_id
                   AND audit_task.task_start >= now() - interval '1 day') AS active,
         (SELECT min(street_edge_region.region_id) FROM street_edge_region
          WHERE street_edge_region.street_edge_id = street_edge.street_edge_id) AS region_id,
         ST_Length(street_edge.geom::geography) AS m,
         ST_StartPoint(street_edge.geom)::geography AS start_pt,
         ST_EndPoint(street_edge.geom)::geography AS end_pt,
         ST_DWithin(ST_StartPoint(street_edge.geom)::geography, ST_EndPoint(street_edge.geom)::geography, :touch_m)
           AND ST_Length(street_edge.geom::geography) > 2 * :touch_m AS is_loop
  FROM street_edge
  WHERE street_edge.status <> 'disabled'
    AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
) AS street;
ALTER TABLE edge ADD PRIMARY KEY (id);
CREATE INDEX ON edge USING gist (geom);
CREATE INDEX ON edge USING gist (start_pt);
CREATE INDEX ON edge USING gist (end_pt);
ANALYZE edge;

-- The lines before any join, to carry a drop-in audit's position onto the joined line afterwards.
CREATE TEMP TABLE before_merge ON COMMIT DROP AS SELECT id, geom, m FROM edge;
ALTER TABLE before_merge ADD PRIMARY KEY (id);

CREATE TEMP TABLE count_before ON COMMIT DROP AS
SELECT count(*) AS streets, count(*) FILTER (WHERE m < :merge_m) AS under_merge_m,
       count(*) FILTER (WHERE m < :drop_m) AS under_drop_m, count(*) FILTER (WHERE active) AS audited_last_day
FROM edge;

-- Which end of which street meets which end of which other, both directions. Found once with the spatial indexes
-- so the loop below never touches geometry except to join two lines; a join just rewires the rows at its two ends.
CREATE TEMP TABLE touch ON COMMIT DROP AS
SELECT a.id AS a_id, 'start' AS a_end, b.id AS b_id, 'start' AS b_end
FROM edge AS a JOIN edge AS b ON b.id <> a.id AND ST_DWithin(b.start_pt, a.start_pt, :touch_m)
UNION ALL
SELECT a.id, 'start', b.id, 'end'
FROM edge AS a JOIN edge AS b ON b.id <> a.id AND ST_DWithin(b.end_pt, a.start_pt, :touch_m)
UNION ALL
SELECT a.id, 'end', b.id, 'start'
FROM edge AS a JOIN edge AS b ON b.id <> a.id AND ST_DWithin(b.start_pt, a.end_pt, :touch_m)
UNION ALL
SELECT a.id, 'end', b.id, 'end'
FROM edge AS a JOIN edge AS b ON b.id <> a.id AND ST_DWithin(b.end_pt, a.end_pt, :touch_m);
CREATE INDEX ON touch (a_id, a_end);
CREATE INDEX ON touch (b_id, b_end);
ANALYZE touch;

-- Rule 2 candidates: an end where exactly one other street meets, whatever the length.
UPDATE edge SET pending = TRUE
WHERE NOT is_loop AND NOT active
  AND id IN (SELECT a_id FROM touch GROUP BY a_id, a_end HAVING count(DISTINCT b_id) = 1);

-- An end at a junction a joined street now runs through: not a dead end, whatever touch says is left there.
CREATE TEMP TABLE blocked_end (id INTEGER NOT NULL, at_end TEXT NOT NULL, PRIMARY KEY (id, at_end)) ON COMMIT DROP;

-- For rule 2's "runs along the border" test.
CREATE TEMP TABLE region_buffer ON COMMIT DROP AS
SELECT region_id, ST_Buffer(geom::geography, :rider_m)::geometry AS geom FROM region;
ALTER TABLE region_buffer ADD PRIMARY KEY (region_id);

-- 2. Join streets into neighbours, shortest first. A survivor is queued again after each join, since its new end may
--    meet something else. The queue is walked by position rather than by re-sorting `edge` each pick: every settled
--    row leaves a dead index entry behind, and stepping over all of them on every pick grows quadratically (minutes
--    on Chicago).
CREATE TEMP TABLE street_merge (drop_id INTEGER PRIMARY KEY, survivor_id INTEGER NOT NULL, rule TEXT NOT NULL,
                                reversed BOOLEAN NOT NULL, drop_m DOUBLE PRECISION NOT NULL,
                                drop_geom geometry NOT NULL, drop_osm_way_id BIGINT) ON COMMIT DROP;
CREATE TEMP TABLE queue (position SERIAL PRIMARY KEY, id INTEGER NOT NULL) ON COMMIT DROP;
INSERT INTO queue (id) SELECT id FROM edge WHERE pending ORDER BY m, id;
DO $$
DECLARE
  merge_m DOUBLE PRECISION := current_setting('consolidate.merge_m')::float;
  border_m DOUBLE PRECISION := current_setting('consolidate.border_m')::float;
  touch_m DOUBLE PRECISION := current_setting('consolidate.touch_m')::float;
  -- The same tolerance in degrees, for the vertex clean-up; a shade under at the equator, more elsewhere.
  tol_deg DOUBLE PRECISION := touch_m / 111320.0;
  straight_deg DOUBLE PRECISION := current_setting('consolidate.straight_deg')::float;
  ways_unknown BOOLEAN;
  sliver RECORD;
  nb RECORD;
  far_end TEXT;
  piece geometry;
  joined geometry;
  accepted BOOLEAN;
  next_position INTEGER := 0;
BEGIN
  -- Rule 3 is for a city with no way id anywhere (Infra3d); a few streets missing one just sit out rule 1.
  SELECT NOT EXISTS (SELECT FROM edge WHERE osm_way_id IS NOT NULL) INTO ways_unknown;
  LOOP
    next_position := next_position + 1;
    SELECT edge.* INTO sliver
    FROM queue JOIN edge ON edge.id = queue.id
    WHERE queue.position = next_position AND edge.pending;
    IF NOT FOUND THEN
      EXIT WHEN next_position > (SELECT max(position) FROM queue);
      CONTINUE; -- Joined onto something, or settled, since it was queued.
    END IF;

    -- Neighbours in order of preference; the first whose joined line is sound wins.
    accepted := FALSE;
    FOR nb IN
      SELECT edge.id, edge.m, edge.geom, touch.a_end AS sliver_end, touch.b_end AS nb_end,
             CASE WHEN test.same_way_short THEN 'same_way'
                  WHEN test.alone AND edge.region_id IS DISTINCT FROM sliver.region_id THEN 'border_cut'
                  WHEN test.alone THEN 'continuation'
                  ELSE 'straightest' END AS rule
      FROM touch
      JOIN edge ON edge.id = touch.b_id
      LEFT JOIN region_buffer AS around_n ON around_n.region_id = edge.region_id
      LEFT JOIN region_buffer AS around_s ON around_s.region_id = sliver.region_id
      CROSS JOIN LATERAL (
        SELECT sliver.m < merge_m AND edge.way_ids && sliver.way_ids AS same_way_short,
               -- Nothing but the neighbour ends here, and no joined street runs through: a border or a change of way
               -- id, not an intersection. Across a border, a short side or a side running along the border joins; a
               -- genuine crossing stays cut.
               NOT EXISTS (SELECT FROM touch AS third
                           WHERE third.a_id = sliver.id AND third.a_end = touch.a_end AND third.b_id <> edge.id)
                 AND NOT EXISTS (SELECT FROM blocked_end
                                 WHERE blocked_end.id = sliver.id AND blocked_end.at_end = touch.a_end)
                 AND (edge.region_id IS NOT DISTINCT FROM sliver.region_id OR sliver.m < border_m OR edge.m < border_m
                      OR ST_Covers(around_n.geom, sliver.geom) OR ST_Covers(around_s.geom, edge.geom)) AS alone,
               -- How far the road bends at the junction (0 is dead straight): bearing in along the sliver vs out
               -- along the neighbour.
               abs(mod((degrees(ST_Azimuth(
                          CASE touch.b_end WHEN 'start' THEN ST_StartPoint(edge.geom)
                                           ELSE ST_EndPoint(edge.geom) END::geography,
                          CASE touch.b_end WHEN 'start' THEN ST_PointN(edge.geom, 2)
                                           ELSE ST_PointN(edge.geom, ST_NPoints(edge.geom) - 1) END::geography))
                        - degrees(ST_Azimuth(
                          CASE touch.a_end WHEN 'start' THEN ST_PointN(sliver.geom, 2)
                                           ELSE ST_PointN(sliver.geom, ST_NPoints(sliver.geom) - 1) END::geography,
                          CASE touch.a_end WHEN 'start' THEN ST_StartPoint(sliver.geom)
                                           ELSE ST_EndPoint(sliver.geom) END::geography))
                        + 540)::numeric, 360) - 180) AS deflection
      ) AS test
      WHERE touch.a_id = sliver.id
        AND edge.status = sliver.status
        AND NOT edge.is_loop
        AND NOT edge.active
        -- The two far ends meeting too would close a ring.
        AND NOT EXISTS (SELECT FROM touch AS far
                        WHERE far.a_id = sliver.id AND far.a_end <> touch.a_end
                          AND far.b_id = edge.id AND far.b_end <> touch.b_end)
        AND (test.same_way_short OR test.alone
             OR (ways_unknown AND sliver.m < merge_m AND test.deflection <= straight_deg))
      -- The straightest continuation under rule 3, else the shorter neighbour so lengths even out. A sliver shorter
      -- than the tolerance meets the neighbour with both ends; either row will do, the same one each run.
      ORDER BY CASE WHEN test.same_way_short OR test.alone THEN 0 ELSE test.deflection END, edge.m, edge.id,
               touch.a_end
    LOOP
      -- The sliver is turned so its meeting end comes first, snapped onto the survivor's end point, and added there.
      -- The survivor's own direction never changes, which is what keeps its labels' left/right right. Vertices of
      -- the sliver within the touching tolerance of each other are noise, so they are dropped. A sliver that is all
      -- noise adds no line at all and only its data moves. One whose line would cross or touch the survivor's, or
      -- close a ring with it (a cul-de-sac's loop meeting its own stem), waits for the next neighbour.
      piece := CASE WHEN nb.sliver_end = 'start' THEN sliver.geom ELSE ST_Reverse(sliver.geom) END;
      IF nb.nb_end = 'end' THEN
        piece := ST_RemoveRepeatedPoints(ST_SetPoint(piece, 0, ST_EndPoint(nb.geom)), tol_deg);
        joined := ST_RemoveRepeatedPoints(ST_MakeLine(nb.geom, piece));
      ELSE
        piece := ST_Reverse(piece);
        piece := ST_RemoveRepeatedPoints(ST_SetPoint(piece, ST_NPoints(piece) - 1, ST_StartPoint(nb.geom)), tol_deg);
        joined := ST_RemoveRepeatedPoints(ST_MakeLine(piece, nb.geom));
      END IF;
      IF ST_Length(piece::geography) < touch_m THEN
        joined := nb.geom;
      ELSIF NOT ST_IsSimple(joined)
            OR ST_DWithin(ST_StartPoint(joined)::geography, ST_EndPoint(joined)::geography, touch_m) THEN
        CONTINUE;
      END IF;
      accepted := TRUE;
      EXIT;
    END LOOP;

    IF NOT accepted THEN
      UPDATE edge SET pending = FALSE WHERE id = sliver.id;
      CONTINUE;
    END IF;

    UPDATE edge
    SET geom = joined, m = ST_Length(joined::geography),
        start_pt = ST_StartPoint(joined)::geography, end_pt = ST_EndPoint(joined)::geography,
        way_ids = edge.way_ids || sliver.way_ids, pending = ST_Length(joined::geography) < border_m
    WHERE id = nb.id;
    INSERT INTO queue (id) VALUES (nb.id);
    DELETE FROM edge WHERE id = sliver.id;

    -- The junction is now inside the survivor: nothing meets its end there any more, what met the sliver's far end
    -- meets that end of the survivor instead, and whatever else still ends there is blocked (a block travels with
    -- a far end).
    far_end := CASE WHEN nb.sliver_end = 'start' THEN 'end' ELSE 'start' END;
    INSERT INTO blocked_end (id, at_end)
    SELECT b_id, b_end FROM touch
    WHERE ((a_id = nb.id AND a_end = nb.nb_end) OR (a_id = sliver.id AND a_end = nb.sliver_end))
      AND b_id <> nb.id AND b_id <> sliver.id
    ON CONFLICT DO NOTHING;
    DELETE FROM blocked_end WHERE (id = nb.id AND at_end = nb.nb_end) OR (id = sliver.id AND at_end = nb.sliver_end);
    UPDATE blocked_end SET id = nb.id, at_end = nb.nb_end WHERE id = sliver.id AND at_end = far_end;
    DELETE FROM touch WHERE (a_id = nb.id AND a_end = nb.nb_end) OR (b_id = nb.id AND b_end = nb.nb_end);
    DELETE FROM touch
    WHERE (a_id = sliver.id AND a_end = nb.sliver_end) OR (b_id = sliver.id AND b_end = nb.sliver_end);
    UPDATE touch SET a_id = nb.id, a_end = nb.nb_end WHERE a_id = sliver.id AND a_end = far_end;
    UPDATE touch SET b_id = nb.id, b_end = nb.nb_end WHERE b_id = sliver.id AND b_end = far_end;
    -- A sliver shorter than the tolerance met the survivor with both ends; the second meeting is now the survivor
    -- meeting itself.
    DELETE FROM touch WHERE a_id = nb.id AND b_id = nb.id;

    -- Drawn the other way than it now runs: when it was added forwards at the end, or backwards at the start. The
    -- length and line recorded are the street's own, not what it had absorbed before joining on itself.
    INSERT INTO street_merge (drop_id, survivor_id, rule, reversed, drop_m, drop_geom, drop_osm_way_id)
    SELECT sliver.id, nb.id, nb.rule, (nb.sliver_end = 'start') <> (nb.nb_end = 'end'), before_merge.m,
           before_merge.geom, sliver.osm_way_id
    FROM before_merge WHERE before_merge.id = sliver.id;
  END LOOP;
END $$;

-- A survivor can itself have been joined on later, so every sliver is followed to the street that is left. Each step
-- keeps the survivor's direction, so "drawn the other way" composes along the chain.
CREATE TEMP TABLE final_merge ON COMMIT DROP AS
WITH RECURSIVE walk AS (
  SELECT drop_id, survivor_id, reversed, 1 AS depth FROM street_merge
  UNION ALL
  SELECT walk.drop_id, street_merge.survivor_id, walk.reversed <> street_merge.reversed, walk.depth + 1
  FROM walk
  JOIN street_merge ON street_merge.drop_id = walk.survivor_id
)
SELECT DISTINCT ON (drop_id) drop_id, survivor_id, reversed, depth FROM walk ORDER BY drop_id, depth DESC;
ALTER TABLE final_merge ADD PRIMARY KEY (drop_id);

CREATE TEMP TABLE survivor ON COMMIT DROP AS SELECT DISTINCT survivor_id AS id FROM final_merge;
ALTER TABLE survivor ADD PRIMARY KEY (id);
-- The loop rewrote edge heavily, and the planner has never seen the others.
ANALYZE edge;
ANALYZE street_merge;
ANALYZE final_merge;
ANALYZE survivor;

-- 3. Audits on the joined streets. One with nothing on it is a 0 m walk of a street nobody could walk: deleting it
--    beats moving it, which would hand the survivor back to that user as a resume.
CREATE TEMP TABLE task_move ON COMMIT DROP AS
SELECT audit_task.audit_task_id, audit_task.street_edge_id AS from_id, final_merge.survivor_id AS to_id,
       final_merge.reversed, audit_task.completed,
       NOT EXISTS (SELECT FROM label WHERE label.audit_task_id = audit_task.audit_task_id)
         AND NOT EXISTS (SELECT FROM audit_task_comment
                         WHERE audit_task_comment.audit_task_id = audit_task.audit_task_id)
         AND NOT EXISTS (SELECT FROM audit_task_user_route
                         WHERE audit_task_user_route.audit_task_id = audit_task.audit_task_id) AS bare
FROM audit_task
JOIN final_merge ON final_merge.drop_id = audit_task.street_edge_id;
ALTER TABLE task_move ADD PRIMARY KEY (audit_task_id);
ANALYZE task_move;

-- How much of each joined street somebody actually walked to the end: its own line if a completed audit covers it,
-- plus every joined piece with one. Short of min_cov, no completed audit on it can stand for the whole.
CREATE TEMP TABLE walked_part ON COMMIT DROP AS
SELECT final_merge.survivor_id AS id, street_merge.drop_m AS m
FROM final_merge
JOIN street_merge ON street_merge.drop_id = final_merge.drop_id
WHERE EXISTS (SELECT FROM audit_task
              WHERE audit_task.street_edge_id = final_merge.drop_id AND audit_task.completed)
UNION ALL
SELECT survivor.id, before_merge.m
FROM survivor
JOIN before_merge ON before_merge.id = survivor.id
WHERE EXISTS (SELECT FROM audit_task WHERE audit_task.street_edge_id = survivor.id AND audit_task.completed);
CREATE INDEX ON walked_part (id);
ANALYZE walked_part;
CREATE TEMP TABLE survivor_walked ON COMMIT DROP AS
SELECT survivor.id, coalesce(sum(walked_part.m), 0) / NULLIF(max(edge.m), 0) >= :min_cov AS covered
FROM survivor
JOIN edge ON edge.id = survivor.id
LEFT JOIN walked_part ON walked_part.id = survivor.id
GROUP BY survivor.id;
ALTER TABLE survivor_walked ADD PRIMARY KEY (id);

-- Where a drop-in audit began, as a point, before the line it was measured along changes.
CREATE TEMP TABLE task_offset ON COMMIT DROP AS
SELECT audit_task.audit_task_id,
       ST_LineInterpolatePoint(before_merge.geom, least(1.0, audit_task.start_offset_m / NULLIF(before_merge.m, 0)))
         AS started_at
FROM audit_task
JOIN before_merge ON before_merge.id = audit_task.street_edge_id
WHERE audit_task.start_offset_m IS NOT NULL
  AND (audit_task.street_edge_id IN (SELECT id FROM survivor)
       OR audit_task.street_edge_id IN (SELECT drop_id FROM final_merge));

-- A free-exploration audit's covered stretches (#5733) are metres along a line about to change: each is carried
-- over as the two points it spans, measured again on the joined line and rounded as the app rounds them. The column
-- came with evolution 415, which a plan run on an older schema can do without.
SELECT EXISTS (SELECT FROM pg_attribute
               WHERE attrelid = 'audit_task'::regclass AND attname = 'covered_ranges' AND NOT attisdropped)
  AS has_coverage \gset
\if :has_coverage
CREATE TEMP TABLE task_range ON COMMIT DROP AS
SELECT audit_task.audit_task_id,
       jsonb_agg(jsonb_build_array(least(moved.a, moved.b), greatest(moved.a, moved.b))
                 ORDER BY least(moved.a, moved.b)) AS covered_ranges
FROM audit_task
JOIN before_merge ON before_merge.id = audit_task.street_edge_id
LEFT JOIN final_merge ON final_merge.drop_id = audit_task.street_edge_id
JOIN survivor ON survivor.id = coalesce(final_merge.survivor_id, audit_task.street_edge_id)
JOIN edge ON edge.id = survivor.id
CROSS JOIN LATERAL jsonb_array_elements(audit_task.covered_ranges) AS seen (pair)
CROSS JOIN LATERAL (
  SELECT round((ST_LineLocatePoint(edge.geom, ST_LineInterpolatePoint(before_merge.geom,
                  least(1.0, (seen.pair ->> 0)::float / NULLIF(before_merge.m, 0)))) * edge.m)::numeric, 1) AS a,
         round((ST_LineLocatePoint(edge.geom, ST_LineInterpolatePoint(before_merge.geom,
                  least(1.0, (seen.pair ->> 1)::float / NULLIF(before_merge.m, 0)))) * edge.m)::numeric, 1) AS b
) AS moved
WHERE jsonb_typeof(audit_task.covered_ranges) = 'array'
GROUP BY audit_task.audit_task_id;
\else
CREATE TEMP TABLE task_range (audit_task_id INTEGER, covered_ranges JSONB) ON COMMIT DROP;
\endif

-- 4. Route stops. A stop whose street joins one the route already walks the same way would send the user down it
--    twice, so the later stop goes (3067's rule; walking a street once each way is a deliberate out-and-back).
CREATE TEMP TABLE route_stop_after ON COMMIT DROP AS
SELECT route_street.route_street_id, route_street.route_id, route_street.position,
       coalesce(final_merge.survivor_id, route_street.street_edge_id) AS street_edge_id,
       route_street.reverse <> coalesce(final_merge.reversed, FALSE) AS reverse,
       final_merge.drop_id IS NOT NULL AS moved
FROM route_street
LEFT JOIN final_merge ON final_merge.drop_id = route_street.street_edge_id;

CREATE TEMP TABLE route_stop_drop ON COMMIT DROP AS
SELECT later_stop.route_street_id, first_stop.route_street_id AS kept_route_street_id
FROM route_stop_after AS later_stop
JOIN LATERAL (
  SELECT route_stop_after.route_street_id, route_stop_after.moved
  FROM route_stop_after
  WHERE route_stop_after.route_id = later_stop.route_id
    AND route_stop_after.street_edge_id = later_stop.street_edge_id
    AND route_stop_after.reverse = later_stop.reverse
  ORDER BY route_stop_after.position, route_stop_after.route_street_id
  LIMIT 1
) AS first_stop ON first_stop.route_street_id <> later_stop.route_street_id
WHERE later_stop.moved OR first_stop.moved;

-- Every route whose cached length is now off: it walks a joined street, or one that grew.
CREATE TEMP TABLE route_touched ON COMMIT DROP AS
SELECT DISTINCT route_id FROM route_street
WHERE street_edge_id IN (SELECT drop_id FROM final_merge) OR street_edge_id IN (SELECT id FROM survivor);

CREATE TEMP TABLE label_move ON COMMIT DROP AS
SELECT label.label_id, label.street_edge_id AS from_id, final_merge.survivor_id AS to_id
FROM label JOIN final_merge ON final_merge.drop_id = label.street_edge_id;
-- 5. A survivor whose line now lies mostly in another live region moves there, so border joins land on the right
--    side. A deleted region would hide the street, so only live ones count.
CREATE TEMP TABLE region_move ON COMMIT DROP AS
SELECT street_edge_region.street_edge_id, street_edge_region.region_id AS from_region_id,
       best.region_id AS to_region_id
FROM street_edge_region
JOIN edge ON edge.id = street_edge_region.street_edge_id
CROSS JOIN LATERAL (
  SELECT region.region_id FROM region
  WHERE region.geom && edge.geom AND NOT region.deleted
  ORDER BY ST_Length(ST_Intersection(edge.geom, region.geom)::geography) DESC, region.region_id
  LIMIT 1
) AS best
WHERE street_edge_region.street_edge_id IN (SELECT id FROM survivor)
  AND street_edge_region.region_id <> best.region_id;

-- Work moving off a visible street onto one in a deleted region would vanish from the site. Judged against the
-- region the survivor is about to be in.
CREATE TEMP TABLE work_moved_out_of_sight ON COMMIT DROP AS
SELECT final_merge.drop_id
FROM final_merge
JOIN street_edge_region AS dropped_region ON dropped_region.street_edge_id = final_merge.drop_id
JOIN region AS dropped_in ON dropped_in.region_id = dropped_region.region_id
JOIN street_edge_region AS survivor_region ON survivor_region.street_edge_id = final_merge.survivor_id
LEFT JOIN region_move ON region_move.street_edge_id = final_merge.survivor_id
JOIN region AS survivor_in ON survivor_in.region_id = coalesce(region_move.to_region_id, survivor_region.region_id)
WHERE survivor_in.deleted AND NOT dropped_in.deleted;

-- 6. What is still too short to walk, with nothing to join.
--    "Trivial" means no label (its own or placed from one of its audits), no comment, no route stop and no audit a
--    route walk recorded, which is everything the app ever shows a user; bare audits, issues and nearby places are
--    not worth a street row.
--    Judged before anything moves, so a street is judged together with whatever joined it.
CREATE TEMP TABLE member ON COMMIT DROP AS
SELECT id AS street_id, id AS part_id FROM edge
UNION ALL
SELECT survivor_id, drop_id FROM final_merge;
CREATE INDEX ON member (street_id);
CREATE TEMP TABLE short_part ON COMMIT DROP AS
SELECT member.street_id, member.part_id FROM member JOIN edge ON edge.id = member.street_id WHERE edge.m < :drop_m;
CREATE INDEX ON short_part (part_id);
ANALYZE short_part;
-- Set joins: a lookup per short street per table takes minutes on Chicago.
CREATE TEMP TABLE short_busy ON COMMIT DROP AS
SELECT DISTINCT street_id FROM (
  SELECT short_part.street_id FROM short_part JOIN label ON label.street_edge_id = short_part.part_id
  UNION ALL
  SELECT short_part.street_id FROM short_part
  JOIN audit_task ON audit_task.street_edge_id = short_part.part_id
  JOIN label ON label.audit_task_id = audit_task.audit_task_id
  UNION ALL
  SELECT short_part.street_id FROM short_part
  JOIN audit_task_comment ON audit_task_comment.edge_id = short_part.part_id
  UNION ALL
  SELECT short_part.street_id FROM short_part
  JOIN audit_task ON audit_task.street_edge_id = short_part.part_id
  JOIN audit_task_comment ON audit_task_comment.audit_task_id = audit_task.audit_task_id
  UNION ALL
  SELECT short_part.street_id FROM short_part
  JOIN audit_task ON audit_task.street_edge_id = short_part.part_id
  JOIN audit_task_user_route ON audit_task_user_route.audit_task_id = audit_task.audit_task_id
  UNION ALL
  SELECT short_part.street_id FROM short_part JOIN route_street ON route_street.street_edge_id = short_part.part_id
) AS busy;
CREATE TEMP TABLE residue ON COMMIT DROP AS
SELECT edge.id, edge.m, edge.geom, edge.status, edge.osm_way_id,
       NOT EXISTS (SELECT FROM short_busy WHERE short_busy.street_id = edge.id) AS trivial
FROM edge
WHERE edge.m < :drop_m AND NOT edge.active;
ALTER TABLE residue ADD PRIMARY KEY (id);
ANALYZE residue;

-- Audits that go: the bare ones on joined streets, and every one on a street about to be deleted (nothing real sits
-- on those, or they would not be deleted).
CREATE TEMP TABLE task_delete ON COMMIT DROP AS
SELECT audit_task_id FROM task_move WHERE bare
UNION
SELECT audit_task.audit_task_id
FROM audit_task
JOIN residue ON residue.id = audit_task.street_edge_id
WHERE residue.trivial;

-- A label on a disabled street is as good as lost, so it is re-filed under the nearest open street if one is close,
-- measured against the lines as they will be after the joins: a survivor often grows right past the label.
CREATE TEMP TABLE label_refile ON COMMIT DROP AS
SELECT label.label_id, label.street_edge_id AS from_id, nearest.id AS to_id, nearest.distance_m
FROM label
JOIN member ON member.part_id = label.street_edge_id
JOIN residue ON residue.id = member.street_id
JOIN label_point ON label_point.label_id = label.label_id AND label_point.geom IS NOT NULL
CROSS JOIN LATERAL (
  SELECT edge.id, ST_Distance(label_point.geom::geography, edge.geom::geography) AS distance_m
  FROM edge
  WHERE edge.status = 'open'
    AND NOT EXISTS (SELECT FROM residue WHERE residue.id = edge.id)
    AND edge.geom && ST_Expand(label_point.geom, 0.0005)
  ORDER BY edge.geom <-> label_point.geom
  LIMIT 1
) AS nearest
WHERE nearest.distance_m <= :refile_m;

CREATE TEMP TABLE merge_count ON COMMIT DROP AS
SELECT (SELECT count(*) FROM street_merge WHERE rule = 'same_way') AS joined_same_way,
       (SELECT count(*) FROM street_merge WHERE rule = 'continuation') AS joined_continuation,
       (SELECT count(*) FROM street_merge WHERE rule = 'border_cut') AS joined_at_border,
       (SELECT count(*) FROM street_merge WHERE rule = 'straightest') AS joined_straightest,
       (SELECT count(*) FROM survivor) AS survivors,
       (SELECT coalesce(max(depth), 0) FROM final_merge) AS longest_chain,
       (SELECT round((coalesce(sum(drop_m), 0) / 1000.0)::numeric, 2) FROM street_merge) AS km_joined,
       (SELECT count(*) FROM street_merge WHERE reversed) AS slivers_drawn_backwards,
       (SELECT count(*) FROM region_move) AS survivors_region_changed,
       (SELECT count(*) FROM label_move) AS labels_moved,
       (SELECT count(*) FROM task_move WHERE NOT bare) AS audits_moved,
       (SELECT count(*) FROM survivor_walked WHERE NOT covered) AS survivors_short_of_walked,
       (SELECT count(*) FROM audit_task
          JOIN survivor_walked ON survivor_walked.id = audit_task.street_edge_id
          WHERE audit_task.completed AND NOT survivor_walked.covered)
       + (SELECT count(*) FROM task_move
            JOIN survivor_walked ON survivor_walked.id = task_move.to_id
            WHERE task_move.completed AND NOT task_move.bare AND NOT survivor_walked.covered)
         AS audits_marked_not_completed,
       (SELECT count(*) FROM task_delete) AS bare_audits_deleted,
       (SELECT count(*) FROM task_offset) AS drop_in_starts_remeasured,
       (SELECT count(*) FROM task_range) AS coverage_remeasured,
       (SELECT count(*) FROM route_stop_after
          WHERE moved AND NOT EXISTS (SELECT FROM route_stop_drop
                                      WHERE route_stop_drop.route_street_id = route_stop_after.route_street_id))
         AS route_stops_moved,
       (SELECT count(*) FROM route_touched) AS routes_remeasured,
       (SELECT count(*) FROM route_stop_drop) AS route_stops_dropped_as_repeats,
       (SELECT count(*) FROM residue WHERE trivial) AS residue_deleted,
       (SELECT count(*) FROM residue WHERE NOT trivial) AS residue_disabled,
       (SELECT round((coalesce(sum(m), 0) / 1000.0)::numeric, 2) FROM residue) AS km_residue,
       (SELECT count(*) FROM label_refile) AS residue_labels_refiled,
       (SELECT count(*) FROM label
          JOIN member ON member.part_id = label.street_edge_id
          JOIN residue ON residue.id = member.street_id
          WHERE NOT EXISTS (SELECT FROM label_refile WHERE label_refile.label_id = label.label_id))
         AS residue_labels_left,
       (SELECT round(max(distance_m)::numeric, 1) FROM label_refile) AS refiled_label_farthest_m;

-- 7. Apply the joins. Everything from here on writes to real tables, so a plan run stops before it.
\if :plan
\else
UPDATE street_edge
SET geom = edge.geom,
    x1 = ST_X(ST_StartPoint(edge.geom)), y1 = ST_Y(ST_StartPoint(edge.geom)),
    x2 = ST_X(ST_EndPoint(edge.geom)), y2 = ST_Y(ST_EndPoint(edge.geom))
FROM survivor
JOIN edge ON edge.id = survivor.id
WHERE street_edge.street_edge_id = survivor.id;

UPDATE label SET street_edge_id = label_move.to_id
FROM label_move WHERE label.label_id = label_move.label_id;

-- Every label on a survivor, moved or not: the line it is measured against changed. Column from evolution 377.
UPDATE label_point
SET centerline_offset_m = label_centerline_offset_m(label_point.geom, street_edge.geom)
FROM label, street_edge
WHERE label_point.label_id = label.label_id
  AND street_edge.street_edge_id = label.street_edge_id
  AND label.street_edge_id IN (SELECT id FROM survivor)
  AND label_point.geom IS NOT NULL;

-- interaction_small references interaction, so it goes first.
UPDATE mission SET current_audit_task_id = NULL
WHERE current_audit_task_id IN (SELECT audit_task_id FROM task_delete);
DELETE FROM audit_task_environment WHERE audit_task_id IN (SELECT audit_task_id FROM task_delete);
DELETE FROM audit_task_interaction_small WHERE audit_task_id IN (SELECT audit_task_id FROM task_delete);
DELETE FROM audit_task_interaction WHERE audit_task_id IN (SELECT audit_task_id FROM task_delete);
DELETE FROM audit_task WHERE audit_task_id IN (SELECT audit_task_id FROM task_delete);

-- A completed audit stands for the whole street, so it holds only while the walked parts cover enough of the joined
-- line. A paused audit remembers which end it started from, so a sliver drawn the other way turns that around.
UPDATE audit_task SET completed = FALSE
FROM survivor_walked
WHERE audit_task.street_edge_id = survivor_walked.id AND audit_task.completed AND NOT survivor_walked.covered;
UPDATE audit_task
SET street_edge_id = task_move.to_id,
    completed = audit_task.completed AND survivor_walked.covered,
    start_point_reversed = audit_task.start_point_reversed <> task_move.reversed
FROM task_move
JOIN survivor_walked ON survivor_walked.id = task_move.to_id
WHERE audit_task.audit_task_id = task_move.audit_task_id AND NOT task_move.bare;

-- A drop-in audit's start, re-measured along the line it now sits on (the survivor's start is shared unless a sliver
-- was added there, in which case the start moved).
UPDATE audit_task
SET start_offset_m = ST_LineLocatePoint(street_edge.geom, task_offset.started_at)
                     * ST_Length(street_edge.geom::geography)
FROM task_offset, street_edge
WHERE audit_task.audit_task_id = task_offset.audit_task_id
  AND street_edge.street_edge_id = audit_task.street_edge_id;
\if :has_coverage
UPDATE audit_task SET covered_ranges = task_range.covered_ranges
FROM task_range WHERE audit_task.audit_task_id = task_range.audit_task_id;
\endif

UPDATE audit_task_user_route SET route_street_id = route_stop_drop.kept_route_street_id
FROM route_stop_drop WHERE audit_task_user_route.route_street_id = route_stop_drop.route_street_id;
DELETE FROM route_street WHERE route_street_id IN (SELECT route_street_id FROM route_stop_drop);
UPDATE route_street
SET street_edge_id = final_merge.survivor_id, reverse = route_street.reverse <> final_merge.reversed
FROM final_merge WHERE route_street.street_edge_id = final_merge.drop_id;

UPDATE street_edge_issue SET street_edge_id = final_merge.survivor_id
FROM final_merge WHERE street_edge_issue.street_edge_id = final_merge.drop_id;
UPDATE cluster SET street_edge_id = final_merge.survivor_id
FROM final_merge WHERE cluster.street_edge_id = final_merge.drop_id;
UPDATE audit_task_comment SET edge_id = final_merge.survivor_id
FROM final_merge WHERE audit_task_comment.edge_id = final_merge.drop_id;
-- These say which street a label's old position was measured against, so they follow the street.
UPDATE old_label_point_coords SET street_edge_id = final_merge.survivor_id
FROM final_merge WHERE old_label_point_coords.street_edge_id = final_merge.drop_id;
UPDATE old_label_point_position SET street_edge_id = final_merge.survivor_id
FROM final_merge WHERE old_label_point_position.street_edge_id = final_merge.drop_id;
UPDATE place
SET nearest_street_edge_id = final_merge.survivor_id,
    nearest_street_distance_m = ST_Distance(place.geom::geography, street_edge.geom::geography)
FROM final_merge, street_edge
WHERE place.nearest_street_edge_id = final_merge.drop_id
  AND street_edge.street_edge_id = final_merge.survivor_id;

-- 8. Survivors move to the region holding most of them.
UPDATE street_edge_region SET region_id = region_move.to_region_id
FROM region_move WHERE street_edge_region.street_edge_id = region_move.street_edge_id;

-- 9. The survivor lists every way it or its slivers lay on, unpositioned: its line changed, so the positions along
--    those ways no longer hold (#5741), and the lineage backfill recomputes them afterwards.
CREATE TEMP TABLE survivor_way ON COMMIT DROP AS
SELECT DISTINCT COALESCE(final_merge.survivor_id, osm_way_street_edge.street_edge_id) AS street_edge_id,
       osm_way_street_edge.osm_way_id
FROM osm_way_street_edge
LEFT JOIN final_merge ON final_merge.drop_id = osm_way_street_edge.street_edge_id
WHERE final_merge.drop_id IS NOT NULL OR osm_way_street_edge.street_edge_id IN (SELECT id FROM survivor);
DELETE FROM osm_way_street_edge
WHERE street_edge_id IN (SELECT id FROM survivor) OR street_edge_id IN (SELECT drop_id FROM final_merge);
--    A schema restored from a dump can have the id sequence behind the table.
SELECT setval(pg_get_serial_sequence('osm_way_street_edge', 'osm_way_street_edge_id'),
              (SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge), false);
INSERT INTO osm_way_street_edge (osm_way_id, street_edge_id)
SELECT osm_way_id, street_edge_id FROM survivor_way;

--    The slivers go: the rows that are theirs alone, the trace, then the street (street_edge_region, status changes,
--    reopen candidates, sidewalk presence, intersections, access scores and gradients cascade).
DELETE FROM street_edge_priority WHERE street_edge_id IN (SELECT drop_id FROM final_merge);
DELETE FROM street_imagery WHERE street_edge_id IN (SELECT drop_id FROM final_merge);
INSERT INTO street_edge_merge (dropped_street_edge_id, survivor_street_edge_id, rule, dropped_length_m, dropped_geom,
                               dropped_osm_way_id)
SELECT street_merge.drop_id, final_merge.survivor_id, street_merge.rule, street_merge.drop_m, street_merge.drop_geom,
       street_merge.drop_osm_way_id
FROM street_merge
JOIN final_merge ON final_merge.drop_id = street_merge.drop_id;
DELETE FROM street_edge WHERE street_edge_id IN (SELECT drop_id FROM final_merge);

-- 10. The residue with history.
INSERT INTO street_edge_status_change (street_edge_id, old_status, new_status, source)
SELECT residue.id, residue.status, 'disabled', 'consolidate_tiny_streets'
FROM residue WHERE NOT residue.trivial;
UPDATE street_edge SET status = 'disabled'
WHERE street_edge_id IN (SELECT id FROM residue WHERE NOT trivial);
DELETE FROM street_edge_priority WHERE street_edge_id IN (SELECT id FROM residue);

UPDATE label SET street_edge_id = label_refile.to_id
FROM label_refile WHERE label.label_id = label_refile.label_id;
UPDATE label_point
SET centerline_offset_m = label_centerline_offset_m(label_point.geom, street_edge.geom)
FROM label_refile, label, street_edge
WHERE label_point.label_id = label_refile.label_id
  AND label.label_id = label_refile.label_id
  AND street_edge.street_edge_id = label.street_edge_id;
UPDATE old_label_point_coords SET street_edge_id = label_refile.to_id
FROM label_refile WHERE old_label_point_coords.label_id = label_refile.label_id;
UPDATE old_label_point_position SET street_edge_id = label_refile.to_id
FROM label_refile WHERE old_label_point_position.label_id = label_refile.label_id;

-- A place's nearest street should be one people can use, whether the old one stays as a row or not.
CREATE TEMP TABLE place_repoint ON COMMIT DROP AS
SELECT place.place_id, nearest.street_edge_id,
       ST_Distance(place.geom::geography, nearest.geom::geography) AS distance_m
FROM place
JOIN residue ON residue.id = place.nearest_street_edge_id
CROSS JOIN LATERAL (
  SELECT street_edge.street_edge_id, street_edge.geom
  FROM street_edge
  WHERE street_edge.status = 'open'
    AND NOT EXISTS (SELECT FROM residue WHERE residue.id = street_edge.street_edge_id)
    AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
  ORDER BY street_edge.geom <-> place.geom
  LIMIT 1
) AS nearest;
UPDATE place
SET nearest_street_edge_id = place_repoint.street_edge_id, nearest_street_distance_m = place_repoint.distance_m
FROM place_repoint WHERE place.place_id = place_repoint.place_id;

-- 11. The trivial residue goes (its audits went with task_delete above).
DELETE FROM street_edge_issue WHERE street_edge_id IN (SELECT id FROM residue WHERE trivial);
DELETE FROM cluster WHERE street_edge_id IN (SELECT id FROM residue WHERE trivial);
-- The backups of past label-position migrations (179, 352) name the street each label sat on then. A label whose
-- street was this one has since been re-attributed to the street it sits on now, so the backup follows it there.
UPDATE old_label_point_coords SET street_edge_id = label.street_edge_id
FROM label
WHERE old_label_point_coords.label_id = label.label_id
  AND old_label_point_coords.street_edge_id IN (SELECT id FROM residue WHERE trivial);
UPDATE old_label_point_position SET street_edge_id = label.street_edge_id
FROM label
WHERE old_label_point_position.label_id = label.label_id
  AND old_label_point_position.street_edge_id IN (SELECT id FROM residue WHERE trivial);
DELETE FROM osm_way_street_edge WHERE street_edge_id IN (SELECT id FROM residue WHERE trivial);
DELETE FROM street_imagery WHERE street_edge_id IN (SELECT id FROM residue WHERE trivial);
INSERT INTO street_edge_merge (dropped_street_edge_id, survivor_street_edge_id, rule, dropped_length_m, dropped_geom,
                               dropped_osm_way_id)
SELECT residue.id, NULL, 'residue', residue.m, residue.geom, residue.osm_way_id FROM residue WHERE residue.trivial;
DELETE FROM street_edge WHERE street_edge_id IN (SELECT id FROM residue WHERE trivial);

-- 12. Cached figures. A route's length and street count sit on its row; region completion refills on the next
--     landing-page load (emptying it locks the table, so a city with nothing to do is skipped).
UPDATE route
SET distance_meters = coalesce(stats.distance_meters, 0), street_count = coalesce(stats.street_count, 0)
FROM (
  SELECT route_street.route_id, sum(ST_Length(street_edge.geom::geography)) AS distance_meters,
         count(*) AS street_count
  FROM route_street
  JOIN street_edge ON street_edge.street_edge_id = route_street.street_edge_id
  WHERE route_street.route_id IN (SELECT route_id FROM route_touched)
  GROUP BY route_street.route_id
) AS stats
WHERE route.route_id = stats.route_id;

DO $$
BEGIN
  IF EXISTS (SELECT FROM street_merge) OR EXISTS (SELECT FROM residue) THEN
    TRUNCATE TABLE region_completion;
  END IF;
END $$;

\endif

-- 13. Output: one row per touched street with -v list=1, otherwise one summary row whose check_ columns should all
--     be 0 (streets still under drop_m that are not disabled, routes walking a street twice the same way, and work
--     moved onto a street in a deleted region); a plan run leaves them empty, since nothing was changed to check.
\if :list
  SELECT :'city' AS city, street_merge.drop_id AS street_edge_id, 'joined' AS action, street_merge.rule,
         final_merge.survivor_id, round(street_merge.drop_m::numeric, 2) AS length_m, street_merge.reversed,
         ST_AsText(street_merge.drop_geom) AS wkt
  FROM street_merge
  JOIN final_merge ON final_merge.drop_id = street_merge.drop_id
  UNION ALL
  SELECT :'city', residue.id, CASE WHEN residue.trivial THEN 'deleted' ELSE 'disabled' END, 'residue', NULL,
         round(residue.m::numeric, 2), NULL, ST_AsText(residue.geom)
  FROM residue
  ORDER BY 2;
\else
  SELECT :'city' AS city,
         :apply::int = 1 AS applied,
         :plan::int = 1 AS plan_only,
         count_before.*,
         merge_count.*,
         CASE WHEN :plan::int = 1 THEN NULL ELSE (SELECT count(*) FROM street_edge
          WHERE status <> 'disabled' AND ST_Length(geom::geography) < :drop_m
            AND street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
            AND NOT EXISTS (SELECT FROM audit_task WHERE audit_task.street_edge_id = street_edge.street_edge_id
                            AND audit_task.task_start >= now() - interval '1 day')) END
           AS check_short_streets_left,
         CASE WHEN :plan::int = 1 THEN NULL ELSE (SELECT count(*) FROM (
            SELECT route_id, street_edge_id, reverse FROM route_street
            WHERE route_id IN (SELECT route_id FROM route_touched)
            GROUP BY route_id, street_edge_id, reverse HAVING count(*) > 1) AS repeated) END
           AS check_routes_visiting_twice,
         (SELECT count(*) FROM work_moved_out_of_sight) AS check_work_moved_out_of_sight
  FROM count_before, merge_count;
\endif

\if :plan
  ROLLBACK;
\else
  \if :apply
    COMMIT;
  \else
    ROLLBACK;
  \endif
\endif
