// G264: copy and visibility rules for the "still to categorise" journey stop.
// The page shows whole pounds, so a payment worth under 50p reads as "£0" and
// asks the user to do work for nothing. It stays inside Out (nothing is hidden
// from the arithmetic), it just stops being a to-do.

/** True when the unplaced total is worth a stop of its own (rounds to at least £1). */
export function unresolvedWorthAsking(total: number): boolean {
  return Math.round(total) >= 1;
}

/** "1 payment still needs a category" / "3 payments still need a category". */
export function unresolvedHeading(count: number): string {
  return count === 1 ? "1 payment still needs a category" : `${count} payments still need a category`;
}
