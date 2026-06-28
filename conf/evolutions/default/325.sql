# --- !Ups
-- Replace the overloaded boolean street_edge.deleted with a first-class status enum (#3888). The old flag conflated
-- several unrelated things: no imagery, manually disabled (e.g. OSM miscategorization), and "region not opened yet".
-- The new status makes each of those explicit. region.deleted is kept; street status 'closed' mirrors it and is the
-- authoritative per-street availability flag (so we can also mark individual streets closed during partial reveals).
CREATE TYPE street_edge_status AS ENUM ('open', 'no_imagery', 'closed', 'disabled');

ALTER TABLE street_edge ADD COLUMN status street_edge_status NOT NULL DEFAULT 'open';
ALTER TABLE street_edge ALTER COLUMN status DROP DEFAULT;

-- Backfill from the overloaded flag joined to region state (per #3888 discussion with @misaugstad):
--   deleted = FALSE                       -> 'open'
--   deleted = TRUE, region closed/deleted -> 'closed'      (the whole neighborhood is hidden)
--   deleted = TRUE, region open           -> 'no_imagery'  (true for nearly all of these; a small number are actually
--                                                            miscategorizations that an admin can later flip to 'disabled')
UPDATE street_edge
SET status = (CASE
    WHEN street_edge.deleted = FALSE THEN 'open'
    WHEN region.deleted = TRUE       THEN 'closed'
    ELSE 'no_imagery'
END)::street_edge_status
FROM street_edge_region
JOIN region ON street_edge_region.region_id = region.region_id
WHERE street_edge.street_edge_id = street_edge_region.street_edge_id;

-- Safety net for any street with no street_edge_region row: a deleted one can only have been hidden for imagery.
UPDATE street_edge
SET status = 'no_imagery'
WHERE street_edge.deleted = TRUE
  AND street_edge.street_edge_id NOT IN (SELECT street_edge_id FROM street_edge_region);

ALTER TABLE street_edge DROP COLUMN deleted;

# --- !Downs
ALTER TABLE street_edge ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- Any non-open status maps back to deleted=TRUE (no_imagery, closed, and disabled were all "deleted"). 'closed' already
-- covers every street in a hidden region, so no separate region-based re-apply is needed.
UPDATE street_edge SET deleted = (status <> 'open');

ALTER TABLE street_edge DROP COLUMN status;
DROP TYPE street_edge_status;
