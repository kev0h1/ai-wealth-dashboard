// Fixture payload for /design/miscategorised — typed against the REAL
// MiscategorisedItem/MiscategorisedMember shapes exported from
// MiscategorisedReviewSheet.tsx (which mirror api.ts's getMiscategorised()
// return type, itself mirrored field-for-field from
// backend/app/routers/analytics.py's _group_miscategorised). Typing against
// the real interfaces means an accidental payload-shape drift fails
// `tsc --noEmit` here, not silently in production.
//
// `reason` (added alongside the per-row evidence line) is exercised in all
// its real states across A-E below: name match (A), account match resolving
// to a different account than the one shown on the sub-line (B), account
// match resolving to the SAME account already shown (D, the stutter-
// avoidance wording), account match resolving to nothing (E), and no
// `reason` field at all — an older cached payload (C).
//
// This route exists because MiscategorisedReviewSheet.tsx sits behind real
// server-side OAuth and has no other way to be seen before it ships — see
// MiscategorisedClient.tsx for the full rationale.
import type { Account, TransferPairSuggestion } from "@/lib/api";
import type { MiscategorisedItem, MiscategorisedMember } from "@/components/MiscategorisedReviewSheet";

// Drives the "This period"/"Earlier periods" split (?period=split, the
// default) — item dates, newest first: D 08-21, B 08-20, E 08-19, A 08-18,
// C 08-15. A boundary of 19 Aug (inclusive, "on/after") puts D/B/E (3 rows)
// in "This period" and A/C (2 rows) in "Earlier periods" — both groups
// non-empty, so both headers render. Built with Date.UTC, matching how
// SpendPage.tsx's own periodStart state and lib/payPeriod.ts's
// dateToUTCDay both treat a pay-period boundary as UTC midnight, not a
// local instant.
export const PREVIEW_PERIOD_START = new Date(Date.UTC(2026, 7, 19)); // 19 Aug 2026

// Minimal-but-real Account fixtures — realistic UK provider/account names,
// exactly the shape SpendPage.tsx's own `accounts` state carries. Only
// PREVIEW_ACCOUNTS[0] and [1] are ever referenced by a resolvable
// `account_id` below; the rest exist so the list looks like a real linked-
// accounts set, not a two-item stub.
export const PREVIEW_ACCOUNTS: Account[] = [
  {
    id: "acc-barclays-premier",
    name: "Barclays Premier Current Account",
    type: "current",
    balance: 2140.55,
    currency: "GBP",
    provider: "Barclays",
    status: "active",
  },
  {
    id: "acc-monzo-current",
    name: "Monzo Current Account",
    type: "current",
    balance: 412.3,
    currency: "GBP",
    provider: "Monzo",
    status: "active",
  },
  {
    id: "acc-halifax-saver",
    name: "Halifax Reward Saver",
    type: "savings",
    balance: 8900.0,
    currency: "GBP",
    provider: "Halifax",
    status: "active",
  },
  {
    // Deliberately NOT in BANK_META or FINEXER_ALIAS — falls through
    // accountBrand()'s branch 3 (neutral default gradient + initials from
    // the provider string) 100% deterministically, no network favicon call.
    // This gives the /design/miscategorised screenshot both badge paths
    // (Barclays above resolves to a real local logo; this one always
    // renders the initials fallback) without depending on network access.
    id: "acc-chase-everyday",
    name: "Community Everyday Account",
    type: "current",
    balance: 76.12,
    currency: "GBP",
    provider: "Community Credit Union",
    status: "active",
  },
];

// Item D's 20 capped members — a genuinely 24-month standing order, only the
// most recent 20 of which the backend ever returns (members[:20] in
// _group_miscategorised), dated monthly back from 2026-08-21. Written out
// explicitly (not date-math'd at runtime) so the fixture is deterministic
// and the truncation point is easy to eyeball against `first_date` below.
const PAYPAL_MEMBER_DATES = [
  "2026-08-21", "2026-07-21", "2026-06-21", "2026-05-21", "2026-04-21",
  "2026-03-21", "2026-02-21", "2026-01-21", "2025-12-21", "2025-11-21",
  "2025-10-21", "2025-09-21", "2025-08-21", "2025-07-21", "2025-06-21",
  "2025-05-21", "2025-04-21", "2025-03-21", "2025-02-21", "2025-01-21",
];
const PAYPAL_AMOUNTS = [
  60, 58, 55, 52, 50, 48, 47, 46, 45, 46, 48, 50, 52, 55, 58, 60, 58, 55, 52, 50,
];
const paypalMembers: MiscategorisedMember[] = PAYPAL_MEMBER_DATES.map((date, i) => ({
  id: `paypal-member-${i}`,
  date,
  amount: PAYPAL_AMOUNTS[i],
  account_id: "acc-barclays-premier",
  description: "PAYPAL *STANDINGORDER",
  merchant_name: "PayPal Standing Order",
}));

export const PREVIEW_ITEMS: MiscategorisedItem[] = [
  // A — multi-payment series with an amount RANGE, a resolvable account, and
  // a populated members array. Exercises the "−£79 – £110" range formatting
  // (formatWhole) at a 390px viewport next to the payee name and 3× badge.
  {
    id: "series-a-rep",
    ids: ["series-a-1", "series-a-2", "series-a-3"],
    count: 3,
    series_key: "series-range",
    merchant_name: "Barclays Faster Payment",
    description: "FPS TO J MAINGI",
    amount: 79,
    amount_min: 79,
    amount_max: 110,
    date: "2026-08-18",
    first_date: "2026-06-18",
    currency: "GBP",
    category: "Shopping",
    transaction_type: "debit",
    account_id: "acc-barclays-premier",
    // Payee name evidence — "J MAINGI" fuzzy-matches the owner's name
    // tokens server-side (own_transfer_evidence's name branch). Exercises
    // the "The payee name matches yours." reason line.
    reason: { kind: "name" },
    members: [
      { id: "series-a-1", date: "2026-08-18", amount: 79, account_id: "acc-barclays-premier", description: "FPS TO J MAINGI", merchant_name: "Barclays Faster Payment" },
      { id: "series-a-2", date: "2026-07-18", amount: 95, account_id: "acc-barclays-premier", description: "FPS TO J MAINGI", merchant_name: "Barclays Faster Payment" },
      { id: "series-a-3", date: "2026-06-18", amount: 110, account_id: "acc-barclays-premier", description: "FPS TO J MAINGI", merchant_name: "Barclays Faster Payment" },
    ],
  },

  // B — single-payment series, one exact amount, resolvable account.
  // count === 1, so the "see the payments" disclosure correctly never
  // renders even though a 1-entry members array came back from the backend
  // (real payload shape — hasMembers gates on count > 1, not on
  // members.length).
  {
    id: "series-b-rep",
    ids: ["series-b-1"],
    count: 1,
    series_key: "series-single",
    merchant_name: "Wise Transfer",
    description: "WISE *8827 TRANSFER",
    amount: 250,
    amount_min: null,
    amount_max: null,
    date: "2026-08-20",
    first_date: "2026-08-20",
    currency: "GBP",
    category: "Shopping",
    transaction_type: "debit",
    account_id: "acc-monzo-current",
    // Account-number evidence pointing at a DIFFERENT own account than the
    // one this payment left from (the sub-line above reads "Monzo Current
    // Account", the reason resolves to Barclays) — exercises the resolved-
    // account-name reason copy without the same-account stutter case.
    reason: { kind: "account", account_id: "acc-barclays-premier" },
    members: [
      { id: "series-b-1", date: "2026-08-20", amount: 250, account_id: "acc-monzo-current", description: "WISE *8827 TRANSFER", merchant_name: "Wise Transfer" },
    ],
  },

  // C — account_id resolves to NOTHING (an account this fixture's
  // PREVIEW_ACCOUNTS list doesn't carry, e.g. a since-unlinked account) —
  // the graceful-degradation path: no dangling " · " separator on the
  // sub-line. Its two members deliberately split — one resolvable, one not
  // — so the SAME degradation is checked independently inside the expanded
  // members list, not just on the parent row. Also carries no `reason` field
  // at all, simulating a payload cached before that field existed — the
  // evidence line must render nothing (no empty space), not a fallback.
  {
    id: "series-c-rep",
    ids: ["series-c-1", "series-c-2"],
    count: 2,
    series_key: "series-unresolved-account",
    merchant_name: "Virgin Money Transfer",
    description: "VIRGIN MONEY TFR",
    amount: 180,
    amount_min: 150,
    amount_max: 180,
    date: "2026-08-15",
    first_date: "2026-07-15",
    currency: "GBP",
    category: "Shopping",
    transaction_type: "debit",
    account_id: "acc-closed-000", // not in PREVIEW_ACCOUNTS — unresolved by design
    members: [
      { id: "series-c-1", date: "2026-08-15", amount: 180, account_id: "acc-closed-000", description: "VIRGIN MONEY TFR", merchant_name: "Virgin Money Transfer" },
      { id: "series-c-2", date: "2026-07-15", amount: 150, account_id: "acc-halifax-saver", description: "VIRGIN MONEY TFR", merchant_name: "Virgin Money Transfer" },
    ],
  },

  // D — count (24) larger than its members array (20) — the server caps
  // members at 20 while count stays uncapped (_group_miscategorised:
  // `members[:20]`). first_date (2024-09-21) predates the oldest of the 20
  // capped members (2025-01-21) by 4 more monthly payments that genuinely
  // happened but never came back in `members` — exactly the silent-
  // truncation shape the real endpoint can produce.
  {
    id: "series-d-rep",
    ids: paypalMembers.map((m) => m.id).concat(["paypal-member-20", "paypal-member-21", "paypal-member-22", "paypal-member-23"]),
    count: 24,
    series_key: "series-capped",
    merchant_name: "PayPal Standing Order",
    description: "PAYPAL *STANDINGORDER",
    amount: 60,
    amount_min: 45,
    amount_max: 60,
    date: "2026-08-21",
    first_date: "2024-09-21",
    currency: "GBP",
    category: "Subscriptions",
    transaction_type: "debit",
    account_id: "acc-barclays-premier",
    // Account-number evidence pointing at the SAME account already named on
    // the sub-line above (both "acc-barclays-premier") — exercises the
    // same-account stutter-avoidance wording ("the one shown above") rather
    // than repeating "Barclays Premier Current Account" on two adjacent
    // lines.
    reason: { kind: "account", account_id: "acc-barclays-premier" },
    members: paypalMembers,
  },

  // E — a long payee name (no merchant_name — falls back to `description`,
  // the longer of the two real fields) that forces truncation at 390px.
  {
    id: "series-e-rep",
    ids: ["series-e-1"],
    count: 1,
    series_key: "series-long-name",
    merchant_name: null,
    description: "TRANSFER TO MRS J ANNABEL THOMPSON-WHITFIELD JOINT SAVINGS ACCOUNT REF 00293841 STANDING ORDER MONTHLY PAYMENT",
    amount: 500,
    amount_min: null,
    amount_max: null,
    date: "2026-08-19",
    first_date: "2026-08-19",
    currency: "GBP",
    category: "Shopping",
    transaction_type: "debit",
    account_id: "acc-chase-everyday",
    // Account-number evidence pointing at an account that resolves to
    // NOTHING (a since-unlinked account, unrelated to the "acc-chase-
    // everyday" this payment left from) — exercises the "matches one of
    // your accounts" fallback reason copy, distinct from the sub-line above
    // which does resolve.
    reason: { kind: "account", account_id: "acc-closed-000" },
    members: [
      {
        id: "series-e-1",
        date: "2026-08-19",
        amount: 500,
        account_id: "acc-chase-everyday",
        description: "TRANSFER TO MRS J ANNABEL THOMPSON-WHITFIELD JOINT SAVINGS ACCOUNT REF 00293841 STANDING ORDER MONTHLY PAYMENT",
        merchant_name: null,
      },
    ],
  },
];

// Cross-account transfer-pair suggestions — the "POSSIBLY THE SAME TRANSFER"
// section, rendered ABOVE PREVIEW_ITEMS above. Both fixtures reuse
// acc-barclays-premier (resolves a real local logo) and acc-chase-everyday
// (falls through to the initials badge, see that account's own comment
// above) so each pair card exercises both BankBadge paths at once, not just
// across the fixture set.
export const PREVIEW_PAIRS: TransferPairSuggestion[] = [
  // Same-day match — different descriptions on each leg (why Pass 2's
  // byte-identical matcher never caught this one at sync time), same
  // amount, same day, different accounts. Exercises the "on the same day"
  // reason-line wording.
  {
    pair_key: "pair-fixture-a-credit:pair-fixture-a-debit",
    date_diff_days: 0,
    credit: {
      id: "pair-fixture-a-credit",
      account_id: "acc-barclays-premier",
      // Deliberately the exact bug-repro shape (owner device-testing fix 3):
      // a naive datetime string with a midnight time component, exactly how
      // the real API serialises a `date`-typed backend field with
      // `.isoformat()` (see _pair_leg in analytics.py). Before the fix,
      // formatDate's `new Date(dateStr)` parsed this as LOCAL time — on this
      // VPS (Europe/Berlin, a positive UTC offset like the owner's BST)
      // midnight local rolls back to the previous UTC day, so this rendered
      // "19 Aug" instead of "20 Aug". After the fix (dateToUTCDay-based
      // extraction) it renders "20 Aug" regardless of the viewer's timezone.
      date: "2026-08-20T00:00:00",
      amount: 320,
      description: "FASTER PAYMENT RECEIVED REF 4471B",
      merchant_name: null,
      category: "Income",
    },
    debit: {
      id: "pair-fixture-a-debit",
      account_id: "acc-chase-everyday",
      date: "2026-08-20",
      amount: 320,
      description: "TO J MAINGI SAVINGS REF 4471",
      merchant_name: "Business Transfer",
      category: "Shopping",
    },
  },
  // A day apart — exercises the "a day apart" reason-line wording, and a
  // non-integer amount (mono/tabular-nums at a decimal value).
  {
    pair_key: "pair-fixture-b-credit:pair-fixture-b-debit",
    date_diff_days: 1,
    credit: {
      id: "pair-fixture-b-credit",
      account_id: "acc-barclays-premier",
      date: "2026-08-15",
      amount: 95.5,
      description: "INBOUND TRANSFER REF WS2291",
      merchant_name: "Wise Transfer",
      category: "Income",
    },
    debit: {
      id: "pair-fixture-b-debit",
      account_id: "acc-chase-everyday",
      date: "2026-08-14",
      amount: 95.5,
      description: "PAYMENT SENT REF WS2291X",
      merchant_name: null,
      category: "Shopping",
    },
  },
];
