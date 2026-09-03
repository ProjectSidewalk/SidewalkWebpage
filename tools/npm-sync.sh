#!/usr/bin/env bash
#
# Install node_modules from package-lock.json when the two have diverged. Runs INSIDE the web container.
#
#     make npm-sync                    # from the host; `make dev` also runs this
#     bash /home/tools/npm-sync.sh     # from inside the container shell
#
# Nothing else in the dev loop installs: `npm start` only runs grunt and sbt, and the named node_modules volume is
# not refreshed by rebuilding the image.
#
set -euo pipefail

cd /home

# The stamp records the lockfile node_modules was installed from, so the common case costs one sha256sum.
stamp=node_modules/.lockstamp
want=$(sha256sum package-lock.json | cut -d' ' -f1)
have=$(cat "$stamp" 2>/dev/null || true)

if [ "$want" = "$have" ]; then
  exit 0
fi

if [ -z "$have" ]; then
  echo "node_modules has no install stamp -- running npm ci..."
else
  echo "package-lock.json has changed since node_modules was installed -- running npm ci..."
fi

# Blocking rather than backgrounded: `npm ci` empties node_modules before it refills it.
npm ci --no-audit --no-fund
echo "$want" > "$stamp"
echo "node_modules is in sync with package-lock.json."
