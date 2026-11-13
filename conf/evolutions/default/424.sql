# --- !Ups
-- #5741: the re-rank trigger's change check is planned per statement. A plpgsql statement keeps its first plan for
-- the session, and the lineage import's first re-rank (after its DELETE) touches no row, so the join of the two
-- transition tables was planned as a nested loop and then run over 70k x 70k rows (13 minutes on Pittsburgh, 5 hours
-- on Chicago). Planned for the real statement it is a hash join, well under a second.
CREATE OR REPLACE FUNCTION osm_way_street_edge_rank_primary() RETURNS trigger
LANGUAGE plpgsql AS
$BODY$
DECLARE
  streets integer[];;
BEGIN
  IF TG_OP = 'INSERT' THEN
    streets := ARRAY(SELECT DISTINCT street_edge_id FROM new_rows);;
  ELSIF TG_OP = 'DELETE' THEN
    streets := ARRAY(SELECT DISTINCT street_edge_id FROM old_rows);;
  ELSE
    -- Only a changed ranking column counts, so the re-rank's own flag writes (and any other update) end here. Dynamic
    -- SQL, so the join is planned for these transition tables rather than reused from the session's first firing.
    EXECUTE $CHANGED$
      SELECT ARRAY(SELECT old_rows.street_edge_id FROM old_rows
                   INNER JOIN new_rows ON old_rows.osm_way_street_edge_id = new_rows.osm_way_street_edge_id
                   WHERE (old_rows.street_edge_id, old_rows.osm_way_id, old_rows.street_from_frac,
                          old_rows.street_to_frac)
                         IS DISTINCT FROM (new_rows.street_edge_id, new_rows.osm_way_id, new_rows.street_from_frac,
                                           new_rows.street_to_frac)
                   UNION SELECT new_rows.street_edge_id FROM new_rows
                   INNER JOIN old_rows ON old_rows.osm_way_street_edge_id = new_rows.osm_way_street_edge_id
                   WHERE old_rows.street_edge_id <> new_rows.street_edge_id)$CHANGED$ INTO streets;;
  END IF;;
  IF cardinality(streets) > 0 THEN
    EXECUTE format('SELECT %I.osm_way_street_edge_set_primary($1, $2)', TG_TABLE_SCHEMA)
      USING streets, TG_TABLE_SCHEMA;;
  END IF;;
  RETURN NULL;;
END
$BODY$;

# --- !Downs
CREATE OR REPLACE FUNCTION osm_way_street_edge_rank_primary() RETURNS trigger
LANGUAGE plpgsql AS
$BODY$
DECLARE
  streets integer[];;
BEGIN
  IF TG_OP = 'INSERT' THEN
    streets := ARRAY(SELECT DISTINCT street_edge_id FROM new_rows);;
  ELSIF TG_OP = 'DELETE' THEN
    streets := ARRAY(SELECT DISTINCT street_edge_id FROM old_rows);;
  ELSE
    -- Only a changed ranking column counts, so the re-rank's own flag writes (and any other update) end here.
    streets := ARRAY(SELECT old_rows.street_edge_id FROM old_rows
                     INNER JOIN new_rows ON old_rows.osm_way_street_edge_id = new_rows.osm_way_street_edge_id
                     WHERE (old_rows.street_edge_id, old_rows.osm_way_id, old_rows.street_from_frac,
                            old_rows.street_to_frac)
                           IS DISTINCT FROM (new_rows.street_edge_id, new_rows.osm_way_id, new_rows.street_from_frac,
                                             new_rows.street_to_frac)
                     UNION SELECT new_rows.street_edge_id FROM new_rows
                     INNER JOIN old_rows ON old_rows.osm_way_street_edge_id = new_rows.osm_way_street_edge_id
                     WHERE old_rows.street_edge_id <> new_rows.street_edge_id);;
  END IF;;
  IF cardinality(streets) > 0 THEN
    EXECUTE format('SELECT %I.osm_way_street_edge_set_primary($1, $2)', TG_TABLE_SCHEMA)
      USING streets, TG_TABLE_SCHEMA;;
  END IF;;
  RETURN NULL;;
END
$BODY$;
