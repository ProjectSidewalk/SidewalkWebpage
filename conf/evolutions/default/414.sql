# --- !Ups
-- The imagery-age poll rotation's key, written only by StreetImageryTable.upsertFromPoll (#5403): updated_at is
-- bumped by the labeling harvest too, so ordering on it let never-polled streets queue behind harvested ones.
-- Left NULL on existing rows so that every street gets one poll on the next pass.
ALTER TABLE street_imagery ADD COLUMN polled_at TIMESTAMPTZ;

# --- !Downs
ALTER TABLE street_imagery DROP COLUMN polled_at;
