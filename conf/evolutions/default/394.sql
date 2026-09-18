# --- !Ups
-- AccessScore Spotlight (#5215): the nightly ranking the landing page and /cities read. Both tables are written at
-- the end of the clustering run, which is the only thing that moves a score, so the pages never recompute a city's
-- AccessScore at request time.
--
-- The two tables keep their rows differently, on purpose. A region snapshot is 1 row per region per night (~80 rows
-- for Seattle), so keeping every run gives a score history for free. A street snapshot is 1 row per OSM way per
-- region (~12k for Seattle), which would be millions of rows a year for a history nobody asked for, so each run
-- replaces the last.
--
-- `score` is nullable in both: a region with no audited street and a way nobody has explored have no score, and
-- their rows are still what the module counts as "M total" and lists as "closest to being ranked".
CREATE TABLE region_access_score (
  region_access_score_id SERIAL PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES region(region_id) ON DELETE CASCADE,
  score DOUBLE PRECISION CHECK (score >= 0 AND score <= 1),
  completion_rate DOUBLE PRECISION NOT NULL CHECK (completion_rate >= 0 AND completion_rate <= 1),
  audited_distance_m DOUBLE PRECISION NOT NULL CHECK (audited_distance_m >= 0),
  -- The neighborhood's size and how much evidence sits behind its score, which the module prints under its name so
  -- a reader can weigh a 74 in a 9 mi neighborhood against a 74 in a 0.5 mi one.
  total_distance_m DOUBLE PRECISION NOT NULL CHECK (total_distance_m >= 0),
  cluster_count INTEGER NOT NULL CHECK (cluster_count >= 0),
  computed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (region_id, computed_at)
);
ALTER TABLE region_access_score OWNER TO sidewalk;
-- Every read is "the newest run", i.e. an ORDER BY / MAX over this column.
CREATE INDEX region_access_score_computed_at_idx ON region_access_score (computed_at);

-- One row per named stretch of street: the edges of one OSM way that fall in one region, since a way crosses
-- neighborhoods and a reader needs to know which "Rainier Ave S" this is. `street_edge_id` is the longest edge in
-- the group, which is what the AccessScore tool's `?sel=` opens on.
CREATE TABLE street_access_score (
  street_access_score_id SERIAL PRIMARY KEY,
  osm_way_id BIGINT NOT NULL,
  region_id INTEGER NOT NULL REFERENCES region(region_id) ON DELETE CASCADE,
  street_edge_id INTEGER NOT NULL REFERENCES street_edge(street_edge_id) ON DELETE CASCADE,
  name TEXT,
  score DOUBLE PRECISION CHECK (score >= 0 AND score <= 1),
  length_m DOUBLE PRECISION NOT NULL CHECK (length_m >= 0),
  audit_count INTEGER NOT NULL CHECK (audit_count >= 0),
  cluster_count INTEGER NOT NULL CHECK (cluster_count >= 0),
  validation_count INTEGER NOT NULL CHECK (validation_count >= 0),
  -- Seeded once per run, so the random half of the street tie-break is stable for the day rather than reshuffling
  -- between two page loads.
  tie_break DOUBLE PRECISION NOT NULL CHECK (tie_break >= 0 AND tie_break < 1),
  computed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (osm_way_id, region_id, computed_at)
);
ALTER TABLE street_access_score OWNER TO sidewalk;
CREATE INDEX street_access_score_computed_at_idx ON street_access_score (computed_at);

# --- !Downs
DROP TABLE IF EXISTS street_access_score;
DROP TABLE IF EXISTS region_access_score;
