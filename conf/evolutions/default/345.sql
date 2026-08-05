# --- !Ups
-- Cached OSM way data (#4654). The speed-limit sign is served from here instead of live client-side Overpass API
-- queries (which flooded the shared community instance with a request per pano move). Rows keyed 'batch' are written by
-- the nightly refresh of every way in osm_way_street_edge, while 'on_demand' rows are ways discovered by the /speedLimit
-- point-lookup fallback and carry geometry so later lookups near them hit our DB instead of Overpass. tags holds the
-- way's full OSM tag map (Overpass returns it either way, and future features can mine name/sidewalk/surface/etc.
-- without re-fetching). maxspeed is extracted from tags at write time by OsmWayService, the single write path. A NULL
-- maxspeed means the way was fetched but carries no maxspeed tag. geom is NULL on batch rows because street_edge
-- geometry already locates them. No FK to osm_way_street_edge: on_demand ways are generally outside our street network.
CREATE TABLE osm_way (
    osm_way_id BIGINT PRIMARY KEY,
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    maxspeed TEXT,
    geom geometry(LineString, 4326),
    source TEXT NOT NULL CHECK (source IN ('batch', 'on_demand')),
    updated_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE osm_way OWNER TO sidewalk;
CREATE INDEX osm_way_geom_idx ON osm_way USING GIST (geom);

# --- !Downs
DROP TABLE osm_way;
