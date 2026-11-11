# --- !Ups
-- #4717: tools/one-off/4717-consolidate-tiny-streets.sql brings cities built before the onboarding pipeline in line
-- with it, joining streets a few metres long onto their neighbours and removing what is left too short to walk.

-- The source it records when it sets a too-short street 'disabled'. Kept in sync with the StreetEdgeStatusChangeSource
-- Scala enum in StreetEdgeStatusChangeTable.scala. Adding a value inside a transaction is fine on PG 12+ as long as
-- the same transaction doesn't use it, and this evolution doesn't. IF NOT EXISTS guards re-application across city
-- schemas. Enum types need no OWNER TO reassignment.
ALTER TYPE street_edge_status_change_source ADD VALUE IF NOT EXISTS 'consolidate_tiny_streets';

-- One row per street the script deleted: joined onto a survivor (same_way, continuation, border_cut, straightest) or
-- removed as too short with nothing real on it (residue, no survivor). A status change can't record a street that no
-- longer exists. Neither street id is a foreign key: the dropped row is gone, and a survivor can itself be deleted
-- later (joined on in a later run, or removed as residue in this one), when a trace that still names it is the point.
-- The dropped way id is kept because osm_way_street_edge holds one way per street, so the survivor's row can't
-- (#5741). It is a BIGINT like osm_way_street_edge.osm_way_id, since OSM way ids passed the INTEGER range in 2025.
CREATE TABLE street_edge_merge (
  street_edge_merge_id SERIAL PRIMARY KEY,
  dropped_street_edge_id INTEGER NOT NULL,
  survivor_street_edge_id INTEGER,
  rule TEXT NOT NULL CHECK (rule IN ('same_way', 'continuation', 'border_cut', 'straightest', 'residue')),
  dropped_osm_way_id BIGINT,
  dropped_length_m DOUBLE PRECISION NOT NULL CHECK (dropped_length_m >= 0),
  dropped_geom geometry(LineString, 4326) NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE street_edge_merge OWNER TO sidewalk;
CREATE INDEX street_edge_merge_dropped_street_edge_id_idx ON street_edge_merge (dropped_street_edge_id);
CREATE INDEX street_edge_merge_survivor_street_edge_id_idx ON street_edge_merge (survivor_street_edge_id);

-- Deleting a street or an audit task checks every referencing table for rows that still point at it, and without these
-- indexes each deleted row cost a full scan (1.6 M rows of audit_task_environment on dev Seattle alone).
CREATE INDEX audit_task_environment_audit_task_id_idx ON audit_task_environment (audit_task_id);
CREATE INDEX audit_task_comment_audit_task_id_idx ON audit_task_comment (audit_task_id);
CREATE INDEX mission_current_audit_task_id_idx ON mission (current_audit_task_id);
CREATE INDEX old_label_point_position_street_edge_id_idx ON old_label_point_position (street_edge_id);
CREATE INDEX old_label_point_coords_street_edge_id_idx ON old_label_point_coords (street_edge_id);
CREATE INDEX street_access_score_street_edge_id_idx ON street_access_score (street_edge_id);
CREATE INDEX route_street_street_edge_id_idx ON route_street (street_edge_id);
CREATE INDEX place_nearest_street_edge_id_idx ON place (nearest_street_edge_id);

# --- !Downs
DROP INDEX place_nearest_street_edge_id_idx;
DROP INDEX route_street_street_edge_id_idx;
DROP INDEX street_access_score_street_edge_id_idx;
DROP INDEX old_label_point_coords_street_edge_id_idx;
DROP INDEX old_label_point_position_street_edge_id_idx;
DROP INDEX mission_current_audit_task_id_idx;
DROP INDEX audit_task_comment_audit_task_id_idx;
DROP INDEX audit_task_environment_audit_task_id_idx;
DROP TABLE street_edge_merge;
-- The 'consolidate_tiny_streets' enum value stays: Postgres cannot drop an enum value without recreating the type
-- and recasting every column referencing it, and an unused extra value is harmless (331.sql precedent).
