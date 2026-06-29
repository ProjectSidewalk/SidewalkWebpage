#!/bin/bash
# Static checks for Play evolution files (conf/evolutions/default/*.sql) that catch footguns the SQL engine itself
# won't flag until apply time. Runs in CI (see .github/workflows/ci.yml) and locally via `make lint-evolutions`.
#
# Checks:
#   1. A semicolon *mid-comment* -- i.e. a `;` inside a `--` comment with more text after it on the same line. Play's
#      evolutions parser splits statements on every `;`, including ones inside comments. The text after the `;` loses
#      its leading `--` (which stayed with the previous chunk) and gets executed as SQL, failing with a syntax error at
#      apply time (this broke evolution 325; see #4335 / #4351). Reword the comment to drop the `;`. A `;` at the very
#      end of a comment line is harmless (it just splits between statements at a comment boundary) and is not flagged.
#   2. Missing `# --- !Ups` / `# --- !Downs` markers. Play needs both section headers; a missing one silently yields an
#      empty Up or Down.
#
# Exit code: 0 if clean, 1 if any problem is found.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
EVOLUTIONS_DIR="${1:-$SCRIPT_DIR/../../conf/evolutions/default}"

if [[ ! -d "$EVOLUTIONS_DIR" ]]; then
    echo "lint-evolutions: evolutions dir not found: $EVOLUTIONS_DIR" >&2
    exit 1
fi

problems=0

shopt -s nullglob
for sql_file in "$EVOLUTIONS_DIR"/*.sql; do
    # Check 1: a `--` comment containing a `;` that has more non-whitespace after it on the same line. That trailing
    # text is what Play orphans into the next statement. A `;` at end-of-comment-line, or a normal statement-ending `;`
    # with no `--`, is fine and not matched.
    while IFS= read -r match; do
        echo "ERROR ($(basename "$sql_file")): semicolon mid-'--'-comment -- Play splits on it and executes the text"
        echo "       after the ';' as SQL. Reword to drop the ';'."
        echo "       $match"
        problems=1
    done < <(grep -nE -- '--.*;[[:space:]]*[^[:space:]]' "$sql_file" || true)

    # Check 2: both section markers must be present.
    if ! grep -qE '^#[[:space:]]*---[[:space:]]*!Ups' "$sql_file"; then
        echo "ERROR ($(basename "$sql_file")): missing '# --- !Ups' marker."
        problems=1
    fi
    if ! grep -qE '^#[[:space:]]*---[[:space:]]*!Downs' "$sql_file"; then
        echo "ERROR ($(basename "$sql_file")): missing '# --- !Downs' marker."
        problems=1
    fi
done

if [[ "$problems" -eq 0 ]]; then
    echo "lint-evolutions: OK ($(basename "$EVOLUTIONS_DIR") is clean)"
fi

exit "$problems"
