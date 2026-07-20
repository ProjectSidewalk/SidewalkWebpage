#!/usr/bin/env bash
#
# Run an uncommitted git worktree's app on http://localhost:9000 for QA.
#
# Runs INSIDE the web container (the main repo is mounted at /home). Invoke via:
#     make qa-worktree wt=<name>                  # start; from the host - Mac, Linux, or WSL
#     make qa-worktree-stop wt=<name> [clean=1]   # stop; teardown the session started above
#     bash /home/tools/qa-worktree.sh <name>            # start; from inside the container shell
#     bash /home/tools/qa-worktree.sh <name> --stop     # stop; add --clean to drop the node_modules symlink
#
# Handles the worktree-specific setup the plain `npm start` flow doesn't (node_modules,
# bundles, a backgrounded grunt watch, sbt caches, config.file, thin-client contention).
# See CLAUDE.md -> "Running a worktree's app for QA".
#
set -euo pipefail

WT="${1:-}"
[ -n "$WT" ] || {
  echo "usage: qa-worktree <name> [--stop] [--clean]   (a dir under .claude/worktrees/)"
  exit 2
}
# Require a bare directory name so $WT can't escape the worktrees dir (e.g. "../..").
case "$WT" in
  */* | . | ..) echo "error: wt must be a bare worktree directory name (no '/', '.', or '..')"; exit 2 ;;
esac
# Parse the optional mode/flags after the worktree name.
shift
MODE="run"
CLEAN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --stop)  MODE="stop" ;;
    --clean) CLEAN="1" ;;
    *) echo "error: unknown argument: $1"; exit 2 ;;
  esac
  shift
done
# procps' pgrep is used below to find the running app + thin-client/watch servers; fail clearly if it's missing.
command -v pgrep >/dev/null 2>&1 || { echo "error: pgrep not found — install procps in the web container"; exit 1; }

WT_DIR="/home/.claude/worktrees/$WT"
# grunt watch's log lives here (per-worktree) so `make qa-worktree-stop clean=1` can remove it.
GRUNT_WATCH_LOG="/tmp/qa-worktree-grunt-watch-$WT.log"

# True (exit 0) when something is listening on :9000 inside the container.
port_9000_in_use() { (exec 3<>/dev/tcp/127.0.0.1/9000) 2>/dev/null; }

# Reap every process whose full command line matches $2 and whose working directory is this worktree, sending
# signal $1. cwd-scoping is deliberate: it reaps only the sbt/grunt processes bound to *this* worktree (target/
# contention, the backgrounded watch) and never touches the main repo's own sbt server or npm-start grunt watch.
reap_in_worktree() {
  local sig="$1" pattern="$2" label="$3" p
  for p in $(pgrep -f "$pattern" 2>/dev/null || true); do
    if [ "$(readlink "/proc/$p/cwd" 2>/dev/null || true)" = "$WT_DIR" ]; then
      echo "==> killing $label (pid $p)"
      kill "-$sig" "$p" 2>/dev/null || true
    fi
  done
}

if [ ! -d "$WT_DIR" ]; then
  echo "error: no worktree at $WT_DIR"
  echo "available worktrees:"; ls /home/.claude/worktrees
  exit 1
fi

# --- stop mode: tear down the session started by a prior launch, then exit. ------------------------------------
if [ "$MODE" = "stop" ]; then
  echo "==> stopping worktree QA session: $WT_DIR"
  reap_in_worktree TERM 'grunt' "grunt watch"
  reap_in_worktree TERM '~ run' "app on :9000 (~ run)"
  sleep 2
  # SIGKILL anything that ignored the SIGTERM above.
  reap_in_worktree KILL 'grunt' "grunt watch"
  reap_in_worktree KILL '~ run' "app on :9000 (~ run)"
  # --clean drops the gitignored setup artifacts too; keep the grunt watch log by default so a watch failure stays
  # diagnosable after a stop.
  if [ -n "$CLEAN" ]; then
    rm -f "$GRUNT_WATCH_LOG"
    if [ -L "$WT_DIR/node_modules" ]; then
      rm -f "$WT_DIR/node_modules"
      echo "==> removed node_modules symlink"
    fi
  fi
  echo "==> done."
  exit 0
fi

# --- run mode: set up and launch the worktree's app. -----------------------------------------------------------
cd "$WT_DIR"
echo "==> worktree: $WT_DIR"

# 1. node_modules is gitignored (absent in worktrees) -> reuse the main repo's. `-d` follows the symlink, so this also
#    replaces a broken/stale link (rm -f is a no-op when the path doesn't exist).
if [ ! -d node_modules ]; then
  rm -f node_modules
  ln -s /home/node_modules node_modules
  echo "==> linked node_modules -> /home/node_modules"
fi

# 2. build/ bundles are gitignored (absent) -> build this branch's JS/CSS once up front.
echo "==> building bundles (grunt concat concat_css)"
node_modules/.bin/grunt concat concat_css >/dev/null

# 3. A stray `sbt --client` server (or a hung `sbtn` task, e.g. a wedged `scalafmtAll`) whose cwd is this worktree
#    shares target/ and deadlocks `~ run` on compile locks. Reap them.
reap_in_worktree KILL 'sbt-launch|sbtn' "thin-client / hung sbt task (shares target/)"

# 4. Free :9000 -> stop whatever `~ run` currently serves it (SIGTERM, then SIGKILL if it lingers). Not cwd-scoped:
#    the app holding :9000 may be the main repo's, so match `~ run` anywhere rather than only in this worktree.
for p in $(pgrep -f '~ run' 2>/dev/null || true); do
  echo "==> stopping running app (pid $p) on :9000"
  kill "$p" 2>/dev/null || true
done
sleep 2
if port_9000_in_use; then
  for p in $(pgrep -f '~ run' 2>/dev/null || true); do kill -9 "$p" 2>/dev/null || true; done
  sleep 1
fi
# Still held? It's something other than an sbt `~ run` we know how to stop — fail clearly instead of letting sbt die
# later with an opaque "address already in use".
if port_9000_in_use; then
  echo "error: :9000 is still in use by a process that isn't an sbt '~ run'. Free it and retry."
  exit 1
fi

# 5. Start a backgrounded `grunt watch` so `public/js/**` / `public/css/**` edits rebuild the bundles automatically —
#    a plain hard-reload then always reflects the latest source (no manual reconcat). The trap tears it down on exit
#    (Ctrl-C, sbt quitting, an error) so it never outlives the app it was serving.
GRUNT_WATCH_PID=""
cleanup() {
  trap - EXIT INT TERM  # disarm so cleanup runs at most once
  if [ -n "$GRUNT_WATCH_PID" ] && kill -0 "$GRUNT_WATCH_PID" 2>/dev/null; then
    echo ""
    echo "==> stopping grunt watch (pid $GRUNT_WATCH_PID)"
    kill "$GRUNT_WATCH_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM
node_modules/.bin/grunt watch >"$GRUNT_WATCH_LOG" 2>&1 &
GRUNT_WATCH_PID=$!
echo "==> grunt watch running (pid $GRUNT_WATCH_PID) — bundles rebuild on save; log: $GRUNT_WATCH_LOG"

# 6. Launch. Absolute cache paths reuse the main repo's warm .coursier/.sbt; cwd-relative caches from a
#    worktree would trigger a multi-GB re-download. config.file points at the worktree's own conf. Run sbt in the
#    foreground (not `exec`) so the exit trap above can reap grunt watch once it stops.
echo "==> starting sbt ~ run  (first HTTP request triggers the dev compile; Ctrl-C to stop)"
sbt \
  -Dconfig.file="$WT_DIR/conf/application.local.conf" \
  -Dsbt.coursier.home=/home/.coursier \
  -Dsbt.global.base=/home/.sbt \
  -Dsbt.boot.directory=/home/.sbt/boot \
  -Dsbt.repository.config=/home/.sbt/repositories \
  -J-Xmx1536m "~ run"
