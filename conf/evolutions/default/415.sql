# --- !Ups
-- #5733: the stretches of a street a free-exploration session has seen, as merged [start_m, end_m] pairs in meters
-- along the street's geometry. The server unions each submission into it and credits the street once little enough
-- is left unseen (StreetCoverage). NULL for regular audits.
ALTER TABLE audit_task ADD COLUMN covered_ranges JSONB
  CHECK (covered_ranges IS NULL OR jsonb_typeof(covered_ranges) = 'array');

# --- !Downs
ALTER TABLE audit_task DROP COLUMN covered_ranges;
