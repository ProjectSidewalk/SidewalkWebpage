# --- !Ups
-- #5007: the imagery-change log (364.sql) is only as honest as its writers -- every writer of pano_data.expired must
-- record its own transition in the same statement, and that invariant can be missed by a writer that forgets to log
-- or by the READ COMMITTED snapshot race documented on PanoDataTable.updateExpiredStatus. Both misses leave the same
-- footprint: a pano whose newest log row disagrees with its current pano_data.expired. A nightly reconciliation pass
-- (PanoImageryChangeTable.reconcile, run with the CheckImageExpiryActor sweep) inserts the missing event, and this
-- value marks the healed rows. It has to be its own value because a healed event carries detection time, not the
-- real transition time -- it can land up to a day late, or in the wrong week -- so it must never be mistaken for an
-- observed one, and unlike scheduled-vs-manual (deliberately not a value here, see 364.sql) the distinction is not
-- answerable from background_job_run: healed and observed rows land during the same sweep's run.
-- Adding a value in a transaction is fine as long as the transaction doesn't use it (339/361.sql precedent) -- the
-- healing happens only at runtime, so nothing in this evolution does.
ALTER TYPE pano_imagery_change_source ADD VALUE IF NOT EXISTS 'reconciliation';

-- The reconciliation pass reads the newest log row per pano: DISTINCT ON (pano_id) ordered by pano_id,
-- changed_at DESC, pano_imagery_change_id DESC. This composite serves that as one presorted index scan, left-joined
-- hash-wise to a single pass over pano_data -- no per-row subqueries. Its pano_id prefix also covers everything the
-- plain pano_id index served (the FK's ON DELETE CASCADE lookups), so that index is dropped rather than kept as a
-- redundant copy -- net index count on the table is unchanged.
CREATE INDEX IF NOT EXISTS pano_imagery_change_pano_id_changed_at_idx
    ON pano_imagery_change (pano_id, changed_at DESC, pano_imagery_change_id DESC);
DROP INDEX IF EXISTS pano_imagery_change_pano_id_idx;

# --- !Downs
-- The reconciliation value stays: Postgres can't drop an enum value without rebuilding the type (331/339 precedent).
CREATE INDEX IF NOT EXISTS pano_imagery_change_pano_id_idx ON pano_imagery_change (pano_id);
DROP INDEX IF EXISTS pano_imagery_change_pano_id_changed_at_idx;
