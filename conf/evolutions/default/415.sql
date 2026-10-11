# --- !Ups
-- #5733: the stretches of a street a free-exploration session has actually seen, as merged [start_m, end_m] pairs in
-- meters along the street's stored geometry, so a revisit from the other end adds to the same list. The server unions
-- every submission into it and derives audited_distance_m from the total, and the street counts as audited once what
-- is left uncovered is short enough (StreetCoverage.MaxUncoveredM). NULL for regular audits, which still finish at
-- the street's far end.
ALTER TABLE audit_task ADD COLUMN covered_ranges JSONB
  CHECK (covered_ranges IS NULL OR jsonb_typeof(covered_ranges) = 'array');

# --- !Downs
ALTER TABLE audit_task DROP COLUMN covered_ranges;
