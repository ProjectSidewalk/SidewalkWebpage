#!/usr/bin/env bash
#
# Leases on the dev resources that checkouts and Claude sessions share, so one never pulls a resource out from under
# another (#5586). A lease says who holds it: checkout, Claude session, purpose, since when.
#
#     bash tools/dev/lease.sh take <resource> [--checkout <dir>] [--pid <pid>] [--wait] [--force]
#     bash tools/dev/lease.sh release <resource> [--checkout <dir>] [--pid <pid>]
#     bash tools/dev/lease.sh check <resource> [--checkout <dir>]
#     bash tools/dev/lease.sh status [<resource>]
#     bash tools/dev/lease.sh release-session <session-id>
#     bash tools/dev/lease.sh nudge <session-id>
#
# Runs inside the web container. The Makefile, qa-worktree.sh and sbt-run.sh call it, and .claude/hooks/lease-hook.sh
# reaches it through docker exec. See docs/dev-environment.md -> "Sharing the app and the test database".
#
# A lease ends when it's released, when the process it names (--pid) exits, or when the Claude session holding it has
# been silent for LEASE_IDLE_MIN minutes. Sessions report in through the hooks, which touch sessions/<id>.
#
# `check` asks without taking: 0 when the resource is free or already this checkout's.
#
# Exit codes: 0 done, 1 busy, 2 usage.

set -uo pipefail

LEASE_DIR="${LEASE_DIR:-/home/.claude/leases}"
LEASE_IDLE_MIN="${LEASE_IDLE_MIN:-60}"
# Container-local: flock across a bind mount isn't reliable on every Docker host, and every writer runs in here.
MUTEX="${LEASE_MUTEX:-/tmp/sidewalk-lease.mutex}"
SESSION="${CLAUDE_CODE_SESSION_ID:-}"
# Kept to one line without '|', the queue file's separator.
PURPOSE=$(printf '%s' "${LEASE_PURPOSE:-}" | tr '|\n' '/ ')

usage() {
  sed -n '6,11p' "$0" | sed 's/^# *//'
  exit 2
}

now() { date +%s; }

# A process's start time, so a recycled pid isn't mistaken for the one that took the lease.
proc_start() { sed 's/.*) //' "/proc/$1/stat" 2>/dev/null | cut -d' ' -f20; }

pid_alive() { [ -n "$1" ] && [ -r "/proc/$1/stat" ] && [ "$(proc_start "$1")" = "$2" ]; }

# Minutes since the session last reported in, or nothing when it never has (its checkout may predate the hooks).
session_idle_min() {
  local f="$LEASE_DIR/sessions/$1"
  [ -n "$1" ] && [ -f "$f" ] || return 0
  echo $((($(now) - $(stat -c %Y "$f")) / 60))
}

# A session's name as ListAgents shows it (what SendMessage takes), which the hooks copy into its session file.
session_label() {
  local name
  name=$(field "$LEASE_DIR/sessions/$1" name)
  echo "${name:-${1:0:8}}"
}

checkout_name() {
  local d
  d=$(cd "$1" 2>/dev/null && pwd -P) || d="$1"
  case "$d" in
  /home) echo main ;;
  /home/.claude/worktrees/*) d="${d#/home/.claude/worktrees/}" && echo "${d%%/*}" ;;
  *) basename "$d" ;;
  esac
}

label() {
  case "$1" in
  app) echo "the app on :9000" ;;
  db-tests) echo "the Scala test database" ;;
  *) echo "'$1'" ;;
  esac
}

field() { sed -n "s/^$2=//p" "$1" 2>/dev/null | head -1; }

ago() {
  local m=$((($(now) - $1) / 60))
  if [ "$m" -lt 1 ]; then echo "just now"; elif [ "$m" -lt 120 ]; then echo "$m min ago"; else echo "$((m / 60)) h ago"; fi
}

lock() {
  exec 8>"$MUTEX"
  flock 8
}
unlock() { flock -u 8; }

ensure_dirs() {
  mkdir -p "$LEASE_DIR/sessions"
  # Owned like the repo, so the hooks, which run on the host, can write their session files.
  chown "$(stat -c %u:%g /home)" "$LEASE_DIR" "$LEASE_DIR/sessions" 2>/dev/null
}

# Why a lease is over, or nothing while it's live.
lease_dead_reason() {
  local f="$1" pid idle
  pid=$(field "$f" pid)
  if [ -n "$pid" ] && ! pid_alive "$pid" "$(field "$f" pid_start)"; then
    echo "its process exited"
    return
  fi
  idle=$(session_idle_min "$(field "$f" session)")
  [ -n "$idle" ] && [ "$idle" -ge "$LEASE_IDLE_MIN" ] && echo "its Claude session has been silent for $idle min"
}

# The queue file holds one waiter per line, first come first served: id|checkout|session|pid|pid_start|since|purpose.
# A waiter stays in line only while its waiting process lives.
prune() {
  local res="$1" f="$LEASE_DIR/$1.lease" q="$LEASE_DIR/$1.queue" why line pid pid_start out=""
  if [ -f "$f" ]; then
    why=$(lease_dead_reason "$f")
    if [ -n "$why" ]; then
      echo "==> $(label "$res") was held by $(field "$f" checkout), but $why; treating it as free" >&2
      rm -f "$f"
    fi
  fi
  [ -f "$q" ] || return 0
  while IFS= read -r line; do
    IFS='|' read -r _ _ _ pid pid_start _ <<<"$line"
    pid_alive "$pid" "$pid_start" && out+="$line"$'\n'
  done <"$q"
  if [ -n "$out" ]; then printf '%s' "$out" >"$q"; else rm -f "$q"; fi
}

describe_holder() {
  local f="$1" session purpose idle s
  session=$(field "$f" session)
  purpose=$(field "$f" purpose)
  s="$(field "$f" checkout)"
  if [ -n "$session" ]; then
    idle=$(session_idle_min "$session")
    s+=" (Claude session $(session_label "$session")${idle:+, last active $idle min ago})"
  fi
  s+=", taken $(ago "$(field "$f" since)")"
  [ -n "$purpose" ] && s+=" for \"$purpose\""
  echo "$s"
}

describe_queue() {
  local n=0 checkout session since purpose
  [ -f "$1" ] || return 0
  while IFS='|' read -r _ checkout session _ _ since purpose; do
    n=$((n + 1))
    echo "  $n. $checkout${session:+ (Claude session $(session_label "$session"))}, waiting since $(ago "$since")${purpose:+ for \"$purpose\"}"
  done <"$1"
}

# The app is the one resource whose real state is visible, and it may be running without a lease (npm start).
running_app() {
  local p
  for p in $(pgrep -f '^java.*~ run' 2>/dev/null); do
    echo "serving: $(checkout_name "$(readlink "/proc/$p/cwd")")"
    return
  done
  echo "serving: nothing"
}

status() {
  local res f q list
  if [ -n "${1:-}" ]; then
    list="$1"
  else
    list=$({
      printf '%s\n' app db-tests
      ls "$LEASE_DIR" 2>/dev/null | sed -n 's/\.\(lease\|queue\)$//p'
    } | sort -u)
  fi
  lock
  for res in $list; do
    f="$LEASE_DIR/$res.lease"
    q="$LEASE_DIR/$res.queue"
    prune "$res" 2>/dev/null
    if [ -f "$f" ]; then
      echo "$(label "$res"): held by $(describe_holder "$f")"
    else
      echo "$(label "$res"): free"
    fi
    [ "$res" = app ] && echo "  $(running_app)"
    [ -f "$q" ] && echo "  waiting:" && describe_queue "$q"
  done
  unlock
}

# Who has the resource and who's in line; with "advice", also what the caller can do about it.
busy_message() {
  local res="$1" advice="${2:-}" f="$LEASE_DIR/$1.lease" q="$LEASE_DIR/$1.queue" session name
  if [ -f "$f" ]; then
    echo "$(label "$res") is held by $(describe_holder "$f")."
  else
    echo "$(label "$res") is free, but others are in line for it."
  fi
  [ -f "$q" ] && echo "In line:" && describe_queue "$q"
  [ -n "$advice" ] || return 0
  echo "Wait your turn with wait=1 (--wait), or take it anyway with force=1 (--force)."
  session=$(field "$f" session)
  # Only a real name works as a SendMessage address, not session_label's id fallback.
  name=$(field "$LEASE_DIR/sessions/$session" name)
  if [ -n "$name" ] && [ "$session" != "$SESSION" ]; then
    echo "To ask the holder to finish, message its Claude session: SendMessage to \"$name\"."
  fi
  return 0
}

write_lease() {
  local pid="$3"
  {
    echo "checkout=$2"
    echo "session=$SESSION"
    echo "pid=$pid"
    echo "pid_start=$([ -n "$pid" ] && proc_start "$pid")"
    echo "purpose=$PURPOSE"
    echo "since=$(now)"
  } >"$LEASE_DIR/$1.lease"
}

drop_from_queue() {
  local q="$1"
  [ -f "$q" ] || return 0
  awk -F'|' -v id="$2" '$1 != id' "$q" >"$q.tmp"
  if [ -s "$q.tmp" ]; then mv "$q.tmp" "$q"; else rm -f "$q" "$q.tmp"; fi
}

take() {
  local res="$1" dir="$2" pid="$3" wait="$4" force="$5"
  local f="$LEASE_DIR/$res.lease" q="$LEASE_DIR/$res.queue" me my_id="" head announced=""
  me=$(checkout_name "$dir")
  ensure_dirs
  while true; do
    lock
    prune "$res"
    head=$([ -f "$q" ] && head -1 "$q" | cut -d'|' -f1)
    # The same checkout taking it again (restarting its app, say) keeps the lease, with the new process.
    if { [ -f "$f" ] && [ "$(field "$f" checkout)" = "$me" ]; } || [ -n "$force" ] ||
      { [ ! -f "$f" ] && { [ -z "$head" ] || [ "$head" = "$my_id" ]; }; }; then
      [ -f "$f" ] && [ "$(field "$f" checkout)" != "$me" ] &&
        echo "==> taking $(label "$res") from $(describe_holder "$f")" >&2
      write_lease "$res" "$me" "$pid"
      [ -n "$my_id" ] && drop_from_queue "$q" "$my_id"
      unlock
      return 0
    fi
    if [ -z "$wait" ]; then
      busy_message "$res" advice >&2
      unlock
      return 1
    fi
    if [ -z "$my_id" ]; then
      my_id="$(now)-$$"
      echo "$my_id|$me|$SESSION|$$|$(proc_start $$)|$(now)|$PURPOSE" >>"$q"
    fi
    if [ -z "$announced" ]; then
      echo "==> waiting in line for $(label "$res"):" >&2
      busy_message "$res" | sed 's/^/    /' >&2
      announced=1
    fi
    unlock
    sleep 3
  done
}

release() {
  local res="$1" f="$LEASE_DIR/$1.lease" pid="$3"
  lock
  # Only the caller's own lease: a process that lost it to a later one mustn't release the later one's.
  if [ -f "$f" ] && [ "$(field "$f" checkout)" = "$(checkout_name "$2")" ] &&
    { [ -z "$pid" ] || [ "$(field "$f" pid)" = "$pid" ]; }; then
    rm -f "$f"
  fi
  unlock
}

check() {
  local res="$1" f="$LEASE_DIR/$1.lease"
  lock
  prune "$res" 2>/dev/null
  if [ -f "$f" ] && [ "$(field "$f" checkout)" != "$(checkout_name "$2")" ]; then
    busy_message "$res" >&2
    unlock
    return 1
  fi
  unlock
}

release_session() {
  local sid="$1" f
  lock
  for f in "$LEASE_DIR"/*.lease; do
    [ -f "$f" ] && [ "$(field "$f" session)" = "$sid" ] || continue
    echo "==> released $(label "$(basename "$f" .lease)") (held by $(field "$f" checkout))"
    rm -f "$f"
  done
  for f in "$LEASE_DIR"/*.queue; do
    [ -f "$f" ] || continue
    awk -F'|' -v s="$sid" '$3 != s' "$f" >"$f.tmp"
    if [ -s "$f.tmp" ]; then mv "$f.tmp" "$f"; else rm -f "$f" "$f.tmp"; fi
  done
  unlock
}

# For the holder's Stop hook: each waiter on something this session holds, reported once.
nudge() {
  local sid="$1" f res q told new id checkout session since purpose
  lock
  for f in "$LEASE_DIR"/*.lease; do
    [ -f "$f" ] && [ "$(field "$f" session)" = "$sid" ] || continue
    res=$(basename "$f" .lease)
    q="$LEASE_DIR/$res.queue"
    prune "$res" 2>/dev/null
    [ -f "$f" ] && [ -f "$q" ] || continue
    told=" $(field "$f" nudged) "
    new=""
    while IFS='|' read -r id checkout session _ _ since purpose; do
      case "$told" in *" $id "*) continue ;; esac
      echo "$checkout${session:+ (Claude session $(session_label "$session"))} is waiting for $(label "$res")${purpose:+ for \"$purpose\"}, since $(ago "$since")."
      new+=" $id"
    done <"$q"
    if [ -n "$new" ]; then
      sed -i '/^nudged=/d' "$f"
      echo "nudged=$(echo "$told$new" | xargs)" >>"$f"
    fi
  done
  unlock
}

cmd="${1:-}"
shift || usage
case "$cmd" in
release-session | nudge)
  [ -n "${1:-}" ] || usage
  "${cmd//-/_}" "$1"
  exit 0
  ;;
take | release | check | status) ;;
*) usage ;;
esac

RES=""
if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then
  RES="$1"
  shift
fi
case "$RES" in *[!a-z0-9-]*) echo "error: a resource name is lowercase letters, digits and dashes" >&2 && exit 2 ;; esac
[ -n "$RES" ] || [ "$cmd" = status ] || usage

DIR="$PWD" PID="" WAIT="" FORCE=""
while [ $# -gt 0 ]; do
  case "$1" in
  --checkout) DIR="${2:-}" && shift 2 ;;
  --pid) PID="${2:-}" && shift 2 ;;
  --wait) WAIT=1 && shift ;;
  --force) FORCE=1 && shift ;;
  *) usage ;;
  esac
done

case "$cmd" in
take) take "$RES" "$DIR" "$PID" "$WAIT" "$FORCE" ;;
release) release "$RES" "$DIR" "$PID" ;;
check) check "$RES" "$DIR" ;;
status) status "$RES" ;;
esac
