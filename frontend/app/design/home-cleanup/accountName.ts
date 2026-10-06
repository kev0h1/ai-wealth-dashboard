// G221 proposal, preview only (not wired into production). lib/displayName.ts
// resolveDisplayName is a PERSON-name helper (greeting), so it cannot tidy an
// account row. Bank strings often arrive wholly upper-case ("PREMIER CURRENT");
// this turns those into sentence case and leaves everything else alone.

const KEEP_UPPER = new Set(["ISA", "LISA", "SIPP", "JISA", "HSBC", "GBP", "USD", "EUR", "UK", "NS&I", "RBS", "TSB", "ATM", "FX", "PEP"]);

export function tidyAccountName(raw: string): string {
  const name = raw.trim();
  const letters = name.replace(/[^A-Za-z]/g, "");
  // Only wholly upper-case names are touched. Mixed case is the user's or the
  // bank's own choice and is kept as is.
  if (letters.length < 2 || letters !== letters.toUpperCase()) return name;
  const words = name.split(/(\s+)/).map((w) => {
    if (/^\s*$/.test(w)) return w;
    if (KEEP_UPPER.has(w)) return w;
    if (/\d/.test(w)) return w; // masked digits, account numbers
    return w.toLowerCase();
  });
  const out = words.join("");
  return out.charAt(0).toUpperCase() + out.slice(1);
}
