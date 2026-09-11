#!/usr/bin/env bash
# Unit test for scripts/session.sh's decide_start_state (the state check
# `start` runs before attaching to an existing item — see item H21, which
# added the original guard, and H31 "start after approve", which narrowed
# it so a uat item Kevin has approved can be picked up again).
#
# This sources session.sh with SESSION_SH_GUARD_ONLY=1, which makes it
# return right after defining decide_start_state (and the small err/log
# helpers it calls), before any real command dispatch, worktree creation,
# or board write ever runs — so this test never touches git, a worktree,
# or the real board. Same shape as
# frontend/scripts/build-mobile-guard.test.sh, which does the same thing
# for build-mobile.sh's require_project_dir.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

SESSION_SH_GUARD_ONLY=1
export SESSION_SH_GUARD_ONLY
source "$SCRIPT_DIR/session.sh"
unset SESSION_SH_GUARD_ONLY
# session.sh does `set -euo pipefail`; since it was sourced, that setting
# leaked into this shell. Turn errexit back off so this test can check
# exit codes itself instead of dying on the first non-zero one.
set +e

fail=0

# item_json() (used by the real cmd_start) shells out to `backlog.py show`
# against $SHARED_TREE; decide_start_state itself never calls it, it just
# takes whatever JSON string the caller passes, so every case below is
# built by hand here — no board, no repo, no jq dependency beyond what
# decide_start_state itself already requires.

check_allowed() {
  local desc="$1" json="$2"
  local out status
  out="$(decide_start_state H99 "$json" 2>&1)"
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "FAIL: $desc -> exited $status (expected 0, allowed), output: $out"
    fail=1
  else
    echo "PASS: $desc -> allowed (exit 0)"
  fi
}

check_refused() {
  local desc="$1" json="$2" expected_snippet="$3"
  local out status
  out="$(decide_start_state H99 "$json" 2>&1)"
  status=$?
  if [ "$status" -eq 0 ]; then
    echo "FAIL: $desc -> exited 0 (expected non-zero, refused)"
    fail=1
    return
  fi
  case "$out" in
    *"$expected_snippet"*)
      echo "PASS: $desc -> refused with '$expected_snippet'"
      ;;
    *)
      echo "FAIL: $desc -> refused, but message did not contain '$expected_snippet'. Got: $out"
      fail=1
      ;;
  esac
}

# ── Allowed cases ───────────────────────────────────────────────────────

check_allowed "todo" '{"state":"todo","branch":null}'

check_allowed "in-progress with no branch (the post-approve shape, H31)" \
  '{"state":"in-progress","branch":null}'

check_allowed "in-progress with an empty-string branch" \
  '{"state":"in-progress","branch":""}'

# ── Refused cases: distinct messages, one per state (H21 unweakened) ────

check_refused "in-progress WITH a branch (a session is genuinely live)" \
  '{"state":"in-progress","branch":"feature-H99-thing"}' \
  "already live on it"

check_refused "review" \
  '{"state":"review","branch":"feature-H99-thing"}' \
  "waiting on the next integrate pass"

check_refused "blocked" \
  '{"state":"blocked","reason":"waiting on Kevin"}' \
  "resolve the block"

check_refused "uat" \
  '{"state":"uat","link":"https://uat.wealth.auriqltd.co.uk/design"}' \
  "waiting on Kevin's review"

check_refused "rejected" \
  '{"state":"rejected","reason":"broke the safe-to-spend guard"}' \
  "resolve it first"

check_refused "done" \
  '{"state":"done"}' \
  "already done"

check_refused "unrecognised state" \
  '{"state":"not-a-real-state"}' \
  "unrecognised state"

# ── Refusal messages must each say which state was found (distinct per
#    the coordinator's ask, not a generic "refused") ─────────────────────

distinct_messages_check() {
  local -a states=("in-progress-with-branch" "review" "blocked" "uat" "rejected" "done")
  local -a jsons=(
    '{"state":"in-progress","branch":"feature-H99-thing"}'
    '{"state":"review","branch":"feature-H99-thing"}'
    '{"state":"blocked","reason":"x"}'
    '{"state":"uat","link":"https://uat.wealth.auriqltd.co.uk/design"}'
    '{"state":"rejected","reason":"x"}'
    '{"state":"done"}'
  )
  local -a seen=()
  local i out
  for i in "${!jsons[@]}"; do
    out="$(decide_start_state H99 "${jsons[$i]}" 2>&1)"
    for prior in "${seen[@]+"${seen[@]}"}"; do
      if [ "$prior" = "$out" ]; then
        echo "FAIL: ${states[$i]} produced the same message as an earlier state: $out"
        fail=1
      fi
    done
    seen+=("$out")
  done
  echo "PASS: every refused state (${states[*]}) produced a distinct message"
}
distinct_messages_check

if [ "$fail" -ne 0 ]; then
  echo "session-start-state.test.sh: FAILED"
  exit 1
fi

echo "session-start-state.test.sh: all checks passed"
