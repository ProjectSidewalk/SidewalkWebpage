#!/usr/bin/env bash
#
# Claude Code's side of tools/dev/lease.sh (#5586).
#
#     lease-hook.sh heartbeat   # UserPromptSubmit: marks the session alive
#     lease-hook.sh pre-tool    # PreToolUse: also warns when :9000 serves another checkout's app
#     lease-hook.sh stop        # Stop: also nudges when someone waits on what the session holds
#     lease-hook.sh end         # SessionEnd: releases the session's leases
#
# Runs on the host; lease changes go through lease.sh in the container. Fails silently so it never blocks real work.

set -uo pipefail

EVENT="${1:-}"
WEB="${SIDEWALK_WEB_CONTAINER:-projectsidewalk-web}"
input=$(cat)
sid=$(jq -r '.session_id // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
[ -n "$sid" ] || exit 0

project="${CLAUDE_PROJECT_DIR:-$cwd}"
main=$(git -C "$project" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
main=$(dirname "$main")
LEASES="$main/.claude/leases"
SESSION_FILE="$LEASES/sessions/$sid"

lease() {
  local script="$project/tools/dev/lease.sh"
  [ -f "$script" ] || script="$main/tools/dev/lease.sh"
  [ -f "$script" ] || return 1
  docker exec -e CLAUDE_CODE_SESSION_ID="$sid" "$WEB" bash "/home${script#"$main"}" "$@" 2>/dev/null
}

checkout_of() {
  case "$1" in
  "$main"/.claude/worktrees/*) local d="${1#"$main"/.claude/worktrees/}" && echo "${d%%/*}" ;;
  *) echo main ;;
  esac
}

# Other sessions SendMessage by this name.
heartbeat() {
  local name
  mkdir -p "$LEASES/sessions" 2>/dev/null || return 0
  name=$(jq -r --arg s "$sid" 'select(.sessionId == $s) | .name // empty' ~/.claude/sessions/*.json 2>/dev/null | head -1)
  echo "name=$name" >"$SESSION_FILE" 2>/dev/null
}

pre_tool() {
  local target status mine held serving key
  target=$(jq -r '[.tool_input.command, .tool_input.url] | map(select(. != null)) | join(" ")' <<<"$input")
  grep -qE '(localhost|127\.0\.0\.1):9000|make[[:space:]]+([^;&|]*[[:space:]])?test-e2e' <<<"$target" || return 0
  status=$(lease status app) || return 0
  mine=$(checkout_of "$cwd")
  # An app this session started for another checkout (qa-worktree wt=X) is still its own.
  grep -qsx "session=$sid" "$LEASES/app.lease" && mine=$(sed -n 's/^checkout=//p' "$LEASES/app.lease")
  held=$(sed -n 's/^the app on :9000: held by \([^ ,]*\).*/\1/p' <<<"$status")
  serving=$(sed -n 's/^  serving: //p' <<<"$status")
  if ! { [ -n "$held" ] && [ "$held" != "$mine" ]; } && ! { [ "$serving" != nothing ] && [ "$serving" != "$mine" ]; }; then
    # Reset, so the same holder returning is announced again.
    rm -f "$SESSION_FILE.seen"
    return 0
  fi
  # Said once per change, not on every curl.
  key="$held|$serving"
  [ "$(cat "$SESSION_FILE.seen" 2>/dev/null)" = "$key" ] && return 0
  echo "$key" >"$SESSION_FILE.seen" 2>/dev/null
  jq -n --arg c "Heads-up: the app on :9000 isn't this checkout's ($mine).
$status
Run yours with \`make qa-worktree wt=<name> wait=1\`." \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $c}}'
}

stop() {
  local waiting
  [ "$(jq -r '.stop_hook_active // false' <<<"$input")" = true ] && return 0
  # Checked on the host first, so a session holding nothing never pays for a docker exec.
  grep -qsx "session=$sid" "$LEASES"/*.lease || return 0
  waiting=$(lease nudge "$sid") || return 0
  [ -n "$waiting" ] || return 0
  jq -n --arg r "Waiting on something you hold:
$waiting
If it's no longer needed, release it (\`make qa-worktree-stop wt=<name>\` or \`make lease-release res=<name>\`). \
If the user may still be using it, tell them who's waiting." '{decision: "block", reason: $r}'
}

case "$EVENT" in
heartbeat) heartbeat ;;
pre-tool) heartbeat; pre_tool ;;
stop) heartbeat; stop ;;
end)
  # Kept if the release fails, so the leases still expire by idleness.
  lease release-session "$sid" >/dev/null && rm -f "$SESSION_FILE"
  rm -f "$SESSION_FILE.seen"
  ;;
esac
exit 0
