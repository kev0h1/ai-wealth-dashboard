/**
 * E15: whether a numeric preference field (income_value, pension_annual)
 * needs a PATCH /preferences at all.
 *
 * Settings used to PATCH on every blur of these two inputs, including a
 * focus-then-leave with nothing typed. Each PATCH bumps the server's data
 * version and makes Home recompute cold, so a write that cannot change the
 * stored value must not be sent.
 *
 * `baseline` is the last value known to be stored on the server: null until
 * the preferences snapshot has loaded, in which case nothing is written (the
 * field on screen is not yet the user's real value).
 */
export function shouldWriteNumericPreference(value: number, baseline: number | null): boolean {
  if (baseline === null) return false;
  return value !== baseline;
}

/** The stored number a raw preferences snapshot holds for a numeric field. */
export function numericBaselineFromSnapshot(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}
