# --- !Ups
-- When the nightly imagery-age poll last answered conclusively for this street (#5403). It is the poll rotation's
-- key (StreetImageryTable.streetsToPoll and noImageryStreetsToPoll), not updated_at: the labeling harvest
-- (refreshFromPanoData) bumps updated_at too, and the harvest's seven-day pano_data.last_viewed window is fed by the
-- expiry sweep as well as by labelers. Keyed on updated_at, a city with no audit activity pushes thousands of
-- never-polled audited streets behind every street polled the previous week, and a street the sweep keeps touching
-- can trail the rotation indefinitely. polled_at is written only by StreetImageryTable.upsertFromPoll, on every
-- conclusive poll (an empty one included), so neither the harvest nor the scan ingest can move a street in the queue.
-- Deliberately left NULL for every existing row: NULL means "never polled", NULLS FIRST puts every street at the
-- front of the next pass, and one full pass is the correct state for a key that was never recorded before.
-- Metadata-only on Postgres 11+ (nullable, no default), so it is instant on prod-sized tables. No index: the
-- rotation's ORDER BY is a top-N heapsort over a city's open streets, the same shape it has on updated_at, which is
-- not indexed either.
ALTER TABLE street_imagery ADD COLUMN polled_at TIMESTAMPTZ;

# --- !Downs
ALTER TABLE street_imagery DROP COLUMN polled_at;
