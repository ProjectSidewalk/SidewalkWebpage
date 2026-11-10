# --- !Ups
-- #5950: disable-streets-outside-area.sh logs its changes as 'study_area', so a rerun with a larger area can tell the
-- streets it disabled from ones removed on purpose. Mirrors the StreetEdgeStatusChangeSource Scala enum.
ALTER TYPE street_edge_status_change_source ADD VALUE IF NOT EXISTS 'study_area';

# --- !Downs
-- partial-downs: Postgres can't drop an enum value without rewriting every column of the type, and a stray value is
-- harmless to the previous release, which never writes it.
