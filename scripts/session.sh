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
# `start` refuses to attach to an existing item unless it is in `todo`
# state, OR `in-progress` with no branch recorded (an item H31 "start
# after approve" left in that shape: `approve <id> "<choice>"` moves a
# `uat` item back to `in-progress` with its old, already-deleted branch
# cleared, so the same agent can open a fresh worktree for the winning
# variant — without this, the uat review loop deadlocked one step after
# Kevin's approval). An `in-progress` id that DOES have a branch recorded
# means a worktree is genuinely live on it, and (like blocked/review/uat/
# rejected/done) still refuses — that's the case item H21 fixed, `start`
# silently re-attaching to an already-claimed item is how stray branches
# happen, and this change does not weaken that guard: it only narrows the
# no-branch-recorded case out of the old blanket "any in-progress id
# refuses" rule. `--title` always allocates a brand-new id via
# `scripts/backlog.py add` rather than assuming the caller guessed a free
# one; see cmd_start below and items H21 and H31.
#
# Usage:
#   scripts/session.sh start <ID> [slug] [--title "New item title"]
#   scripts/session.sh finish <ID>
#   scripts/session.sh abandon <ID> [--worktree <path>]
#   scripts/session.sh list
set -euo pipefail

SHARED_TREE="/root/ai-wealth-dashboard"
WORKTREES_ROOT="/root/worktrees"
BACKLOG_PY="$SHARED_TREE/scripts/backlog.py"
VENV_PY="$SHARED_TREE/backend/.venv/bin/python"

usage() {
  cat <<'EOF'
Usage:
  scripts/session.sh start <ID> [slug] [--title "New item title"] [--any-owner]
      Create a worktree + branch feature-<ID>[-slug] for backlog item <ID>
      (the slug is appended only when you pass one, or one can be derived
      from the item's title), symlink node_modules/.venv into it, mark the
      item in-progress, and print the worktree path.

      Without --title: <ID> must already exist on the board AND be in
      `todo` state, OR `in-progress` with no branch recorded (H31: the
      state `approve <id> "<choice>"` leaves a uat item in, so the same
      agent can build the winning variant on a fresh worktree). An
      `in-progress` id that already has a branch recorded means a
      worktree is genuinely live on it and still refuses, same as
      blocked, review, uat, rejected or done — this refuses with an
      explanation instead of silently attaching to it (attaching to a
      done or already-claimed item is how stray branches happen; see item
      H21).

      Each agent only starts items owned by its own model type. The
      caller's type comes from the BACKLOG_AGENT environment variable
      (`claude` or `codex`, defaults to `claude` when unset). If <ID>'s
      owner does not match BACKLOG_AGENT, or is `kevin`, start refuses
      with the owner and a pointer to either reassign the item
      (`scripts/backlog.py owner <ID> <type>`) or pass --any-owner, which
      skips this check for the case where Kevin has told the session to
      proceed anyway (see item H29).

      With --title: always allocates a FRESH id via `scripts/backlog.py
      add`, added to the section matching <ID>'s leading letter, and never
      looks up <ID> at all. Even if <ID> already exists and is in `todo`
      state, --title wins and a new item is created. The id actually used
      is whatever scripts/backlog.py add allocates, printed prominently by
      this command; use that id (not <ID>) for finish/abandon.

  scripts/session.sh finish <ID> [--uat-review]
      Run inside the worktree for <ID>: backend tests, frontend typecheck,
      then the design preview index check, then the legal content
      marker/renumbering check, then push the branch and mark the item
      "review" with that branch. Refuses if the worktree is dirty or any
      check fails.

      --uat-review flags this branch as a design round (new preview
      variants under frontend/app/design/<slug>/ for Kevin to choose
      between, nothing else): scripts/integrate.py lands a clean merge of
      it in the "uat" state instead of "done", so it rebuilds UAT and
      notifies Kevin with a real, working preview link instead of the item
      being blocked on a link nobody has built yet. Pass this whenever the
      branch's only job is to show Kevin variants; a branch that also
      folds an already-approved winner into production code is a normal
      finish, not this. scripts/integrate.py also catches an unflagged
      design round via a backstop heuristic (the merged diff touches only
      frontend/app/design/), but flag it explicitly when you know, don't
      rely on the backstop.

  scripts/session.sh abandon <ID> [--worktree <path>]
      Delete the worktree and its branch, reset the item to to-do with a
      note explaining why. A detached worktree is removed with an
      accurate note and no attempt to delete a branch called HEAD (it
      was always removable; the wrong note and the pointless branch
      delete were the defects). A leftover directory that is no longer a
      git worktree is not matched at all and is not removed here: clear
      it by hand with rm -rf, nothing in this script deletes arbitrary
      directories.

      --worktree names the directory explicitly, which is the way past a
      refused resolution: when more than one worktree matches <ID> and
      the board has no branch recorded, or when the only worktree there
      is is not on the branch the board records, nothing can safely be
      guessed, so abandon asks you which one you mean. The path is
      normalised first and must be under /root/worktrees, so it cannot
      be walked back out of the root with '..'. It removes the worktree
      only: the board is reset for <ID> just when the named worktree is
      the session <ID> actually records, so clearing a stale duplicate
      never touches the live item.

  scripts/session.sh list
      Show active item worktrees and their branches, and warn about any
      id that has more than one worktree (the condition behind the
      2026-09-18 G127 incident, item H85).

Resolving <ID> to a worktree (finish and abandon):
  The branch the board records for <ID> is the authority. git knows
  which worktree has that branch checked out, and no other worktree can
  ever be chosen; if none has it, that is a hard refusal, not a fallback
  to a name match. Only when the item records no branch at all (the
  shape `approve` leaves it in) does the worktree NAME decide, and then
  only if exactly one matches: two matches are listed and refused, never
  picked between. Both feature-<ID>[-slug] and the older
  item-<ID>-<slug> names are matched. finish prints the worktree and
  branch it resolved to before it runs anything, so a wrong resolution
  is visible rather than silent.

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
# Both go to stderr like err, so they stay out of the machine-readable
# stdout of resolve_worktree_for_id, but neither is an error.
warn() { echo "[session] warning: $*" >&2; }
note() { echo "[session] note: $*" >&2; }

require_shared_clean() {
  local dirty
  dirty="$(cd "$SHARED_TREE" && git status --porcelain | grep -v '^??' || true)"
  if [[ -n "$dirty" ]]; then
    err "shared tree ($SHARED_TREE) has uncommitted tracked changes; commit or stash before starting a session:"
    echo "$dirty" >&2
    exit 1
  fi
}

item_json() {
  # Prints the item as one JSON object (via `backlog.py show`, the
  # machine-readable read-only mode, see item H21), or nothing (and
  # exit 1) if it doesn't exist. Deliberately not scraping `list`'s
  # human-readable table with awk: that's what let `start` silently
  # attach to a done item before.
  local id="$1"
  (cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" show "$id" 2>/dev/null)
}

recorded_branch_for_id() {
  # The branch the board records for <id>, printed on stdout. Empty is a
  # legitimate answer, not an error: `approve <id> "<choice>"` leaves an
  # item in-progress with no branch (H31), and `start` records one only
  # once it has actually created the worktree.
  #
  # A read that FAILS is a different thing and must never be flattened
  # into "no branch recorded": that silently downgrades the board-is-
  # authority rule back to a worktree-name match, which is the pre-H85
  # bug this whole section exists to remove. Static breakage would be
  # caught by the tests; runtime degradation would not, so it returns 1
  # with the board's own error and the caller stops. Same read as
  # item_json above (`backlog.py show`, machine-readable and read-only,
  # never scraping `list`), but keeping stderr so a runtime failure can
  # be diagnosed rather than swallowed.
  local id="$1" data branch
  if ! data="$(cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" show "$id" 2>&1)"; then
    err "could not read item $id from the board ($BACKLOG_PY show $id failed):"
    printf '%s\n' "$data" >&2
    err "refusing to continue: with the board unreadable the recorded branch is unknown, and falling back to a worktree-name match is the pre-H85 bug (item H85)."
    return 1
  fi
  if ! branch="$(jq -r '.branch // empty' <<<"$data")"; then
    err "could not parse the board's JSON for item $id:"
    printf '%s\n' "$data" >&2
    return 1
  fi
  printf '%s' "$branch"
}

# ── Worktree resolution (item H85) ─────────────────────────────────────
#
# "Which worktree is item <ID>?" used to be one `find ... | head -1`: it
# globbed the worktree names, took whatever the filesystem happened to
# list first, and never looked at the branch the board already records.
#
# On 2026-09-18 that picked a stale, never-cleaned worktree for G127
# (feature-G127-upcoming-round3, sitting at a commit that had been
# REJECTED on review) over the live one (feature-G127-round3-fix).
# `finish` pushed the rejected branch and marked the item `review`
# against it. The next integrate pass would have merged rejected code
# into main and UAT while the board read as a clean review; the only
# reason it didn't is that the agent knew its own fix could not exist on
# that branch. Two worktrees for one id is not hypothetical either:
# several ids on this host have had a second, stale worktree left behind
# after a design round.
#
# So resolution now either produces the one right answer or refuses:
#
#   - The board is the authority. When the item records a branch, git
#     itself says which worktree has that branch checked out
#     (`git worktree list --porcelain`), so the name on disk is
#     irrelevant and a worktree that is NOT on the recorded branch can
#     never be chosen. A mismatch is a hard, explained refusal.
#   - With nothing recorded, fall back to matching the id in the
#     worktree name, but refuse and list them if more than one matches
#     rather than picking one.
#
# The name match still accepts the older item-<ID>-<slug> naming as well
# as feature-<ID>[-slug], so list/finish/abandon keep finding worktrees
# created before that convention changed. Both name patterns are
# anchored on the whole id (feature-<ID> exactly, or feature-<ID>-...),
# so G12 never matches G127's worktree.

find_worktree_candidates() {
  # Every *worktree* whose name matches <id>, one per line, sorted so the
  # output is stable rather than filesystem-dependent. Used for the
  # no-branch-recorded fallback and, either way, to explain a refusal.
  #
  # A directory with no .git entry is skipped, because it is not a
  # worktree: an rm -rf'd or half-pruned session leaves a plain
  # directory behind, and counting one as a candidate made the id
  # ambiguous and wedged `finish` on a refusal whose recommended escape
  # could not clear it either (git worktree remove: "is not a working
  # tree"). Such a directory contributes nothing but ambiguity.
  local id="$1" dir
  while IFS= read -r dir; do
    [[ -n "$dir" ]] || continue
    [[ -e "$dir/.git" ]] || continue
    printf '%s\n' "$dir"
  done < <(find "$WORKTREES_ROOT" -mindepth 1 -maxdepth 1 -type d \
    \( -name "feature-${id}" -o -name "feature-${id}-*" -o -name "item-${id}-*" \) \
    2>/dev/null | LC_ALL=C sort)
}

is_under_worktrees_root() {
  # Containment test on NORMALISED paths. A plain string prefix test let
  # <root>/../elsewhere/x through, and `abandon --worktree` then deleted
  # it, contents and branch and all. That shape is real on this host:
  # /tmp/g70-review is a live checkout reachable as
  # /root/worktrees/../../tmp/g70-review. realpath -m normalises without
  # requiring the path to exist.
  local path root
  path="$(realpath -m "$1")" || return 1
  root="$(realpath -m "$WORKTREES_ROOT")" || return 1
  [[ "$path" == "$root"/* ]]
}

same_path() {
  [[ "$(realpath -m "$1")" == "$(realpath -m "$2")" ]]
}

path_is_one_of() {
  # Is $1 one of the remaining arguments, comparing normalised paths?
  local needle="$1" other
  shift
  for other in "$@"; do
    if same_path "$needle" "$other"; then
      return 0
    fi
  done
  return 1
}

worktree_branch_of() {
  # The branch <dir> has checked out, or empty when it is detached or
  # isn't a git worktree at all (a linked worktree always has a .git
  # file; a leftover plain directory does not).
  local dir="$1" branch=""
  if [[ -e "$dir/.git" ]]; then
    branch="$(git -C "$dir" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  fi
  printf '%s' "$branch"
}

worktree_dir_for_branch() {
  # Which worktree of the shared tree has <branch> checked out, according
  # to git. Empty when none does. This is what makes a wrong resolution
  # impossible rather than unlikely: git will not let two worktrees have
  # the same branch checked out, so when the board records a branch there
  # is exactly one possible answer and no guessing to do.
  local branch="$1"
  git -C "$SHARED_TREE" worktree list --porcelain 2>/dev/null \
    | awk -v want="refs/heads/$branch" '
        /^worktree /   { dir = substr($0, 10) }
        $0 == "branch " want { print dir; exit }
      '
}

describe_candidates() {
  local dir b
  for dir in "$@"; do
    b="$(worktree_branch_of "$dir")"
    err "    $dir -> ${b:-(detached HEAD, or not a git worktree)}"
  done
}

disambiguation_hint() {
  # Verb-specific way out of a refusal. `abandon` must never become
  # impossible — a stuck session has to be able to clean up — so it can
  # always name the worktree it means explicitly.
  local id="$1" verb="$2"
  if [[ "$verb" == "abandon" ]]; then
    err "  Name the one you mean explicitly: scripts/session.sh abandon $id --worktree <path> (that removes the worktree only; the board is left untouched unless the worktree is the session $id records)"
  else
    err "  Fix the board or the tree first: record the right branch (from $SHARED_TREE: backend/.venv/bin/python scripts/backlog.py start $id --branch <branch>), or remove the stale worktree with 'scripts/session.sh abandon $id --worktree <path>'."
  fi
}

resolve_worktree_for_id() {
  # Prints exactly one machine-readable line on stdout on success:
  #     <worktree dir>\t<branch it has checked out>\t<branch the board records>
  # The second field is empty only for a detached-HEAD worktree (which
  # `abandon` can still clean up and `finish` has nothing to push from);
  # the third is empty when the item records no branch. Every human-
  # readable word goes to stderr, so callers can capture stdout directly.
  # Returns 1, having explained itself, rather than ever guessing.
  local id="$1" recorded_branch="${2:-}" verb="${3:-resolve}"

  local -a candidates=()
  mapfile -t candidates < <(find_worktree_candidates "$id")

  if [[ -n "$recorded_branch" ]]; then
    local dir
    dir="$(worktree_dir_for_branch "$recorded_branch")"
    if [[ -n "$dir" ]]; then
      if ! is_under_worktrees_root "$dir"; then
        err "the board records branch $recorded_branch for item $id, but git has that branch checked out at $dir, which is not under $WORKTREES_ROOT."
        err "refusing to $verb there: that is the shared tree or a scratch checkout, not a session worktree."
        return 1
      fi
      if [[ ! -d "$dir" ]]; then
        # git keeps listing a worktree whose directory was deleted until
        # someone prunes. Resolving to it hands the caller a path that
        # does not exist, and finish then dies on a raw git error.
        err "the board records branch $recorded_branch for item $id and git still lists a worktree at $dir for it, but that directory no longer exists."
        err "  Clear the stale registration first: git -C $SHARED_TREE worktree prune"
        return 1
      fi
      if ! path_is_one_of "$dir" "${candidates[@]-}"; then
        if [[ ${#candidates[@]} -gt 0 ]]; then
          # Making the board unconditionally authoritative removed the
          # one bound the old resolver did have: it could only ever pick
          # a worktree whose NAME matched the id. A mistyped or
          # copy-pasted [branch: ...] tag would otherwise resolve to
          # another item's live worktree, and finish would push that
          # branch and mark THIS item in review against it. integrate.py
          # already warns that recorded branches drift from their id, so
          # this state is known to occur.
          err "the board records branch $recorded_branch for item $id, but that branch is checked out at $dir, which is not one of $id's own worktrees:"
          describe_candidates "${candidates[@]}"
          err "refusing to $verb in what looks like another item's worktree: pushing $recorded_branch and marking $id in review against it is the same class of failure as 2026-09-18 (item H85), just with the board wrong instead of the filesystem."
          err "  Correct the recorded branch first (from $SHARED_TREE: backend/.venv/bin/python scripts/backlog.py start $id --branch <branch>)."
          return 1
        fi
        # No name candidates at all, so there is nothing to contradict
        # the board: proceed, but say so loudly rather than quietly.
        warn "$dir is not named feature-${id}[-slug], and no worktree is. It is the only worktree with branch $recorded_branch checked out, and that branch is what the board records for $id, so $verb will use it. Check it is really yours."
      fi
      if [[ ${#candidates[@]} -gt 1 ]]; then
        # Benign: several worktrees carry the id in their name, and the
        # board says which one. Deliberately a note, not a refusal:
        # refusing here would make today's G94 (rejected, one recorded
        # branch, one stale sibling) neither finishable nor abandonable.
        # The dangerous sibling case, the recorded branch pointing
        # outside the id's own worktrees, is refused above.
        note "${#candidates[@]} worktrees match id $id; chose $dir because it is on the branch the board records ($recorded_branch). Clean the others up with 'scripts/session.sh abandon $id --worktree <path>'."
      fi
      printf '%s\t%s\t%s\n' "$dir" "$recorded_branch" "$recorded_branch"
      return 0
    fi

    if [[ ${#candidates[@]} -eq 0 ]]; then
      err "no worktree found for item $id under $WORKTREES_ROOT (the board records branch $recorded_branch for it, and nothing has that branch checked out)."
      err "  If its worktree was removed, re-create one with: git -C $SHARED_TREE worktree add $WORKTREES_ROOT/$recorded_branch $recorded_branch"
      return 1
    fi
    err "the board records branch $recorded_branch for item $id, but no worktree has that branch checked out."
    err "  worktrees whose name matches $id:"
    describe_candidates "${candidates[@]}"
    err "refusing to $verb against a worktree that is not on the branch the board records: taking a name match instead is exactly the 2026-09-18 G127 failure (item H85), where finish pushed a branch that had already been rejected and marked the item review against it."
    disambiguation_hint "$id" "$verb"
    return 1
  fi

  if [[ ${#candidates[@]} -eq 0 ]]; then
    err "no worktree found for item $id under $WORKTREES_ROOT"
    return 1
  fi

  if [[ ${#candidates[@]} -gt 1 ]]; then
    err "item $id has no branch recorded on the board, and ${#candidates[@]} worktrees match its id:"
    describe_candidates "${candidates[@]}"
    err "refusing to guess between them: with nothing recorded on the board there is no authority saying which one is the live session, and picking the wrong one is how a rejected branch got pushed on 2026-09-18 (item H85)."
    disambiguation_hint "$id" "$verb"
    return 1
  fi

  printf '%s\t%s\t\n' "${candidates[0]}" "$(worktree_branch_of "${candidates[0]}")"
}

resolve_session_worktree() {
  # What finish/abandon actually call: read the board, then resolve.
  local id="$1" verb="${2:-resolve}"
  local recorded_branch
  recorded_branch="$(recorded_branch_for_id "$id")"
  resolve_worktree_for_id "$id" "$recorded_branch" "$verb"
}

derive_slug() {
  # lowercase, non-alnum -> spaces, first 4 words, hyphen-joined
  local title="$1"
  echo "$title" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/ /g' \
    | awk '{ n = (NF < 4 ? NF : 4); out = ""; for (i = 1; i <= n; i++) out = out (i > 1 ? "-" : "") $i; print out }'
}

# Decides whether `start` may attach to an existing item <id>, given its
# board JSON (as `item_json`/`backlog.py show` prints it). Returns 0 to
# let the caller proceed to worktree creation (logging why, for the
# in-progress-no-branch case), or prints a distinct `err` message and
# returns 1 for every refusal case. Pulled out of cmd_start's inline case
# statement into its own function, the same way
# frontend/scripts/build-mobile.sh's require_project_dir was pulled out of
# build-mobile.sh, so scripts/session-start-state.test.sh can exercise
# every branch directly by sourcing this file with
# SESSION_SH_GUARD_ONLY=1, without ever touching git or the filesystem.
# See item H21 (the guard this must not weaken) and H31 (the narrow
# in-progress-with-no-branch case it adds).
decide_start_state() {
  local id="$1" item_data="$2"
  local state
  state="$(jq -r '.state' <<<"$item_data")"
  case "$state" in
    todo)
      return 0
      ;;
    in-progress)
      # H31: an in-progress item with NO branch recorded is exactly the
      # state an item is in right after `approve <id> "<choice>"` — the
      # winning variant's old branch was already deleted by integrate,
      # so there is no live worktree to collide with, and this is
      # precisely the case that must be startable or the whole uat loop
      # deadlocks one step after Kevin's approval (H31 "start after
      # approve"). An in-progress item WITH a branch recorded means a
      # worktree is genuinely live on it (scripts/session.sh start
      # writes that branch the moment it creates one, see cmd_start
      # below), and that case must still refuse exactly as before item
      # H21's fix: `start` silently re-attaching to an already-claimed
      # item is how stray branches happen. This narrows that old blanket
      # "any in-progress id refuses" rule; it does not weaken it.
      local existing_branch
      existing_branch="$(jq -r '.branch // empty' <<<"$item_data")"
      if [[ -n "$existing_branch" ]]; then
        err "item $id is in-progress on branch $existing_branch; a session is already live on it. Check 'scripts/session.sh list'; if that session is dead, reset it with 'backend/.venv/bin/python scripts/backlog.py todo $id' from the shared tree before starting again."
        return 1
      fi
      log "item $id is in-progress with no branch recorded (approved from uat, or never had a worktree attached); starting a fresh session for it..."
      return 0
      ;;
    review)
      local branch
      branch="$(jq -r '.branch // empty' <<<"$item_data")"
      err "item $id is in review${branch:+ on branch $branch}; it is waiting on the next integrate pass, not a new session."
      return 1
      ;;
    blocked)
      local reason
      reason="$(jq -r '.reason // empty' <<<"$item_data")"
      err "item $id is blocked${reason:+: $reason}; resolve the block before starting a session on it."
      return 1
      ;;
    uat)
      local link
      link="$(jq -r '.link // empty' <<<"$item_data")"
      err "item $id is in uat${link:+, preview at $link}; it is waiting on Kevin's review, not a new session. Once he runs 'backend/.venv/bin/python scripts/backlog.py approve $id \"<choice>\"' (or the Approve control on /ops/go-live) it moves to in-progress and can be started."
      return 1
      ;;
    rejected)
      local reason
      reason="$(jq -r '.reason // empty' <<<"$item_data")"
      err "item $id is rejected${reason:+: $reason}; resolve it first with 'backend/.venv/bin/python scripts/backlog.py start $id' (clears the rejection, moves it to in-progress with no branch) or 'todo $id', then run scripts/session.sh start $id again."
      return 1
      ;;
    done)
      err "item $id is already done; pass --title \"...\" to open a new item instead of reusing a completed one."
      return 1
      ;;
    *)
      err "item $id has unrecognised state '$state'; refusing to start a session on it."
      return 1
      ;;
  esac
}

if [ "${SESSION_SH_GUARD_ONLY:-}" = "1" ]; then
  # Test-only escape hatch (see scripts/session-start-state.test.sh):
  # stop right after defining decide_start_state (and the small helpers
  # it calls: err, log) above, before any real command dispatch, worktree
  # creation, or board write ever runs.
  return 0 2>/dev/null || exit 0
fi

cmd_start() {
  local id="${1:-}"
  [[ -n "$id" ]] || { usage; exit 1; }
  shift

  local caller_agent="${BACKLOG_AGENT:-claude}"
  if [[ "$caller_agent" != "claude" && "$caller_agent" != "codex" ]]; then
    err "BACKLOG_AGENT must be 'claude' or 'codex' (got '$caller_agent')"
    exit 1
  fi

  local slug="" title="" any_owner=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --title)
        if [[ $# -lt 2 || -z "${2:-}" ]]; then
          err "--title needs a title, e.g. scripts/session.sh start $id --title \"Fix the thing\""
          exit 1
        fi
        title="$2"; shift 2 ;;
      --any-owner) any_owner="true"; shift ;;
      *) if [[ -z "$slug" ]]; then slug="$1"; shift; else err "unexpected argument: $1"; exit 1; fi ;;
    esac
  done

  require_shared_clean
  log "fetching origin..."
  (cd "$SHARED_TREE" && git fetch origin)

  local existing_title
  if [[ -n "$title" ]]; then
    # --title always wins and always allocates a fresh id: it never looks
    # up <ID>, even when <ID> already exists and is in `todo` state (see
    # usage text above and item H21).
    local section="${id:0:1}"
    if ! [[ "$section" =~ ^[A-H]$ ]]; then
      err "can't infer a section from id '$id' (expected e.g. A1, H2)"
      exit 1
    fi
    log "--title given; allocating a fresh item in section $section (not looking up $id)..."
    local new_id
    new_id="$(cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" add "$section" "$title" --owner "$caller_agent")"
    log "allocated new item $new_id: $title"
    if [[ "$new_id" != "$id" ]]; then
      log "note: requested id was $id, board allocated $new_id instead — using $new_id from here on"
    fi
    id="$new_id"
    existing_title="$title"
  else
    local item_data
    if ! item_data="$(item_json "$id")"; then
      err "item $id not found in the board; pass --title \"...\" to create it"
      exit 1
    fi
    decide_start_state "$id" "$item_data" || exit 1

    if [[ "$any_owner" != "true" ]]; then
      local owner
      owner="$(jq -r '.owner' <<<"$item_data")"
      if [[ "$owner" == "kevin" ]]; then
        err "item $id is owned by kevin, not $caller_agent; a $caller_agent session should not start it, even if asked to clear the board. Ask Kevin to do it or reassign it, or pass --any-owner if he has told you to proceed."
        exit 1
      elif [[ "$owner" != "$caller_agent" ]]; then
        err "item $id is owned by $owner, not $caller_agent; a $caller_agent session should not start another agent's item. Reassign it first ('backend/.venv/bin/python scripts/backlog.py owner $id $caller_agent') or pass --any-owner if Kevin has told you to proceed."
        exit 1
      fi
    fi

    existing_title="$(jq -r '.title' <<<"$item_data")"
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

  log "marking $id in-progress on the board (branch $branch)..."
  (cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" start "$id" --branch "$branch")

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
  shift || true

  local uat_review=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --uat-review) uat_review="true"; shift ;;
      *) err "unexpected argument: $1"; exit 1 ;;
    esac
  done

  local resolved
  resolved="$(resolve_session_worktree "$id" finish)" || exit 1
  local worktree_dir branch board_branch
  IFS=$'\t' read -r worktree_dir branch board_branch <<<"$resolved"

  if [[ -z "$branch" ]]; then
    err "worktree $worktree_dir is not on a branch (detached HEAD), so there is nothing to push for $id."
    err "Check it out on its branch, or clean it up with: scripts/session.sh abandon $id --worktree $worktree_dir"
    exit 1
  fi

  # Say out loud which worktree and branch this resolved to, before any
  # check runs and long before anything is pushed (item H85): the
  # 2026-09-18 G127 failure was invisible in the output, so the only
  # thing that caught it was an agent happening to know its own work
  # could not be on the branch that got pushed.
  echo
  log "resolved item $id:"
  log "  worktree:      $worktree_dir"
  log "  branch:        $branch"
  log "  board records: ${board_branch:-(none yet; matched by worktree name)}"
  log "If that is not the worktree you have been working in, stop now: nothing has been pushed yet."
  echo

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
    tests)

  log "checking no raw pentest evidence is staged or tracked in $worktree_dir..."
  (cd "$worktree_dir" && "$worktree_dir/backend/.venv/bin/python" scripts/check_pentest_evidence.py)

  log "running frontend typecheck in $worktree_dir/frontend..."
  (cd "$worktree_dir/frontend" && npx tsc --noEmit -p .)

  log "checking design preview index in $worktree_dir/frontend..."
  (cd "$worktree_dir/frontend" && npm run -s check:design-index)

  log "checking BANK_META logoFile entries against public/banks/ in $worktree_dir/frontend..."
  (cd "$worktree_dir/frontend" && npm run -s check:bank-logos)

  log "checking /design previews for real data access in $worktree_dir/frontend..."
  (cd "$worktree_dir/frontend" && npm run -s check:design-no-live-data)

  log "checking legal content marker/renumbering contract in $worktree_dir/frontend..."
  (cd "$worktree_dir/frontend" && npm run -s check:legal-content)

  log "checking bottom nav coverage in $worktree_dir/frontend..."
  (cd "$worktree_dir/frontend" && npm run -s check:nav-coverage)

  log "checking pooled cash-walk predicates in $worktree_dir/frontend..."
  (cd "$worktree_dir/frontend" && npm run -s check:cash-walk)

  log "checking spend-from-account ranking and scope copy in $worktree_dir/frontend..."
  (cd "$worktree_dir/frontend" && npm run -s check:spend-from-account)

  log "checking verdict/money-shape client TTL caches in $worktree_dir/frontend..."
  (cd "$worktree_dir/frontend" && npm run -s check:verdict-cache)

  log "checking category-edit cache invalidation in $worktree_dir/frontend..."
  (cd "$worktree_dir/frontend" && npm run -s check:category-mutations)

  log "pushing $branch from $worktree_dir (the board records ${board_branch:-no branch} for $id)..."
  git -C "$worktree_dir" push -u origin "$branch"

  if [[ "$uat_review" == "true" ]]; then
    log "marking $id in review on branch $branch (flagged --uat-review)..."
    (cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" review "$id" --branch "$branch" --uat-review)
    echo
    echo "$id is in review on branch $branch, flagged as a design round. A clean integrate pass will land it in uat, not done, and notify Kevin with a preview link."
  else
    log "marking $id in review on branch $branch..."
    (cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" review "$id" --branch "$branch")
    echo
    echo "$id is in review on branch $branch. The next integrate pass will merge it into main."
  fi
}

cmd_abandon() {
  local id="${1:-}"
  [[ -n "$id" ]] || { usage; exit 1; }
  shift

  # --worktree is the always-available way out of a refused resolution
  # (item H85). abandon is the cleanup path, so it must never become
  # impossible: naming the directory explicitly is a human saying which
  # one they mean, which is the one thing the resolver will not invent.
  local explicit_worktree="" explicit=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --worktree)
        # Checked before `shift 2`, which would otherwise fail under
        # set -e and exit 1 having printed nothing at all.
        if [[ $# -lt 2 || -z "${2:-}" ]]; then
          err "--worktree needs a path, e.g. scripts/session.sh abandon $id --worktree $WORKTREES_ROOT/feature-${id}-something"
          exit 1
        fi
        explicit_worktree="$2"; explicit="true"; shift 2 ;;
      *) err "unexpected argument: $1"; exit 1 ;;
    esac
  done

  local worktree_dir branch board_branch board_readable="true"
  if [[ -n "$explicit" ]]; then
    explicit_worktree="${explicit_worktree%/}"
    if ! is_under_worktrees_root "$explicit_worktree"; then
      err "--worktree $explicit_worktree resolves to $(realpath -m "$explicit_worktree"), which is not under $WORKTREES_ROOT."
      err "abandon only ever removes session worktrees: never the shared tree, another checkout, or anything reached back out of the root with '..'."
      exit 1
    fi
    if [[ ! -d "$explicit_worktree" ]]; then
      err "--worktree $explicit_worktree is not a directory"
      exit 1
    fi
    if [[ ! -e "$explicit_worktree/.git" ]]; then
      err "--worktree $explicit_worktree is not a git worktree (no .git entry), so git cannot remove it and this script will not delete arbitrary directories."
      err "  It is a leftover directory, not a session: clear it by hand with 'rm -rf $explicit_worktree'. It does not make $id ambiguous either way."
      exit 1
    fi
    worktree_dir="$explicit_worktree"
    branch="$(worktree_branch_of "$worktree_dir")"
    if ! board_branch="$(recorded_branch_for_id "$id")"; then
      warn "carrying on because --worktree names the directory explicitly, but the board will not be touched."
      board_branch=""
      board_readable=""
    fi
    log "using the worktree named explicitly on the command line (skipping resolution)."
  else
    local resolved
    resolved="$(resolve_session_worktree "$id" abandon)" || exit 1
    IFS=$'\t' read -r worktree_dir branch board_branch <<<"$resolved"
  fi

  # Only ever reset the board for the item's OWN session. --worktree is
  # advertised here, in the refusal hints and in docs/ops/BACKLOG.md as
  # the way to clear a stale duplicate; following that advice on today's
  # live G94 (rejected, branch feature-G94-fold-in-approved-variant-c
  # recorded, one stale sibling) used to ALSO reset G94 to todo, clear
  # its recorded branch and note "session abandoned, branch
  # feature-G94-story-first-reset discarded" -- corrupting the very item
  # the cleanup was meant to unblock.
  local skip_board_reason=""
  if [[ -n "$explicit" ]]; then
    if [[ -z "$board_readable" ]]; then
      skip_board_reason="the board could not be read"
    elif [[ -z "$board_branch" ]]; then
      skip_board_reason="$id records no branch, so $worktree_dir cannot be confirmed as its session"
    elif [[ "$branch" != "$board_branch" ]]; then
      skip_board_reason="$id records branch $board_branch, not ${branch:-(no branch checked out)}"
    fi
  fi

  echo
  log "abandoning item $id:"
  log "  worktree:      $worktree_dir"
  log "  branch:        ${branch:-(detached HEAD, or not a git worktree)}"
  log "  board records: ${board_branch:-(none)}"
  echo

  log "removing worktree $worktree_dir..."
  git -C "$SHARED_TREE" worktree remove --force "$worktree_dir"
  if [[ -n "$branch" ]]; then
    log "deleting local branch $branch..."
    git -C "$SHARED_TREE" branch -D "$branch" 2>/dev/null || true
  else
    # A worktree whose branch is gone or was never on one still has to be
    # removable, or a stuck session cannot clean up after itself.
    log "no branch checked out in that worktree; nothing to delete."
  fi

  if [[ -n "$skip_board_reason" ]]; then
    log "leaving the board alone: $skip_board_reason."
    log "If $id itself should be reset, do that deliberately from $SHARED_TREE: backend/.venv/bin/python scripts/backlog.py todo $id"
    echo "removed worktree $worktree_dir${branch:+ and branch $branch}; item $id left untouched"
    return 0
  fi

  local note_text
  if [[ -n "$branch" ]]; then
    note_text="session abandoned, branch $branch discarded"
  else
    note_text="session abandoned, worktree $worktree_dir discarded (no branch checked out)"
  fi
  (cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" note "$id" "$note_text")
  (cd "$SHARED_TREE" && "$VENV_PY" "$BACKLOG_PY" todo "$id")

  echo "abandoned $id (worktree $worktree_dir${branch:+ and branch $branch} removed, item reset to to-do)"
}

worktree_id_of_path() {
  # The backlog id a worktree's name claims, for both naming conventions
  # (feature-<ID>[-slug] and the older item-<ID>-<slug>). Empty for
  # anything else under the root, e.g. the detached preview checkouts.
  local base="$1"
  base="${base##*/}"
  case "$base" in
    feature-*) base="${base#feature-}" ;;
    item-*) base="${base#item-}" ;;
    *) printf ''; return 0 ;;
  esac
  base="${base%%-*}"
  if [[ "$base" =~ ^[A-Z][0-9]+$ ]]; then
    printf '%s' "$base"
  else
    printf ''
  fi
}

cmd_list() {
  local found=0
  local -a paths=()
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local path
    path="$(echo "$line" | awk '{print $1}')"
    if [[ "$path" == "$WORKTREES_ROOT"/* ]]; then
      echo "$line"
      paths+=("$path")
      found=1
    fi
  done < <(git -C "$SHARED_TREE" worktree list)
  if [[ "$found" -eq 0 ]]; then
    echo "no active item sessions under $WORKTREES_ROOT"
    return 0
  fi

  # A second worktree for the same id is the condition that caused the
  # 2026-09-18 G127 failure (item H85). finish/abandon now refuse to
  # guess between them rather than pushing whichever one `find` happened
  # to list first, but that is a stop, not a fix: say so here so the
  # stale one gets cleaned up before someone hits the refusal.
  local -a ids=()
  local p this_id
  for p in "${paths[@]}"; do
    this_id="$(worktree_id_of_path "$p")"
    if [[ -n "$this_id" ]]; then
      ids+=("$this_id")
    fi
  done
  local dup
  while IFS= read -r dup; do
    [[ -z "$dup" ]] && continue
    echo >&2
    warn "$dup has more than one worktree; finish and abandon will refuse to guess between them unless the board records a branch that matches exactly one:"
    for p in "${paths[@]}"; do
      if [[ "$(worktree_id_of_path "$p")" == "$dup" ]]; then
        warn "    $p -> $(worktree_branch_of "$p")"
      fi
    done
    warn "  Remove the stale one with: scripts/session.sh abandon $dup --worktree <path>"
  done < <(printf '%s\n' "${ids[@]-}" | LC_ALL=C sort | uniq -d)
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
