# --- !Ups
ALTER TABLE route_street DROP COLUMN first_street;

ALTER TABLE route_street ADD COLUMN reverse BOOLEAN;
UPDATE route_street SET reverse = false;
ALTER TABLE route_street ALTER COLUMN reverse SET NOT NULL;

UPDATE route SET deleted = TRUE;

# --- !Downs
UPDATE route SET deleted = FALSE;

ALTER TABLE route_street DROP COLUMN reverse;

ALTER TABLE route_street ADD COLUMN first_street BOOLEAN;

UPDATE route_street SET first_street = false;

UPDATE route_street
SET first_street = true
WHERE route_street_id IN (SELECT MIN(route_street_id) FROM route_street GROUP BY route_id);

ALTER TABLE route_street ALTER COLUMN first_street SET NOT NULL;
