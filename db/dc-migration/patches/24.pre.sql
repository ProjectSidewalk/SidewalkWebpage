-- 24 drops street_edge_parent_edge, the only record of which OSM way each DC street was cut from, and creates
-- osm_way_street_edge empty; every modern street, raw-label and cluster API inner-joins that table, so 25.pre.sql
-- fills it from this copy. Sixteen legacy rows name another street as the parent; one hop reaches its ways.
CREATE TABLE dc_migration_parent_edge AS
SELECT DISTINCT p.street_edge_id, COALESCE(p2.parent_edge_id, p.parent_edge_id) AS osm_way_id
FROM street_edge_parent_edge p
LEFT JOIN street_edge_parent_edge p2
  ON p.parent_edge_id IN (SELECT street_edge_id FROM street_edge) AND p2.street_edge_id = p.parent_edge_id
WHERE COALESCE(p2.parent_edge_id, p.parent_edge_id) NOT IN (SELECT street_edge_id FROM street_edge);
SELECT 'parent edges kept' AS what, count(*) AS rows, count(DISTINCT street_edge_id) AS streets,
       count(DISTINCT osm_way_id) AS ways
FROM dc_migration_parent_edge;
