# --- !Ups
-- Repairs streets falsely marked audited by no-imagery reports (#4918, #4922). A transient pano-load failure made
-- Explore report a street as imagery-less, and the server answered by marking the whole street audited: a completed
-- audit_task plus a street-priority drop, which together credit region coverage and the reporter's meters_audited. A
-- client reload loop submitted such reports at ~0.5 s per street, leaving ~3,370 streets (~130 km) across 29 cities
-- carrying audited state that no one produced.
--
-- The repair un-completes every completed task matching the report signature, then recomputes all derived state from
-- the corrected tasks. The signature -- sub-3-second task, zero labels, and a PanoNotAvailable street_edge_issue row
-- from the same user on the same street within 3 seconds of task_end -- is the shape every accepted no-imagery report
-- wrote, and only reports wrote: a real audit does not insert a street_edge_issue row. Genuine no-imagery reports
-- match too, deliberately: under the current contract (ExploreService.insertNoImagery) a report is evidence, not an
-- audit, so those streets return to open/un-audited and leave the pool only when the offline imagery checker
-- (check_streets_for_imagery.py -> street_edge.status = 'no_imagery') confirms them. Reports attached to substantive
-- sessions (any labels, or more than 3 seconds on the street) keep their completed state: a human actually worked
-- those streets. mission rows are deliberately untouched, as in 347.sql: historical per-mission records that nothing
-- recomputes.
--
-- The recomputes are expensive PostGIS queries, which can trip the broken JIT that ships in the projectsidewalk/db
-- image (#4376) and segfault the backend. Evolutions run inside one transaction, so SET LOCAL scopes the guard here.
SET LOCAL jit = off;

-- Un-complete the falsely-audited tasks. Everything below re-derives cached state from audit_task.completed, so this
-- must run first.
-- Access path at prod scale: one seq scan of audit_task with the cheap completed/duration filters applied first;
-- the planner runs NOT EXISTS(label) as a hash anti-join (one scan of label, hashed on audit_task_id) and
-- EXISTS(street_edge_issue) as a hash semi-join on (street_edge_id, user_id) with the timestamp window as a join
-- filter -- street_edge_issue tops out at ~11k rows (kaohsiung). No per-row index probes needed.
UPDATE audit_task
SET completed = FALSE
WHERE completed
    AND task_end - task_start < INTERVAL '3 seconds'
    AND NOT EXISTS (SELECT 1 FROM label WHERE label.audit_task_id = audit_task.audit_task_id)
    AND EXISTS (
        SELECT 1
        FROM street_edge_issue
        WHERE street_edge_issue.street_edge_id = audit_task.street_edge_id
            AND street_edge_issue.user_id = audit_task.user_id
            AND street_edge_issue.issue = 'PanoNotAvailable'
            AND street_edge_issue.timestamp BETWEEN audit_task.task_end - INTERVAL '3 seconds'
                                                AND audit_task.task_end + INTERVAL '3 seconds'
    );

-- user_stat.meters_audited: mirrors UserStatTable.updateAuditedDistanceHelper -- per completed audit task (a street
-- audited by the same user twice counts twice), open streets excluding the tutorial street. Same statement as
-- 347.sql, re-run because the un-complete above shrank some users' qualifying task sets.
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

-- Users whose only completed tasks were the false ones fall out of the recompute above (no qualifying rows left), and
-- the runtime recompute never visits such users either -- they drop out of its join the same way -- so without this
-- their stored meters (pure loop credit) would survive indefinitely. Zero them directly.
-- Access path: NOT EXISTS becomes a hash anti-join -- one pass over completed audit_task joined to street_edge,
-- hashed on user_id, probed by the user_stat rows that pass the meters_audited <> 0 filter. No correlated re-execution.
UPDATE user_stat
SET meters_audited = 0
WHERE meters_audited <> 0
    AND NOT EXISTS (
        SELECT 1
        FROM audit_task
        INNER JOIN street_edge ON audit_task.street_edge_id = street_edge.street_edge_id
        WHERE audit_task.user_id = user_stat.user_id
            AND audit_task.completed
            AND street_edge.status = 'open'
            AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
    );

-- user_stat.labels_per_meter: mirrors UserStatTable.updateLabelsPerMeterHelper, which derives it from meters_audited
-- (recomputed above). Same statement as 347.sql. The false tasks carry no labels, so affected users' label counts are
-- unchanged while their meters shrank -- their labeling frequency rises, which can only lift high_quality, not sink it.
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

-- user_stat.high_quality: labels_per_meter (just recomputed) is an input to the quality heuristic, so refresh the
-- flag. Same statement as 347.sql, including the reasons the WHERE repeats the expression instead of joining a
-- subquery: both the SET and the filter must read the row being updated (user_id carries no UNIQUE constraint and
-- duplicate rows exist, #4776), and the filter keeps the rewrite to the rows that actually change.
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

-- street_edge_priority.priority: mirrors StreetEdgePriorityTable.selectGoodBadUserCompletionCountPriority (via
-- recalculateStreetPriority, which the nightly RecalculateStreetPriorityActor runs) -- so the falsely-completed tasks
-- are already folded into every affected street's stored priority, and un-completing them requires this recompute
-- rather than an undo of the per-report increments. Runs after the user_stat recomputes because good/bad user
-- classification reads user_stat.high_quality/excluded. Per street: completed tasks deduped on (user, quality flags,
-- outdated_imagery), split into good-user audits on current imagery, good-user audits on since-replaced imagery
-- (capped at a flat 0.5, #4384), and bad-user audits (0.25 each). Priority is 1 with no good-user audit at all, else
-- 1 / (1 + fresh_good + outdated_half + 0.25 * bad). Only open streets are recomputed, matching the runtime's
-- streetsWithTutorial source (non-open streets have no priority row to begin with -- the hide scripts delete them).
-- Access path: one scan of audit_task feeds the DISTINCT (hash aggregate), one hash join against user_stat on
-- user_id, one hash aggregate per street, then a hash join to street_edge_priority on its UNIQUE street_edge_id.
-- Every statement here is single-pass over its big tables -- nothing is probed per row.
UPDATE street_edge_priority
SET priority = recomputed.priority
FROM (
    SELECT street_edge.street_edge_id,
           CASE WHEN COUNT(*) FILTER (WHERE completions.is_good) = 0
                THEN 1.0
                ELSE 1.0 / (1.0
                    + COUNT(*) FILTER (WHERE completions.is_good AND NOT completions.outdated_imagery)
                    + CASE WHEN COUNT(*) FILTER (WHERE completions.is_good AND completions.outdated_imagery) > 0
                           THEN 0.5 ELSE 0.0 END
                    + 0.25 * COUNT(*) FILTER (WHERE NOT completions.is_good))
           END AS priority
    FROM street_edge
    LEFT JOIN (
        SELECT completed_audit.street_edge_id, completed_audit.outdated_imagery,
               (user_stat.high_quality
                AND NOT (completed_audit.low_quality OR completed_audit.incomplete OR completed_audit.stale)
               ) AS is_good
        FROM (
            SELECT DISTINCT street_edge_id, user_id, low_quality, incomplete, stale, outdated_imagery
            FROM audit_task
            WHERE completed
        ) completed_audit
        INNER JOIN user_stat ON completed_audit.user_id = user_stat.user_id
        WHERE NOT user_stat.excluded
    ) completions ON street_edge.street_edge_id = completions.street_edge_id
    WHERE street_edge.status = 'open'
    GROUP BY street_edge.street_edge_id
) recomputed
WHERE street_edge_priority.street_edge_id = recomputed.street_edge_id;

-- region_completion: mirrors RegionService.initializeRegionCompletionTable -- open streets excluding the tutorial
-- street, a street counting as audited when its priority (just recomputed) is below 1. Same statement as 347.sql,
-- including the alias-and-rejoin so regions with no qualifying streets go to 0 instead of keeping a stale value.
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

# --- !Downs
-- Data repair only: nothing to restore. The audited state the Up removes was false under every code version, and no
-- derived-value formula changes with this migration, so the recomputed caches already agree with what any runtime
-- recompute writes, before or after a rollback.
SELECT 1;
