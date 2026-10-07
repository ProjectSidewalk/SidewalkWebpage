#!/usr/bin/env bash
# The dev server behind `npm start`, run inside the web container: build the assets once, keep rebuilding them on
# save, run the app, and stop the rebuild watcher when the app exits. The watcher gets its own process group so one
# kill takes down npm, the shell it spawns and the watcher itself; a plain `&` job would ignore Ctrl-C (sh starts
# background jobs that way) and outlive the session, and the next `npm start` would then run two watchers.
set -u
cd "$(dirname "$0")/../.." || exit 1

# A failed first build must not skip the watcher: fix the file, save, and the watcher rebuilds.
npm run build || echo "==> asset build failed; fix the error and save, and the watcher will rebuild" >&2

setsid npm run watch &
WATCH_PGID=$!
cleanup() {
  trap - EXIT INT TERM
  kill -- "-$WATCH_PGID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Foreground, not `exec`, so the trap above still runs once sbt quits.
sbt -Dconfig.file=/home/conf/application.local.conf \
  -Dsbt.coursier.home='.coursier' -Dsbt.global.base='.sbt' -Dsbt.boot.directory='.sbt/boot' \
  -Dsbt.repository.config='.sbt/repositories' -J-Xmx1536m "~ run"
