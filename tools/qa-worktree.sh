#!/usr/bin/env bash
#
# Run an uncommitted git worktree's app on http://localhost:9000 for QA.
#
# Runs INSIDE the web container (the main repo is mounted at /home). Invoke via:
#     make qa-worktree wt=<name>                 # from the host - Mac, Linux, or WSL
#     bash /home/tools/qa-worktree.sh <name>     # from inside the container shell
#
# Handles the worktree-specific setup the plain `npm start` flow doesn't (node_modules,
# bundles, sbt caches, config.file, thin-client contention). See CLAUDE.md ->
# "Running a worktree's app for QA".
#
set -euo pipefail

WT="${1:-}"
[ -n "$WT" ] || { echo "usage: qa-worktree <name>   (a dir under .claude/worktrees/)"; exit 2; }

WT_DIR="/home/.claude/worktrees/$WT"
if [ ! -d "$WT_DIR" ]; then
  echo "error: no worktree at $WT_DIR"
  echo "available worktrees:"; ls /home/.claude/worktrees
  exit 1
fi
cd "$WT_DIR"
echo "==> worktree: $WT_DIR"

# 1. node_modules is gitignored (absent in worktrees) -> reuse the main repo's.
if [ ! -e node_modules ]; then
  ln -s /home/node_modules node_modules
  echo "==> linked node_modules -> /home/node_modules"
fi

# 2. build/ bundles are gitignored (absent) -> build this branch's JS/CSS.
echo "==> building bundles (grunt concat concat_css)"
node_modules/.bin/grunt concat concat_css >/dev/null

# 3. A stray `sbt --client` server whose cwd is this worktree shares target/ and deadlocks `~ run`. Kill it.
for p in $(pgrep -f sbt-launch 2>/dev/null || true); do
  if [ "$(readlink "/proc/$p/cwd" 2>/dev/null || true)" = "$WT_DIR" ]; then
    echo "==> killing thin-client sbt $p (shares target/)"
    kill -9 "$p" 2>/dev/null || true
  fi
done

# 4. Free :9000 -> stop whatever `~ run` currently serves it (SIGTERM, then SIGKILL if it lingers).
for p in $(pgrep -f '~ run' 2>/dev/null || true); do
  echo "==> stopping running app (pid $p) on :9000"
  kill "$p" 2>/dev/null || true
done
sleep 2
if (exec 3<>/dev/tcp/127.0.0.1/9000) 2>/dev/null; then
  for p in $(pgrep -f '~ run' 2>/dev/null || true); do kill -9 "$p" 2>/dev/null || true; done
  sleep 1
fi

# 5. Launch. Absolute cache paths reuse the main repo's warm .coursier/.sbt; cwd-relative caches from a
#    worktree would trigger a multi-GB re-download. config.file points at the worktree's own conf.
echo "==> starting sbt ~ run  (first HTTP request triggers the dev compile; Ctrl-C to stop)"
exec sbt \
  -Dconfig.file="$WT_DIR/conf/application.local.conf" \
  -Dsbt.coursier.home=/home/.coursier \
  -Dsbt.global.base=/home/.sbt \
  -Dsbt.boot.directory=/home/.sbt/boot \
  -Dsbt.repository.config=/home/.sbt/repositories \
  -J-Xmx1536m "~ run"
