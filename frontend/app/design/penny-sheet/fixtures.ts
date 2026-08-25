// TEMPORARY PREVIEW — delete after design review.
//
// Self-contained fixture copy for /design/penny-sheet. Deliberately NOT
// imported from ../penny-thread/fixtures.ts (this route's grammars must be
// self-contained inside their own directory) but reuses the exact same
// four exchanges and voice so the two previews stay comparable: a
// comfortable yes, a careful yes with an offer chip, a calm bad-news
// verdict, and a tax explainer (markdown body, quiet eyebrow, no bold
// verdict headline).
//
// Copy rules match the live surface (CanISection.tsx / PennyConversation.tsx):
// hedge anything naming a future event, never promise an external money
// movement, no em-dashes anywhere.

export type VerdictExchange = {
  kind: "verdict";
  question: string;
  /** Bold verdict line, answer-first, hedged where it names a future event. */
  headline: string;
  /** 2-3 muted grounding facts under the headline. */
  facts: string[];
  /** Present only on the careful-yes exchange, where the verdict hands off to a commitment. */
  offer?: string;
};

export type TaxExchange = {
  kind: "tax";
  question: string;
  /** Markdown body, no bold verdict headline, quiet TAX eyebrow instead. */
  body: string;
};

export type Exchange = VerdictExchange | TaxExchange;

/** One thread item as rendered in the sheet: a resolved exchange (verdict
 * or tax) or a still-loading turn. `id` is stable and assigned once, never
 * recomputed from array index (matches PennyConversation.tsx's own
 * reasoning for keying by id rather than index on a growing thread). */
export type ThreadItem =
  | (VerdictExchange & { id: number })
  | (TaxExchange & { id: number })
  | { id: number; kind: "pending"; question: string };

// Four real exchanges, in the order a real session would actually build up.
export const THREAD: Exchange[] = [
  {
    kind: "verdict",
    question: "Can I spend £45 this weekend?",
    headline: "Yes, comfortably. £45 this weekend leaves about £206 spare.",
    facts: [
      "£251 free until Fri 28 Aug",
      "That's still about £20 a day for the rest of the period",
      "No bills land this weekend",
    ],
  },
  {
    kind: "verdict",
    question: "Can I put £50 extra toward Japan this month?",
    headline: "Yes, with a little care. £50 extra leaves about £201 for 10 days.",
    facts: [
      "Japan is at £1,240 of £3,000, this would nudge it along",
      "£251 free until Fri 28 Aug",
      "10 days left in this pay period",
    ],
    offer: "Add £50 to Japan this period ›",
  },
  {
    kind: "verdict",
    question: "Can I put £150 extra toward Japan this week instead?",
    headline: "Not comfortably. £150 extra would leave about £101 for 10 days, tighter than your usual pace.",
    facts: [
      "£251 free until Fri 28 Aug",
      "Usual pace is closer to £25 a day, this would push you nearer £10",
      "Waiting until payday keeps Japan on track without the squeeze",
    ],
  },
  {
    kind: "tax",
    question: "How does pension carry-forward work?",
    body:
      "Carry-forward lets you use unused annual allowance from the previous three tax years, on top of this year's.\n\n" +
      "- You need to have been a member of a registered pension scheme in each of those years\n" +
      "- This year's allowance is used first, then the earliest unused year\n" +
      "- Tapering can reduce the allowance available to higher earners\n\n" +
      "This is general information, not a read on your own pot.",
  },
];

// A fifth, in-flight turn so each grammar's loading affordance is visible
// without tapping anything. The question is already asked and visible; only
// the answer is still pending, and it stays that way (this fixture item is
// never auto-resolved), same convention as /design/penny-thread.
export const PENDING_QUESTION = "Can I get a takeaway tonight?";

export const PREVIEW_NOTE =
  "TEMPORARY PREVIEW, for design review only, delete after a decision is made.";

/** Builds the initial thread state: the four resolved exchanges plus the
 * permanently-pending fifth turn, each tagged with a stable id. */
export function buildInitialThread(): ThreadItem[] {
  return [
    ...THREAD.map((ex, i) => ({ ...ex, id: i })),
    { id: THREAD.length, kind: "pending" as const, question: PENDING_QUESTION },
  ];
}

/** Canned reply for anything typed into the live composer beyond the fixed
 * fixture thread. Purely local, no network call, this is a design preview.
 * Hedged, no promise of a real money movement, no em-dashes. */
export function cannedReply(question: string): VerdictExchange {
  return {
    kind: "verdict",
    question,
    headline: "Noted. This preview doesn't run your real numbers yet.",
    facts: [
      "In the live surface this would check today's balance and pace before answering",
      "This is a design preview, not a live calculation",
    ],
  };
}
