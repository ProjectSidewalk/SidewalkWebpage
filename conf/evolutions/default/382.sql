# --- !Ups
-- A third provenance for a cached way's tags (#5244, step 2). 'batch' rows hold what the nightly refresh last
-- fetched and 'on_demand' rows what the point lookup found. 'history' marks a way that is gone from OSM
-- (missing_since set) whose tags were recovered from the main OSM API's way history -- the tags of the last visible
-- version, which describe the same geometry we imported. A 'history' row with empty tags is one whose history had
-- nothing usable (the id never existed, or no visible version carried tags), and the mark keeps the refresh from
-- re-asking for it every night. The monthly re-check still covers these ids, and a way that reappears goes back to
-- 'batch'.
ALTER TABLE osm_way DROP CONSTRAINT osm_way_source_check;
ALTER TABLE osm_way ADD CONSTRAINT osm_way_source_check CHECK (source IN ('batch', 'on_demand', 'history'));

# --- !Downs
-- Recovered rows fold back into 'batch' first, or the narrower CHECK would fail on them. Their tags stay, so no
-- bridge is lost. What is lost is the provenance and the checked-once mark: a row whose history held nothing folds
-- back into a plain empty missing row, and the next Up looks it up again.
UPDATE osm_way SET source = 'batch' WHERE source = 'history';
ALTER TABLE osm_way DROP CONSTRAINT osm_way_source_check;
ALTER TABLE osm_way ADD CONSTRAINT osm_way_source_check CHECK (source IN ('batch', 'on_demand'));
