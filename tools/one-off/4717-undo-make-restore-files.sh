#!/usr/bin/env bash
#
# #4717: cut the undo's restore files from the 2026-10-20 backup loaded locally in sidewalk_pre4717.
#
#   ./4717-undo-make-restore-files.sh <rerun-streets-list.csv> <out-dir>
#
# The list is 4717-undo-rerun-list.sql's output from prod. For each city in it this writes <out-dir>/<city>.sql:
# that run's timestamp, the list, and the backup's rows for those streets and everything that sat on them, each table
# loaded into a pre_<table> temp table shaped like the live one. 4717-undo-rerun.sql reads the file with \ir.

set -euo pipefail

LIST=$1
OUT=$2
PSQL=(docker exec -i projectsidewalk-db psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d sidewalk_pre4717)

mkdir -p "$OUT"
"${PSQL[@]}" -c "DROP TABLE IF EXISTS public.rerun_list" \
  -c "CREATE TABLE public.rerun_list (city TEXT, kind TEXT, street_edge_id INTEGER, survivor_street_edge_id INTEGER,
                                      run_at TEXT)" \
  -c "COPY public.rerun_list FROM STDIN WITH (FORMAT csv, HEADER)" < "$LIST"

# table|which rows: every street the run touched, what sat on them, and whole routes that visited one.
TABLES=(
  "street_edge|street_edge_id IN (SELECT street_edge_id FROM x)"
  "street_edge_region|street_edge_id IN (SELECT street_edge_id FROM x)"
  "street_edge_priority|street_edge_id IN (SELECT street_edge_id FROM x)"
  "street_imagery|street_edge_id IN (SELECT street_edge_id FROM x)"
  "osm_way_street_edge|street_edge_id IN (SELECT street_edge_id FROM x)"
  "street_edge_status_change|street_edge_id IN (SELECT street_edge_id FROM x)"
  "street_gradient|street_edge_id IN (SELECT street_edge_id FROM x)"
  "sidewalk_presence|street_edge_id IN (SELECT street_edge_id FROM x)"
  "street_access_score|street_edge_id IN (SELECT street_edge_id FROM x)"
  "street_reopen_candidate|street_edge_id IN (SELECT street_edge_id FROM x)"
  "intersection_street_edge|street_edge_id IN (SELECT street_edge_id FROM x)"
  "audit_task|street_edge_id IN (SELECT street_edge_id FROM x)"
  "label|street_edge_id IN (SELECT street_edge_id FROM x)"
  "audit_task_comment|edge_id IN (SELECT street_edge_id FROM x)"
  "street_edge_issue|street_edge_id IN (SELECT street_edge_id FROM x)"
  "cluster|street_edge_id IN (SELECT street_edge_id FROM x)"
  "place|nearest_street_edge_id IN (SELECT street_edge_id FROM x)"
  "old_label_point_coords|street_edge_id IN (SELECT street_edge_id FROM x)
     OR label_id IN (SELECT label_id FROM label WHERE street_edge_id IN (SELECT street_edge_id FROM x))"
  "old_label_point_position|street_edge_id IN (SELECT street_edge_id FROM x)
     OR label_id IN (SELECT label_id FROM label WHERE street_edge_id IN (SELECT street_edge_id FROM x))"
  "route|route_id IN (SELECT route_id FROM route_street WHERE street_edge_id IN (SELECT street_edge_id FROM x))"
  "route_street|route_id IN (SELECT route_id FROM route_street WHERE street_edge_id IN (SELECT street_edge_id FROM x))"
  "audit_task_user_route|route_street_id IN (SELECT route_street_id FROM route_street WHERE route_id IN
     (SELECT route_id FROM route_street WHERE street_edge_id IN (SELECT street_edge_id FROM x)))"
)

for city in $("${PSQL[@]}" -c "SELECT DISTINCT city FROM public.rerun_list ORDER BY 1"); do
  schema="sidewalk_$city"
  file="$OUT/$city.sql"
  run_at=$("${PSQL[@]}" -c "SELECT DISTINCT run_at FROM public.rerun_list WHERE city = '$city' AND kind <> 'disabled'")
  if [[ $(wc -l <<< "$run_at") -ne 1 ]]; then
    echo "ERROR: $city has more than one run in the list" >&2
    exit 1
  fi
  {
    echo "-- #4717 restore file for $city, cut from the 2026-10-20 nightly backup. Read by 4717-undo-rerun.sql."
    echo "\\set bad_run_at '$run_at'"
    echo "CREATE TEMP TABLE pre_list (kind TEXT, street_edge_id INTEGER, survivor_street_edge_id INTEGER)"
    echo "  ON COMMIT DROP;"
    echo "COPY pre_list FROM STDIN;"
    "${PSQL[@]}" -c "COPY (SELECT kind, street_edge_id, survivor_street_edge_id FROM public.rerun_list
                           WHERE city = '$city' ORDER BY kind, street_edge_id) TO STDOUT"
    echo '\.'
    for entry in "${TABLES[@]}"; do
      table=${entry%%|*}
      rows=${entry#*|}
      cols=$("${PSQL[@]}" -c "SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) FROM pg_attribute
                              WHERE attrelid = to_regclass('$schema.$table') AND attnum > 0 AND NOT attisdropped")
      if [[ -z "$cols" ]]; then
        echo "WARNING: $schema.$table is not in the backup; skipped" >&2
        continue
      fi
      echo "CREATE TEMP TABLE pre_$table (LIKE $table) ON COMMIT DROP;"
      echo "COPY pre_$table ($cols) FROM STDIN;"
      "${PSQL[@]}" -c "SET search_path = $schema, public" \
        -c "COPY (WITH x AS (SELECT street_edge_id FROM public.rerun_list WHERE city = '$city')
                  SELECT $cols FROM $table WHERE $rows) TO STDOUT"
      echo '\.'
      echo "ANALYZE pre_$table;"
    done
  } > "$file"
  echo "$city: $(du -h "$file" | cut -f1)"
done
