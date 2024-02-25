# --- !Ups
ALTER TABLE osm_way_street_edge
ALTER COLUMN osm_way_id TYPE BIGINT;

# --- !Downs
ALTER TABLE osm_way_street_edge
    ADD COLUMN osm_way_id_temp INT;
UPDATE osm_way_street_edge
    SET osm_way_id_temp = CAST(LEFT(osm_way_id::TEXT, 9) AS INT);
ALTER TABLE osm_way_street_edge
    DROP COLUMN osm_way_id;
ALTER TABLE osm_way_street_edge
    RENAME COLUMN osm_way_id_temp TO osm_way_id;
