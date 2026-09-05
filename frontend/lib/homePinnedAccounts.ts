"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePreferences } from "@/components/PreferencesContext";

// Shared store for `home_pinned_accounts` (the star-pinned accounts behind
// Home's "Your estate" top picks) — same shared-store convention as
// lib/useHomePinnedCards.ts (which covers the separate `home_pinned_cards`
// field: fuel/groceries/chart-widget pins), for the identical reason:
// PreferencesContext fetches /preferences exactly once per full page load
// and never refreshes on client-side navigation, so a consumer reading only
// `rawPrefs` would miss a pin toggled elsewhere in the same tab —
// AccountsPage's togglePin writes preferences directly — until a hard
// reload. This is what previously made HomePage re-fetch /preferences on
// every one of its own mounts (see its old dedicated effect); reading from
// this shared store instead removes that redundant request while keeping
// the same freshness guarantee.
//
// Unlike useHomePinnedCards, AccountsPage keeps its own local pinnedIds
// state (it needs it before this hook's first render for its `ready`/
// prefsReady gate) — so this module also exports a plain write-through
// function for it to call alongside its existing local update, rather than
// making it subscribe via the hook too.
let sharedPinnedAccounts: string[] = [];
let seeded = false;
const listeners = new Set<() => void>();

function setShared(next: string[]) {
  sharedPinnedAccounts = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return sharedPinnedAccounts;
}

function getServerSnapshot() {
  return sharedPinnedAccounts;
}

/** Write-through for any page that already has a fresh `home_pinned_accounts`
 *  value (AccountsPage's togglePin, or its own initial preferences fetch) —
 *  updates every other mounted reader (useHomePinnedAccounts below)
 *  instantly, without them needing a fetch of their own. */
export function writeHomePinnedAccounts(next: string[]): void {
  setShared(next);
}

/** Read-only hook for pages that just need the current pinned-account ids
 *  (Home's topPickAccounts) — seeds once from PreferencesContext's own
 *  /preferences fetch (rawPrefs), then stays live via the shared store for
 *  the rest of the tab's session. */
export function useHomePinnedAccounts(): string[] {
  const { rawPrefs } = usePreferences();
  const pinnedIds = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (rawPrefs && !seeded) {
      seeded = true;
      setShared(rawPrefs.home_pinned_accounts ?? []);
    }
  }, [rawPrefs]);

  return pinnedIds;
}
