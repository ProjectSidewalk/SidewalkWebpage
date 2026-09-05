#!/usr/bin/env bash
#
# Install node_modules from package-lock.json when the two have diverged. Runs INSIDE the web container.
#
#     make npm-sync                          # from the host; `make dev` also runs this
#     bash /home/tools/npm-sync.sh           # from inside the container shell
#     bash tools/npm-sync.sh --write-stamp   # image build: record the tree its own `npm ci` just installed
#
# Nothing else in the dev loop installs: `npm start` only runs grunt and sbt, and the named node_modules volume is
# not refreshed by rebuilding the image.
#
set -euo pipefail

cd /home

# The stamp covers package.json too, because `npm ci` refuses to run when it and the lockfile disagree, and the
# node/npm versions, because a Node major leaves the volume's prebuilt native binaries on the old ABI.
stamp=node_modules/.lockstamp
want=$({ sha256sum package.json package-lock.json; node -v; npm -v; } | sha256sum | cut -d' ' -f1)

if [ "${1:-}" = "--write-stamp" ]; then
  echo "$want" > "$stamp"
  exit 0
fi

have=$(cat "$stamp" 2>/dev/null || true)
if [ "$want" = "$have" ]; then
  exit 0
fi

if [ -z "$have" ]; then
  echo "node_modules has no install stamp -- running npm ci..."
else
  echo "node_modules is out of date -- running npm ci..."
fi

# Blocking rather than backgrounded: `npm ci` empties node_modules before it refills it.
npm ci --no-audit --no-fund
echo "$want" > "$stamp"
echo "node_modules is in sync with package-lock.json."
