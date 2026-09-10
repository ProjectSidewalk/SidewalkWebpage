-- Fill osm_way_street_edge from the parent-edge rows 24.pre.sql saved. The modern table holds one way per street
-- (338 makes it UNIQUE) while ~2,900 legacy streets were stitched from several ways, so a street takes the way that
-- covers most of it, measured against today's OSM geometry from harness/fetch-osm-ways.sh (a way OSM has since
-- deleted scores zero; ties and geometry-less groups fall to the lowest id). The pick is kept for the report.
CREATE TABLE dc_migration_osm_way_geom (osm_way_id BIGINT PRIMARY KEY, wkt TEXT);
\copy dc_migration_osm_way_geom FROM '/tmp/dc-events/osm_ways.csv' CSV HEADER
ALTER TABLE dc_migration_osm_way_geom ADD COLUMN geom geometry(LineString, 4326);
UPDATE dc_migration_osm_way_geom SET geom = ST_GeomFromText(wkt, 4326);
CREATE INDEX ON dc_migration_osm_way_geom USING gist (geom);

CREATE TABLE dc_migration_osm_way_pick AS
WITH scored AS (
  SELECT pe.street_edge_id, pe.osm_way_id,
         count(*) OVER (PARTITION BY pe.street_edge_id) AS candidates,
         CASE WHEN w.geom IS NULL THEN 0
              ELSE ST_Length(ST_Intersection(se.geom, ST_Buffer(w.geom::geography, 15)::geometry)::geography)
         END AS overlap_m,
         ST_Length(se.geom::geography) AS street_m
  FROM dc_migration_parent_edge pe
  JOIN street_edge se ON se.street_edge_id = pe.street_edge_id
  LEFT JOIN dc_migration_osm_way_geom w ON w.osm_way_id = pe.osm_way_id
)
SELECT DISTINCT ON (street_edge_id) street_edge_id, osm_way_id, candidates, round(overlap_m::numeric) AS overlap_m,
       round(street_m::numeric) AS street_m,
       CASE WHEN candidates = 1 THEN 'single' WHEN overlap_m > 0 THEN 'overlap' ELSE 'no geometry' END AS how
FROM scored
ORDER BY street_edge_id, overlap_m DESC, osm_way_id;

INSERT INTO osm_way_street_edge (osm_way_id, street_edge_id)
SELECT osm_way_id, street_edge_id FROM dc_migration_osm_way_pick ORDER BY street_edge_id;
DROP TABLE dc_migration_osm_way_geom;

SELECT 'osm way picks' AS what, how, count(*) FROM dc_migration_osm_way_pick GROUP BY how ORDER BY 2;
SELECT 'multi-way streets where the pick covers under half the street' AS what, count(*)
FROM dc_migration_osm_way_pick WHERE candidates > 1 AND overlap_m < street_m / 2;
SELECT 'streets without a way' AS what, count(*) FROM street_edge
WHERE NOT EXISTS (SELECT 1 FROM osm_way_street_edge WHERE osm_way_street_edge.street_edge_id = street_edge.street_edge_id);
