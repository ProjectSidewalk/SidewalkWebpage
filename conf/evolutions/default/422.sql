# --- !Ups
-- #5691: a street under a metre can't be walked or sized into a mission, so only a disabled street may be that short.
-- Every prod city already complies (#4717), but the dev dumps in db/ predate that cleanup, and the #4717 script needs
-- evolution 416, which would roll back with this one if it failed. So any short street left is disabled first, as
-- tools/one-off/4181-remove-streets.sql does, under 'remove_streets': 'consolidate_tiny_streets' is added by 416, and
-- a batch that also runs 416 can't use it yet. Nothing ever reopens a disabled street.
INSERT INTO street_edge_status_change (street_edge_id, old_status, new_status, source)
SELECT street_edge_id, status, 'disabled', 'remove_streets'
FROM street_edge
WHERE status <> 'disabled' AND ST_Length(geom::geography) < 1;
DELETE FROM street_edge_priority
USING street_edge
WHERE street_edge_priority.street_edge_id = street_edge.street_edge_id
  AND street_edge.status <> 'disabled' AND ST_Length(street_edge.geom::geography) < 1;
UPDATE street_edge SET status = 'disabled' WHERE status <> 'disabled' AND ST_Length(geom::geography) < 1;

ALTER TABLE street_edge ADD CONSTRAINT street_edge_min_length_check
  CHECK (status = 'disabled' OR ST_Length(geom::geography) >= 1);

# --- !Downs
-- The streets the Ups disabled stay disabled: they were never walkable.
ALTER TABLE street_edge DROP CONSTRAINT IF EXISTS street_edge_min_length_check;
