# --- !Ups
-- When the nightly refresh last found this way absent from OSM (deleted, or merged into another way), NULL while it
-- is present (#5244). osm_way_street_edge freezes way ids at import, and 3% of Seattle's had died in OSM by 2026. The
-- refresh used to blank such a row's tags, which every reader took as "no bridge, no tunnel, layer 0, no maxspeed";
-- now a miss keeps the last known tags -- they still describe the geometry we imported -- and stamps this column, so
-- a reader can tell "way gone, tags are the last known" from "way present, no such tag". The stamp keeps its first
-- value across repeated misses and clears if the way reappears. Existing blanked rows are marked as missing since
-- their last fetch, the earliest date known for them. A batch row with no tags at all can only be a miss, because
-- every mapped street way carries at least highway=*.
ALTER TABLE osm_way ADD COLUMN missing_since TIMESTAMPTZ;
UPDATE osm_way SET missing_since = updated_at WHERE source = 'batch' AND tags = '{}'::jsonb;

# --- !Downs
ALTER TABLE osm_way DROP COLUMN missing_since;
