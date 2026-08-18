#!/usr/bin/env bash
#
# Tear down a git worktree under .claude/worktrees/ completely: its QA session, its directory, its git registration,
# and its branch when that branch is already merged.
#
#     make worktree-remove wt=<name> [force=1]
#     bash tools/worktree-remove.sh <name> [--force] [--container <web-container>]
#
# Runs on the HOST, unlike tools/qa-worktree.sh: a worktree's .git file points at the main repo's .git/worktrees/<name>
# by absolute host path, which doesn't exist inside the web container, so git can't reach the worktree from in there.
# Deleting the directory by hand isn't equivalent either — the registration survives it, and the worktree keeps showing
# up in `git worktree list` until something prunes it.
#
set -euo pipefail

WT="${1:-}"
[ -n "$WT" ] || {
  echo "usage: worktree-remove <name> [--force] [--container <name>]   (a dir under .claude/worktrees/)"
  exit 2
}
# A bare, shell-safe name: $WT is interpolated into the container command below, and must not escape the worktrees dir.
case "$WT" in
  *[!A-Za-z0-9._-]* | . | ..) echo "error: wt must be a bare worktree directory name ([A-Za-z0-9._-])"; exit 2 ;;
esac
shift

FORCE=""
CONTAINER="projectsidewalk-web"
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE="1" ;;
    --container) shift; CONTAINER="${1:-}" ;;
    *) echo "error: unknown argument: $1"; exit 2 ;;
  esac
  shift
done

# --git-common-dir resolves to the MAIN repo's .git even when this runs from inside a worktree, so `make
# worktree-remove` works from either checkout.
MAIN_REPO="$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd)")"
WT_DIR="$MAIN_REPO/.claude/worktrees/$WT"

# True when git still has a registration for $WT_DIR, whether or not the directory is still there.
worktree_is_registered() {
  git -C "$MAIN_REPO" worktree list --porcelain | grep -qxF "worktree $WT_DIR"
}

# A live Claude Code worktree session locks its worktree, and git refuses to remove a locked one even with --force —
# worth its own message rather than a puzzling failure late in the teardown.
worktree_is_locked() {
  git -C "$MAIN_REPO" worktree list --porcelain | awk -v target="worktree $WT_DIR" '
    $0 == target { in_block = 1; next }
    /^$/ { in_block = 0 }
    in_block && $1 == "locked" { locked = 1 }
    END { exit(locked ? 0 : 1) }'
}

# Short branch name, empty when HEAD is detached. Comes from the registration rather than the worktree so it's still
# answerable once the directory is gone.
registered_branch() {
  git -C "$MAIN_REPO" worktree list --porcelain | awk -v target="worktree $WT_DIR" '
    $0 == target { in_block = 1; next }
    /^$/ { in_block = 0 }
    in_block && $1 == "branch" { sub(/^branch refs\/heads\//, ""); print; exit }'
}

# Best-effort: no docker or no container means nothing can be running, so neither is an error.
stop_qa_session() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "==> docker not found; skipping QA-session stop"
    return
  fi
  if ! docker ps --format '{{.Names}}' | grep -qxF "$CONTAINER"; then
    echo "==> $CONTAINER not running; skipping QA-session stop"
    return
  fi
  echo "==> stopping any QA session for $WT"
  # Prefer the worktree's own copy of qa-worktree.sh, falling back to the main repo's, for the same reason the Makefile
  # does (#4628): either checkout may sit on a branch that predates the script.
  docker exec "$CONTAINER" bash -c \
    "script=/home/.claude/worktrees/$WT/tools/qa-worktree.sh; \
     [ -f \"\$script\" ] || script=/home/tools/qa-worktree.sh; \
     [ -f \"\$script\" ] || exit 0; \
     exec bash \"\$script\" $WT --stop --clean" \
    || echo "warning: the QA-session stop reported an error; continuing with removal"
}

# True when deleting branch $1 would lose nothing. The remote-tracking ref is checked too, since a local develop can lag
# behind what has actually merged.
branch_is_merged() {
  local base
  for base in develop origin/develop; do
    if git -C "$MAIN_REPO" rev-parse --verify --quiet "$base" >/dev/null &&
       git -C "$MAIN_REPO" merge-base --is-ancestor "$1" "$base"; then
      return 0
    fi
  done
  return 1
}

# The branch is the part of a teardown easiest to forget, so every outcome here prints what was decided.
clean_up_branch() {
  local branch="$1"
  if [ -z "$branch" ]; then
    echo "==> HEAD was detached; no branch to clean up"
  elif printf '%s\n' develop master main | grep -qxF "$branch"; then
    echo "==> kept branch $branch (long-lived branch)"
  elif branch_is_merged "$branch"; then
    # -D, not -d: merged-ness is settled above against develop, while -d judges it against this checkout's HEAD.
    git -C "$MAIN_REPO" branch -D "$branch" >/dev/null
    echo "==> deleted branch $branch (already merged into develop)"
  else
    echo "==> kept branch $branch — it has commits that aren't in develop yet"
    echo "    delete it anyway with: git branch -D $branch"
  fi
}

if [ ! -d "$WT_DIR" ]; then
  if worktree_is_registered; then
    echo "==> $WT_DIR is already gone; pruning its stale git registration"
    BRANCH="$(registered_branch)"
    git -C "$MAIN_REPO" worktree prune
    clean_up_branch "$BRANCH"
    echo "==> done."
    exit 0
  fi
  echo "error: no worktree at $WT_DIR"
  echo "available worktrees:"; ls "$MAIN_REPO/.claude/worktrees" 2>/dev/null || echo "  (none)"
  exit 1
fi

if worktree_is_locked; then
  echo "error: $WT is locked, so git won't remove it. A running Claude Code session in it holds a lock; otherwise"
  echo "       someone locked it deliberately. End that session, or unlock it: git worktree unlock \"$WT_DIR\""
  exit 1
fi

# `git worktree remove` makes the same judgement, but only once the QA session is already stopped — checking up front
# keeps a refusal side-effect-free. Ignored build output (target/, logs/, node_modules) isn't work either way.
if [ -z "$FORCE" ] && [ -n "$(git -C "$WT_DIR" status --porcelain)" ]; then
  echo "error: $WT has work in it:"
  git -C "$WT_DIR" status --short | sed 's/^/         /'
  echo "       Commit or move that work, or rerun to delete it along with the worktree:"
  echo "         make worktree-remove wt=$WT force=1"
  exit 1
fi

BRANCH="$(registered_branch)"
SIZE="$(du -sh "$WT_DIR" 2>/dev/null | cut -f1 || true)"
echo "==> removing worktree $WT_DIR${BRANCH:+  (branch $BRANCH)}${SIZE:+  [$SIZE]}"

stop_qa_session

if ! git -C "$MAIN_REPO" worktree remove ${FORCE:+--force} "$WT_DIR"; then
  echo "error: git declined to remove the worktree (see above). The QA session, if there was one, is already stopped."
  exit 1
fi
echo "==> removed directory and git registration${SIZE:+ (reclaimed $SIZE)}"

clean_up_branch "$BRANCH"
echo "==> done."
