#!/usr/bin/env bash
#
#     bash tools/sbt-run.sh --dir <checkout> [--db-lock] <sbt command>
#
# Called by the Makefile's sbt targets from inside the web container, not by hand.
#
# --dir rather than the cwd, so `make compile wt=<other>` runs this copy of the script and not whatever the target
# checkout's branch has, which may predate it (#4628 is the same hazard for qa-worktree.sh).

set -uo pipefail

usage() {
  echo "usage: bash tools/sbt-run.sh --dir <checkout> [--db-lock] <sbt command>"
  exit 2
}

DIR=""
DB_LOCK=""
while [ $# -gt 0 ]; do
  case "$1" in
  --dir)
    DIR="${2:-}"
    [ -n "$DIR" ] || usage
    shift 2
    ;;
  --db-lock)
    DB_LOCK=1
    shift
    ;;
  *) break ;;
  esac
done
[ -n "$DIR" ] || usage
[ $# -ge 1 ] || usage

cd "$DIR" || {
  echo "error: no checkout at $DIR"
  exit 1
}
HERE=$(pwd -P)

# A qa-worktree app owns its checkout's one sbt server and never finishes, so sbt would queue this command behind it
# forever — no output, no error. Matched by cwd: another checkout's app has its own server and doesn't block us.
if command -v pgrep >/dev/null 2>&1; then
  case "$HERE" in
  /home/.claude/worktrees/*) stop_hint="make qa-worktree-stop wt=$(basename "$HERE")" ;;
  *) stop_hint="stop the sbt \`~ run\` that is serving :9000" ;;
  esac
  for p in $(pgrep -f '~ run' 2>/dev/null || true); do
    [ "$(readlink "/proc/$p/cwd" 2>/dev/null || true)" = "$HERE" ] || continue
    echo "error: a qa-worktree app (pid $p) is running in this checkout and owns its sbt server."
    echo "       sbt would queue '$*' behind it and that app never finishes, so this would hang with no output."
    echo "       Stop it first:  $stop_hint"
    exit 1
  done
fi

# Every checkout's tests share one database and one city schema, and most specs commit rather than roll back, so two
# runs at once overwrite each other's rows. The hold lives on the fd, surviving the exec below, so the kernel frees
# it however the client dies; Ctrl-C is the gap, killing the client while the server may still be finishing.
if [ -n "$DB_LOCK" ]; then
  lock="${SBT_DB_TEST_LOCK:-/home/.sbt/scala-tests.lock}"
  mkdir -p "$(dirname "$lock")" 2>/dev/null
  if ! exec 9>"$lock"; then
    echo "warning: could not open $lock; running without the cross-checkout lock"
  elif ! flock -n 9; then
    echo "==> waiting: another checkout is running the Scala tests (they all share one database)"
    flock 9
  fi
fi

exec sbt --jvm-client "$@"
