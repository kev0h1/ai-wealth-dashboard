/**
 * The two things PreferencesContext.tsx does with a `GET /preferences`
 * snapshot, pulled out as plain, framework-free functions (G62) so the
 * distinction between them — which is the entire fix — can be tested with
 * a plain Node script instead of only living as prose in a code comment.
 * Same "no React, import the real module" pattern as
 * lib/preferenceSave.ts, lib/serialQueue.ts and lib/preferencesVersion.ts;
 * see frontend/scripts/preferences-snapshot.test.mjs.
 *
 * BACKGROUND (G62): `loadPreferences` in PreferencesContext.tsx used to
 * serve two jobs — mount hydration, and the `reconcile()` callback every
 * field's saver runs after a failed save (via `refreshPreferences()`).
 * Applying every field is correct for mount hydration (nothing is in
 * flight yet) but wrong as a failure-path reconcile: if `hide_net_worth`
 * is mid-PATCH while `dark_mode`'s save fails, `dark_mode`'s reconcile
 * fetch can carry a STALE `hide_net_worth` (the in-flight PATCH hasn't
 * bumped the version yet, so it still passes the freshness gate) and,
 * because the reconcile function applied every field as a side effect,
 * silently stomp `hide_net_worth`'s optimistic value and its
 * `wd_hide_balances` localStorage mirror.
 *
 * The fix splits the one function into two:
 *  - `fetchGatedSnapshot` — the version-gated FETCH only. No field is ever
 *    applied to anything; it just returns the accepted snapshot, or null
 *    if the fetch failed or the snapshot was stale. This is what a field's
 *    own `reconcile()` should call: it can extract just its own key from
 *    the result, and nothing else on the page is ever touched by it.
 *  - `applyWholeDocument` — given a snapshot, calls every field's `apply`
 *    callback. Correct for mount hydration and for `refreshPreferences()`'s
 *    other caller (Settings' Penny "Turn off" control, which wants a full
 *    resync after a write to a DIFFERENT endpoint). Never called from a
 *    field saver's own `reconcile()` — doing so is exactly the G62 defect,
 *    and is what frontend/scripts/preferences-snapshot.test.mjs's "bug
 *    mode" scenario reconstructs to prove why.
 *
 * Deliberately import-free of its sibling lib modules (same convention as
 * lib/preferenceSave.ts and lib/serialQueue.ts, and for the same reason
 * stated in their docstrings: a relative TS-to-TS import can't be given an
 * extension both `tsc`'s "bundler" module resolution and a plain
 * `node --experimental-strip-types` script agree on, so cross-module reuse
 * here is done by dependency injection instead — the freshness check
 * (`shouldAcceptPreferencesSnapshot`) is a parameter, not an import; the
 * REAL production one still flows in from `lib/preferencesVersion.ts`, via
 * PreferencesContext.tsx, so there is no second implementation of that
 * rule anywhere. `PayPeriodConfig` is imported as a type only, which Node's
 * type-stripping erases entirely and never tries to resolve at runtime. */
import type { PayPeriodConfig } from "./payPeriod.js";

export type Region = "UK" | "Kenya";

/** Structural match for a React ref (or any mutable holder) tracking the
 * highest preferences `version` accepted so far — a type, not an import,
 * so this module stays dependency-free of React. */
export interface VersionHolder {
  current: number;
}

/**
 * Fetches `GET /preferences` and applies a version-freshness gate. Returns
 * the accepted snapshot, or `null` if the fetch failed, or the snapshot
 * was discarded as stale. Never applies any field to anything — see this
 * module's own docstring for why that matters.
 *
 * `fetchFn` is almost always `() => api.getPreferences()`; `isFreshSnapshot`
 * is almost always `shouldAcceptPreferencesSnapshot` from
 * `lib/preferencesVersion.ts` (G45) — both passed in rather than imported,
 * per this module's own docstring, so this stays testable with plain Node
 * without either module needing to agree on an import extension.
 */
export function fetchGatedSnapshot(
  fetchFn: () => Promise<Record<string, any>>,
  versionHolder: VersionHolder,
  isFreshSnapshot: (incomingVersion: number | null | undefined, lastAcceptedVersion: number) => boolean
): Promise<Record<string, any> | null> {
  return fetchFn()
    .then((p) => {
      const incomingVersion = (p as any).version;
      if (!isFreshSnapshot(incomingVersion, versionHolder.current)) {
        return null;
      }
      if (typeof incomingVersion === "number" && Number.isFinite(incomingVersion)) {
        versionHolder.current = incomingVersion;
      }
      return p;
    })
    .catch(() => null);
}

/** The `apply*` callbacks `applyWholeDocument` drives — one per field on
 * the preferences document PreferencesContext.tsx mirrors locally, plus
 * `setRawPrefs` for the raw snapshot other screens read directly. */
export interface WholeDocumentApplyCallbacks {
  applyHideNetWorth: (v: boolean) => void;
  applyDarkMode: (v: boolean) => void;
  applyPayPeriodConfig: (v: PayPeriodConfig) => void;
  applyRegion: (v: Region) => void;
  applyDebtTargetMonths: (v: number) => void;
  applyDebtTrackingStart: (v: string) => void;
  setSpendWidgets: (v: string[]) => void;
  setHomePinnedWidget: (v: string | null) => void;
  setDebtBurndownOverrides: (v: any) => void;
  setRawPrefs: (p: Record<string, any>) => void;
}

/**
 * Applies every field on an already-fetched, already-gated snapshot. Only
 * ever call this for MOUNT hydration or a caller that genuinely wants a
 * full resync (`refreshPreferences()`'s B13 caller) — never from a single
 * field's own failure-path `reconcile()` (that is the G62 defect this
 * split exists to prevent).
 */
export function applyWholeDocument(p: Record<string, any>, cb: WholeDocumentApplyCallbacks): void {
  cb.applyHideNetWorth(p.hide_net_worth);
  if (p.dark_mode !== undefined) cb.applyDarkMode(p.dark_mode);
  if (p.pay_period_config) cb.applyPayPeriodConfig(p.pay_period_config as PayPeriodConfig);
  if (p.region) cb.applyRegion(p.region as Region);
  if (p.debt_target_months) cb.applyDebtTargetMonths(p.debt_target_months as number);
  if (p.debt_tracking_start) cb.applyDebtTrackingStart(p.debt_tracking_start as string);
  if (Array.isArray(p.spend_widgets)) cb.setSpendWidgets(p.spend_widgets as string[]);
  if (p.home_pinned_widget !== undefined) cb.setHomePinnedWidget(p.home_pinned_widget ?? null);
  if (p.debt_burndown_overrides !== undefined) cb.setDebtBurndownOverrides(p.debt_burndown_overrides ?? null);
  cb.setRawPrefs(p);
}
