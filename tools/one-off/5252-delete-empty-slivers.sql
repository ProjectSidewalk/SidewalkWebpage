-- Delete 16 empty regions whose names duplicate another region's (#5252). Written against evolution 374
-- (v11.11.0); applied on prod 2026-09-09.
--
-- Each is named after its district (瑞芳區, 中正區, ...) because the source data had no village name for it. None
-- has a street or label, so nobody could ever work in them; they only cluttered the region picker. Eleven are thin
-- coastal strips in New Taipei; five are Keelung's 八斗子 strip and four offshore islands.
--
-- Empty regions whose names weren't duplicated were left for 5252-fix-district-remainders.sql.
--
-- THIS DELETES FOR GOOD. Run on new_taipei and keelung only:
--     scp tools/one-off/5252-delete-empty-slivers.sql saugstad@makelab1.cs.washington.edu:sidewalk-server-tools/current-query.sql
--     ./run-query-in-every-city.sh -p -m -c "new_taipei keelung" -o "5252-slivers-deleted"
--     scp saugstad@makelab1.cs.washington.edu:sidewalk-server-tools/5252-slivers-deleted.csv scratchpad/
-- Expect 16 rows (11 new_taipei, 5 keelung). A region is deleted only if its id and name still match and nothing
-- points at it, so fewer rows means a region changed since this was written. Rerunning is safe; it does nothing.
--
-- The runner sets the search_path.
WITH doomed (schema_name, region_id, old_name) AS (VALUES
  ('sidewalk_new_taipei', 890, '貢寮區'),
  ('sidewalk_new_taipei', 902, '貢寮區'),
  ('sidewalk_new_taipei', 4153, '瑞芳區'),
  ('sidewalk_new_taipei', 4155, '瑞芳區'),
  ('sidewalk_new_taipei', 4156, '瑞芳區'),
  ('sidewalk_new_taipei', 5357, '萬里區'),
  ('sidewalk_new_taipei', 5362, '萬里區'),
  ('sidewalk_new_taipei', 5363, '萬里區'),
  ('sidewalk_new_taipei', 5364, '萬里區'),
  ('sidewalk_new_taipei', 7488, '石門區'),
  ('sidewalk_new_taipei', 7497, '石門區'),
  ('sidewalk_keelung', 2493, '中正區'),
  ('sidewalk_keelung', 3617, '中正區'),
  ('sidewalk_keelung', 3618, '中正區'),
  ('sidewalk_keelung', 3619, '中正區'),
  ('sidewalk_keelung', 3626, '中正區')
),
targets AS (
  SELECT region.region_id
  FROM region
  INNER JOIN doomed ON doomed.region_id = region.region_id AND doomed.old_name = region.name
  WHERE doomed.schema_name = current_schema()
    AND NOT EXISTS (SELECT 1 FROM street_edge_region WHERE street_edge_region.region_id = region.region_id)
    AND NOT EXISTS (SELECT 1 FROM mission WHERE mission.region_id = region.region_id)
    AND NOT EXISTS (SELECT 1 FROM route WHERE route.region_id = region.region_id)
    AND NOT EXISTS (SELECT 1 FROM clustering_session WHERE clustering_session.region_id = region.region_id)
    AND NOT EXISTS (SELECT 1 FROM user_current_region WHERE user_current_region.region_id = region.region_id)
),
gone AS (
  DELETE FROM region WHERE region_id IN (SELECT region_id FROM targets) RETURNING region_id, name
)
SELECT current_schema() AS schema_name, region_id, name AS deleted_name FROM gone ORDER BY region_id;
