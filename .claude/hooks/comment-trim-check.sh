#!/usr/bin/env bash
#
# Stop hook: requests a comment-trim pass on the comment lines the working diff adds.
#
# Fires on growth in the count rather than on presence, which is what makes it converge:
# a trim lowers the count, the per-session ratchet follows it down, and the next stop is
# silent until later edits push it back up.
#
# Dry run (no state written, no JSON emitted):
#   .claude/hooks/comment-trim-check.sh --dry-run
#   CTC_DIFF_BASE=develop .claude/hooks/comment-trim-check.sh --dry-run

set -uo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

if [ "$DRY_RUN" -eq 0 ]; then
  input=$(cat)
  # A block already sent us back around; a second one would loop.
  [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0
  session=$(printf '%s' "$input" | jq -r '.session_id // "nosession"')
  cwd=$(printf '%s' "$input" | jq -r '.cwd // "."')
  cd "$cwd" 2>/dev/null || exit 0
fi

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

BASE="${CTC_DIFF_BASE:-HEAD}"

# Gated per file type so a CSS hex color, a JS decrement, and a SQL dash don't all read
# as comments.
read -r -d '' AWK_LIB <<'AWKEOF'
function skip_path(f) {
  return (f ~ /(^|\/)(build|vendor|node_modules|target|dist)\// || f ~ /\.min\./)
}
function is_comment(f, s,   t) {
  t = s
  sub(/^[ \t]+/, "", t)
  if (t == "") return 0
  # Doc-block scaffolding is structure, not prose: counting it inflates the ratchet and
  # buries the real prose in the listing.
  if (t ~ /^(\/\*\*?|\*\/|\*|@\*|\*@)[ \t]*$/) return 0
  if (t ~ /^\*[ \t]*@(param|return|returns|throws|tparam)\b/) return 0
  if (f ~ /\.html$/)                    return (t ~ /^(<!--|@\*|\*)/)
  if (f ~ /\.(scala|js|mjs|java)$/)     return (t ~ /^(\/\/|\/\*|\*)/)
  if (f ~ /\.css$/)                     return (t ~ /^(\/\*|\*)/)
  if (f ~ /\.sql$/)                     return (t ~ /^--/)
  if (f ~ /\.(py|sh|conf|yml|yaml)$/)   return (t ~ /^#/)
  return 0
}
AWKEOF

tracked=$(git diff "$BASE" --unified=0 --no-color -- . 2>/dev/null | awk "
$AWK_LIB
/^\+\+\+ b\// { file = substr(\$0, 7); next }
/^\+\+\+ \/dev\/null/ { file = \"\"; next }
/^@@ / {
  if (match(\$0, /\+[0-9]+/)) ln = substr(\$0, RSTART + 1, RLENGTH - 1)
  next
}
/^\+/ {
  if (file == \"\" || skip_path(file)) next
  line = substr(\$0, 2)
  if (is_comment(file, line)) printf \"%s:%d: %s\n\", file, ln, line
  ln++
}
")

# Untracked files never appear in a diff, so every comment line in them is new.
untracked=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  hits=$(awk "
$AWK_LIB
{ if (!skip_path(FILENAME) && is_comment(FILENAME, \$0)) printf \"%s:%d: %s\n\", FILENAME, NR, \$0 }
" "$f" 2>/dev/null)
  [ -n "$hits" ] && untracked+="$hits"$'\n'
done < <(git ls-files --others --exclude-standard 2>/dev/null)

flagged=$(printf '%s\n%s' "$tracked" "$untracked" | grep -c . >/dev/null 2>&1 && printf '%s\n%s' "$tracked" "$untracked" | grep . || true)
count=$(printf '%s' "$flagged" | grep -c . || true)
count=${count:-0}

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s\n' "$flagged"
  printf -- '--- added comment lines: %s (base: %s)\n' "$count" "$BASE"
  exit 0
fi

state_dir="${HOME}/.claude/comment-trim-state"
mkdir -p "$state_dir" 2>/dev/null
state_file="${state_dir}/${session}.count"
last=0
[ -f "$state_file" ] && last=$(cat "$state_file" 2>/dev/null || printf '0')
case "$last" in ''|*[!0-9]*) last=0 ;; esac

printf '%s' "$count" > "$state_file"

[ "$count" -le "$last" ] && exit 0

listing=$(printf '%s' "$flagged" | head -60)
extra=$((count - 60))
[ "$extra" -gt 0 ] && listing="${listing}
... and ${extra} more"

reason="Before this turn ends, do the comment-trim pass on the ${count} comment lines this working diff adds.

Re-read each one below and apply CLAUDE.md's standard - comments say WHY, not WHAT:
- Delete any that restate what the code already says.
- Delete any that narrate the change you just made (git history covers that).
- Delete doc headers on trivial helpers; keep ScalaDoc/JSDoc on non-trivial ones, but cut the prose to the contract.
- Collapse multi-line comments that fit on one line. One tight line beats three.
- Keep the ones that carry a reason, a constraint, an invariant, or a non-obvious tradeoff.

Edit the files to apply the trims. If a comment genuinely earns its place, leave it - this is a review, not a
mandate to cut everything.

Then close the turn by repeating, in full, the summary of the actual work that you had written before this pass.
This pass is housekeeping and lands below that summary, so without the repeat the user has to scroll back past it
to read the part they care about. Do not describe what you trimmed, and do not add a line saying you are repeating
yourself - just restate the summary as your final message.

Comment lines added by this diff:
${listing}"

jq -n --arg r "$reason" \
  '{decision:"block", reason:$r, systemMessage:"comment-trim hook: requesting a trim pass on newly added comments"}'
