#!/usr/bin/env bash
# `npm start`, inside the web container: build the assets, keep rebuilding them on save, run the app. The watcher
# gets its own process group (setsid) so the trap can kill it and its npm/shell parents when sbt quits; a plain `&`
# job ignores Ctrl-C and outlives the session, and the next `npm start` then runs two of them.
set -u
cd "$(dirname "$0")/../.." || exit 1

npm run build || echo "==> asset build failed; fix the error and save, and the watcher will rebuild" >&2
setsid npm run watch &
WATCH_PGID=$!
trap 'kill -- "-$WATCH_PGID" 2>/dev/null' EXIT

sbt -Dconfig.file=/home/conf/application.local.conf \
  -Dsbt.coursier.home='.coursier' -Dsbt.global.base='.sbt' -Dsbt.boot.directory='.sbt/boot' \
  -Dsbt.repository.config='.sbt/repositories' -J-Xmx1536m "~ run"
