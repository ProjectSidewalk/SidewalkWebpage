# --- !Ups
-- #5741: a street's full OpenStreetMap lineage. The street builder joins consecutive OSM ways between intersections
-- and tools/one-off/4717-consolidate-tiny-streets.sql joins more, so one street can lie on several ways and one way
-- usually holds several streets. Contributing street-side data back to OSM (sidewalk:left=no on a way) needs, per
-- street and way, which stretch of each the pair shares and whether they run the same direction. The link table now
-- holds one row per street-way pair with that position, and a row without one (a city built before this, a hand-built
-- street layer, the Infra3d placeholder way -1) still names the way.
ALTER TABLE osm_way_street_edge DROP CONSTRAINT osm_way_street_edge_street_edge_id_key;
ALTER TABLE osm_way_street_edge
  ADD COLUMN street_from_frac DOUBLE PRECISION CHECK (street_from_frac >= 0 AND street_from_frac <= 1),
  ADD COLUMN street_to_frac DOUBLE PRECISION CHECK (street_to_frac >= 0 AND street_to_frac <= 1),
  ADD COLUMN way_from_frac DOUBLE PRECISION CHECK (way_from_frac >= 0 AND way_from_frac <= 1),
  ADD COLUMN way_to_frac DOUBLE PRECISION CHECK (way_to_frac >= 0 AND way_to_frac <= 1),
  ADD COLUMN same_direction BOOLEAN,
  ADD COLUMN matched_at TIMESTAMPTZ,
  -- A position is the whole set of columns or none of them, and both intervals read in their own line's direction.
  ADD CONSTRAINT osm_way_street_edge_position_all_or_none_check CHECK (
    (street_from_frac IS NULL) = (street_to_frac IS NULL) AND (street_from_frac IS NULL) = (way_from_frac IS NULL)
    AND (street_from_frac IS NULL) = (way_to_frac IS NULL) AND (street_from_frac IS NULL) = (same_direction IS NULL)
    AND (street_from_frac IS NULL) = (matched_at IS NULL)
  ),
  ADD CONSTRAINT osm_way_street_edge_intervals_ascend_check CHECK (
    street_from_frac < street_to_frac AND way_from_frac < way_to_frac
  ),
  -- A street can return to the same way (a way that loops back across it), so the start along the street is part of
  -- the key. NULLS NOT DISTINCT so an unpositioned pair can be stored once.
  ADD CONSTRAINT osm_way_street_edge_street_way_position_key
    UNIQUE NULLS NOT DISTINCT (street_edge_id, osm_way_id, street_from_frac);

-- The one way per street the APIs name as *the* way: the way covering most of the street, an unpositioned row counting
-- as the whole street, ties to the lowest id. The DISTINCT ON columns are what a join filters on, so the planner pushes
-- a street id filter inside.
CREATE VIEW osm_way_street_edge_primary AS
SELECT DISTINCT ON (street_edge_id) street_edge_id, osm_way_id
FROM osm_way_street_edge
ORDER BY street_edge_id, COALESCE(street_to_frac - street_from_frac, 1) DESC, osm_way_id;

-- The way under a point of the street (a label, a cluster, an end), by its fraction along the street. A street with
-- no positioned row covering the point answers with its primary way, so the call never comes back empty for a
-- linked street. NULLS LAST on the covering test, since DESC alone would put the unpositioned rows first.
CREATE FUNCTION osm_way_at_fraction(street integer, frac double precision) RETURNS bigint
LANGUAGE sql STABLE AS
$BODY$
  SELECT osm_way_id
  FROM osm_way_street_edge
  WHERE street_edge_id = street
  ORDER BY (street_from_frac <= frac AND frac <= street_to_frac) DESC NULLS LAST,
           COALESCE(street_to_frac - street_from_frac, 1) DESC, osm_way_id
  LIMIT 1
$BODY$;

-- What the nightly refresh already reads off the OSM API and threw away: a way's edit version and the time of that
-- edit. A link positioned before the way's last edit may no longer fit it.
ALTER TABLE osm_way ADD COLUMN osm_version INTEGER, ADD COLUMN osm_timestamp TIMESTAMPTZ;

# --- !Downs
ALTER TABLE osm_way DROP COLUMN osm_timestamp, DROP COLUMN osm_version;
DROP FUNCTION osm_way_at_fraction(integer, double precision);
-- Back to one row per street: the primary way's row, then the lowest id if that way has several positions.
DELETE FROM osm_way_street_edge
USING osm_way_street_edge_primary
WHERE osm_way_street_edge.street_edge_id = osm_way_street_edge_primary.street_edge_id
  AND osm_way_street_edge.osm_way_id <> osm_way_street_edge_primary.osm_way_id;
DELETE FROM osm_way_street_edge
USING (SELECT street_edge_id, MIN(osm_way_street_edge_id) AS keep_id
       FROM osm_way_street_edge
       GROUP BY street_edge_id) keeper
WHERE osm_way_street_edge.street_edge_id = keeper.street_edge_id
  AND osm_way_street_edge.osm_way_street_edge_id <> keeper.keep_id;
DROP VIEW osm_way_street_edge_primary;
ALTER TABLE osm_way_street_edge
  DROP CONSTRAINT osm_way_street_edge_street_way_position_key,
  DROP CONSTRAINT osm_way_street_edge_intervals_ascend_check,
  DROP CONSTRAINT osm_way_street_edge_position_all_or_none_check,
  DROP COLUMN matched_at,
  DROP COLUMN same_direction,
  DROP COLUMN way_to_frac,
  DROP COLUMN way_from_frac,
  DROP COLUMN street_to_frac,
  DROP COLUMN street_from_frac,
  ADD CONSTRAINT osm_way_street_edge_street_edge_id_key UNIQUE (street_edge_id);
