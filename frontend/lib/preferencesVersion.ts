/**
 * Freshness gate for a `GET /preferences` snapshot (G45, second re-review).
 *
 * Earlier attempts tried to detect staleness structurally — a busy-counter
 * ("skip while a PATCH is in flight") and then a permanent latch ("stop
 * resyncing after the first local edit"). Both were rejected: the counter
 * couldn't tell a GET issued BEFORE a PATCH from one issued after (it only
 * tracked in-flight-ness, not data age), and the latch's premise — that
 * cover_plan_excluded_accounts has exactly one writer — is false: Penny's
 * `set_cover_plan_exclusions` proposal (backend/app/services/penny_tools.py)
 * replays the same PATCH /preferences endpoint via
 * `can_i._execute_update_preferences`, and PennySheetProvider is mounted
 * app-wide, so a Penny-driven write can land while Settings is the visible
 * screen. A permanent latch would then block that legitimately newer value
 * forever.
 *
 * The real fix is a version number. `backend/app/routers/preferences.py`
 * stamps a monotonic `version` on the preferences document on every PATCH
 * (regardless of which field changed or which caller wrote it) and returns
 * it from both GET and PATCH. The client remembers the highest version it
 * has ever accepted and applies this one rule: discard any snapshot older
 * than that, accept anything equal or newer, no matter who produced it.
 *
 * This is deliberately a plain, framework-free function — see
 * frontend/scripts/preferences-version.test.mjs, which imports this exact
 * file (not a re-implementation) to test the rule without needing a
 * frontend test harness.
 */
export function shouldAcceptPreferencesSnapshot(
  incomingVersion: number | null | undefined,
  lastAcceptedVersion: number
): boolean {
  // No version on the incoming snapshot (a server that hasn't deployed this
  // field yet, or a shape from before this change) — nothing to compare
  // against, so accept it rather than wedging the app.
  if (typeof incomingVersion !== "number" || !Number.isFinite(incomingVersion)) {
    return true;
  }
  return incomingVersion >= lastAcceptedVersion;
}
