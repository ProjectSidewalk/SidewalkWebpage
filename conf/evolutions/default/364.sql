# --- !Ups
-- #4947: pano imagery expiry needs an event log, not a snapshot column. pano_data.expired_at dates the imagery that
-- is missing *right now*, and is cleared the moment it comes back -- by a provider re-check that finds it, or by a
-- labeler viewing the pano again. So the admin trend chart built on that column silently rewrites its own history: a
-- pano that expired in March and returned in May does not move buckets, it vanishes from March, and past weeks shrink
-- between two loads of the same page.
--
-- Same shape as street_edge_status_change in 358.sql: keep the current-state column because it is cheap to read and
-- join, and add an append-only log as the record of what actually happened. Recoveries become visible for the first
-- time, which is the point -- whether an expiry was permanent imagery loss or a transient provider blip is what
-- decides whether a city needs a re-drive, and the snapshot destroys exactly that.

-- provider_check covers both the nightly CheckImageExpiryActor sweep and the on-demand existence check, because both
-- land in PanoDataService.panoExists. pano_view is the labeler-facing path (PanoDataTable.upsert), which un-expires a
-- pano by virtue of someone loading it. Scheduled vs. hand-triggered is answerable from background_job_run, so it is
-- deliberately not a fourth value here.
CREATE TYPE pano_imagery_change_source AS ENUM ('provider_check', 'pano_view');

CREATE TABLE pano_imagery_change (
    pano_imagery_change_id SERIAL PRIMARY KEY,
    pano_id TEXT NOT NULL REFERENCES pano_data (pano_id) ON DELETE CASCADE,
    -- The state the pano moved *into*: TRUE = the imagery went away, FALSE = it came back. A single boolean rather
    -- than the old/new pair street_edge_status_change carries: with two states the old value is implied, and the
    -- old <> new CHECK that keeps that table honest would be tautological here. What keeps this table honest is that
    -- all three writers guard on the edge, so a re-check that confirms a known expiry records nothing.
    expired BOOLEAN NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source pano_imagery_change_source NOT NULL
);
ALTER TABLE pano_imagery_change OWNER TO sidewalk;

-- The chart scans a date window and splits by direction, so lead with changed_at. Edge-triggered writes keep this
-- table small: logging every *check* would cost a row per pano per nightly sweep, which is 266k a night on the
-- largest pano_data, where real transitions run to a few thousand a year.
CREATE INDEX pano_imagery_change_changed_at_idx ON pano_imagery_change (changed_at);
CREATE INDEX pano_imagery_change_pano_id_idx ON pano_imagery_change (pano_id);

-- Seed the log with what expired_at still knows, so the chart keeps the history it has today instead of starting
-- empty. Only still-expired panos have a date to seed from: one that expired and returned since 358 had its
-- expired_at cleared, and that transition is not recoverable. expired_at is written by exactly one code path, the
-- expiring branch of PanoDataTable.updateExpiredStatus, so provider_check is the true source of these rows rather
-- than a placeholder for an unknown one.
INSERT INTO pano_imagery_change (pano_id, expired, changed_at, source)
SELECT pano_id, TRUE, expired_at, 'provider_check'
FROM pano_data
WHERE expired_at IS NOT NULL;

# --- !Downs
DROP TABLE pano_imagery_change;
-- Tables and types share a namespace, so the type can only go once nothing references it.
DROP TYPE pano_imagery_change_source;
