-- =====================================================================
-- Merge duplicate streets (#3067).
--
-- Some cities have street_edge rows drawn on top of each other: the same OSM way imported twice, a road OSM later
-- deleted or kept only as an untagged line, or a short piece lying on a longer road. Explore then routes people back
-- down the street they just finished. This keeps one street per group, moves the others' data onto it, deletes them.
--
-- DRY RUN BY DEFAULT: everything is done inside a transaction and then rolled back, and one summary row per city is
-- printed. Pass -v apply=1 to commit instead. Built for sidewalk-server-tools/run-query-in-every-city.sh (-m), which
-- sets the search_path and the city variable; for one city by hand:
--   psql -v city=chicago -v apply=0 "options=--search_path=sidewalk_chicago,public" -f merge_duplicate_streets.sql
--
-- Which street stays, tested in this order:
--   1. Pairs where OSM says one is a bridge, a tunnel or on another layer are left alone: that's a road passing over
--      another, not a copy of it.
--   2. If only one of the two is open, the open one stays (DC has 2-5km no_imagery streets lying on top of the open
--      streets that replaced them).
--   3. If one is a piece of the other, the longer one stays.
--   4. Between twins, the one OSM no longer has as a road goes (deleted, or kept only as an untagged line).
--   5. Then the one with less user data on it goes, so less has to be moved.
--   6. Then the one that isn't already in the region holding most of its length goes, so nothing has to move.
--   7. Otherwise the newer id goes.
-- A street left more than 20m uncovered by the one it would merge into (-v max_gap_m=) is kept instead, so its
-- audits don't land on a much shorter road. Groups of three or more follow the chain to its end; a group that loops
-- has no clear keeper and is skipped, counted in skipped_streets.
--
-- What happens to a dropped street's data:
--   * Labels stay put and are re-filed under the nearest kept street, so a long street's labels spread over the
--     shorter ones replacing it. Their distance from the centre line is re-measured, since left/right comes from it.
--   * Audits, route stops, issues, clusters and comments move to the street it merged into. An audit covering only
--     part of its new street is marked not completed, so nobody is credited with distance that wasn't walked. Where
--     the two were drawn in opposite directions, routes and paused audits are flipped and a paused audit's distance
--     along the street is cleared. A route stop landing on a street the route already visits is dropped.
--   * Its OSM way link, priority and imagery rows go, then the street itself.
-- Each kept street moves to the live region holding most of its length. The nightly jobs rebuild priority, sidewalk
-- presence, clusters, intersections, access scores and user distance; region completion is cleared and refills.
--
-- The duplicate detection matches find_duplicate_streets.sql next to this file, which prints the pairs one per row;
-- use that to look at a city before applying. ~40s on the largest schema (Chicago, 331k streets).
-- =====================================================================

\set QUIET on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?tol_m}
\else
  \set tol_m 0.5
\endif
\if :{?min_len_m}
\else
  \set min_len_m 10.0
\endif
\if :{?min_cov}
\else
  \set min_cov 0.80
\endif
\if :{?max_gap_m}
\else
  \set max_gap_m 20.0
\endif

BEGIN;

-- 1. Every duplicate pair: one street >=80% inside a 0.5m corridor around the other, both >=10m long.
CREATE TEMP TABLE dup_decision ON COMMIT DROP AS
WITH scored AS MATERIALIZED (
  -- MATERIALIZED so the corridor maths runs once per pair, not once per use below (10 min instead of 30s).
  -- Longitude is squashed by cos(latitude) so the corridor is round rather than an oval.
  SELECT street_a.street_edge_id AS street_a_id, street_b.street_edge_id AS street_b_id,
         ST_Length(ST_Intersection(flat.geom_a, ST_Buffer(flat.geom_b, flat.tol_deg, 'quad_segs=4')))
           / NULLIF(ST_Length(flat.geom_a), 0) AS a_in_b,
         ST_Length(ST_Intersection(flat.geom_b, ST_Buffer(flat.geom_a, flat.tol_deg, 'quad_segs=4')))
           / NULLIF(ST_Length(flat.geom_b), 0) AS b_in_a
  FROM street_edge AS street_a
  JOIN street_edge AS street_b
    ON street_a.street_edge_id < street_b.street_edge_id
   AND street_a.geom && ST_Expand(street_b.geom, 0.00010)
  CROSS JOIN LATERAL (
    SELECT ST_Scale(street_a.geom, cos(radians(ST_Y(ST_StartPoint(street_a.geom)))), 1.0) AS geom_a,
           ST_Scale(street_b.geom, cos(radians(ST_Y(ST_StartPoint(street_a.geom)))), 1.0) AS geom_b,
           :tol_m / 111320.0 AS tol_deg
  ) AS flat
  -- The tutorial street is shared by every user's tutorial, so it is never touched.
  WHERE street_a.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
    AND street_b.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
),
pair AS (
  SELECT scored.street_a_id, scored.street_b_id, scored.a_in_b, scored.b_in_a
  FROM scored
  JOIN street_edge AS edge_a ON edge_a.street_edge_id = scored.street_a_id
  JOIN street_edge AS edge_b ON edge_b.street_edge_id = scored.street_b_id
  WHERE greatest(scored.a_in_b, scored.b_in_a) >= :min_cov
    AND ST_Length(edge_a.geom::geography) >= :min_len_m
    AND ST_Length(edge_b.geom::geography) >= :min_len_m
),
street_fact AS (
  SELECT street_edge.street_edge_id, street_edge.status::text AS status,
         -- Where the street sits vertically, from its OSM ways; untagged or unfetched ways read as ground level.
         coalesce(bool_or(coalesce(osm_way.tags ->> 'bridge', 'no') <> 'no'), FALSE) AS is_bridge,
         coalesce(bool_or(coalesce(osm_way.tags ->> 'tunnel', 'no') <> 'no'), FALSE) AS is_tunnel,
         coalesce(max(CASE WHEN osm_way.tags ->> 'layer' ~ '^-?[0-9]+$' THEN (osm_way.tags ->> 'layer')::int END),
                  0) AS layer,
         -- Rows exist only once the nightly refresh fetched the way, so empty tags mean untagged, not unknown.
         -- missing_since goes through to_jsonb so a schema behind evolution 382 still parses.
         count(osm_way_street_edge.osm_way_id) > 0
           AND count(osm_way_street_edge.osm_way_id) = count(osm_way.osm_way_id) FILTER (
             WHERE to_jsonb(osm_way) ->> 'missing_since' IS NOT NULL OR NOT osm_way.tags ? 'highway'
           ) AS gone_from_osm
  FROM street_edge
  LEFT JOIN osm_way_street_edge ON osm_way_street_edge.street_edge_id = street_edge.street_edge_id
  LEFT JOIN osm_way ON osm_way.osm_way_id = osm_way_street_edge.osm_way_id
  WHERE street_edge.street_edge_id IN (SELECT street_a_id FROM pair UNION SELECT street_b_id FROM pair)
  GROUP BY street_edge.street_edge_id, street_edge.status
),
street_data AS (
  SELECT street_fact.*,
         (SELECT count(*) FROM label
           WHERE label.street_edge_id = street_fact.street_edge_id AND label.deleted = FALSE)
           + (SELECT count(*) FROM audit_task WHERE audit_task.street_edge_id = street_fact.street_edge_id)
           AS n_user_data,
         (SELECT street_edge_region.region_id FROM street_edge_region
           WHERE street_edge_region.street_edge_id = street_fact.street_edge_id) AS region_id,
         -- Deleted regions are hidden everywhere in the app, so a street in one would vanish from the site.
         (SELECT region.region_id FROM region
           JOIN street_edge ON street_edge.street_edge_id = street_fact.street_edge_id
           WHERE region.geom && street_edge.geom AND NOT region.deleted
           ORDER BY ST_Length(ST_Intersection(street_edge.geom, region.geom)::geography) DESC, region.region_id
           LIMIT 1) AS best_region_id
  FROM street_fact
),
decided AS (
  SELECT pair.*,
         CASE
           WHEN data_a.is_bridge <> data_b.is_bridge OR data_a.is_tunnel <> data_b.is_tunnel
                OR data_a.layer <> data_b.layer THEN NULL
           WHEN data_a.status = 'open' AND data_b.status <> 'open' THEN 'b'
           WHEN data_b.status = 'open' AND data_a.status <> 'open' THEN 'a'
           WHEN pair.b_in_a < :min_cov THEN 'a'
           WHEN pair.a_in_b < :min_cov THEN 'b'
           WHEN data_a.gone_from_osm AND NOT data_b.gone_from_osm THEN 'a'
           WHEN data_b.gone_from_osm AND NOT data_a.gone_from_osm THEN 'b'
           WHEN data_a.n_user_data < data_b.n_user_data THEN 'a'
           WHEN data_b.n_user_data < data_a.n_user_data THEN 'b'
           WHEN data_a.region_id = data_a.best_region_id AND data_b.region_id IS DISTINCT FROM data_b.best_region_id
             THEN 'b'
           WHEN data_b.region_id = data_b.best_region_id AND data_a.region_id IS DISTINCT FROM data_a.best_region_id
             THEN 'a'
           ELSE 'b'
         END AS drop_side
  FROM pair
  JOIN street_data AS data_a ON data_a.street_edge_id = pair.street_a_id
  JOIN street_data AS data_b ON data_b.street_edge_id = pair.street_b_id
)
SELECT CASE drop_side WHEN 'a' THEN street_a_id ELSE street_b_id END AS drop_id,
       CASE drop_side WHEN 'a' THEN street_b_id ELSE street_a_id END AS keep_id,
       -- How much of the dropped street the kept one covers; picks the dropped street's main partner below.
       CASE drop_side WHEN 'a' THEN a_in_b ELSE b_in_a END AS drop_covered
FROM decided
WHERE drop_side IS NOT NULL;

-- 2. Each dropped street's main partner: the kept street covering the most of it.
CREATE TEMP TABLE best_partner ON COMMIT DROP AS
SELECT DISTINCT ON (drop_id) drop_id, keep_id
FROM dup_decision
ORDER BY drop_id, drop_covered DESC, keep_id;

-- 3. A partner can itself be dropped, so follow partners to a street nobody drops; a walk that loops is skipped.
--    Everything but the labels lands on that one street, so it has to be the same road — DC's 3.7km Clara Barton
--    Pkwy would otherwise merge into a 745m street. A street like that is kept instead, which shortens the chains
--    through it, so this repeats until nothing new is kept.
--    psql doesn't fill its variables in inside a $$ block, so the two the loop needs are passed as settings.
SET LOCAL merge.tol_m = :tol_m;
SET LOCAL merge.max_gap_m = :max_gap_m;
CREATE TEMP TABLE partly_replaced (drop_id INTEGER PRIMARY KEY, gap_m DOUBLE PRECISION) ON COMMIT DROP;
CREATE TEMP TABLE street_merge (drop_id INTEGER PRIMARY KEY, survivor_id INTEGER, only_part BOOLEAN,
                                reversed BOOLEAN) ON COMMIT DROP;
DO $$
DECLARE
  tol_deg DOUBLE PRECISION := current_setting('merge.tol_m')::float / 111320.0;
  max_gap DOUBLE PRECISION := current_setting('merge.max_gap_m')::float;
  passes INTEGER := 0;
  settled BOOLEAN;
BEGIN
  LOOP
    passes := passes + 1;
    -- A chain stops at a street being kept, so a street kept on an earlier pass can take in its own partners.
    DELETE FROM street_merge;
    INSERT INTO street_merge (drop_id, survivor_id)
    WITH RECURSIVE walk (drop_id, current_id, seen, looped) AS (
      SELECT drop_id, keep_id, ARRAY[drop_id, keep_id], drop_id = keep_id FROM best_partner
      UNION ALL
      SELECT walk.drop_id, best_partner.keep_id, walk.seen || best_partner.keep_id,
             best_partner.keep_id = ANY(walk.seen)
      FROM walk
      JOIN best_partner ON best_partner.drop_id = walk.current_id
      WHERE NOT walk.looped AND walk.current_id NOT IN (SELECT drop_id FROM partly_replaced)
    )
    SELECT walk.drop_id, walk.current_id
    FROM walk
    WHERE NOT walk.looped
      AND (walk.current_id IN (SELECT drop_id FROM partly_replaced)
           OR NOT EXISTS (SELECT FROM best_partner WHERE best_partner.drop_id = walk.current_id));

    -- The streets whose own survivor doesn't really cover them are the ones to keep on the next pass.
    CREATE TEMP TABLE next_partly_replaced ON COMMIT DROP AS
    SELECT street_merge.drop_id, gap.gap_m
    FROM street_merge
    JOIN street_edge AS dropped_edge ON dropped_edge.street_edge_id = street_merge.drop_id
    JOIN street_edge AS survivor_edge ON survivor_edge.street_edge_id = street_merge.survivor_id
    CROSS JOIN LATERAL (
      SELECT ST_Scale(dropped_edge.geom, cos(radians(ST_Y(ST_StartPoint(dropped_edge.geom)))), 1.0) AS dropped,
             ST_Scale(survivor_edge.geom, cos(radians(ST_Y(ST_StartPoint(dropped_edge.geom)))), 1.0) AS survivor
    ) AS flat
    CROSS JOIN LATERAL (
      SELECT (1 - ST_Length(ST_Intersection(flat.dropped, ST_Buffer(flat.survivor, tol_deg, 'quad_segs=4')))
                    / NULLIF(ST_Length(flat.dropped), 0)) * ST_Length(dropped_edge.geom::geography) AS gap_m
    ) AS gap
    WHERE gap.gap_m > max_gap;

    settled := NOT EXISTS (SELECT drop_id FROM next_partly_replaced EXCEPT SELECT drop_id FROM partly_replaced)
           AND NOT EXISTS (SELECT drop_id FROM partly_replaced EXCEPT SELECT drop_id FROM next_partly_replaced);
    DELETE FROM partly_replaced;
    INSERT INTO partly_replaced SELECT * FROM next_partly_replaced;
    DROP TABLE next_partly_replaced;

    EXIT WHEN settled;
    -- Each pass keeps a street the one before it dropped, so this settles in a few. Never settling is a bug, and
    -- stopping beats deleting streets on a half-made decision.
    IF passes >= 10 THEN
      RAISE EXCEPTION 'which streets to keep did not settle after % passes', passes;
    END IF;
  END LOOP;
END $$;

DELETE FROM street_merge WHERE drop_id IN (SELECT drop_id FROM partly_replaced);

-- A dropped street covering only part of its survivor: its audits must not count as walking the whole survivor.
UPDATE street_merge
SET only_part = ST_Length(ST_Intersection(flat.survivor, ST_Buffer(flat.dropped, flat.tol_deg, 'quad_segs=4')))
                  / NULLIF(ST_Length(flat.survivor), 0) < :min_cov
FROM street_edge AS dropped_edge, street_edge AS survivor_edge,
     LATERAL (
       SELECT ST_Scale(dropped_edge.geom, cos(radians(ST_Y(ST_StartPoint(dropped_edge.geom)))), 1.0) AS dropped,
              ST_Scale(survivor_edge.geom, cos(radians(ST_Y(ST_StartPoint(dropped_edge.geom)))), 1.0) AS survivor,
              :tol_m / 111320.0 AS tol_deg
     ) AS flat
WHERE dropped_edge.street_edge_id = street_merge.drop_id AND survivor_edge.street_edge_id = street_merge.survivor_id;

-- Saved routes and paused audits remember which end of a street to start from, so they have to be flipped where the
-- two streets were drawn in opposite directions.
-- Where each end of the dropped street falls along the survivor, as a 0-1 fraction; running the other way means the
-- start lands further along than the end. Comparing distances between endpoints instead gets a short piece in the
-- survivor's far half backwards, because its start is then nearer the survivor's end than its start.
UPDATE street_merge
SET reversed = ST_LineLocatePoint(survivor_edge.geom, ST_StartPoint(dropped_edge.geom))
                 > ST_LineLocatePoint(survivor_edge.geom, ST_EndPoint(dropped_edge.geom))
FROM street_edge AS dropped_edge, street_edge AS survivor_edge
WHERE dropped_edge.street_edge_id = street_merge.drop_id AND survivor_edge.street_edge_id = street_merge.survivor_id;

-- 4. Each label is re-filed under the closest of its dropped street's kept partners. Only label.street_edge_id changes.
CREATE TEMP TABLE label_refile ON COMMIT DROP AS
SELECT DISTINCT ON (label.label_id) label.label_id, label.street_edge_id AS from_id, candidate.survivor_id AS to_id,
       ST_Distance(label_point.geom::geography, survivor_edge.geom::geography) AS distance_m
FROM label
JOIN street_merge ON street_merge.drop_id = label.street_edge_id
LEFT JOIN label_point ON label_point.label_id = label.label_id
-- The kept streets this dropped street was paired with. A partner that is itself dropped stands in for wherever it
-- merges into; one that survives after all, because it looped or isn't really replaced, can hold labels as it is.
JOIN LATERAL (
  SELECT coalesce(partner_merge.survivor_id, dup_decision.keep_id) AS survivor_id
  FROM dup_decision
  LEFT JOIN street_merge AS partner_merge ON partner_merge.drop_id = dup_decision.keep_id
  WHERE dup_decision.drop_id = label.street_edge_id
  UNION
  SELECT street_merge.survivor_id
) AS candidate ON TRUE
JOIN street_edge AS survivor_edge ON survivor_edge.street_edge_id = candidate.survivor_id
-- A label with no point falls back to the street its dropped street merged into.
ORDER BY label.label_id,
         CASE WHEN label_point.geom IS NULL THEN (candidate.survivor_id <> street_merge.survivor_id)::int END,
         ST_Distance(label_point.geom::geography, survivor_edge.geom::geography),
         candidate.survivor_id;

-- 5. A route stop whose street merges into one the route already walks the same way would send the user down it
--    twice, the very bug this fixes, so the later stop goes. Walking a street once each way is a deliberate
--    out-and-back (evolution 344), so direction is part of what counts as a repeat. Positions are only a walking
--    order, so the gap a deleted stop leaves is fine.
CREATE TEMP TABLE route_stop_after ON COMMIT DROP AS
SELECT route_street.route_street_id, route_street.route_id, route_street.position,
       coalesce(street_merge.survivor_id, route_street.street_edge_id) AS street_edge_id,
       route_street.reverse <> coalesce(street_merge.reversed, FALSE) AS reverse,
       street_merge.drop_id IS NOT NULL AS moved
FROM route_street
LEFT JOIN street_merge ON street_merge.drop_id = route_street.street_edge_id;

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
-- Only a repeat the merge itself created; two stops that already sat on this street are the route's own business.
WHERE later_stop.moved OR first_stop.moved;

-- The routes whose stops are about to change, so their cached length and street count can be redone afterwards.
CREATE TEMP TABLE route_touched ON COMMIT DROP AS
SELECT DISTINCT route_id FROM route_street WHERE street_edge_id IN (SELECT drop_id FROM street_merge);

-- Counts taken before anything changes, for the summary row.
CREATE TEMP TABLE merge_count ON COMMIT DROP AS
SELECT (SELECT count(*) FROM dup_decision) AS dup_pairs,
       (SELECT count(*) FROM street_merge) AS streets_dropped,
       (SELECT count(DISTINCT survivor_id) FROM street_merge) AS streets_kept,
       (SELECT count(*) FROM best_partner
          WHERE drop_id NOT IN (SELECT drop_id FROM street_merge)
            AND drop_id NOT IN (SELECT drop_id FROM partly_replaced)) AS skipped_streets,
       (SELECT count(*) FROM partly_replaced) AS left_partly_replaced,
       (SELECT round((sum(ST_Length(street_edge.geom::geography)) / 1000.0)::numeric, 2)
          FROM street_edge WHERE street_edge_id IN (SELECT drop_id FROM street_merge)) AS km_dropped,
       (SELECT count(*) FROM label_refile) AS labels_refiled,
       -- How far the farthest re-filed label sits from its new street; a large value means a bad match.
       (SELECT round(max(distance_m)::numeric, 1) FROM label_refile) AS label_farthest_from_new_street_m,
       (SELECT count(*) FROM audit_task WHERE street_edge_id IN (SELECT drop_id FROM street_merge)) AS audits_moved,
       (SELECT count(*) FROM audit_task
          JOIN street_merge ON street_merge.drop_id = audit_task.street_edge_id
          WHERE audit_task.completed AND street_merge.only_part) AS audits_marked_not_completed,
       (SELECT count(*) FROM route_street
          WHERE street_edge_id IN (SELECT drop_id FROM street_merge)) AS route_stops_moved,
       (SELECT count(*) FROM route_stop_drop) AS route_stops_dropped_as_repeats,
       (SELECT count(*) FROM street_edge_issue
          WHERE street_edge_id IN (SELECT drop_id FROM street_merge)) AS issues_moved,
       -- Streets whose replacement runs the other way, so saved routes and paused audits get flipped to match.
       (SELECT count(*) FROM street_merge WHERE reversed) AS streets_drawn_backwards;

-- 6. Move everything users did on the dropped streets.
UPDATE label SET street_edge_id = label_refile.to_id FROM label_refile WHERE label.label_id = label_refile.label_id;

-- A label's distance from the centre line, and the left/right side derived from it, were measured against the
-- street it just left, and nothing else in the app recomputes them. Column from evolution 377.
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'label_point'
               AND column_name = 'centerline_offset_m') THEN
    EXECUTE 'UPDATE label_point
             SET centerline_offset_m = label_centerline_offset_m(label_point.geom, street_edge.geom)
             FROM label_refile, label, street_edge
             WHERE label_point.label_id = label_refile.label_id
               AND label.label_id = label_refile.label_id
               AND street_edge.street_edge_id = label.street_edge_id
               AND label_point.geom IS NOT NULL';
  END IF;
END $$;

-- A paused audit remembers which end it started from, so a street drawn the other way turns that around. An audit
-- covering only part of its new street stops counting as finished, so the street isn't marked done for distance
-- nobody walked. start_offset_m is left as it is: a task that has one started mid-street, and that is exactly what
-- stops Explore handing the street back and letting someone finish ground they never covered (#4451,
-- AuditTaskTable). It is measured from the start of the road, which the survivor shares -- except where the survivor
-- runs the other way, where it would point at the wrong end, so that task is left finished instead of reopened.
UPDATE audit_task
SET street_edge_id = street_merge.survivor_id,
    completed = CASE WHEN street_merge.reversed AND audit_task.start_offset_m IS NOT NULL THEN TRUE
                     ELSE audit_task.completed AND NOT street_merge.only_part END,
    start_point_reversed = audit_task.start_point_reversed <> street_merge.reversed
FROM street_merge
WHERE audit_task.street_edge_id = street_merge.drop_id;

-- Repeat stops go, after anything recorded against them is pointed at the stop that stays.
UPDATE audit_task_user_route SET route_street_id = route_stop_drop.kept_route_street_id
FROM route_stop_drop WHERE audit_task_user_route.route_street_id = route_stop_drop.route_street_id;
DELETE FROM route_street WHERE route_street_id IN (SELECT route_street_id FROM route_stop_drop);

UPDATE route_street
SET street_edge_id = street_merge.survivor_id,
    reverse = route_street.reverse <> street_merge.reversed
FROM street_merge WHERE route_street.street_edge_id = street_merge.drop_id;

UPDATE street_edge_issue SET street_edge_id = street_merge.survivor_id
FROM street_merge WHERE street_edge_issue.street_edge_id = street_merge.drop_id;

UPDATE cluster SET street_edge_id = street_merge.survivor_id
FROM street_merge WHERE cluster.street_edge_id = street_merge.drop_id;

UPDATE audit_task_comment SET edge_id = street_merge.survivor_id
FROM street_merge WHERE audit_task_comment.edge_id = street_merge.drop_id;

-- These say which street a label's old position was measured against, so they follow the label, not the street.
UPDATE old_label_point_coords SET street_edge_id = label_refile.to_id
FROM label_refile WHERE old_label_point_coords.label_id = label_refile.label_id;
UPDATE old_label_point_coords SET street_edge_id = street_merge.survivor_id
FROM street_merge WHERE old_label_point_coords.street_edge_id = street_merge.drop_id;

UPDATE old_label_point_position SET street_edge_id = label_refile.to_id
FROM label_refile WHERE old_label_point_position.label_id = label_refile.label_id;
UPDATE old_label_point_position SET street_edge_id = street_merge.survivor_id
FROM street_merge WHERE old_label_point_position.street_edge_id = street_merge.drop_id;

-- place arrived in evolution 396. The weekly refresh would re-measure the distance, but not for days, so the
-- distance to the new nearest street is measured here too.
DO $$
BEGIN
  IF to_regclass(current_schema() || '.place') IS NOT NULL THEN
    EXECUTE 'UPDATE place
             SET nearest_street_edge_id = street_merge.survivor_id,
                 nearest_street_distance_m = ST_Distance(place.geom::geography, street_edge.geom::geography)
             FROM street_merge, street_edge
             WHERE place.nearest_street_edge_id = street_merge.drop_id
               AND street_edge.street_edge_id = street_merge.survivor_id';
  END IF;
END $$;

-- 7. Put each kept street in the live region holding most of its length; a deleted region would hide it.
CREATE TEMP TABLE region_move ON COMMIT DROP AS
SELECT street_edge_region.street_edge_id, street_edge_region.region_id AS from_region_id, best.region_id AS to_region_id
FROM street_edge_region
JOIN street_edge ON street_edge.street_edge_id = street_edge_region.street_edge_id
CROSS JOIN LATERAL (
  SELECT region.region_id FROM region
  WHERE region.geom && street_edge.geom AND NOT region.deleted
  ORDER BY ST_Length(ST_Intersection(street_edge.geom, region.geom)::geography) DESC, region.region_id
  LIMIT 1
) AS best
WHERE street_edge_region.street_edge_id IN (SELECT survivor_id FROM street_merge)
  AND street_edge_region.region_id <> best.region_id;

UPDATE street_edge_region SET region_id = region_move.to_region_id
FROM region_move WHERE street_edge_region.street_edge_id = region_move.street_edge_id;

-- Checked here, while the dropped streets still have their regions. A street is hidden everywhere in the app while
-- its region is deleted, so work moving off a street people can see onto one they can't would vanish from the site.
-- It can happen when no live region covers the street being kept, which leaves nowhere for the move above to go.
CREATE TEMP TABLE work_moved_out_of_sight ON COMMIT DROP AS
SELECT street_merge.drop_id
FROM street_merge
JOIN street_edge_region AS dropped_region ON dropped_region.street_edge_id = street_merge.drop_id
JOIN region AS dropped_in ON dropped_in.region_id = dropped_region.region_id
JOIN street_edge_region AS survivor_region ON survivor_region.street_edge_id = street_merge.survivor_id
JOIN region AS survivor_in ON survivor_in.region_id = survivor_region.region_id
WHERE survivor_in.deleted AND NOT dropped_in.deleted;

-- 8. Delete what belongs only to the dropped streets (one row per street each, so nothing can move), then the
--    streets. street_edge_region, street_edge_status_change, street_reopen_candidate, sidewalk presence,
--    intersections, access scores and gradients cascade. The nightly jobs rebuild intersections and access scores;
--    a kept street's shape never changes here, so its gradient stays right.
DELETE FROM osm_way_street_edge WHERE street_edge_id IN (SELECT drop_id FROM street_merge);
DELETE FROM street_edge_priority WHERE street_edge_id IN (SELECT drop_id FROM street_merge);
DELETE FROM street_imagery WHERE street_edge_id IN (SELECT drop_id FROM street_merge);
DELETE FROM street_edge WHERE street_edge_id IN (SELECT drop_id FROM street_merge);

-- Every route's length and street count is cached on the route row, and only redone when its streets change.
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

-- Refills on the next landing-page load. Emptying it locks the table, so a city with nothing to merge is skipped.
DO $$
BEGIN
  IF EXISTS (SELECT FROM street_merge) THEN
    TRUNCATE TABLE region_completion;
  END IF;
END $$;

-- 9. One summary row. The last two columns are checks on the finished state and should both be 0.
SELECT :'city' AS city,
       :apply::int = 1 AS applied,
       merge_count.*,
       (SELECT count(*) FROM region_move) AS kept_streets_region_changed,
       -- Every route that had a stop moved, checked for the bug this is all about: the same street walked the same
       -- way twice. Once each way is an out-and-back, which routes are allowed to do.
       (SELECT count(*) FROM (
          SELECT route_id, street_edge_id, reverse FROM route_street
          WHERE route_id IN (SELECT route_id FROM route_touched)
          GROUP BY route_id, street_edge_id, reverse HAVING count(*) > 1) AS repeated) AS check_routes_visiting_twice,
       (SELECT count(*) FROM work_moved_out_of_sight) AS check_work_moved_out_of_sight
FROM merge_count;

\if :apply
  COMMIT;
\else
  ROLLBACK;
\endif
