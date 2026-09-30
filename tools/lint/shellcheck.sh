#!/usr/bin/env bash
# Runs ShellCheck over the repo's shell scripts (#5589). Runs in CI (see .github/workflows/ci.yml) and locally via
# `make shellcheck`. Settings shared with editors live in .shellcheckrc.
#
# ShellCheck runs from its official Docker image so everyone gets the same version, with nothing to install.
#
# Usage: tools/lint/shellcheck.sh [file ...]    (no files = every tracked .sh file outside public/vendor/)
#
# Exit code: 0 if clean, 1 if ShellCheck finds anything, 2 if it could not run.

set -euo pipefail

SHELLCHECK_IMAGE="koalaman/shellcheck:v0.11.0"

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"
cd "$ROOT"

command -v docker > /dev/null || { echo "shellcheck: docker not found" >&2; exit 2; }

if [[ $# -gt 0 ]]; then
    files=("$@")
else
    mapfile -t files < <(git ls-files '*.sh' ':!public/vendor/')
fi
[[ ${#files[@]} -gt 0 ]] || { echo "shellcheck: no shell scripts found" >&2; exit 2; }

color=never; [[ -t 1 || -n "${FORCE_COLOR:-}" ]] && color=always
docker run --rm -v "$ROOT:/mnt:ro" -w /mnt "$SHELLCHECK_IMAGE" --color="$color" "${files[@]}"
echo "shellcheck: ${#files[@]} scripts clean"
