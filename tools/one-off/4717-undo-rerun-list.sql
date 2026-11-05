-- Read-only. SAFE TO RUN ON PROD. The runner sets search_path; one row per street.
-- #4717: every street the 2026-10-22 rerun touched (joined away, grown, or disabled), with that run's timestamp, so the
-- undo's restore file can be cut from the 2026-10-20 nightly backup for just these streets.
SELECT :'city' AS city, 'dropped' AS kind, dropped_street_edge_id AS street_edge_id, survivor_street_edge_id,
       merged_at AS run_at
FROM street_edge_merge
WHERE merged_at >= '2026-10-21'
UNION ALL
SELECT DISTINCT :'city', 'grown', survivor_street_edge_id, NULL::INTEGER, merged_at
FROM street_edge_merge
WHERE merged_at >= '2026-10-21' AND survivor_street_edge_id IS NOT NULL
UNION ALL
SELECT :'city', 'disabled', street_edge_id, NULL, changed_at
FROM street_edge_status_change
WHERE source = 'consolidate_tiny_streets' AND changed_at >= '2026-10-21'
ORDER BY 2, 3;
