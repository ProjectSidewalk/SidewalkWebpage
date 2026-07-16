# --- !Ups
ALTER TABLE route ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX route_user_id_idx ON route (user_id);

-- Routes predating user-supplied names were all saved with the placeholder name "temp". Give them a
-- presentable default so they can be listed in the new dashboard "My Routes" section.
UPDATE route SET name = 'Route ' || route_id WHERE name = 'temp';

# --- !Downs
DROP INDEX route_user_id_idx;
ALTER TABLE route DROP COLUMN created_at;
