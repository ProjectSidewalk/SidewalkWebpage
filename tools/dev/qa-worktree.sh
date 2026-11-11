#!/usr/bin/env bash
#
# Run an uncommitted git worktree's app on http://localhost:9000 for QA.
#
# Runs INSIDE the web container (the main repo is mounted at /home). Invoke via:
#     make qa-worktree wt=<name> [wait=1] [force=1] [purpose="…"]   # start; from the host - Mac, Linux, or WSL
#     make qa-worktree-stop wt=<name> [clean=1]   # stop; teardown the session started above
#     bash /home/tools/dev/qa-worktree.sh <name> [--wait] [--force]   # start; from inside the container shell
#     bash /home/tools/dev/qa-worktree.sh <name> --stop     # stop; add --clean to drop the node_modules symlink
#
# The make targets run the WORKTREE's copy of this script when it has one, so the branch being QA'd supplies its own
# tooling. `make` itself still reads the main checkout's Makefile, though, so when that checkout sits on a branch
# without the target, make reports "No rule to make target". Invoke the worktree's copy directly instead (#4628):
#     docker exec -it projectsidewalk-web bash /home/.claude/worktrees/<name>/tools/dev/qa-worktree.sh <name>
#
# Handles the worktree-specific setup the plain `npm start` flow doesn't (node_modules,
# bundles, a backgrounded asset watcher, sbt caches, config.file, thin-client contention), and holds the
# :9000 lease (tools/dev/lease.sh) while the app runs.
# See docs/dev-environment.md -> "Running a branch from a git worktree".
#
set -euo pipefail

WT="${1:-}"
[ -n "$WT" ] || {
  echo "usage: qa-worktree <name> [--stop] [--clean] [--wait] [--force]   (a dir under .claude/worktrees/)"
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
LEASE_FLAGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --stop)  MODE="stop" ;;
    --clean) CLEAN="1" ;;
    --wait | --force) LEASE_FLAGS+=("$1") ;;
    *) echo "error: unknown argument: $1"; exit 2 ;;
  esac
  shift
done
# procps' pgrep is used below to find the running app + thin-client/watch servers; fail clearly if it's missing.
command -v pgrep >/dev/null 2>&1 || { echo "error: pgrep not found — install procps in the web container"; exit 1; }

WT_DIR="/home/.claude/worktrees/$WT"
# Absolute, since the script changes directory before its first lease call.
LEASE_SH="$(cd "$(dirname "$0")" && pwd)/lease.sh"
lease() { bash "$LEASE_SH" "$@"; }
# The asset watcher's log lives here (per-worktree) so `make qa-worktree-stop clean=1` can remove it.
WATCH_LOG="/tmp/qa-worktree-watch-$WT.log"

# True (exit 0) when something is listening on :9000 inside the container.
port_9000_in_use() { (exec 3<>/dev/tcp/127.0.0.1/9000) 2>/dev/null; }

# Reap every process whose full command line matches $2 and whose working directory is this worktree, sending
# signal $1. cwd-scoping is deliberate: it reaps only the sbt/watcher processes bound to *this* worktree (target/
# contention, the backgrounded watch) and never touches the main repo's own sbt server or npm-start watcher.
# A 4th argument of "group" signals each match's whole process group, since npm doesn't pass signals to the watcher.
reap_in_worktree() {
  local sig="$1" pattern="$2" label="$3" scope="${4:-}" p
  for p in $(pgrep -f "$pattern" 2>/dev/null || true); do
    if [ "$(readlink "/proc/$p/cwd" 2>/dev/null || true)" = "$WT_DIR" ]; then
      echo "==> killing $label (pid $p)"
      if [ "$scope" = "group" ]; then kill "-$sig" -- "-$p" 2>/dev/null || true
      else kill "-$sig" "$p" 2>/dev/null || true; fi
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
  lease release app --checkout "$WT_DIR"
  reap_in_worktree TERM 'npm run watch' "asset watcher" group
  reap_in_worktree TERM '~ run' "app on :9000 (~ run)"
  # `make compile`, `make test-scala`, and `make scalafmt` leave sbt running here, so stop that too.
  reap_in_worktree TERM 'sbt-launch|sbtn' "sbt server"
  sleep 2
  # SIGKILL anything that ignored the SIGTERM above.
  reap_in_worktree KILL 'npm run watch' "asset watcher" group
  reap_in_worktree KILL '~ run' "app on :9000 (~ run)"
  reap_in_worktree KILL 'sbt-launch|sbtn' "sbt server"
  # --clean drops the gitignored setup artifacts too; keep the watcher log by default so a watch failure stays
  # diagnosable after a stop.
  if [ -n "$CLEAN" ]; then
    rm -f "$WATCH_LOG"
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

# Before any setup, so a busy :9000 fails fast.
lease take app --checkout "$WT_DIR" --pid $$ "${LEASE_FLAGS[@]}" || exit 1

# 1. node_modules is gitignored (absent in worktrees) -> reuse the main repo's. Test for the bundler rather than the
#    folder, so a broken link or a partial install (e.g. only typescript, added by hand) is replaced too.
if [ ! -x node_modules/.bin/vite ]; then
  [ -L node_modules ] || [ ! -e node_modules ] || echo "==> replacing node_modules, which has no vite"
  rm -rf node_modules
  ln -s /home/node_modules node_modules
  echo "==> linked node_modules -> /home/node_modules"
fi
# The linked copy is installed from the main checkout's lockfile, so warn when this branch's differs.
if [ -L node_modules ] && ! cmp -s package-lock.json /home/package-lock.json; then
  echo "==> warning: package-lock.json differs from the main checkout's; node_modules may not match this branch"
fi

# 2. build/ bundles are gitignored (absent) -> build this branch's JS/CSS once up front.
echo "==> building bundles (npm run build)"
npm run build >/dev/null

# 3. A stray thin-client sbt server (or a hung task, e.g. a wedged `scalafmtAll`) whose cwd is this worktree
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

# 5. Start a backgrounded `npm run watch` so `frontend/js/**` / `frontend/css/**` edits rebuild the bundles
#    automatically. It gets its own process group (setsid) so the trap can kill npm, its shell and the watcher
#    together on exit (Ctrl-C, sbt quitting, an error), and it never outlives the app it was serving.
WATCH_PGID=""
cleanup() {
  trap - EXIT INT TERM  # disarm so cleanup runs at most once
  lease release app --checkout "$WT_DIR" --pid $$
  if [ -n "$WATCH_PGID" ] && kill -0 "$WATCH_PGID" 2>/dev/null; then
    echo ""
    echo "==> stopping asset watcher (pid $WATCH_PGID)"
    kill -- "-$WATCH_PGID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM
setsid npm run watch >"$WATCH_LOG" 2>&1 &
WATCH_PGID=$!
echo "==> asset watcher running (pid $WATCH_PGID) — bundles rebuild on save; log: $WATCH_LOG"

# 6. Launch. Absolute cache paths reuse the main repo's warm .coursier/.sbt; cwd-relative caches from a
#    worktree would trigger a multi-GB re-download. config.file points at the worktree's own conf. Run sbt in the
#    foreground (not `exec`) so the exit trap above can reap the asset watcher once it stops.
echo "==> starting sbt ~ run  (first HTTP request triggers the dev compile; Ctrl-C to stop)"
sbt \
  -Dconfig.file="$WT_DIR/conf/application.local.conf" \
  -Dsbt.coursier.home=/home/.coursier \
  -Dsbt.global.base=/home/.sbt \
  -Dsbt.boot.directory=/home/.sbt/boot \
  -Dsbt.repository.config=/home/.sbt/repositories \
  -J-Xmx1536m "~ run"
