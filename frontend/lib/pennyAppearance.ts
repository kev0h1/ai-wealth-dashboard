/** The three approved visual treatments for the Penny entry points. */
export const PENNY_APPEARANCES = ["original", "outline", "ink"] as const;

export type PennyAppearance = typeof PENNY_APPEARANCES[number];

export const DEFAULT_PENNY_APPEARANCE: PennyAppearance = "ink";

export function pennyAppearanceFromSnapshot(value: unknown): PennyAppearance {
  return PENNY_APPEARANCES.includes(value as PennyAppearance)
    ? value as PennyAppearance
    : DEFAULT_PENNY_APPEARANCE;
}

/** localStorage mirror of the server value, same idea as `wd_hide_balances`. */
export const PENNY_APPEARANCE_STORAGE_KEY = "wd_penny_appearance";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

/** The last appearance the server told this device about, or null when this
 * device has never seen one (first ever load, cleared storage, a bad value).
 * Null is not "original": the launcher stays neutral until the server answers
 * rather than painting the default and flipping. */
export function readSeededPennyAppearance(storage: StorageLike | null = defaultStorage()): PennyAppearance | null {
  try {
    const saved = storage?.getItem(PENNY_APPEARANCE_STORAGE_KEY);
    return PENNY_APPEARANCES.includes(saved as PennyAppearance) ? saved as PennyAppearance : null;
  } catch {
    return null;
  }
}

export function writeSeededPennyAppearance(value: PennyAppearance, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(PENNY_APPEARANCE_STORAGE_KEY, value); } catch {}
}
