// Session-only persistence of the Spend hub's transient UI state — the
// "This period/Over time" tab, the majority list's "Show all N" expansion,
// the "Money you moved" accordion, and (bug round 4, owner report
// 2026-08-31) the SELECTED PAY PERIOD. Restores the exact view the user left
// on any return to /spend within the same tab session (the original
// reported bug: tap a "Money you moved" row -> /transactions -> BACK -> the
// accordion had re-collapsed, "Show all" had re-truncated, and the page
// landed scrolled to the top because there was nothing tall enough left to
// restore onto — see ScrollReset.tsx/lib/scrollRestore.ts, which already
// handles the actual scroll-position restore app-wide and needs the page to
// re-render at its previous height for that height-gated restore to land
// correctly. Round 4's bug: none of the above accounted for the user having
// navigated to a PREVIOUS period first — BACK always re-landed on the
// current period, restoring the right accordion/scroll state into the wrong
// month's data).
//
// periodStart is the period's own START date (YYYY-MM-DD), not a relative
// offset — SpendPage.tsx's own "N periods before now" offset isn't stable
// across a save/restore round trip (the calendar can roll between them,
// silently turning "1 before now" into a different period than the one the
// user actually left). See payPeriod.ts's findPeriodByStart, which turns
// this stable date back into the offset the verdict/signals/miscategorised
// fetches are actually keyed by.
//
// sessionStorage, not localStorage — same convention as HomeBrief's
// wealth_open_category/wealth_open_pay_period keys: a fresh tab/session
// always starts clean.
//
// A hard reload of /spend must ALSO start clean, even though sessionStorage
// itself survives a reload. SEMANTICS (fix-round 2 — the first version of
// this file got this wrong): "starts clean" means WIPE the saved state at
// reload time, once, and then behave completely normally for the rest of
// the session — not disable restoration for the rest of the tab's life.
// The very first version gated every read behind a session-wide
// `IS_HARD_RELOAD` flag computed once at module load; that made the whole
// feature look permanently broken for anyone who reloads mid-session (which
// is exactly what happened testing this on a phone — every reload while
// poking at the page silently killed restoration for good). The fix below
// clears the sessionStorage key exactly once, synchronously, the moment
// this module first evaluates in a JS context whose document load was a
// reload (Navigation Timing's `type === "reload"`, read once via a
// module-level IIFE — a client-side SPA route change never re-evaluates
// this module, only a real document load does, so this can only ever fire
// once per actual reload). After that one-time clear, every read/write
// below is the plain, unconditional sessionStorage round trip a normal
// session gets — a toggle made right after the reload persists and
// restores across subsequent round trips exactly like any other visit.
const KEY = "spend_ui_state";

(function clearOnHardReload() {
  if (typeof window === "undefined" || typeof performance === "undefined") return;
  try {
    const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (nav?.type === "reload") {
      sessionStorage.removeItem(KEY);
    }
  } catch {
    // Navigation Timing unavailable — nothing to clear; sessionStorage's own
    // per-tab scoping still covers the "fresh session" half of the contract.
  }
})();

export interface SpendUiState {
  showPatterns?: boolean;
  majorityExpanded?: boolean;
  movedOpen?: boolean;
  /** YYYY-MM-DD — the viewed period's start date, not an offset. See the
   *  file header comment above for why. */
  periodStart?: string;
}

function readRaw(): SpendUiState {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SpendUiState) : {};
  } catch {
    return {};
  }
}

/** Read once on mount (SpendPage's own useState lazy initializer). Empty on
 *  a fresh tab (nothing saved yet) or immediately after a hard reload (the
 *  IIFE above already cleared the key by the time this runs). */
export function consumeSpendUiState(): SpendUiState {
  return readRaw();
}

/** Write on every change — cheap, these only change on an explicit tap (a
 *  tab switch, "Show all", the moved accordion). Merges rather than
 *  overwrites so one field's write never clobbers another's. */
export function writeSpendUiState(patch: SpendUiState) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...readRaw(), ...patch }));
  } catch {
    // sessionStorage unavailable (private mode etc.) — persistence simply
    // won't happen; the page falls back to its normal fresh-visit defaults.
  }
}
