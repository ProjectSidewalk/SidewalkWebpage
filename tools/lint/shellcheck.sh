#!/usr/bin/env bash
# Runs ShellCheck over the repo's shell scripts (#5589). Runs in CI (see .github/workflows/ci.yml) and locally via
# `make shellcheck`. Settings shared with editors live in .shellcheckrc.
#
# ShellCheck runs from its official Docker image so everyone gets the same version, with nothing to install. The
# version is pinned in docker/shellcheck/Dockerfile, where Dependabot can see it.
#
# Usage: tools/lint/shellcheck.sh [file ...]    (no files = every .sh file outside public/vendor/ that git sees,
#                                                 tracked or not, minus ignored ones)
#
# Exit code: 0 if clean, 1 if ShellCheck finds anything, 2 if a file is missing or the tool couldn't be found.
#
# Written for the host's bash, which on macOS is 3.2: no mapfile, no associative arrays.

set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"
cd "$ROOT"

command -v docker > /dev/null || { echo "shellcheck: docker not found" >&2; exit 2; }
image=$(sed -n 's/^FROM //p' docker/shellcheck/Dockerfile)
[[ -n "$image" ]] || { echo "shellcheck: no FROM line in docker/shellcheck/Dockerfile" >&2; exit 2; }

files=()
if [[ $# -gt 0 ]]; then
    # Absolute paths are made repo-relative, since that's where the container sees the files.
    for f in "$@"; do
        f="${f#"$ROOT"/}"
        [[ -e "$f" ]] || { echo "shellcheck: no such file: $f" >&2; exit 2; }
        files+=("$f")
    done
else
    # Untracked scripts count too, so a new file is checked before it's staged; a deleted one is skipped until then.
    while IFS= read -r f; do
        [[ -e "$f" ]] && files+=("$f")
    done < <(git ls-files --cached --others --exclude-standard '*.sh' ':!public/vendor/')
fi
[[ ${#files[@]} -gt 0 ]] || { echo "shellcheck: no shell scripts found" >&2; exit 2; }

color=never; [[ -t 1 || -n "${FORCE_COLOR:-}" ]] && color=always
docker run --rm -v "$ROOT:/mnt:ro" -w /mnt "$image" --color="$color" "${files[@]}"
echo "shellcheck: ${#files[@]} scripts clean"
