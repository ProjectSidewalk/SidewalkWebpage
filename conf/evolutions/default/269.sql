# --- !Ups
CREATE INDEX idx_street_edge_geom ON street_edge USING GIST(geom);
CREATE INDEX idx_region_geom ON region USING GIST(geom);

# --- !Downs
DROP INDEX idx_region_geom;
DROP INDEX idx_street_edge_geom;
