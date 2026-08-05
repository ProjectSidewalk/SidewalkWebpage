# --- !Ups
-- Street distances are now measured geodesically -- ST_Length over geography, accurate worldwide -- instead of by
-- projecting every city's geometry to UTM zone 18N (EPSG:26918), which is only correct near the US East Coast and
-- overstated lengths by up to +51% (Auckland) elsewhere (#4641). This migration recomputes every cached distance so
-- stored values agree with what the app now computes on the fly. Each statement mirrors the runtime recompute it
-- caches for -- named in the comment above it -- so the invariant "stored value == fresh recompute" holds afterwards.
-- mission.distance_meters / distance_progress are deliberately untouched: they are historical per-mission records
-- (fixed targets, or clipped to a region remainder at creation time) that nothing recomputes or compares globally.
--
-- These are full recomputes, not rescalings, so they also repair rows the nightly refresh had never reached: on the
-- Seattle dev dump 352 users have a completed audit task on an open street but meters_audited = 0 stored (#4774,
-- fixed alongside this migration -- UserStatTable.usersThatAuditedSinceCutoffTime now selects on completed audit
-- tasks, so nothing falls out of the nightly refresh again). Repairing them gives labels_per_meter = 0, which fails
-- the quality floor, so of the 432 high_quality flips this migration produces on that dump, 326 are that repair, 96
-- are the geodesic effect proper (shorter streets raise labels_per_meter, lifting users over the floor), and 10 are
-- other demotions.

-- The recomputes are expensive PostGIS queries, which can trip the broken JIT that ships in the projectsidewalk/db
-- image (#4376) and segfault the backend. Evolutions run with autocommit off, i.e. inside one transaction, so
-- SET LOCAL scopes the guard to this migration.
SET LOCAL jit = off;

-- region_completion: mirrors RegionService.initializeRegionCompletionTable. Only open streets excluding the tutorial
-- street count, and a street is audited when its priority has dropped below 1. Regions with no qualifying streets get
-- zeroes, matching what a fresh initialization would insert for them.
-- UPDATE ... FROM cannot LEFT JOIN its own target, so the target is re-listed under an alias and joined back by
-- primary key. Without that, regions missing from `recomputed` would keep their stale value instead of going to 0.
UPDATE region_completion
SET total_distance   = COALESCE(recomputed.total_distance, 0),
    audited_distance = COALESCE(recomputed.audited_distance, 0)
FROM region_completion AS current_completion
LEFT JOIN (
    SELECT street_edge_region.region_id,
           SUM(ST_Length(street_edge.geom::geography)) AS total_distance,
           SUM(ST_Length(street_edge.geom::geography)) FILTER (WHERE street_edge_priority.priority < 1.0) AS audited_distance
    FROM street_edge_region
    INNER JOIN street_edge ON street_edge_region.street_edge_id = street_edge.street_edge_id
    INNER JOIN street_edge_priority ON street_edge.street_edge_id = street_edge_priority.street_edge_id
    WHERE street_edge.status = 'open'
        AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
    GROUP BY street_edge_region.region_id
) recomputed ON current_completion.region_id = recomputed.region_id
WHERE region_completion.region_id = current_completion.region_id;

-- user_stat.meters_audited: mirrors UserStatTable.updateAuditedDistanceHelper -- per completed audit task (a street
-- audited by the same user twice counts twice), open streets excluding the tutorial street. Restricted to users with
-- at least one qualifying task, exactly the set a full runtime recompute would touch.
UPDATE user_stat
SET meters_audited = recomputed.meters_audited
FROM (
    SELECT audit_task.user_id, SUM(ST_Length(street_edge.geom::geography)) AS meters_audited
    FROM audit_task
    INNER JOIN street_edge ON audit_task.street_edge_id = street_edge.street_edge_id
    WHERE audit_task.completed
        AND street_edge.status = 'open'
        AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
    GROUP BY audit_task.user_id
) recomputed
WHERE user_stat.user_id = recomputed.user_id;

-- user_stat.labels_per_meter: mirrors UserStatTable.updateLabelsPerMeterHelper, which derives it from meters_audited
-- (recomputed above). Labels are counted through the user's audit missions, dropping deleted and tutorial labels and
-- anything on the tutorial street. Users with zero audited meters keep their value (runtime leaves it NULL for them).
UPDATE user_stat
SET labels_per_meter = COALESCE(label_counts.label_count, 0) / user_stat.meters_audited
FROM user_stat AS current_stat
LEFT JOIN (
    SELECT mission.user_id, COUNT(label.label_id) AS label_count
    FROM mission
    INNER JOIN label ON mission.mission_id = label.mission_id
    INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
    WHERE mission.mission_type = 'audit'
        AND NOT label.deleted
        AND NOT label.tutorial
        AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
        AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
    GROUP BY mission.user_id
) label_counts ON current_stat.user_id = label_counts.user_id
WHERE user_stat.user_id = current_stat.user_id
    AND user_stat.meters_audited > 0;

-- user_stat.high_quality: labels_per_meter (just recomputed above) is an input to the quality heuristic, so refresh
-- the flag too. Mirrors UserStatTable.updateHighQuality, which is a pure function of user_stat columns -- the manual
-- override, then the 0.0375 labels-per-meter floor and the 60%-accuracy-at-50+-validations floor -- so this writes
-- exactly what any runtime refresh of the same row would.
-- The WHERE repeats the expression rather than joining a subquery that computes it once, for two reasons: both the
-- SET and the filter must read the row being updated (user_id carries no UNIQUE constraint and duplicate rows exist,
-- #4776, so a self-join on it can match the wrong row), and without the filter this rewrites every user_stat row --
-- 995k rows and 10s of the migration's 11s on the Seattle dump, to change 432 of them.
UPDATE user_stat
SET high_quality =
    NOT excluded
    AND COALESCE(high_quality_manual, TRUE)
    AND (COALESCE(high_quality_manual, FALSE)
         OR ((meters_audited = 0 OR COALESCE(labels_per_meter, 5) > 0.0375)
             AND (COALESCE(accuracy, 1.0) > 0.6 OR own_labels_validated < 50)))
WHERE high_quality IS DISTINCT FROM (
    NOT excluded
    AND COALESCE(high_quality_manual, TRUE)
    AND (COALESCE(high_quality_manual, FALSE)
         OR ((meters_audited = 0 OR COALESCE(labels_per_meter, 5) > 0.0375)
             AND (COALESCE(accuracy, 1.0) > 0.6 OR own_labels_validated < 50))));

-- route.distance_meters: mirrors RouteTable.updateStats -- every street on the route regardless of status. Routes
-- with no streets stay at 0.
UPDATE route
SET distance_meters = recomputed.distance_meters
FROM (
    SELECT route_street.route_id, SUM(ST_Length(street_edge.geom::geography)) AS distance_meters
    FROM route_street
    INNER JOIN street_edge ON route_street.street_edge_id = street_edge.street_edge_id
    GROUP BY route_street.route_id
) recomputed
WHERE route.route_id = recomputed.route_id;

# --- !Downs
-- Reverting this migration means reverting to code that measures through UTM zone 18N, so the caches are recomputed
-- under that measure again. The point is not to restore the exact prior bytes -- some of them were stale, and the Up
-- repaired that -- but to leave the caches agreeing with whatever code is about to read them. Leaving the geodesic
-- values in place instead is what makes a downgrade silently wrong: region completion, dashboards and the leaderboard
-- would mix geodesic caches with UTM-measured live queries, with nothing to signal it. Each statement below is its
-- Up counterpart with ST_Length(geom::geography) swapped for the projected measure.
SET LOCAL jit = off;

UPDATE region_completion
SET total_distance   = COALESCE(recomputed.total_distance, 0),
    audited_distance = COALESCE(recomputed.audited_distance, 0)
FROM region_completion AS current_completion
LEFT JOIN (
    SELECT street_edge_region.region_id,
           SUM(ST_Length(ST_Transform(street_edge.geom, 26918))) AS total_distance,
           SUM(ST_Length(ST_Transform(street_edge.geom, 26918))) FILTER (WHERE street_edge_priority.priority < 1.0) AS audited_distance
    FROM street_edge_region
    INNER JOIN street_edge ON street_edge_region.street_edge_id = street_edge.street_edge_id
    INNER JOIN street_edge_priority ON street_edge.street_edge_id = street_edge_priority.street_edge_id
    WHERE street_edge.status = 'open'
        AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
    GROUP BY street_edge_region.region_id
) recomputed ON current_completion.region_id = recomputed.region_id
WHERE region_completion.region_id = current_completion.region_id;

UPDATE user_stat
SET meters_audited = recomputed.meters_audited
FROM (
    SELECT audit_task.user_id, SUM(ST_Length(ST_Transform(street_edge.geom, 26918))) AS meters_audited
    FROM audit_task
    INNER JOIN street_edge ON audit_task.street_edge_id = street_edge.street_edge_id
    WHERE audit_task.completed
        AND street_edge.status = 'open'
        AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
    GROUP BY audit_task.user_id
) recomputed
WHERE user_stat.user_id = recomputed.user_id;

UPDATE user_stat
SET labels_per_meter = COALESCE(label_counts.label_count, 0) / user_stat.meters_audited
FROM user_stat AS current_stat
LEFT JOIN (
    SELECT mission.user_id, COUNT(label.label_id) AS label_count
    FROM mission
    INNER JOIN label ON mission.mission_id = label.mission_id
    INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
    WHERE mission.mission_type = 'audit'
        AND NOT label.deleted
        AND NOT label.tutorial
        AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
        AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
    GROUP BY mission.user_id
) label_counts ON current_stat.user_id = label_counts.user_id
WHERE user_stat.user_id = current_stat.user_id
    AND user_stat.meters_audited > 0;

UPDATE user_stat
SET high_quality =
    NOT excluded
    AND COALESCE(high_quality_manual, TRUE)
    AND (COALESCE(high_quality_manual, FALSE)
         OR ((meters_audited = 0 OR COALESCE(labels_per_meter, 5) > 0.0375)
             AND (COALESCE(accuracy, 1.0) > 0.6 OR own_labels_validated < 50)))
WHERE high_quality IS DISTINCT FROM (
    NOT excluded
    AND COALESCE(high_quality_manual, TRUE)
    AND (COALESCE(high_quality_manual, FALSE)
         OR ((meters_audited = 0 OR COALESCE(labels_per_meter, 5) > 0.0375)
             AND (COALESCE(accuracy, 1.0) > 0.6 OR own_labels_validated < 50))));

UPDATE route
SET distance_meters = recomputed.distance_meters
FROM (
    SELECT route_street.route_id, SUM(ST_Length(ST_Transform(street_edge.geom, 26918))) AS distance_meters
    FROM route_street
    INNER JOIN street_edge ON route_street.street_edge_id = street_edge.street_edge_id
    GROUP BY route_street.route_id
) recomputed
WHERE route.route_id = recomputed.route_id;
