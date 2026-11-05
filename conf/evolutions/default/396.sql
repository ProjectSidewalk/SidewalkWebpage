# --- !Ups
-- Places (#5311): the destinations that matter most to people with disabilities and to the city staff who plan for
-- them -- schools, health care, libraries, grocery stores, transit stops, parks, community centers -- so the
-- AccessScore map can show a red block as the block between a bus stop and a clinic. One row per place, as a point.
--
-- Rows come from OpenStreetMap: a weekly job (PlacesRefreshActor) queries Overpass for the city's bounds and replaces
-- the `source = 'osm'` rows, keeping each place's `place_id` across refreshes so a shared link or a logged event keeps
-- pointing at the same place. The catalog of categories and the OSM tags behind each is PlaceCategory (Scala), which
-- PlaceTableSpec checks against the CHECK below. A city may also load its own list as `source = 'city'` rows, which
-- the refresh never touches. Those carry no OSM reference, which the place_osm_ref_matches_source_check constraint pins.
--
-- The nearest street (within 250 m) and the containing region are computed at refresh time, so the map's place card
-- can show the score of the street a place sits on without any geometry work in the browser, and #5312 (a score for
-- a place) starts from a stored street rather than a search. `tags` keeps the object's whole OSM tag map for the
-- features that will want opening hours, wheelchair tags, or operator names without a second fetch.
--
-- `category` and `source` are text under a CHECK rather than enum types: the catalog is expected to grow (pharmacies
-- and playgrounds were added while it was being designed), and a new enum label cannot be used by an INSERT in the
-- same evolution that ADDs it (Postgres 55P04), while a CHECK list is one DROP CONSTRAINT / ADD CONSTRAINT.
--
-- Nothing is populated here: the first nightly tick after this evolution lands fills the table (an empty table is
-- always stale), and Admin > Management has a "Refresh places" button for sooner.
CREATE TABLE place (
    place_id SERIAL PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('school', 'health', 'library', 'grocery', 'transit', 'park', 'community')),
    name TEXT,
    source TEXT NOT NULL CHECK (source IN ('osm', 'city')),
    osm_type TEXT CHECK (osm_type IN ('node', 'way', 'relation')),
    osm_id BIGINT,
    tags JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(tags) = 'object'),
    geom geometry(Point, 4326) NOT NULL,
    region_id INTEGER REFERENCES region(region_id),
    -- No ON DELETE action: SET NULL would null the id alone and trip the paired-NULL check below. Streets are
    -- status-flagged rather than deleted, and the weekly refresh recomputes both columns anyway.
    nearest_street_edge_id INTEGER REFERENCES street_edge(street_edge_id),
    nearest_street_distance_m DOUBLE PRECISION CHECK (nearest_street_distance_m >= 0),
    fetched_at TIMESTAMPTZ NOT NULL,
    -- An OSM place has an OSM reference and a city-supplied one has none. Named, since Postgres takes place_osm_type_check
    -- for the inline check above.
    CONSTRAINT place_osm_ref_matches_source_check CHECK ((source = 'osm') = (osm_type IS NOT NULL AND osm_id IS NOT NULL)),
    -- The street distance is known exactly when the street is.
    CONSTRAINT place_street_distance_matches_street_check CHECK ((nearest_street_edge_id IS NULL) = (nearest_street_distance_m IS NULL)),
    CONSTRAINT place_osm_key UNIQUE (osm_type, osm_id)
);
CREATE INDEX place_geom_idx ON place USING gist (geom);
ALTER TABLE place OWNER TO sidewalk;

# --- !Downs
DROP TABLE IF EXISTS place;
