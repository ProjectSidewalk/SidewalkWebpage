#!/usr/bin/env bash
#
# Claude Code's side of the dev-resource leases in tools/dev/lease.sh (#5586).
#
#     lease-hook.sh heartbeat   # UserPromptSubmit: marks the session alive
#     lease-hook.sh pre-tool    # PreToolUse: that, plus a note when :9000 is serving another checkout's app
#     lease-hook.sh stop        # Stop: that, plus asks the session to let go when someone waits on what it holds
#     lease-hook.sh end         # SessionEnd: releases everything the session holds
#
# Runs on the host and reads the hook's JSON on stdin. Leases live in the main checkout's .claude/leases/, which the
# web container sees as /home/.claude/leases/; anything that changes one goes through lease.sh in the container. Every
# failure is silent, since no hook here may get in the way of the session's real work.

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

# The copy of lease.sh from the checkout this session was started in, as the container sees it.
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

# The session's name is what other sessions pass to SendMessage, so lease.sh shows it to them.
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
  held=$(sed -n 's/^the app on :9000: held by \([^ ,]*\).*/\1/p' <<<"$status")
  serving=$(sed -n 's/^  serving: //p' <<<"$status")
  { [ -n "$held" ] && [ "$held" != "$mine" ]; } || { [ "$serving" != nothing ] && [ "$serving" != "$mine" ]; } ||
    return 0
  # Said once per change, not on every curl.
  key="$held|$serving"
  [ "$(cat "$SESSION_FILE.seen" 2>/dev/null)" = "$key" ] && return 0
  echo "$key" >"$SESSION_FILE.seen" 2>/dev/null
  jq -n --arg c "Heads-up: the app on :9000 is not this checkout's ($mine), so it won't show your changes.
$status
To run your own branch's app, use \`make qa-worktree wt=<name> wait=1\`, which waits its turn instead of stopping an app someone is using." \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $c}}'
}

stop() {
  local waiting
  [ "$(jq -r '.stop_hook_active // false' <<<"$input")" = true ] && return 0
  # Checked on the host first, so a session holding nothing never pays for a docker exec.
  grep -qsx "session=$sid" "$LEASES"/*.lease || return 0
  waiting=$(lease nudge "$sid") || return 0
  [ -n "$waiting" ] || return 0
  jq -n --arg r "Another session is waiting for something you hold:
$waiting
If neither you nor the user still needs it, release it now: \`make qa-worktree-stop wt=<name>\` for the app, \
\`make lease-release res=<name>\` for anything else. If the user may still be using it (say, clicking through the app), \
leave it and tell them who is waiting." '{decision: "block", reason: $r}'
}

case "$EVENT" in
heartbeat) heartbeat ;;
pre-tool) heartbeat; pre_tool ;;
stop) heartbeat; stop ;;
end)
  lease release-session "$sid" >/dev/null
  rm -f "$SESSION_FILE" "$SESSION_FILE.seen"
  ;;
esac
exit 0
