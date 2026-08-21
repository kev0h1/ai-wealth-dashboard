// Home-only dismissal store for Penny's advice/insight/ask cards.
//
// Home shows only the timely; Penny is the permanent archive of current
// advice. Dismissing a card from Home must never remove it server-side
// (that would also erase it from Penny) — so this is a purely local,
// client-side "hide on Home" preference, keyed on the CompanionItem's
// already-stable `id` (the same id the backend's /today/dismiss endpoint
// relies on being stable).
//
// Entries auto-expire after 7 days so advice can resurface if it's still
// relevant, and are pruned whenever a key is no longer present in the live
// /today feed (the advice itself has stopped being generated — nothing to
// remember a dismissal for).

const STORAGE_KEY = "home_dismissed_advice";
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type DismissedEntry = { key: string; at: number };

function readRaw(): DismissedEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is DismissedEntry =>
        !!e && typeof e.key === "string" && typeof e.at === "number"
    );
  } catch {
    return [];
  }
}

function writeRaw(entries: DismissedEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable (private mode / quota) — dismissal just won't
    // persist across reloads; the in-memory hide still works this session.
  }
}

/** Entries younger than the 7-day expiry window. */
function freshEntries(entries: DismissedEntry[]): DismissedEntry[] {
  const now = Date.now();
  return entries.filter((e) => now - e.at < EXPIRY_MS);
}

/** Reads the current set of live (non-expired) dismissed-on-Home keys. */
export function readHomeDismissedAdvice(): Set<string> {
  return new Set(freshEntries(readRaw()).map((e) => e.key));
}

/** Marks a key as dismissed-on-Home, stamped with the current time. */
export function dismissOnHome(key: string): void {
  const entries = freshEntries(readRaw()).filter((e) => e.key !== key);
  entries.push({ key, at: Date.now() });
  writeRaw(entries);
}

/**
 * Drops expired entries and any entry whose key is no longer present in
 * `liveKeys` (the current /today feed, unfiltered by dismissal). Call this
 * with the raw feed's ids, not the already-dismissal-filtered list, or every
 * dismissed key would be pruned the moment it's dismissed.
 */
export function pruneHomeDismissedAdvice(liveKeys: Set<string>): void {
  const kept = freshEntries(readRaw()).filter((e) => liveKeys.has(e.key));
  writeRaw(kept);
}

/**
 * Un-hides a single key — the "show on Home again" affordance in Penny's
 * "cleared from Home" archive (app/penny/PennyPage.tsx). Removes the entry
 * outright rather than waiting for the 7-day expiry, so the card reappears
 * on Home the next time it loads.
 */
export function restoreOnHome(key: string): void {
  const entries = freshEntries(readRaw()).filter((e) => e.key !== key);
  writeRaw(entries);
}
