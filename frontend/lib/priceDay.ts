// G338: date helpers for the "Prices as of" line on investment accounts.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "13 Oct" (or "13 Oct 2025" when withYear), from a YYYY-MM-DD string. */
export function shortDate(iso: string, withYear = false): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** G333: "16 Oct", or "15 to 16 Oct" when the prices span two dates. Null when there is no price date. */
export function formatPriceDay(asOf: string | null | undefined, oldest?: string | null): string | null {
  if (!asOf) return null;
  if (!oldest || oldest.slice(0, 10) === asOf.slice(0, 10)) return shortDate(asOf);
  const [, om, od] = oldest.slice(0, 10).split("-").map(Number);
  const [, nm] = asOf.slice(0, 10).split("-").map(Number);
  const to = shortDate(asOf);
  if (om === nm) return `${od} to ${to}`;
  return `${shortDate(oldest)} to ${to}`;
}
