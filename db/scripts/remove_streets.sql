-- =====================================================================
-- Remove a set of street_edges from the DB.
--   - Soft-delete (set `status = 'disabled'`) if any work exists on the street (audit_task, label, or route_street).
--   - Hard-delete otherwise, cleaning up FK-referenced tables first.
--
-- Tables with a FK to street_edge:
--   street_edge_priority, osm_way_street_edge, cluster, route_street, audit_task
-- Tables that reference street_edge_id without a FK constraint:
--   street_edge_region, street_edge_issue, label
--
-- Run inside a transaction so you can ROLLBACK if the preview looks wrong.
-- =====================================================================

BEGIN;

SET search_path TO sidewalk_seattle;  -- <<< change to the target city schema

-- 1. Candidate IDs. Edit this list.
CREATE TEMP TABLE streets_to_remove (street_edge_id INT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO streets_to_remove (street_edge_id) VALUES
    (2),
    (3);
    -- ... fill in

-- 2. Split into soft-delete vs hard-delete.
--    Any street with audit_task, label, or route_street rows is considered to have "work" on it and gets soft-deleted.
CREATE TEMP TABLE streets_to_soft_delete ON COMMIT DROP AS
SELECT DISTINCT streets_to_remove.street_edge_id
FROM streets_to_remove
WHERE EXISTS (SELECT 1 FROM audit_task WHERE audit_task.street_edge_id = streets_to_remove.street_edge_id)
    OR EXISTS (SELECT 1 FROM label WHERE label.street_edge_id = streets_to_remove.street_edge_id)
    OR EXISTS (SELECT 1 FROM route_street WHERE route_street.street_edge_id = streets_to_remove.street_edge_id);

CREATE TEMP TABLE streets_to_hard_delete ON COMMIT DROP AS
SELECT streets_to_remove.street_edge_id
FROM streets_to_remove
LEFT JOIN streets_to_soft_delete ON streets_to_soft_delete.street_edge_id = streets_to_remove.street_edge_id
WHERE streets_to_soft_delete.street_edge_id IS NULL;

-- 3. Preview. Sanity-check these counts before committing.
SELECT 'candidates'   AS bucket, COUNT(*) FROM streets_to_remove
UNION ALL
SELECT 'soft_delete'  AS bucket, COUNT(*) FROM streets_to_soft_delete
UNION ALL
SELECT 'hard_delete'  AS bucket, COUNT(*) FROM streets_to_hard_delete;

-- Optional: see which ones will be soft-deleted and why.
SELECT streets_to_soft_delete.street_edge_id,
       (SELECT COUNT(*) FROM audit_task WHERE audit_task.street_edge_id = streets_to_soft_delete.street_edge_id) AS audit_task_rows,
       (SELECT COUNT(*) FROM label WHERE label.street_edge_id = streets_to_soft_delete.street_edge_id) AS label_rows,
       (SELECT COUNT(*) FROM route_street WHERE route_street.street_edge_id = streets_to_soft_delete.street_edge_id) AS route_street_rows
FROM streets_to_soft_delete
ORDER BY streets_to_soft_delete.street_edge_id;

-- 4. Soft-delete: mark 'disabled' (the manual-removal catch-all in street_edge_status) and drop the priority row so
--    the street is no longer auditable, while keeping the row for the audit/label/route work that references it (#3888).
UPDATE street_edge
SET status = 'disabled'
WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_soft_delete);

DELETE FROM street_edge_priority WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_soft_delete);

-- 5. Hard-delete: clear FK-referenced tables, then delete the street_edge rows.

-- cluster_label cascades from cluster via ON DELETE CASCADE, so deleting cluster rows is enough.
DELETE FROM cluster WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete);

DELETE FROM street_edge_priority WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete);

DELETE FROM street_edge_region WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete);

DELETE FROM osm_way_street_edge WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete);

-- street_edge_issue has no FK but references street_edge_id; clean it up too so we don't leave orphaned issue reports.
DELETE FROM street_edge_issue WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete);

-- Finally, delete the actual streets.
DELETE FROM street_edge WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete);

-- Wipe the region_completion table. To be refilled on next load of the landing page.
TRUNCATE TABLE region_completion;

-- 6. Final check. Make sure none of the hard-delete IDs remain anywhere.
SELECT 'still_in_street_edge' AS where_found, COUNT(*) FROM street_edge
    WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete)
UNION ALL
SELECT 'still_in_priority', COUNT(*) FROM street_edge_priority
    WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete)
UNION ALL
SELECT 'still_in_region', COUNT(*) FROM street_edge_region
    WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete)
UNION ALL
SELECT 'still_in_osm_way', COUNT(*) FROM osm_way_street_edge
    WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete)
UNION ALL
SELECT 'still_in_issue', COUNT(*) FROM street_edge_issue
    WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete)
UNION ALL
SELECT 'still_in_cluster', COUNT(*) FROM cluster
    WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete)
UNION ALL
SELECT 'still_in_route_street', COUNT(*) FROM route_street
    WHERE street_edge_id IN (SELECT street_edge_id FROM streets_to_hard_delete);

-- If everything looks right:
COMMIT;
-- Otherwise:
-- ROLLBACK;
