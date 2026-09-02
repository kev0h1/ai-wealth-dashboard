// TEMPORARY PREVIEW FIXTURES — delete with the preview route.
//
// Two distinct provenances, kept genuinely distinct in the data shape, not
// just in copy:
//
//   "user"   rows come from `dismissed_recurring` in preferences — a bare
//            list of series-key strings today, no dismissal date or amount
//            stored. `lastSeen` below stands in for the enrichment a real
//            backend task would compute from transaction history (most
//            recent matching transaction), NOT a dismissal timestamp —
//            deliberately, because the app has no dismissal timestamp to
//            show and shouldn't pretend otherwise (see DismissedRow.lastSeen
//            doc below).
//
//   "engine" rows come from `engine_vetoed_recurring` — the LLM
//            recurring-judge's own vetoes, each with a real reason
//            sentence, confidence and `vetoedAt`, which the engine DOES
//            store, so those rows are allowed to show a real "when".
//
// Reason sentences and keys below are the real examples from tonight's
// incident review, copied verbatim (no em-dashes in the source copy).

export type Provenance = "user" | "engine";
export type Direction = "out" | "in";

export interface DismissedRow {
  key: string;
  displayName: string;
  provenance: Provenance;
  bankKey: string;
  direction: Direction;
  typicalAmount: number;
  /** Set only when the amount genuinely varies transaction to transaction. */
  amountNote?: string;
  cadence: string;
  /**
   * Most recent matching transaction date (ISO). This is enrichment from
   * transaction history, not a dismissal date — the app has no dismissal
   * date to show for user rows. Always present so an unrecognisable raw
   * key still reads as a real, identifiable thing.
   */
  lastSeen: string;
  /** Engine rows only. */
  category?: string;
  reason?: string;
  confidence?: number;
  vetoedAt?: string;
}

export const MIXED_ROWS: DismissedRow[] = [
  {
    key: "VANGUARD ASSET MAN VG10239160010986",
    displayName: "Vanguard",
    provenance: "user",
    bankKey: "BARCLAYS",
    direction: "out",
    typicalAmount: 400,
    cadence: "Monthly",
    lastSeen: "2026-08-01",
  },
  {
    key: "Goldman Sachs",
    displayName: "Goldman Sachs",
    provenance: "user",
    bankKey: "STARLING",
    direction: "out",
    typicalAmount: 250,
    amountNote: "varies, £180 to £310",
    cadence: "Roughly monthly",
    lastSeen: "2026-07-22",
  },
  {
    key: "Midlands Golf Stonebri",
    displayName: "Midlands Golf, Stonebridge",
    provenance: "user",
    bankKey: "MONZO",
    direction: "out",
    typicalAmount: 46.5,
    cadence: "Monthly",
    lastSeen: "2026-08-14",
  },
  {
    key: "FUNDS TRANSFER FEE",
    displayName: "Funds transfer fee",
    provenance: "user",
    bankKey: "BARCLAYS",
    direction: "out",
    typicalAmount: 8.5,
    amountNote: "usually £8 to £25",
    cadence: "Irregular",
    lastSeen: "2026-06-30",
  },
  {
    key: "Interest On Your 5210, INTEREST ON",
    displayName: "Interest on your 5210 account",
    provenance: "user",
    bankKey: "NATIONWIDE",
    direction: "in",
    typicalAmount: 11.4,
    amountNote: "varies, £9 to £14",
    cadence: "Monthly",
    lastSeen: "2026-08-05",
  },
  {
    key: "COMP BAL XFR",
    displayName: "COMP BAL XFR",
    provenance: "engine",
    bankKey: "NATWEST",
    direction: "out",
    typicalAmount: 620,
    amountNote: "varies each time",
    cadence: "No regular pattern",
    lastSeen: "2026-08-20",
    category: "Transfer",
    reason:
      "Multiple transactions on the same date, highly irregular intervals (0, 43, 17 days), and variable amounts on a credit card strongly indicate ad-hoc balance transfers rather than a genuine recurring bill.",
    confidence: 0.84,
    vetoedAt: "2026-08-27",
  },
  {
    key: "Transport for London",
    displayName: "Transport for London",
    provenance: "engine",
    bankKey: "MONZO",
    direction: "out",
    typicalAmount: 4.2,
    amountNote: "£1.75 to £7.95",
    cadence: "No regular pattern",
    lastSeen: "2026-08-19",
    category: "Transport",
    reason:
      "Only three transactions with highly irregular spacing (56 days, then 2 days) and highly variable amounts (£1.75 to £7.95) suggest ad-hoc TfL top-ups or payments rather than a regular bill commitment.",
    confidence: 0.71,
    vetoedAt: "2026-08-26",
  },
  {
    key: "AMERICAN EXPRESS 3766-824849-32000",
    displayName: "American Express 3766-824849-32000",
    provenance: "engine",
    bankKey: "AMEX",
    direction: "out",
    typicalAmount: 874.1,
    amountNote: "£609.20 and £1,138.99",
    cadence: "No regular pattern",
    lastSeen: "2026-08-11",
    category: "Bills",
    reason:
      "Only two occurrences with highly variable amounts (1138.99 and 609.2) and irregular timing suggest ad-hoc manual payments to an American Express card rather than a genuine recurring bill.",
    confidence: 0.79,
    vetoedAt: "2026-08-24",
  },
];

export const SINGLE_ROW: DismissedRow[] = [MIXED_ROWS[0]];

export const EMPTY_ROWS: DismissedRow[] = [];

export type StateKey = "mixed" | "single" | "empty";

export const STATE_ROWS: Record<StateKey, DismissedRow[]> = {
  mixed: MIXED_ROWS,
  single: SINGLE_ROW,
  empty: EMPTY_ROWS,
};

export function formatMoney(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const fixed = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2);
  return `£${fixed}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Verdict-line copy for the page header. Shared across all three variants
 *  so the count/grammar logic lives in exactly one place. */
export function verdictLine(count: number): string {
  if (count === 0) {
    return "Nothing is set aside. Every recurring payment and bill Sorted has spotted is included in your projections.";
  }
  if (count === 1) {
    return "1 payment is set aside, excluded from your projections.";
  }
  return `${count} payments are set aside, excluded from your projections.`;
}

export function formatRelative(iso: string, today: Date = new Date("2026-08-29T09:00:00")): string {
  const d = new Date(iso + "T00:00:00");
  const days = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return formatDate(iso);
}
