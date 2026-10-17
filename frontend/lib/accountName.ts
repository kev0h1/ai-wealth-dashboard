// The ONE account display-name function (G282, Kevin 2026-10-17).
//
// Mirror of backend/app/services/account_names.py: both read the same table in
// shared/account-name-cases.json so web, app and API agree. Every surface that
// shows an account name (Home estate, Accounts rows, Upcoming By account, the
// plan and set-aside pickers, Spend from, Penny) goes through this.
//
// Rules:
//  - a name that mixes upper and lower case is the user's or the bank's own
//    choice and is never altered ("Premier Current Account", "Kevin's Pot");
//  - a wholly upper-case (or wholly lower-case) name is title-cased, with small
//    words ("and", "of") kept lower case after the first word;
//  - brands and acronyms keep their own casing (HSBC, ISA, GBP, NatWest, AJ, S&P);
//  - a run of two or more single-letter initials stays upper case ("Maingi K M");
//  - tokens with digits (masked numbers, "ISA 2025") are left alone.
// resolveDisplayName in lib/displayName.ts is a PERSON-name helper and unrelated.
// Bank (provider) text is a separate concern: lib/accountDisplay.ts tidyAccountText.

const BRAND_LIST = [
  "NatWest", "HSBC", "TSB", "RBS", "Amex", "ISA", "LISA", "JISA", "SIPP", "ETF", "FTSE", "GIA", "PAYE",
  "GBP", "USD", "EUR", "UK", "NS&I", "S&P", "M&S", "ATM", "FX", "PEP", "NW", "AJ", "BOS", "AIB", "JLP", "PCA", "PLC", "MBNA", "PayPal",
  "Lloyds", "Barclays", "Barclaycard", "Halifax", "Santander", "Nationwide", "Monzo", "Starling", "Revolut", "Vanguard",
];
const BRANDS = new Map(BRAND_LIST.map((b) => [b.toUpperCase(), b]));
const SMALL_WORDS = new Set(["and", "of", "the", "for", "to", "in", "on", "at", "or", "an", "with", "by", "from"]);
const TRIM = /^[^A-Za-z0-9&]+|[^A-Za-z0-9&]+$/g;

function cap(part: string): string {
  const lower = part.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function displayAccountName(raw: string | null | undefined): string {
  const name = (raw ?? "").trim();
  const letters = name.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return name;
  // Mixed case is someone's own choice: leave it exactly as it is.
  if (letters !== letters.toUpperCase() && letters !== letters.toLowerCase()) return name;
  const tokens = name.split(/(\s+)/);
  const words = tokens.filter((t) => !/^\s*$/.test(t));
  const coreOf = (w: string) => w.replace(TRIM, "");
  const isInitial = (w: string) => /^[A-Za-z]$/.test(coreOf(w));
  const inInitialRun = words.map((w, i) => isInitial(w) && (isInitial(words[i - 1] ?? "") || isInitial(words[i + 1] ?? "")));
  let wi = -1;
  return tokens
    .map((t) => {
      if (/^\s*$/.test(t)) return t;
      wi += 1;
      if (/\d/.test(t)) return t;
      const core = coreOf(t);
      const brand = BRANDS.get(core.toUpperCase());
      if (brand) return t.replace(core, brand);
      if (inInitialRun[wi]) return t.toUpperCase();
      if (/^[A-Za-z]+(?:&[A-Za-z]+)+$/.test(core)) return t.toUpperCase();
      if (wi > 0 && SMALL_WORDS.has(core.toLowerCase())) return t.toLowerCase();
      return t.split("-").map((part) => {
        const lead = part.match(/^[^A-Za-z]*/)![0];
        return lead + cap(part.slice(lead.length));
      }).join("-");
    })
    .join("");
}

/** Kept for existing imports: the same function under its G221 name. */
export const tidyAccountName = displayAccountName;
