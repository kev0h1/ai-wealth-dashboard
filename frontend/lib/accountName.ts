// Tidy display name for an account row on Home (G221, approved C).
//
// Bank strings often arrive wholly upper-case ("PREMIER CURRENT"). This turns
// those into sentence case and leaves everything else alone: a mixed-case name
// is the user's or the bank's own choice. Brands and acronyms keep their own
// casing through BRANDS, so "NATWEST ISA" reads "NatWest ISA", not "Natwest isa".
// resolveDisplayName in lib/displayName.ts is a PERSON-name helper and is not
// related. Home estate rows only; the Accounts page rows are unchanged.

const BRAND_LIST = [
  "NatWest", "HSBC", "TSB", "RBS", "Amex", "ISA", "LISA", "JISA", "SIPP", "ETF", "FTSE", "GIA", "PAYE",
  "GBP", "USD", "EUR", "UK", "NS&I", "ATM", "FX", "PEP",
  "Lloyds", "Barclays", "Barclaycard", "Halifax", "Santander", "Nationwide", "Monzo", "Starling", "Revolut", "Vanguard",
];
const BRANDS = new Map(BRAND_LIST.map((b) => [b.toUpperCase(), b]));

const TRIM = /^[^A-Za-z0-9&]+|[^A-Za-z0-9&]+$/g;

export function tidyAccountName(raw: string): string {
  const name = raw.trim();
  const letters = name.replace(/[^A-Za-z]/g, "");
  // Only wholly upper-case names are touched.
  if (letters.length < 2 || letters !== letters.toUpperCase()) return name;
  const out = name
    .split(/(\s+)/)
    .map((w) => {
      if (/^\s*$/.test(w)) return w;
      if (/\d/.test(w)) return w; // masked digits, account numbers
      const core = w.replace(TRIM, "");
      const brand = BRANDS.get(core.toUpperCase());
      if (brand) return w.replace(core, brand);
      // Initialisms joined by "&" (M&S) keep their capitals.
      if (/^[A-Z]+(?:&[A-Z]+)+$/.test(core)) return w;
      return w.toLowerCase();
    })
    .join("");
  // Sentence case: capitalise the first letter unless a brand already set it.
  return out.charAt(0).toUpperCase() + out.slice(1);
}
