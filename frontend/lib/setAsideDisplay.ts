// Shared set-aside display hygiene, moved out of the g124-upcoming-refine
// design round's own setAsideHelpers.ts (G131 fold-in, variant A: "today's
// shape, kept, with the typography and truncation fixes applied in
// place") so PlanningPage.tsx and its design preview run the exact same
// logic — the same pattern as lib/upcomingMarkers.ts and lib/cashWalk.ts.
//
// Fixes two raw-data presentation defects Kevin flagged from his own
// screenshots (a bare-number title, e.g. "50"; a shouty bank string
// truncated mid-word, "Fed by INTEREST PAID GROSS FOR PERIOD 3…") as
// PRESENTATION problems only, never by dropping the underlying data or
// inventing a label: a bare-number name still shows, now as a small `#50`
// tag next to a humanised title recovered from the feed match, and the
// original raw string is still available via a `title` attribute on the
// caller's own "Fed by …" line.
//
// Whether set-asides should be user-nameable — the real fix for a bare
// numeric name — is a functionality question Kevin has not decided. That
// stays open; this module ships the hygiene only and invents no fallback
// label for the case it can't help (a bare number with no feed at all).

// A shouty raw bank string is uniformly uppercase throughout, so case alone
// can't tell an acronym (HSBC, ISA) apart from an ordinary word that
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
// falling back to a hard cut when the very first word already overruns the
// budget (nothing else to break on).
function truncateAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > max * 0.4 ? cut.slice(0, lastSpace) : cut;
  return safe.trimEnd() + "…";
}

// A card-like raw descriptor ("AMERICAN EXPRESS 3751-4360-XXXXXX ...")
// collapses to "American Express •• 4360" — brand name plus the one digit
// group a user would actually recognise their card by, rather than
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

// Shape both PlanningPage.tsx (from its real Allocation + Account data) and
// the design preview (from its own fixtures) resolve down to before calling
// these helpers — deliberately NOT the raw API `Allocation` type, so this
// module (and the shared list component built on it,
// components/upcoming/SetAsideList.tsx) don't need the much larger `Account`
// shape just to read a feed label.
export interface SetAsideDisplayInput {
  /** As typed by the user when the set-aside was created — can be a bare number. */
  name: string;
  /** The feed match's own cleaned label (or a manually chosen account name), or
   * null when there's nothing to show (a manual set-aside with no matching rule). */
  feedLabel: string | null;
  amountPerPeriod: number;
  filledThisPeriod: number;
  remaining: number;
  recurrence: "every_period" | "once";
  pending: boolean;
  completed: boolean;
  /** Only meaningful while `pending` — the pay-period start date this
   * set-aside's reserve will begin counting from, already formatted
   * ("5 Oct"). Omit to render the bare "nothing reserved yet" copy (the
   * design round's own fixture never modelled this date). */
  pendingStartsLabel?: string;
}

// A bare-number name ("50") is real data (the user typed it, maybe it's a
// personal reference), so it becomes a small `#50` tag next to a readable
// title derived from the feed match, rather than being hidden. When there's
// no feed to derive a title from either, the bare number is shown exactly
// as before this fix — no fallback label is invented for it.
export function titleFor(a: Pick<SetAsideDisplayInput, "name" | "feedLabel">, maxLen = 30): { primary: string; tag: string | null } {
  if (isBareNumber(a.name)) {
    if (a.feedLabel) return { primary: humanizeRaw(a.feedLabel, maxLen), tag: `#${a.name}` };
    return { primary: a.name, tag: null };
  }
  return { primary: a.name, tag: null };
}

export function fmtC(n: number): string {
  return "£" + Math.round(n).toLocaleString("en-GB");
}

export function cadenceLabel(a: Pick<SetAsideDisplayInput, "recurrence">): string {
  return a.recurrence === "once" ? "this period only" : "every pay period";
}

export function statusFor(a: SetAsideDisplayInput): { detail: string; amount: string | null } {
  const remaining = Math.max(0, a.remaining);
  const complete = a.completed || remaining < 0.5;
  const rhythm = cadenceLabel(a);
  if (a.pending) {
    return {
      detail: a.pendingStartsLabel ? `Starts ${a.pendingStartsLabel} · nothing reserved yet` : "nothing reserved yet",
      amount: null,
    };
  }
  if (complete) {
    return { detail: `Fully set aside · ${rhythm}`, amount: "£0" };
  }
  return {
    detail: `${fmtC(a.filledThisPeriod)} of ${fmtC(a.amountPerPeriod)} set aside · ${rhythm}`,
    amount: `−${fmtC(remaining)}`,
  };
}
