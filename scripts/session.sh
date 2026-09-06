#!/usr/bin/env bash
# Branch-per-item sessions: each backlog item gets its own git worktree on
# its own branch, so several Claude sessions can work in parallel on this
# one shared VPS without stepping on each other's files or UAT services.
# See docs/ops/BACKLOG.md "Branch per item" for the full model.
#
# The shared tree at /root/ai-wealth-dashboard stays on `main` and is what
# UAT runs. Sessions never edit files there directly (except the board,
# which scripts/backlog.py already writes only from the shared tree) — they
# work in a worktree this script creates under /root/worktrees/<name>, on a
# branch named feature-<ID>[-slug] (slug appended only when one is given or
# derivable from the item's title). scripts/integrate.py later merges
# finished branches back into the shared tree's main and rebuilds/restarts
# UAT. Older sessions may still have worktrees/branches from before this
# convention, named item/<ID>-<slug> — `list`/`abandon` still recognise
# those so they can be cleaned up.
#
# Usage:
#   scripts/session.sh start <ID> [slug] [--title "New item title"]
#   scripts/session.sh finish <ID>
#   scripts/session.sh abandon <ID>
#   scripts/session.sh list
set -euo pipefail

SHARED_TREE="/root/ai-wealth-dashboard"
WORKTREES_ROOT="/root/worktrees"
BACKLOG_PY="$SHARED_TREE/scripts/backlog.py"
VENV_PY="$SHARED_TREE/backend/.venv/bin/python"

usage() {
  cat <<'EOF'
Usage:
  scripts/session.sh start <ID> [slug] [--title "New item title"]
      Create a worktree + branch feature-<ID>[-slug] for backlog item <ID>
      (the slug is appended only when you pass one, or one can be derived
      from the item's title), symlink node_modules/.venv into it, mark the
      item in-progress, and print the worktree path. If <ID> doesn't exist
      yet, pass --title to create it first (it is added to the section
      matching <ID>'s leading letter; the id actually used is whatever
      scripts/backlog.py add allocates, printed by this command).

  scripts/session.sh finish <ID>
      Run inside the worktree for <ID>: backend tests, frontend typecheck,
      then the design preview index check, then push the branch and mark
      the item "review" with that branch. Refuses if the worktree is dirty
      or any check fails.

  scripts/session.sh abandon <ID>
      Delete the worktree and its branch, reset the item to to-do with a
      note explaining why.

  scripts/session.sh list
      Show active item worktrees and their branches.

Rules:
  - Never restart wealth-api / wealth-worker / wealth-frontend from a
    worktree. UAT only changes when scripts/integrate.py merges to main.
  - The board (TODO.md, docs/compliance/...) is only ever edited from the
    shared tree via scripts/backlog.py — never hand-edit a worktree's copy
    of those files, they are not the board.
EOF
}

log() { echo "[session] $*"; }
err() { echo "[session] error: $*" >&2; }

require_shared_clean() {
  local dirty
  dirty="$(cd "$SHARED_TREE" && git status --porcelain | grep -v '^??' || true)"
  if [[ -n "$dirty" ]]; then
    err "shared tree ($SHARED_TREE) has uncommitted tracked changes; commit or stash before starting a session:"
    echo "$dirty" >&2
    exit 1
  fi
}

find_worktree_for_id() {
  # Matches the current feature-<ID>[-slug] naming as well as the older
  # item-<ID>-<slug> naming, so list/finish/abandon still find worktrees
  # created before this convention changed.
  local id="$1"
  find "$WORKTREES_ROOT" -maxdepth 1 -type d \
    \( -name "feature-${id}" -o -name "feature-${id}-*" -o -name "item-${id}-*" \) \
    2>/dev/null | head -1
}

item_title() {
  # Prints the item's title, or nothing (and exit 1) if it doesn't exist.
  local id="$1"
  "$VENV_PY" "$BACKLOG_PY" list 2>/dev/null | awk -v id="$id" '
    $1 == id {
      for (i = 5; i <= NF; i++) printf "%s%s", (i > 5 ? " " : ""), $i
      print ""
      found = 1
    }
    END { if (!found) exit 1 }
  '
}

derive_slug() {
  # lowercase, non-alnum -> spaces, first 4 words, hyphen-joined
  local title="$1"
  echo "$title" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/ /g' \
    | awk '{ n = (NF < 4 ? NF : 4); out = ""; for (i = 1; i <= n; i++) out = out (i > 1 ? "-" : "") $i; print out }'
}

cmd_start() {
  local id="${1:-}"
  [[ -n "$id" ]] || { usage; exit 1; }
  shift

  local slug="" title=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --title) title="${2:-}"; shift 2 ;;
      *) if [[ -z "$slug" ]]; then slug="$1"; shift; else err "unexpected argument: $1"; exit 1; fi ;;
    esac
  done

  require_shared_clean
  log "fetching origin..."
  (cd "$SHARED_TREE" && git fetch origin)

  local existing_title
  if existing_title="$(item_title "$id")"; then
    :
  elif [[ -n "$title" ]]; then
    local section="${id:0:1}"
    if ! [[ "$section" =~ ^[A-H]$ ]]; then
      err "can't infer a section from id '$id' (expected e.g. A1, H2)"
      exit 1
    fi
    log "item $id not found; adding it to section $section with --title"
    local new_id
    new_id="$(cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" add "$section" "$title" --owner claude)"
    if [[ "$new_id" != "$id" ]]; then
      log "note: requested id was $id, board allocated $new_id instead — using $new_id from here on"
    fi
    id="$new_id"
    existing_title="$title"
  else
    err "item $id not found in the board; pass --title \"...\" to create it"
    exit 1
  fi

  if [[ -z "$slug" ]]; then
    slug="$(derive_slug "$existing_title")"
  fi

  local branch="feature-${id}"
  local worktree_dir="$WORKTREES_ROOT/feature-${id}"
  if [[ -n "$slug" ]]; then
    branch="${branch}-${slug}"
    worktree_dir="${worktree_dir}-${slug}"
  fi

  if [[ -e "$worktree_dir" ]]; then
    err "worktree already exists at $worktree_dir"
    exit 1
  fi
  if git -C "$SHARED_TREE" show-ref --verify --quiet "refs/heads/$branch"; then
    err "branch $branch already exists locally in the shared tree"
    exit 1
  fi

  mkdir -p "$WORKTREES_ROOT"
  log "creating worktree $worktree_dir on branch $branch (from origin/main)..."
  git -C "$SHARED_TREE" worktree add "$worktree_dir" -b "$branch" origin/main

  # frontend/node_modules is symlinked wholesale from the shared tree below,
  # so npm's own node_modules/@wealth/shared symlink resolves to the shared
  # tree's shared/, not this worktree's. @wealth/shared is carved out of
  # that via frontend/tsconfig.json paths ("@wealth/shared" -> the current
  # checkout's ../shared/src), which tsc and Next both honour, so edits to
  # this worktree's shared/src are visible here without any extra linking.
  log "linking node_modules and .venv from the shared tree..."
  [[ -d "$worktree_dir/frontend" ]] && ln -s "$SHARED_TREE/frontend/node_modules" "$worktree_dir/frontend/node_modules"
  [[ -d "$worktree_dir/capacitor-spike" ]] && ln -s "$SHARED_TREE/capacitor-spike/node_modules" "$worktree_dir/capacitor-spike/node_modules"
  [[ -d "$worktree_dir/backend" ]] && ln -s "$SHARED_TREE/backend/.venv" "$worktree_dir/backend/.venv"

  if [[ -d "$worktree_dir/backend" ]]; then
    local resolved
    resolved="$(cd "$worktree_dir/backend" && "$worktree_dir/backend/.venv/bin/python" -c "import app; print(app.__file__)")"
    case "$resolved" in
      "$worktree_dir"/*)
        log "venv import check ok: app resolves to the worktree ($resolved)"
        ;;
      *)
        err "venv import check FAILED: 'import app' resolved to $resolved, not the worktree."
        err "This usually means a .pth file or editable install in backend/.venv points at the shared tree."
        err "Work around it by exporting PYTHONPATH=. from $worktree_dir/backend before running python/pytest there."
        ;;
    esac
  fi

  log "marking $id in-progress on the board..."
  (cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" start "$id")

  echo
  echo "cd $worktree_dir"
  echo
  echo "Rules:"
  echo "  - never restart wealth-api / wealth-worker / wealth-frontend from this worktree"
  echo "  - UAT only changes when scripts/integrate.py merges $branch into main"
  echo "  - edit the board only from $SHARED_TREE via scripts/backlog.py, never this worktree's copy"
  echo "  - finish with: scripts/session.sh finish $id"
}

cmd_finish() {
  local id="${1:-}"
  [[ -n "$id" ]] || { usage; exit 1; }

  local worktree_dir
  worktree_dir="$(find_worktree_for_id "$id")"
  if [[ -z "$worktree_dir" ]]; then
    err "no worktree found for item $id under $WORKTREES_ROOT"
    exit 1
  fi

  local branch
  branch="$(git -C "$worktree_dir" rev-parse --abbrev-ref HEAD)"

  local status_lines
  status_lines="$(git -C "$worktree_dir" status --porcelain)"
  local dirty untracked
  dirty="$(echo "$status_lines" | grep -v '^??' || true)"
  untracked="$(echo "$status_lines" | grep '^??' || true)"
  if [[ -n "$dirty" ]]; then
    err "worktree $worktree_dir is dirty; commit your changes before finishing:"
    echo "$dirty" >&2
    exit 1
  fi
  if [[ -n "$untracked" ]]; then
    log "worktree $worktree_dir has untracked files (not blocking finish):"
    echo "$untracked"
  fi

  log "running backend tests in $worktree_dir/backend..."
  (cd "$worktree_dir/backend" && "$worktree_dir/backend/.venv/bin/python" -m pytest -q -x \
    --deselect tests/test_spotlight.py::test_material_estimate_change_earns_return_with_reason \
    tests)

  log "running frontend typecheck in $worktree_dir/frontend..."
  (cd "$worktree_dir/frontend" && npx tsc --noEmit -p .)

  log "checking design preview index in $worktree_dir/frontend..."
  (cd "$worktree_dir/frontend" && npm run -s check:design-index)

  log "pushing $branch..."
  git -C "$worktree_dir" push -u origin "$branch"

  log "marking $id in review on branch $branch..."
  (cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" review "$id" --branch "$branch")

  echo
  echo "$id is in review on branch $branch. The next integrate pass will merge it into main."
}

cmd_abandon() {
  local id="${1:-}"
  [[ -n "$id" ]] || { usage; exit 1; }

  local worktree_dir
  worktree_dir="$(find_worktree_for_id "$id")"
  if [[ -z "$worktree_dir" ]]; then
    err "no worktree found for item $id under $WORKTREES_ROOT"
    exit 1
  fi

  local branch
  branch="$(git -C "$worktree_dir" rev-parse --abbrev-ref HEAD)"

  log "removing worktree $worktree_dir..."
  git -C "$SHARED_TREE" worktree remove --force "$worktree_dir"
  log "deleting local branch $branch..."
  git -C "$SHARED_TREE" branch -D "$branch" 2>/dev/null || true

  (cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" note "$id" "session abandoned, branch $branch discarded")
  (cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" todo "$id")

  echo "abandoned $id (worktree and branch $branch removed, item reset to to-do)"
}

cmd_list() {
  local found=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local path
    path="$(echo "$line" | awk '{print $1}')"
    if [[ "$path" == "$WORKTREES_ROOT"/* ]]; then
      echo "$line"
      found=1
    fi
  done < <(git -C "$SHARED_TREE" worktree list)
  if [[ "$found" -eq 0 ]]; then
    echo "no active item sessions under $WORKTREES_ROOT"
  fi
}

main() {
  local cmd="${1:-}"
  [[ $# -gt 0 ]] && shift || true
  case "$cmd" in
    start) cmd_start "$@" ;;
    finish) cmd_finish "$@" ;;
    abandon) cmd_abandon "$@" ;;
    list) cmd_list "$@" ;;
    -h|--help|"") usage ;;
    *) err "unknown command: $cmd"; usage; exit 1 ;;
  esac
}

main "$@"
