# --- !Ups
-- #4929: nothing reopens a street that regains imagery after being marked no_imagery. The nightly imagery-age poll
-- (which only covered open streets) now also re-checks a small rotating batch of no_imagery streets. When it finds
-- panos attributable to one, the street is queued here for admin review on /admin/street-status, where a Reopen
-- button flips it back to open. Reopening stays human-gated -- the mirror of the #4928 "Awaiting confirmation"
-- queue for the opposite direction.

-- The admin Reopen action is the first in-app writer of street_edge.status. Kept in sync with the
-- StreetEdgeStatusChangeSource Scala enum in StreetEdgeStatusChangeTable.scala. Adding a value inside a transaction
-- is fine on PG 12+ as long as the same transaction doesn't use it, and this evolution doesn't. IF NOT EXISTS guards
-- re-application across city schemas. Enum types need no OWNER TO reassignment.
ALTER TYPE street_edge_status_change_source ADD VALUE IF NOT EXISTS 'admin_reopen';

-- One row per no_imagery street whose latest conclusive poll found attributable imagery -- the evidence behind the
-- review queue. The poller upserts on each positive poll (bumping last_detected_at and the evidence columns, keeping
-- first_detected_at) and deletes the row when a later conclusive poll finds nothing, so the queue's promise is
-- always "the most recent poll of this street found imagery". Rows are also deleted when the admin reopens or
-- dismisses the street, and by mark_streets_no_imagery (checker evidence retracts poll evidence).
CREATE TABLE street_reopen_candidate (
    street_edge_id INTEGER PRIMARY KEY REFERENCES street_edge (street_edge_id) ON DELETE CASCADE,
    first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A candidate exists only because panos were found, so a zero count is a bug, not a state.
    n_panos INTEGER NOT NULL CHECK (n_panos > 0),
    -- Newest capture date among the attributable panos (NULL when the provider reported no parseable date).
    newest_capture DATE
);
ALTER TABLE street_reopen_candidate OWNER TO sidewalk;

# --- !Downs
DROP TABLE street_reopen_candidate;
-- The 'admin_reopen' enum value stays: Postgres cannot drop an enum value without recreating the type and recasting
-- every column referencing it, and an unused extra value is harmless (331.sql precedent).
