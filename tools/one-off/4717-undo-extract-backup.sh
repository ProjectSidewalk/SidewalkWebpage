#!/usr/bin/env bash
#
# #4717: pull the 10 rerun cities' tables out of the 2026-10-20 nightly pg_dumpall, the last full dump taken after the
# first tiny-streets run and before the bad rerun. Only reads the dump; writes only under ~/4717-backup-extract.
#
#   ./4717-undo-extract-backup.sh            plan: index the dump (one full read, kept) and show what it'd take
#   ./4717-undo-extract-backup.sh --extract  write ~/4717-backup-extract/pre4717.sql.gz
#
# The dump is ~317 GB, so the first run's index pass takes a while; run it in tmux or under nohup.
# Interaction logs and webpage_activity are left out; everything else in those schemas comes along.

set -euo pipefail

DUMP=${DUMP:-/m-makelab1/backups/pgsql/2026-10-20-pg16.sql}
OUT="$HOME/4717-backup-extract"
CITIES="st_louis chicago gainesville zurich_infra3d houston tucson taichung niagara_falls sao_paulo chandigarh"
SKIP_DATA='_task_interaction|^webpage_activity$'

mkdir -p "$OUT"
TOC="$OUT/toc.txt"

# Every object in a pg_dump file starts with a "-- Name: ..." or "-- Data for Name: ..." comment, so the byte offsets
# of those lines cut the file into pieces we can copy out with dd instead of reading the whole file again.
if [[ ! -s "$TOC" ]]; then
  echo "Indexing $DUMP ..."
  LC_ALL=C grep -a -b -E '^(-- (Data for )?Name: |\\connect )' "$DUMP" > "$TOC.tmp"
  mv "$TOC.tmp" "$TOC"
fi

# One line per piece to keep: start byte, length, type, schema, name. A pg_dumpall file holds every database in the
# cluster, so only pieces after the "\connect sidewalk_prod" line count.
awk -v size="$(stat -c %s "$DUMP")" -v cities="$CITIES" -v skip="$SKIP_DATA" '
  BEGIN {
    OFS = "\t"
    n = split(cities, c, " ")
    for (i = 1; i <= n; i++) wanted["sidewalk_" c[i]] = 1
    split("TABLE|SEQUENCE|SEQUENCE SET|TYPE|DOMAIN", t, "|")
    for (i in t) ddl[t[i]] = 1
  }
  {
    offset = substr($0, 1, index($0, ":") - 1)
    line = substr($0, index($0, ":") + 1)
    if (keep) print start, offset - start, label
    keep = 0
    if (line ~ /^\\connect /) {
      in_prod = (line ~ /(^|[^a-z_])sidewalk_prod([^a-z_]|$)/)
      print "connect", line > "/dev/stderr"
      next
    }
    sub(/^-- (Data for )?Name: /, "", line)
    split(line, f, "; ")
    type = f[2]; sub(/^Type: /, "", type)
    schema = f[3]; sub(/^Schema: /, "", schema)
    if (in_prod && (schema in wanted) && ((type in ddl) || (type == "TABLE DATA" && f[1] !~ skip))) {
      keep = 1; start = offset; label = type OFS schema OFS f[1]
    }
  }
  END { if (keep) print start, size - start, label }
' "$TOC" > "$OUT/ranges.txt"

echo
echo "Pieces: $(wc -l < "$OUT/ranges.txt")"
awk -F'\t' '{ total += $2; city[$4] += $2 }
  END {
    printf "Total: %.2f GB\n", total / 1e9
    for (s in city) printf "  %-28s %8.2f GB\n", s, city[s] / 1e9
  }' "$OUT/ranges.txt"
echo "Largest tables:"
awk -F'\t' '$3 == "TABLE DATA" { printf "  %8.2f GB  %s.%s\n", $2 / 1e9, $4, $5 }' "$OUT/ranges.txt" \
  | sort -rn | sed -n 1,25p

if [[ "${1:-}" == "--extract" ]]; then
  gz=gzip
  command -v pigz > /dev/null && gz=pigz
  echo "Extracting to $OUT/pre4717.sql.gz ..."
  while IFS=$'\t' read -r start len _; do
    dd if="$DUMP" iflag=skip_bytes,count_bytes skip="$start" count="$len" bs=4M status=none
  done < "$OUT/ranges.txt" | "$gz" -1 > "$OUT/pre4717.sql.gz.tmp"
  mv "$OUT/pre4717.sql.gz.tmp" "$OUT/pre4717.sql.gz"
  ls -lh "$OUT/pre4717.sql.gz"
fi
