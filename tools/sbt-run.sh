#!/usr/bin/env bash
#
#     bash tools/sbt-run.sh --dir <checkout> [--db-lock] <sbt command>
#
# Called by the Makefile's sbt targets inside the web container, not by hand. --dir rather than the cwd, so
# `make compile wt=<other>` runs this copy and not the target branch's, which may predate it (as in #4628).

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

# A qa-worktree app holds its checkout's only sbt server and never finishes, so sbt would queue this behind it
# forever, in silence. Matched by cwd, since another checkout's app has its own server and doesn't block us.
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

# Every checkout's tests share one database, and most specs commit rather than roll back, so simultaneous runs
# overwrite each other's rows. Locking the fd means the kernel frees it however this exits — except on Ctrl-C,
# which kills us while the server may still be running the tests.
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
