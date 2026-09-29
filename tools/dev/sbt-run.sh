#!/usr/bin/env bash
#
#     bash tools/dev/sbt-run.sh --dir <checkout> [--db-lock] <sbt command>
#
# Called by the Makefile's sbt targets inside the web container, not by hand. --dir rather than the cwd, so
# `make compile wt=<other>` runs this copy and not the target branch's, which may predate it (as in #4628).

set -uo pipefail

usage() {
  echo "usage: bash tools/dev/sbt-run.sh --dir <checkout> [--db-lock] <sbt command>"
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

LEASE_SH="$(cd "$(dirname "$0")" && pwd)/lease.sh"
cd "$DIR" || {
  echo "error: no checkout at $DIR"
  exit 1
}
HERE=$(pwd -P)

# Same reason tools/dev/qa-worktree.sh insists on it: without pgrep the watch check below silently passes, and the hang
# it exists to prevent comes back with nothing on screen to explain it.
command -v pgrep >/dev/null 2>&1 || {
  echo "error: pgrep not found — install procps in the web container"
  exit 1
}

case "$HERE" in
/home/.claude/worktrees/*)
  app_name="a qa-worktree app"
  stop_hint="make qa-worktree-stop wt=$(basename "$HERE")"
  ;;
*)
  app_name="the dev server (npm start)"
  stop_hint="stop it, or use a worktree"
  ;;
esac

# `~ run` holds sbt's task for as long as the app lives, so a client command queues behind something that never
# ends and the terminal hangs with nothing on screen. Measured: behind `~ run` a client compile never returns,
# while behind `~ compile` it finishes in a second — a watch loop yields between runs, `run` doesn't. Matched by
# cwd, since sbt serves one checkout per server and another checkout's app doesn't block us.
refuse_if_watch_run_here() {
  local p
  for p in $(pgrep -f '~ run' 2>/dev/null || true); do
    [ "$(readlink "/proc/$p/cwd" 2>/dev/null || true)" = "$HERE" ] || continue
    echo "error: $app_name (pid $p) is running here and holds this checkout's sbt server."
    echo "       '$*' would queue behind it and never start. To proceed: $stop_hint"
    exit 1
  done
}
refuse_if_watch_run_here "$@"

# Every checkout's tests share one database, and most specs commit rather than roll back, so simultaneous runs
# overwrite each other's rows. The lease (tools/dev/lease.sh) names who is testing while we wait, and lasts as long as
# this process, which becomes the sbt client below.
if [ -n "$DB_LOCK" ]; then
  # A lease failure shouldn't block the run, but an unnoticed overlap is what this exists to prevent, so say so.
  if ! bash "$LEASE_SH" take db-tests --checkout "$HERE" --pid $$ --wait; then
    echo "warning: could not take the db-tests lease — running WITHOUT the cross-checkout lock"
  fi
  # Somebody may have started an app here while we waited for our turn.
  refuse_if_watch_run_here "$@"

  # The lease dies with this process, but the *server* runs the tests: kill the client and the suite carries on
  # unlocked. Forked test JVMs take their options from an @-file named sbt-args…, so one of those is a suite on the
  # database whoever owns it. Bounded, so a wedged JVM can't block testing forever.
  waited=0
  while pgrep -f 'sbt-args' >/dev/null 2>&1; do
    [ "$waited" -eq 0 ] && echo "==> waiting: a test JVM from an earlier run is still using the database"
    [ "$waited" -ge 1200 ] && {
      echo "warning: it has been 20 min and that JVM is still there — starting anyway, results may be unreliable"
      break
    }
    sleep 5
    waited=$((waited + 5))
  done
fi

exec sbt --jvm-client "$@"
