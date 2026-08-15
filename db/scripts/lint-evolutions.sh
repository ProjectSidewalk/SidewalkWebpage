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
#   2. A semicolon *inside a single-quoted string literal* -- the same split, one layer deeper. Play cuts the statement
#      mid-string, so the chunk it hands Postgres ends with an unterminated quote and fails with SQLSTATE 42601. The
#      usual source is prose: a `version` row description or a comment column that reads naturally with a `;`. Reword
#      to drop it. (Dollar-quoted bodies would need separate handling, but no evolution uses them.)
#   3. Missing `# --- !Ups` / `# --- !Downs` markers. Play needs both section headers; a missing one silently yields an
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

    # Check 2: a `;` inside a single-quoted string. Scan character by character rather than with a regex, because
    # whether a given `;` is quoted depends on every quote before it. String and block-comment state both carry across
    # lines, since either may span them. A doubled '' is an escaped quote that stays in the string. Prose apostrophes
    # inside comments are why comments must be skipped rather than merely ignored: `/* ... we don't ... */` holds an
    # odd number of quotes and would otherwise open a string that never closes (242.sql).
    while IFS= read -r match; do
        echo "ERROR ($(basename "$sql_file")): semicolon inside a string literal -- Play splits on it and hands"
        echo "       Postgres an unterminated string. Reword to drop the ';'."
        echo "       $match"
        problems=1
    done < <(awk '
        BEGIN { q = sprintf("%c", 39); in_str = 0; in_block = 0 }
        {
            reported = 0
            n = length($0)
            for (i = 1; i <= n; i++) {
                c = substr($0, i, 1)
                if (in_block) {
                    if (c == "*" && substr($0, i + 1, 1) == "/") { in_block = 0; i++ }
                } else if (in_str) {
                    if (c == q) {
                        if (substr($0, i + 1, 1) == q) { i++; continue }
                        in_str = 0
                    } else if (c == ";" && !reported) {
                        print FNR ":" $0
                        reported = 1
                    }
                } else {
                    if (c == "-" && substr($0, i + 1, 1) == "-") break
                    if (c == "/" && substr($0, i + 1, 1) == "*") { in_block = 1; i++; continue }
                    if (c == q) in_str = 1
                }
            }
        }
    ' "$sql_file")

    # Check 3: both section markers must be present.
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
