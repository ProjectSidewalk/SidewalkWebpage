# --- !Ups
-- Some label_point.geom values were stored with SRID 0 instead of 4326 (the lat/lng coordinate system). The bbox
-- filter on the public label API now relies on this column (#4238), so normalize the SRID for consistency. The `&&`
-- bbox operator ignores SRID, but other spatial predicates (ST_Intersects/ST_DWithin) require it to match.
UPDATE label_point SET geom = ST_SetSRID(geom, 4326) WHERE geom IS NOT NULL AND ST_SRID(geom) <> 4326;

# --- !Downs
-- No-op: the original (mixed/0) SRID values are not recoverable and tagging them 4326 is a pure correction.
