# --- !Ups
-- #5950: db/scripts/disable-streets-outside-area.sh records 'study_area' when it disables a street outside a partner's
-- study area, so a rerun with a larger area can tell the streets it disabled, and restore them, from streets removed
-- on purpose. Kept in sync with the StreetEdgeStatusChangeSource Scala enum. Adding a value inside a transaction is
-- fine on PG 12+ as long as the same transaction doesn't use it, and IF NOT EXISTS guards re-application across city
-- schemas.
ALTER TYPE street_edge_status_change_source ADD VALUE IF NOT EXISTS 'study_area';

# --- !Downs
-- partial-downs: Postgres can't drop an enum value without rewriting every column of the type, and a stray value is
-- harmless to the previous release, which never writes it.
