#!/usr/bin/env bash
# Extract the interaction-log evidence the mission reconstruction needs from the full DC baseline (issue #4700), so
# the core (no-interaction-log) iteration loop can run patches/16.sql with the same inputs as the full run.
#
# Usage: ./extract-events.sh [--from DB]      (default sidewalk_dc; read-only against it)
#
# Writes /tmp/dc-events/{events,label_times}.csv inside the db container. label_times is what 163.sql later uses to
# backfill NULL label.time_created, needed earlier here to place labels into mission windows.
# patches/16.pre.sql loads them into dc_migration_event / dc_migration_label_time on every run, full one included,
# so both runs reconstruct from identical inputs. Takes a few minutes: each query scans 135 M rows.
set -euo pipefail
CONTAINER=${DC_CONTAINER:-projectsidewalk-db}
FROM=sidewalk_dc
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
docker exec "$CONTAINER" mkdir -p /tmp/dc-events
docker exec -i -e PGOPTIONS="-c search_path=sidewalk,public -c work_mem=512MB" "$CONTAINER" \
  psql -U sidewalk -d "$FROM" -v ON_ERROR_STOP=1 -q <<'EOF'
\copy (SELECT audit_task_interaction_id, audit_task_id, action, timestamp, note FROM audit_task_interaction WHERE action IN ('MissionComplete', 'Onboarding_Start', 'Onboarding_End', 'TaskStart', 'TaskEnd') ORDER BY audit_task_interaction_id) TO '/tmp/dc-events/events.csv' CSV HEADER
\copy (SELECT audit_task_id, temporary_label_id, min(timestamp) AS first_ts FROM audit_task_interaction WHERE temporary_label_id IS NOT NULL GROUP BY audit_task_id, temporary_label_id) TO '/tmp/dc-events/label_times.csv' CSV HEADER
EOF
docker exec "$CONTAINER" ls -la /tmp/dc-events/
