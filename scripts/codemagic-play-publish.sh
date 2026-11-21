#!/usr/bin/env bash
# C49: publish the signed AAB to Google Play whatever the app's review state.
#
# Usage: scripts/codemagic-play-publish.sh --track internal|production [--draft]
#
# Google refuses an edit commit in one of two ways depending on the app's
# state, so no static setting is right:
#   - normal state: "Changes are sent for review automatically. The query
#     parameter changesNotSentForReview must not be set."
#   - rejected or pending update: "Changes cannot be sent for review
#     automatically" unless changesNotSentForReview is set.
# So attempt 1 publishes WITHOUT --changes-not-sent-for-review. Only if its
# output contains "Changes cannot be sent for review automatically" do we retry
# WITH the flag. Any other failure fails the step at once, with no retry.
#
# Credentials: GCLOUD_SERVICE_ACCOUNT_CREDENTIALS (Codemagic group
# google_play), passed with --credentials exactly as the versionCode step does.
# The value is never echoed. Runs on macOS bash 3.2 (Codemagic mac_mini_m2).
#
# Test hooks: AAB_GLOB overrides the bundle location; the test puts a fake
# `google-play` on PATH.
set -euo pipefail

TRACK=""
DRAFT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --track) TRACK="${2:-}"; shift 2 ;;
    --draft) DRAFT=1; shift ;;
    *) echo "ERROR: unknown argument '$1'"; exit 2 ;;
  esac
done
if [ -z "$TRACK" ]; then
  echo "ERROR: --track is required"
  exit 2
fi
if [ -z "${GCLOUD_SERVICE_ACCOUNT_CREDENTIALS:-}" ]; then
  echo "ERROR: GCLOUD_SERVICE_ACCOUNT_CREDENTIALS is not set. Add the Play service-account JSON to the Codemagic variable group google_play."
  exit 1
fi

AAB_GLOB="${AAB_GLOB:-${CM_BUILD_DIR:-.}/capacitor-spike/android/app/build/outputs/bundle/release/*.aab}"
# shellcheck disable=SC2086
AAB=$(ls $AAB_GLOB 2>/dev/null | head -n 1 || true)
if [ -z "$AAB" ]; then
  echo "ERROR: no signed AAB found at $AAB_GLOB"
  exit 1
fi

OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT

# run_attempt <label> [extra flags...]: runs the CLI, copies its output to the
# build log, and returns its exit status. The credentials never appear in the
# log because only the CLI's own output is printed.
run_attempt() {
  local label="$1"; shift
  local out="$OUT_DIR/$label.log"
  local args=(bundles publish --bundle "$AAB" --track "$TRACK" --credentials "$GCLOUD_SERVICE_ACCOUNT_CREDENTIALS")
  if [ "$DRAFT" = "1" ]; then args+=(--draft); fi
  if [ $# -gt 0 ]; then args+=("$@"); fi
  set +e
  google-play "${args[@]}" > "$out" 2>&1
  local rc=$?
  set -e
  cat "$out"
  return $rc
}

NEEDLE="Changes cannot be sent for review automatically"

echo "Play publish: attempt 1 of 2, track $TRACK, draft=$DRAFT, WITHOUT --changes-not-sent-for-review"
if run_attempt attempt1; then
  echo "Play publish: attempt 1 succeeded. Google sent the changes for review automatically; nothing to do in Play Console."
  exit 0
fi

if ! grep -qF "$NEEDLE" "$OUT_DIR/attempt1.log"; then
  echo "ERROR: Play publish attempt 1 failed for a reason other than review state. Not retrying. See the CLI output above."
  exit 1
fi

echo "Play publish: Google says '$NEEDLE' (the app has a rejected or pending update)."
echo "Play publish: attempt 2 of 2, track $TRACK, draft=$DRAFT, WITH --changes-not-sent-for-review"
if run_attempt attempt2 --changes-not-sent-for-review; then
  echo "Play publish: attempt 2 succeeded. The upload is SAVED but NOT sent for review."
  echo "ACTION NEEDED: Kevin must open Play Console and press 'Send for review' on this release."
  exit 0
fi

echo "ERROR: Play publish failed on both attempts (the second with --changes-not-sent-for-review). See the CLI output above."
exit 1
