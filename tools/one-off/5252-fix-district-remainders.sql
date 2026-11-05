-- Clean up the 11 district-level regions the renaming skipped (#5252). Written against evolution 374 (v11.11.0);
-- applied on prod 2026-09-09.
--
-- Each covers land in a district that no village (里) covers, like a riverbed or harbour, and is named just after
-- the district (三重區), or in Kaohsiung with 代管 ("run directly by the district"). After 5252-rename-regions.sql
-- they would have been the only names in the picker without a district prefix. The 7 with no streets or work are
-- deleted; the 4 with streets are renamed to <district>代管, following Kaohsiung.
--
-- THIS DELETES FOR GOOD. Run on new_taipei, keelung and kaohsiung only:
--     scp tools/one-off/5252-fix-district-remainders.sql saugstad@makelab1.cs.washington.edu:sidewalk-server-tools/current-query.sql
--     ./run-query-in-every-city.sh -p -m -c "new_taipei keelung kaohsiung" -o "5252-remainders-fixed"
--     scp saugstad@makelab1.cs.washington.edu:sidewalk-server-tools/5252-remainders-fixed.csv scratchpad/
-- Expect 11 rows: 7 deleted, 4 renamed. A change applies only if the region's id and name still match, and a delete
-- only if nothing points at the region. Rerunning is safe; it does nothing.
--
-- The runner sets the search_path.
BEGIN;

CREATE TEMP TABLE receipt (action text, region_id integer, name text);

WITH doomed (schema_name, region_id, old_name) AS (VALUES
  ('sidewalk_new_taipei', 753, '林口區'),
  ('sidewalk_new_taipei', 1421, '金山區'),
  ('sidewalk_new_taipei', 5067, '蘆洲區'),
  ('sidewalk_keelung', 1750, '仁愛區'),
  ('sidewalk_keelung', 2457, '中山區'),
  ('sidewalk_kaohsiung', 5494, '高雄市旗津區代管2'),
  ('sidewalk_kaohsiung', 5498, '高雄市旗津區代管1')
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
INSERT INTO receipt SELECT 'deleted', region_id, name FROM gone;

WITH renames (schema_name, region_id, old_name, new_name) AS (VALUES
  ('sidewalk_new_taipei', 1729, '永和區', '永和區代管'),
  ('sidewalk_new_taipei', 2606, '三重區', '三重區代管'),
  ('sidewalk_new_taipei', 5065, '淡水區', '淡水區代管'),
  ('sidewalk_keelung', 2497, '中正區', '中正區代管')
),
applied AS (
  UPDATE region
  SET name = renames.new_name
  FROM renames
  WHERE renames.schema_name = current_schema()
    AND renames.region_id = region.region_id
    AND renames.old_name = region.name
  RETURNING region.region_id, region.name
)
INSERT INTO receipt SELECT 'renamed', region_id, name FROM applied;

SELECT :'city' AS city, action, region_id, name FROM receipt ORDER BY action, region_id;

COMMIT;
