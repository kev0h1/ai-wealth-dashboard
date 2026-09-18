// G124 ask #3 — shared helpers for the three Set-aside content-density
// answers. These fix the two raw-data hygiene defects Kevin flagged
// (a bare-number title, a shouty truncated-mid-word bank string) as
// PRESENTATION problems, never by dropping the underlying data: every raw
// string is still recoverable (the humanised label carries a `title`
// attribute with the original string; the numeric id becomes a small tag
// rather than disappearing).
import type { PreviewAllocation } from "./fixtures";

// A shouty raw bank string is uniformly uppercase throughout, so case
// alone can't tell an acronym (HSBC, ISA) apart from an ordinary word that
// happened to be typed in caps too (PAID, GROSS, FOR) — title-casing every
// word except a short curated list of common UK banking acronyms is the
// safer default than a length/case heuristic, which would just as
// confidently "preserve" PAID or FOR as if they were acronyms.
const KNOWN_ACRONYMS = new Set(["HSBC", "RBS", "TSB", "ISA", "VAT", "APR", "BACS", "CHAPS", "PAYE", "STO", "DD", "SO", "NS&I"]);

function toTitleCase(s: string): string {
  return s
    .split(/(\s+)/)
    .map((word) => {
      if (KNOWN_ACRONYMS.has(word.toUpperCase())) return word.toUpperCase();
      return word.toLowerCase().replace(/^[a-z]/, (m) => m.toUpperCase());
    })
    .join("");
}

// Never cuts mid-word: truncates at the nearest earlier space, only
// falling back to a hard cut when the very first word already overruns
// the budget (nothing else to break on).
function truncateAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > max * 0.4 ? cut.slice(0, lastSpace) : cut;
  return safe.trimEnd() + "…";
}

// A card-like raw descriptor ("AMERICAN EXPRESS 3751-4360-XXXXXX ...")
// collapses to "American Express •• 4360" — brand name plus the one
// digit group a user would actually recognise their card by, rather than
// truncating the whole string mid-account-number.
const CARD_PATTERN = /^([a-z ]+?)\s+[\dx]{2,6}-([\dx]{4})(?:[\d-]*)?/i;

export function humanizeRaw(raw: string, maxLen = 30): string {
  const trimmed = raw.trim();
  const cardMatch = trimmed.match(CARD_PATTERN);
  if (cardMatch) {
    const brand = toTitleCase(cardMatch[1].trim());
    const last4 = cardMatch[2].replace(/x/gi, "");
    if (last4.length === 4) return `${brand} •• ${last4}`;
  }
  return truncateAtWord(toTitleCase(trimmed), maxLen);
}

function isBareNumber(name: string): boolean {
  return /^\d+(\.\d+)?$/.test(name.trim());
}

// A bare-number name ("50") is real data (the user typed it, maybe it's a
// personal reference), so it becomes a small `#50` tag next to a readable
// title derived from the feed match, rather than being hidden.
export function titleFor(a: PreviewAllocation, maxLen = 30): { primary: string; tag: string | null } {
  if (isBareNumber(a.rawName)) {
    return { primary: humanizeRaw(a.feedRaw, maxLen), tag: `#${a.rawName}` };
  }
  return { primary: a.rawName, tag: null };
}

export function fmtC(n: number): string {
  return "£" + Math.round(n).toLocaleString("en-GB");
}

export function cadenceLabel(a: PreviewAllocation): string {
  return a.recurrence === "once" ? "this period only" : "every pay period";
}

export function statusFor(a: PreviewAllocation): { detail: string; amount: string | null } {
  const remaining = Math.max(0, a.remaining);
  const complete = a.completed || remaining < 0.5;
  const rhythm = cadenceLabel(a);
  if (a.pending) {
    return { detail: "nothing reserved yet", amount: null };
  }
  if (complete) {
    return { detail: `Fully set aside · ${rhythm}`, amount: "£0" };
  }
  return {
    detail: `${fmtC(a.filledThisPeriod)} of ${fmtC(a.amountPerPeriod)} set aside · ${rhythm}`,
    amount: `−${fmtC(remaining)}`,
  };
}
