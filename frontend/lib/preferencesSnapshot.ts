/**
 * The things PreferencesContext.tsx does with a `GET /preferences`
 * snapshot, pulled out as plain, framework-free functions (G62) so the
 * fix — and the guard that closes the second hole a reviewer found in it —
 * can be tested with a plain Node script instead of only living as prose
 * in a code comment. Same "no React, import the real module" pattern as
 * lib/preferenceSave.ts, lib/serialQueue.ts and lib/preferencesVersion.ts;
 * see frontend/scripts/preferences-snapshot.test.mjs.
 *
 * BACKGROUND (G62, first pass): `loadPreferences` in PreferencesContext.tsx
 * used to serve two jobs — mount hydration, and the `reconcile()` callback
 * every field's saver runs after a failed save (via `refreshPreferences()`).
 * Applying every field is correct for mount hydration (nothing is in
 * flight yet) but wrong as a failure-path reconcile: if `hide_net_worth`
 * is mid-PATCH while `dark_mode`'s save fails, `dark_mode`'s reconcile
 * fetch can carry a STALE `hide_net_worth` (the in-flight PATCH hasn't
 * bumped the version yet, so it still passes the freshness gate) and,
 * because the reconcile function applied every field as a side effect,
 * silently stomp `hide_net_worth`'s optimistic value and its
 * `wd_hide_balances` localStorage mirror.
 *
 * The first pass split the one function into two:
 *  - `fetchGatedSnapshot` — the version-gated FETCH only. No field is ever
 *    applied to anything; it just returns the accepted snapshot, or null
 *    if the fetch failed or the snapshot was stale.
 *  - `applyWholeDocument` — given a snapshot, calls every field's `apply`
 *    callback.
 * and rewired each of the six fields' OWN `reconcile()` (via
 * `makeFieldReconcile` below) to call `fetchGatedSnapshot` alone, extracting
 * only its own key — never `applyWholeDocument`. That closed the hole for a
 * field reconciling ITS OWN failed save.
 *
 * THE HOLE THAT WAS LEFT (G62, review #1): `refreshPreferences()` in
 * PreferencesContext.tsx still composes the fetch WITH `applyWholeDocument`
 * — correct for MOUNT hydration, where nothing is in flight yet, but
 * `refreshPreferences()` has FOUR OTHER callers, all in
 * frontend/app/settings/SettingsPage.tsx, none of which were touched by the
 * first pass because none of them are one of the six fields' own reconciles:
 * the Penny agent-consent "Turn off" control (B13, ~line 379), and the
 * failure-path reconciles of the child benefit toggle (G58, ~line 730), the
 * cover-plan exclusion toggle (G45, ~line 790) and the notification prefs
 * toggle (G52, ~line 841). Every one of those calls `refreshPreferences()`
 * to reconcile ITS OWN field, but `refreshPreferences()` still applies every
 * OTHER field too — including any of this context's six that might be
 * mid-save at that exact moment. Concretely: flip dark mode (its PATCH in
 * flight, version not yet bumped), then let a notification toggle fail in
 * that window — its catch calls `refreshPreferences()`, which reapplies
 * dark mode from a snapshot that still passes the freshness gate, bypassing
 * the dark mode saver's own queue entirely. Same bug, different door.
 *
 * THE SECOND FIX: `applyWholeDocument` now takes an optional per-field
 * `skip` map. A field whose own saver reports `isSaving` (a flag
 * `lib/preferenceSave.ts`'s `createPreferenceSaver` already exposes for
 * exactly this) is left untouched by ANY whole-document apply, mount
 * hydration included — mount can never actually collide with an in-flight
 * save (nothing has started saving yet when it runs), so the guard is a
 * no-op there, but it makes `refreshPreferences()` — and by extension every
 * one of its four callers above — safe by construction, present and
 * future, rather than only the six call sites the first pass happened to
 * rewire. This is NOT the busy-counter approach G45 rejected: that counter
 * was asked to decide whether a SNAPSHOT was fresh, which in-flight-ness
 * alone cannot answer (a GET issued before the write can still resolve
 * after it). `isSaving` here is asked only whether a field is CURRENTLY
 * AUTHORING ITS OWN VALUE, which it genuinely knows — the freshness
 * question is still answered by the version scheme alone, untouched.
 *
 * The two fixes are complementary, not alternatives: `makeFieldReconcile`
 * means a field's own failure path never even fetches a whole-document
 * apply; the `skip` guard means that on the rarer path where some OTHER
 * caller does apply the whole document, an in-flight field survives it
 * too.
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

/**
 * Builds ONE field's `reconcile()` callback for `createPreferenceSaver`
 * (`lib/preferenceSave.ts`): fetch a gated snapshot, extract just `key`,
 * return `undefined` if there is no server truth to offer (the fetch
 * failed, the snapshot was stale, or the key was absent) — the exact
 * contract `createPreferenceSaver` expects, so it falls back to the
 * pre-write value in that case (see its own docstring, point 4). Never
 * applies anything — extraction only. All six of PreferencesContext.tsx's
 * field savers are built from this one function rather than each hand-
 * writing an near-identical `async () => { const server = ...; return
 * server ? server.x : undefined; }` — see
 * frontend/scripts/preferences-snapshot.test.mjs, which drives this exact
 * function (not a reimplementation) for its own reconcile scenarios.
 */
export function makeFieldReconcile<T>(
  fetchSnapshot: () => Promise<Record<string, any> | null>,
  key: string
): () => Promise<T | undefined> {
  return async () => {
    const server = await fetchSnapshot();
    return server ? (server[key] as T) : undefined;
  };
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

/** One `() => boolean` per field `applyWholeDocument` can skip, each
 * almost always `() => someSaver.isSaving.current` (the flag
 * `createPreferenceSaver` exposes) — a field this returns `true` for is
 * left completely untouched by this call, however many other callers
 * `refreshPreferences()` picks up in the future. All optional: a caller
 * with no six-field savers to protect (there is none in this codebase
 * today, but the type shouldn't assume there always will be) can omit any
 * or all of them, which behaves exactly like the pre-G62-review-#1 code —
 * always apply. */
export interface WholeDocumentApplySkip {
  hideNetWorth?: () => boolean;
  darkMode?: () => boolean;
  payPeriodConfig?: () => boolean;
  region?: () => boolean;
  debtTargetMonths?: () => boolean;
  debtTrackingStart?: () => boolean;
}

/**
 * Applies every field on an already-fetched, already-gated snapshot,
 * except any field `skip` marks as currently saving its own value. Called
 * for MOUNT hydration (where `skip` is a no-op, since nothing has started
 * saving yet) and by `refreshPreferences()` for every one of its callers —
 * B13's Penny consent revoke, and the failure-path reconciles of the child
 * benefit (G58), cover-plan (G45) and notification prefs (G52) toggles in
 * SettingsPage.tsx — none of which reconcile one of THIS module's six
 * fields themselves, so without `skip` any of those four could still land
 * mid-save on one of the six and stomp it (see this module's own docstring,
 * "THE HOLE THAT WAS LEFT"). Never called from one of the six fields' own
 * failure-path `reconcile()` — those use `makeFieldReconcile` instead,
 * which never applies anything at all.
 */
export function applyWholeDocument(
  p: Record<string, any>,
  cb: WholeDocumentApplyCallbacks,
  skip: WholeDocumentApplySkip = {}
): void {
  if (!skip.hideNetWorth?.()) cb.applyHideNetWorth(p.hide_net_worth);
  if (p.dark_mode !== undefined && !skip.darkMode?.()) cb.applyDarkMode(p.dark_mode);
  if (p.pay_period_config && !skip.payPeriodConfig?.()) cb.applyPayPeriodConfig(p.pay_period_config as PayPeriodConfig);
  if (p.region && !skip.region?.()) cb.applyRegion(p.region as Region);
  if (p.debt_target_months && !skip.debtTargetMonths?.()) cb.applyDebtTargetMonths(p.debt_target_months as number);
  if (p.debt_tracking_start && !skip.debtTrackingStart?.()) cb.applyDebtTrackingStart(p.debt_tracking_start as string);
  if (Array.isArray(p.spend_widgets)) cb.setSpendWidgets(p.spend_widgets as string[]);
  if (p.home_pinned_widget !== undefined) cb.setHomePinnedWidget(p.home_pinned_widget ?? null);
  if (p.debt_burndown_overrides !== undefined) cb.setDebtBurndownOverrides(p.debt_burndown_overrides ?? null);
  cb.setRawPrefs(p);
}
