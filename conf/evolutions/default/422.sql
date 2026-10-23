# --- !Ups
-- #5691: a sub-metre street can't be walked or sized into a mission, and #4717 removed them all, so this keeps them out.
-- Disabled streets are exempt: #4717 disabled the short ones it couldn't delete, and nothing reopens a disabled street.
ALTER TABLE street_edge ADD CONSTRAINT street_edge_min_length_check
  CHECK (status = 'disabled' OR ST_Length(geom::geography) >= 1);

# --- !Downs
ALTER TABLE street_edge DROP CONSTRAINT IF EXISTS street_edge_min_length_check;
