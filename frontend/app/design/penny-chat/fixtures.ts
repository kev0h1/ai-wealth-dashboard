// TEMPORARY PREVIEW — delete after design review.
//
// Fixture data for /design/penny-chat — the "one Penny, three doors, zero
// bubbles" conversation redesign. No live LLM, no auth: every verdict below
// is hand-written copy standing in for what /can-i would return, following
// the same voice rules as the real thing (hedged, answer-first, no em-dashes
// — see DESIGN.md and CanISection.tsx).
//
// Chips are seeded from the owner's own data (never generic examples) to
// demonstrate the personalisation principle: a weekend spend at his usual
// scale, his frequent Padel habit, and his live Japan savings plan.

export const CHIPS = [
  "Can I spend £45 this weekend?",
  "Can I book another Padel session?",
  "Can I put £50 extra toward Japan?",
] as const;

export type QAFixture = {
  question: string;
  /** Bold 16px verdict line — answer-first, hedged where it names a future event. */
  headline: string;
  /** 2-3 muted 13px grounding facts under the headline. */
  facts: string[];
  /** Present only when the verdict hands off to a commitment. */
  offer?: string;
};

// One fixture per CHIPS index (0-2), plus a fourth (index 3) that is NOT a
// visible chip — it's reachable only via the ?open=1&q=3 deep link, kept
// around purely so the calm-bad-news "not comfortably" verdict style is
// still demonstrable in review without forcing a fourth chip into the UI
// (CHIPS stays at 3 visible max). Q0 is a comfortable yes at his usual
// weekend scale, Q1 is a comfortable yes on his frequent Padel habit, Q2 is
// a careful yes-with-an-offer against his live Japan plan, Q3 is the
// calm-bad-news case.
export const QA_FIXTURES: QAFixture[] = [
  {
    question: CHIPS[0],
    headline: "Yes, comfortably. £45 this weekend leaves about £206 spare.",
    facts: [
      "£251 free until Fri 28 Aug",
      "That's still about £20 a day for the rest of the period",
      "No bills land this weekend",
    ],
  },
  {
    question: CHIPS[1],
    headline: "Yes, easily. Around £14 barely dents your £251 spare.",
    facts: [
      "You usually play twice a month at about £14 a session",
      "£251 free until Fri 28 Aug",
    ],
  },
  {
    question: CHIPS[2],
    headline: "Yes, with a little care. £50 extra leaves about £201 for 10 days.",
    facts: [
      "Japan is at £1,240 of £3,000, this would nudge it along",
      "£251 free until Fri 28 Aug",
      "10 days left in this pay period",
    ],
    offer: "Add £50 to Japan this period ›",
  },
  {
    question: "Can I put £150 extra toward Japan this week?",
    headline: "Not comfortably. £150 extra would leave about £101 for 10 days, tighter than your usual pace.",
    facts: [
      "£251 free until Fri 28 Aug",
      "Usual pace is closer to £25 a day, this would push you nearer £10",
      "Waiting until payday keeps Japan on track without the squeeze",
    ],
  },
];

// Free-text fallback — anything typed into the composer that isn't one of
// the fixture questions gets this. Penny's scope is bounded to spending and
// affordability questions grounded in live balances, so an unrelated
// question demonstrates the honest, calm out-of-scope redirect rather than
// pretending to answer it.
export const OUT_OF_SCOPE_FIXTURE: { headline: string; facts: string[] } = {
  headline: "That one's outside what I can work out from your numbers.",
  facts: [
    "I answer spending and affordability questions from your live balances.",
    "For tax questions, the Tax tab has its own chat.",
    "Try: Can I spend £45 this weekend?",
  ],
};

// Scene 1 mock Planning-page context — muted, non-interactive, fixture only.
export const DOOR_CARDS = {
  runway: {
    label: "Before month end",
    amount: "£11",
    sub: "10 days remaining · based on your typical spending",
  },
  japan: {
    label: "Japan",
    sub: "£1,240 of £3,000 · 3 of 7 milestones",
    pct: 41,
  },
};

// Scene 2's condensed structured-cards region — proves the hub keeps its
// cards even with the composer docked below. Non-interactive, fixture only.
export const PENNY_ROWS = [
  "Move £120 to cover Friday's bill",
  "Payday plan · 3 transfers ready for Fri 28 Aug",
];

export const CONTEXT_WHISPER = "£251 free · 10 days left";
