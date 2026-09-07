#!/usr/bin/env bash
# Builds the vendored Photo Sphere Viewer bundle (see ../README.md). Usage: ./build.sh <psv-version>
# Needs node + npm. Installs into a temporary directory, so nothing here touches the repo's node_modules.
set -euo pipefail

VERSION="${1:?usage: build.sh <photo-sphere-viewer version, e.g. 5.15.1>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(dirname "$HERE")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm init -y >/dev/null
# three.js is pinned to whatever this Photo Sphere Viewer release declares, so the two always match.
npm install --silent --no-audit --no-fund esbuild@0.24 \
  "@photo-sphere-viewer/core@$VERSION" "@photo-sphere-viewer/equirectangular-tiles-adapter@$VERSION"
THREE_RANGE="$(node -p "require('@photo-sphere-viewer/core/package.json').dependencies.three")"
npm install --silent --no-audit --no-fund "three@$THREE_RANGE"
THREE_VERSION="$(node -p "require('three/package.json').version")"

cp "$HERE/entry.js" entry.js
npx esbuild entry.js --bundle --minify --format=iife --global-name=PhotoSphereViewer --legal-comments=eof \
  --target=es2022 --outfile="$OUT/psv-$VERSION-bundle.min.js"
cp node_modules/@photo-sphere-viewer/core/index.css "$OUT/psv-$VERSION.css"
cp node_modules/@photo-sphere-viewer/core/LICENSE "$OUT/LICENSE-photo-sphere-viewer"
cp node_modules/three/LICENSE "$OUT/LICENSE-three"

echo "Built psv-$VERSION-bundle.min.js (Photo Sphere Viewer $VERSION + three.js $THREE_VERSION) into $OUT"
