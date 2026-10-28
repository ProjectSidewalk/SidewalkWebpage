#!/bin/bash
# Prints the newest release tag and the highest evolution in it, as "<tag> <evolution>". CI uses it to find the
# evolutions a rollback would undo (#5839). Fetches just that tag, since CI checkouts have none.

set -euo pipefail

tag=$(git ls-remote --tags --refs origin 'v*' | sed 's#.*refs/tags/##' | sort -V | tail -1)
[[ -n "$tag" ]] || { echo "last-release: no v* tag on origin" >&2; exit 1; }
git fetch --quiet --depth=1 --no-tags origin "refs/tags/$tag:refs/tags/$tag"
evolution=$(git ls-tree --name-only "$tag" conf/evolutions/default/ | sed 's#.*/##; s#\.sql$##' | sort -n | tail -1)
echo "$tag $evolution"
