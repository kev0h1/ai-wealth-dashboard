// TEMPORARY PREVIEW — delete after design review.
//
// Fixture data for /design/penny-thread — three variants answering one
// tester complaint: "the contrast of the layout for the questions vs the
// answers feels a bit weird, maybe because it's different from the
// chat/messenger type of UX." All three variants render this exact same
// thread so they're directly comparable; only the question/answer
// presentation changes between them (see PennyThreadClient.tsx).
//
// Copy follows the same voice rules as the live surface (CanISection.tsx /
// PennyConversation.tsx): hedge anything naming a future event, never
// promise an external money movement, no em-dashes. Reuses the fixture
// style already approved in ../penny-chat/fixtures.ts.

export type VerdictExchange = {
  kind: "verdict";
  question: string;
  /** Bold 16px verdict line, answer-first, hedged where it names a future event. */
  headline: string;
  /** 2-3 muted 13px grounding facts under the headline. */
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

// Four real exchanges: a comfortable yes, a careful yes with an offer chip,
// a calm bad-news verdict, and a tax explainer. Order matters for the
// pairing-rhythm variants (A/B/C) — this is the sequence a real session
// would actually build up.
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

// A fifth, in-flight turn appended after THREAD so each variant's loading
// affordance is demonstrable without needing an interaction or a screen
// recording. The question is already asked and visible per that variant's
// own pairing convention; only the answer is still pending.
export const PENDING_QUESTION = "Can I get a takeaway tonight?";

export const PREVIEW_NOTE =
  "TEMPORARY PREVIEW, for design review only, delete after a decision is made.";
