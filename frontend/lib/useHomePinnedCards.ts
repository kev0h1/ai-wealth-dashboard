"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";

// Module-level store shared by every instance of this hook (Home, plus
// FuelSavingsCard/GroceryBasketCard on Insights). PreferencesContext fetches
// /preferences exactly once per full page load and never refreshes on
// client-side navigation, so a hook instance that only read from rawPrefs
// would miss a pin toggled by a *different* instance until a hard reload —
// e.g. tapping "Pin to Home" on /insights wouldn't show up on Home. Routing
// every toggle() through this shared store means all mounted instances,
// including ones on other routes, update in lockstep without waiting on a
// fresh fetch.
let sharedPinned: string[] = [];
let seeded = false;
const listeners = new Set<() => void>();

function setSharedPinned(next: string[]) {
  sharedPinned = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return sharedPinned;
}

function getServerSnapshot() {
  return sharedPinned;
}

// Which extra cards (e.g. "fuel", "groceries") the user pinned to Home.
export function useHomePinnedCards() {
  const { rawPrefs } = usePreferences();
  const pinned = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    // Seed the shared store once from whichever hook instance first sees
    // preferences resolve. Guarded by `seeded` so a later-mounting instance
    // (e.g. navigating to a second page after already toggling a pin) can't
    // clobber the shared, possibly-newer state with the original snapshot.
    if (rawPrefs && !seeded) {
      seeded = true;
      setSharedPinned(rawPrefs.home_pinned_cards ?? []);
    }
  }, [rawPrefs]);

  function toggle(id: string) {
    const next = sharedPinned.includes(id)
      ? sharedPinned.filter(x => x !== id)
      : [...sharedPinned, id];
    setSharedPinned(next);
    api.updatePreferences({ home_pinned_cards: next }).catch(() => {});
  }

  return { pinned, toggle };
}
