// Fixture payloads for /design/insights-live — one SavingsInsight per
// `state`, shaped field-for-field like the real GET /savings-insights
// serializer output (backend/app/routers/savings_insights.py,
// `_serialize_insight`).
//
// OWNER DECISION (2026-09-01, verbatim, REVERSING the pull model on cost
// grounds): "this pattern would mean that users would do a lot of searches
// which mean tavily calls would be high, I think the app should be
// responsible for the refreshes, but it should indicate an expiry on the
// offers perhaps a ttl on the entry, these should come on a weekly basis".
// Every category is weekly-push now (CATEGORY_LIFECYCLE), the live "Find me
// alternatives" tap and its research_pull/research_fresh fields are
// retired, and every researched entry carries a displayed
// content_valid_until (see `_compute_content_valid_until`) plus a
// server-composed `expiry_line`. `push_stale` folds into `quiet` — every
// category ages out the same TTL-driven way now, so the fixture set below
// is reshaped: two `fresh` variants show the two `expiry_line` wordings
// (claim-governed vs. default-TTL), and `quiet` gains an explicit
// "was fresh, now expired" fixture alongside the original "never
// researched" one — the fixtures ResearchTap used to justify (car_finance/
// groceries/gym/subscriptions = quiet, mobile/mortgage/energy = fresh,
// eating_out = substituted, all captured live 2026-09-01) are kept where
// their shape still applies, updated to the new field contract.
//
// OWNER RULING (2026-09-02, verbatim: "what's the point of these cards if
// there is nothing, and we shouldn't show the cadence of the refresh") —
// two follow-on changes to this fixture set:
// 1. `expiry_line`'s wording lost every "weekly"/"refreshes" word — see
//    FRESH_WEEKLY below (was "Refreshes weekly · researched 2d ago", now
//    "Researched 2d ago").
// 2. `quiet_recent_researched` is a NEW fixture (item 2c of the ruling: "the
//    twin's quiet fixtures actually cover researched_at recent + content
//    empty" — this is the exact shape that kept escaping). Captured
//    verbatim, live, from GET /savings-insights for
//    kevin.maingi12@gmail.com/subscriptions on 2026-09-02: the doc DOES
//    carry real title/body in storage from a successful pass the evening
//    before (refreshed_at 2026-09-01T18:25), but that pass never stamped a
//    `content_valid_until` (a legacy-shape doc predating the TTL field —
//    see `_regen_reason`'s "ttl" branch, `not content_valid_until` fires
//    unconditionally), so `_derive_insight_state` correctly resolves
//    "quiet" and the serializer correctly nulls title/body/researched_at on
//    THIS read — differs from `QUIET_EXPIRED` below (refreshed_at over a
//    week old, unambiguously stale) precisely in HOW recent refreshed_at
//    is, which is exactly the detail a reviewer's eye slides past.
//
// This is the STANDING design twin for Insights (not a one-off preview):
// it renders the REAL exported components from InsightsPage.tsx
// (InsightCard, CompactInsightRow, InsightsHero, isCompactPullInsight) — no
// forked/redrawn card markup — so a future state-machine change either
// keeps behaving correctly here or breaks visibly here, instead of only
// surfacing on a phone screenshot three rounds later.
import type { SavingsInsight, MoneyShape, MoneyShapePeriodEntry, MoneyShapeAverageEntry } from "@/lib/api";

export type FixtureKey =
  | "fresh_weekly"
  | "fresh_claim"
  | "quiet_never_researched"
  | "quiet_expired"
  | "quiet_recent_researched"
  | "substituted"
  | "verified"
  | "is_new";

export const FIXTURE_LABELS: Record<FixtureKey, string> = {
  fresh_weekly: "fresh — generic content, default 7d TTL",
  fresh_claim: "fresh — dated offer, claim governs the TTL",
  quiet_never_researched: "quiet — never researched (car_finance)",
  quiet_expired: "quiet — TTL expired since last weekly pass (groceries)",
  quiet_recent_researched: "quiet — refreshed_at is TODAY, content still empty (subscriptions, live 2026-09-02)",
  substituted: "substituted",
  verified: "verified",
  is_new: "contentless + is_new:true -> still compact (the invariant)",
};

// fresh — generic researched content on the DEFAULT 7-day TTL (no dated
// claim in the body), captured-live shape (mobile), updated for the
// content_valid_until/expiry_line contract. researched_at is 2 days before
// content_valid_until's 7-day window closes, matching the exact wording the
// backend produces for this shape (see `_expiry_line` in
// savings_insights.py). expiry_line's wording itself was cut down 2026-09-02
// (OWNER RULING: no cadence/"weekly" wording anywhere user-facing) from
// "Refreshes weekly · researched 2d ago" to the honest age stamp alone,
// "Researched 2d ago".
const FRESH_WEEKLY: SavingsInsight = {
  id: "mobile-dd836d89",
  category: "mobile",
  icon: "📱",
  label: "Mobile",
  title: "You pay EE £57/mo, SIM-only could cut that sharply",
  body: "The cheapest SIM only deal right now is 20GB for £6/month from iD Mobile (new customers only). Even Asda Mobile and Lebara offer 3-5GB for £5/month, which could save you ~£52/month compared to your current EE spend.",
  savings_estimate: "~£52/mo",
  savings_estimate_monthly: 52.0,
  pinned: false,
  is_new: false,
  refreshed_at: "2026-09-01T05:25:44.298000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  substituted_line: null,
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: "2026-09-08T05:25:44.298000Z",
  expiry_line: "Researched 2d ago",
  state: "fresh",
  researched_at: "2026-08-30T05:25:44.298000Z",
  triggered_by: [
    { merchant_key: "ee", display_name: "Ee", monthly_amount: 56.64, occurrences: 5, is_recurring: true },
    { merchant_key: "lycamobile", display_name: "Lycamobile", monthly_amount: 5.0, occurrences: 3, is_recurring: false },
  ],
  user_context: null,
  has_workflow: true,
  app_route: "/transactions?category=Bills&merchants=Ee,Lycamobile",
};

// fresh — a real, dated offer whose OWN deadline is sooner than the default
// 7-day TTL, so claim_valid_until governs content_valid_until (see
// `_compute_content_valid_until`) and `expiry_line` states the exact date
// instead of the generic "refreshes weekly" framing.
const FRESH_CLAIM: SavingsInsight = {
  id: "subscriptions-a1b2c3d4",
  category: "subscriptions",
  icon: "🔁",
  label: "Subscriptions",
  title: "Now TV's Entertainment Membership offer ends this week",
  body: "Now TV is running a 50% off Entertainment Membership offer for new sign-ups, down from £9.99 to £4.99/mo for the first 3 months.",
  savings_estimate: "~£5/mo",
  savings_estimate_monthly: 5.0,
  pinned: false,
  is_new: true,
  refreshed_at: "2026-09-02T09:00:00.000000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  substituted_line: null,
  deadline_at: null,
  claim_valid_until: "2026-09-07T23:59:59.000000Z",
  content_valid_until: "2026-09-07T23:59:59.000000Z",
  expiry_line: "Valid until Mon 7 Sep",
  state: "fresh",
  researched_at: "2026-09-02T09:00:00.000000Z",
  triggered_by: [
    { merchant_key: "netflix", display_name: "Netflix", monthly_amount: 12.99, occurrences: 6, is_recurring: true },
  ],
  user_context: null,
  has_workflow: true,
  app_route: "/transactions?category=Subscriptions&merchants=Netflix",
};

// quiet — car_finance, captured live 2026-09-01 (is_new: false, state:
// "quiet"). Never researched at all — content_valid_until/researched_at
// both null. This is exactly the payload the owner's phone received while
// rendering a full hollow card instead of a compact row.
const QUIET_NEVER_RESEARCHED: SavingsInsight = {
  id: "car_finance-dd836d89",
  category: "car_finance",
  icon: "🚗",
  label: "Car Finance",
  title: "",
  body: "",
  savings_estimate: null,
  savings_estimate_monthly: null,
  pinned: false,
  is_new: false,
  refreshed_at: "2026-09-01T06:00:38.000000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  substituted_line: null,
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: null,
  expiry_line: null,
  state: "quiet",
  researched_at: null,
  triggered_by: [
    { merchant_key: "black horse", display_name: "Black Horse", monthly_amount: 289.0, occurrences: 1, is_recurring: true },
  ],
  user_context: null,
  has_workflow: true,
  app_route: "/transactions?merchants=Black%20Horse",
};

// quiet — groceries, TTL EXPIRED since the last weekly pass (the new
// between-refreshes state the 2026-09-01 reversal introduces): this doc DID
// carry real researched content as recently as a week ago, but its
// content_valid_until has since passed and no new weekly pass has run yet,
// so the server correctly nulls title/body/savings_estimate/
// content_valid_until/expiry_line on THIS read — same wire shape as
// "never researched" (the API never exposes stale prose, even briefly), but
// the underlying cause is different: this is the reversal's headline
// behaviour ("expired content retires visibly until the next weekly pass"),
// not a first-run gap. Visually renders identically to
// QUIET_NEVER_RESEARCHED — that's the point: the compact row is honest
// either way, with no "why" the user needs to reason about.
const QUIET_EXPIRED: SavingsInsight = {
  id: "groceries-dd836d89",
  category: "groceries",
  icon: "🛒",
  label: "Groceries",
  title: "",
  body: "",
  savings_estimate: null,
  savings_estimate_monthly: null,
  pinned: false,
  is_new: false,
  refreshed_at: "2026-08-25T06:00:41.921000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  substituted_line: null,
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: null,
  expiry_line: null,
  state: "quiet",
  researched_at: null,
  triggered_by: [
    { merchant_key: "sainsburys supermarket birmin", display_name: "Sainsburys Supermarket Birmin", monthly_amount: 78.18, occurrences: 6, is_recurring: false },
    { merchant_key: "morrisons", display_name: "Morrisons", monthly_amount: 20.99, occurrences: 3, is_recurring: false },
    { merchant_key: "asda", display_name: "Asda", monthly_amount: 20.95, occurrences: 1, is_recurring: false },
    { merchant_key: "asda stores sutton coldfiel", display_name: "Asda Stores Sutton Coldfiel", monthly_amount: 17.3, occurrences: 1, is_recurring: false },
  ],
  user_context: null,
  has_workflow: true,
  app_route: "/transactions?category=Groceries&merchants=Sainsburys%20Supermarket%20Birmin,Morrisons,Asda",
};

// quiet — subscriptions, refreshed_at is TODAY, content still empty. THE
// EXACT LIVE SHAPE THAT KEEPS ESCAPING (OWNER RULING 2026-09-02 item 2c) —
// captured verbatim from GET /savings-insights,
// kevin.maingi12@gmail.com/subscriptions, 2026-09-02: a real generation pass
// succeeded the evening before (refreshed_at 2026-09-01T18:25) and wrote
// real title/body to storage, but that write predates the
// content_valid_until field (a legacy-shape doc, see `_regen_reason`'s "ttl"
// branch: `not content_valid_until` fires unconditionally for it), so
// `_derive_insight_state` correctly resolves "quiet" and the serializer
// correctly nulls title/body/researched_at on every read since — same wire
// shape as QUIET_NEVER_RESEARCHED/QUIET_EXPIRED (the API never exposes
// stale prose), but distinguished from both by `refreshed_at`: hours old
// here, not "never" (car_finance) or a week-plus stale (groceries). That
// distinction is invisible in the served payload — title/body are "" either
// way — which is exactly why a reviewer's eye slides past it; the fixture
// exists so this specific shape renders in pixels every time this page is
// touched, not just the two "obviously quiet" shapes either side of it.
const QUIET_RECENT_RESEARCHED: SavingsInsight = {
  id: "subscriptions-dd836d89",
  category: "subscriptions",
  icon: "📺",
  label: "Subscriptions",
  title: "",
  body: "",
  savings_estimate: null,
  savings_estimate_monthly: null,
  pinned: false,
  is_new: false,
  refreshed_at: "2026-09-01T18:25:15.060000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  substituted_line: null,
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: null,
  expiry_line: null,
  state: "quiet",
  researched_at: null,
  triggered_by: [
    { merchant_key: "amazon prime", display_name: "Amazon Prime", monthly_amount: 8.99, occurrences: 3, is_recurring: false },
    { merchant_key: "netflix.com", display_name: "Netflix.Com", monthly_amount: 12.99, occurrences: 2, is_recurring: true },
  ],
  user_context: null,
  has_workflow: true,
  app_route: "/transactions?category=Subscriptions&merchants=Amazon%20Prime,Netflix.Com",
};

// substituted — eating_out/Nandos, captured live 2026-09-01, verbatim,
// updated for the content_valid_until/expiry_line contract (both null —
// Zone 2 never renders once resolved).
const SUBSTITUTED: SavingsInsight = {
  id: "eating_out-dd836d89",
  category: "eating_out",
  icon: "🍽️",
  label: "Eating Out",
  title: "",
  body: "",
  savings_estimate: null,
  savings_estimate_monthly: null,
  pinned: false,
  is_new: false,
  refreshed_at: "2026-09-01T06:00:46.652000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: true,
  substituted_merchant: "Nandos",
  substituted_amount: 49.1,
  substituted_line: "Payments to Nandos stopped, but Eating Out overall hasn't moved. Worth a look at where it went.",
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: null,
  expiry_line: null,
  state: "substituted",
  researched_at: null,
  triggered_by: [
    { merchant_key: "nandos", display_name: "Nandos", monthly_amount: 49.1, occurrences: 4, is_recurring: false },
    { merchant_key: "wagamama", display_name: "Wagamama", monthly_amount: 17.4, occurrences: 1, is_recurring: false },
    { merchant_key: "mcdonalds", display_name: "Mcdonalds", monthly_amount: 14.29, occurrences: 5, is_recurring: false },
    { merchant_key: "costa coffee", display_name: "Costa Coffee", monthly_amount: 2.08, occurrences: 1, is_recurring: false },
  ],
  user_context: null,
  has_workflow: true,
  app_route: "/transactions?category=Eating%20Out&merchants=Nandos,Wagamama,Mcdonalds",
};

// verified — a genuine, bank-confirmed saving, "earned" tier (confirmed
// engagement before it verified). Shape mirrors _serialize_insight's
// verified branch exactly (verified_savings/verified_merchant/
// verified_tier/verified_savings_line all set, title/body nulled since
// Zone 2 never renders once resolved).
const VERIFIED: SavingsInsight = {
  id: "subscriptions-dd836d89",
  category: "subscriptions",
  icon: "🔁",
  label: "Subscriptions",
  title: "",
  body: "",
  savings_estimate: null,
  savings_estimate_monthly: null,
  pinned: false,
  is_new: false,
  refreshed_at: "2026-08-30T09:12:00.000000Z",
  return_reason: null,
  verified_savings: 11.99,
  verified_merchant: "Now Tv",
  verified_tier: "earned",
  verified_savings_line: "You cancelled Now Tv, £11.99/mo back in your pocket.",
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  substituted_line: null,
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: null,
  expiry_line: null,
  state: "verified",
  researched_at: null,
  triggered_by: [],
  user_context: null,
  has_workflow: true,
  app_route: "/transactions?category=Subscriptions",
};

// contentless + is_new:true — THE INVARIANT fixture (owner phone report
// 2026-09-01, the SAME-DAY follow-up to the fix that originally shipped
// this fixture: "whenever you do your fix the ones that didn't have
// content now have content and the one that did didn't ... should we
// render a card if there is no content" — answer: no, never, no override).
// A brand-new insight with real content DOES earn a full card (see
// FRESH_CLAIM above, is_new: true there, state: "fresh" — also renders
// full, correctly, on content). But a brand-new insight with NOTHING
// researched yet — this fixture, gym, title/body both "" — must render
// COMPACT regardless of is_new. `isCompactPullInsight` no longer even reads
// `insight.is_new`; `state` alone decides, and the backend's own invariant
// (see `_derive_insight_state` / `_serialize_insight` in
// savings_insights.py) guarantees `state` can never be "fresh" without real
// content. The row still gets a subtle indigo dot (see CompactInsightRow)
// so "new" isn't lost entirely — it just no longer buys a full, empty card.
const IS_NEW: SavingsInsight = {
  id: "gym-dd836d89",
  category: "gym",
  icon: "🏋️",
  label: "Gym",
  title: "",
  body: "",
  savings_estimate: null,
  savings_estimate_monthly: null,
  pinned: false,
  is_new: true,
  refreshed_at: "2026-09-01T14:50:00.000000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  substituted_line: null,
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: null,
  expiry_line: null,
  state: "quiet",
  researched_at: null,
  triggered_by: [
    { merchant_key: "puregym", display_name: "Puregym", monthly_amount: 24.99, occurrences: 1, is_recurring: true },
  ],
  user_context: null,
  has_workflow: true,
  app_route: "/transactions?merchants=Puregym",
};

export const INSIGHT_FIXTURES: Record<FixtureKey, SavingsInsight> = {
  fresh_weekly: FRESH_WEEKLY,
  fresh_claim: FRESH_CLAIM,
  quiet_never_researched: QUIET_NEVER_RESEARCHED,
  quiet_expired: QUIET_EXPIRED,
  quiet_recent_researched: QUIET_RECENT_RESEARCHED,
  substituted: SUBSTITUTED,
  verified: VERIFIED,
  is_new: IS_NEW,
};

export const FIXTURE_ORDER: FixtureKey[] = [
  "fresh_weekly", "fresh_claim", "quiet_never_researched", "quiet_expired", "quiet_recent_researched",
  "substituted", "verified", "is_new",
];

// ── Money shape fixtures (GET /money-shape) ─────────────────────────────
// Added for the Insights redesign (2026-09-02) so MoneyShapeHero and
// WhatWorksCard — the two real components those files export — get the
// same standing, auth-exempt design-twin treatment as the SavingsInsight
// fixtures above, rather than only ever being checked against
// /design/insights-shape's static (pre-API) wireframe fixtures. Shaped
// field-for-field like shared/src/types.ts's MoneyShape contract; every
// state WhatWorksCard's consent logic can be in gets its own key so a
// future change to that branching either keeps behaving correctly here or
// breaks visibly here.
//
// CORRECTNESS INSTRUMENT — every verdict / trend_line / what_works.headline
// / proposal string below is NOT free text: it's built from the exact
// deterministic templates in backend/app/services/money_shape.py
// (verdict_for, trend_line_for, evaluate_patterns, proposal_for). This
// twin is only useful as a check on the real page if it can only ever
// render what the backend can actually emit — if the two drift apart this
// stops catching anything. Update this file and money_shape.py together;
// if a template there changes, the copy here must change to match:
//   verdict (overspent):  "Of every £100 you take home, £{fixed_share} was
//     spoken for before you chose anything, and spending went £{overspent}
//     past what came in." (fixed_share computed over fixed+free+moved only)
//   verdict (normal):     "Of every £100 you take home, £{fixed} is spoken
//     for before you choose anything. £{free} is yours to spend freely."
//   trend_line:            "Fixed share is up|down {N} points over
//     {three|four|five|six} pay periods." or, when |delta| < 3, "Fixed
//     share has held steady over {word} pay periods."
//   what_works.headline:
//     early_saving — "Pay periods where you moved money to savings in the
//       first week ended with cash left over {k} times out of {hit_n}."
//       (flag_labels: hit "early", miss "late")
//     calm_start   — "Pay periods that started calm, under £{threshold} of
//       free spending in the first three days, ended with cash left over
//       {k} times out of {hit_n}." (flag_labels: hit "calm", miss "fast")
//     thin         — "Not enough history yet."
//     no_pattern   — "No clear pattern yet across {n} pay periods."
//   proposal (only when state "ok", pattern_id early_saving or calm_start,
//   AND trait.choice === "change" — proposal_for's Consent Rule, silence on
//   keep/no-choice):
//     early_saving — headline "Move your payday transfer to the first
//       week?", body "Your early periods ended with cash left over more
//       often. Penny can help you set this up in Planning, you approve
//       before anything moves.", penny_ask "Help me move my regular
//       savings transfer to the first week of my pay period".
//     calm_start   — headline "Give the first three days a number?", body
//       "Your calm starts ended with cash left over more often. Penny can
//       help you set a first-week allocation in Planning, you approve
//       before anything moves.", penny_ask "Help me set an allocation for
//       the first week of my pay period".
export type MoneyShapeFixtureKey = "ok_change" | "ok_keep" | "ok_nochoice" | "no_pattern" | "thin" | "overspent";

export const MONEY_SHAPE_LABELS: Record<MoneyShapeFixtureKey, string> = {
  ok_change: "ok — early_saving trait \"change\" (live proposal, \"Propose in Planning\")",
  ok_keep: "ok — early_saving trait \"keep\" (\"Kept\" celebration, no proposal)",
  ok_nochoice: "ok — early_saving trait undecided (\"choose keep or change in your Mirror\")",
  no_pattern: "ok hero, what_works has no established pattern yet",
  thin: "thin — not enough pay-period history for either card",
  overspent: "ok — spend exceeded take-home, calm_start trait \"change\" (\"Beyond take-home\", no red)",
};

export const MONEY_SHAPE_ORDER: MoneyShapeFixtureKey[] = [
  "ok_change", "ok_keep", "ok_nochoice", "no_pattern", "thin", "overspent",
];

// Exact percentages by construction (2074/3400=61%, 340/3400=10%,
// 816/3400=24%, 170/3400=5% — no largest-remainder apportionment needed to
// verify by eye) so verdict_for's fixed/free shares below are checkable at
// a glance: fixed 61, free 24.
// `categories`/`txn_type` mirror the backend fields in progress (2026-09-02,
// Kevin's phone feedback: job rows should link to the real transactions
// behind them, not jump to Planning — see MoneyShapeHero.tsx's `jobHref`).
// Category names are the app's display-form category strings (matches the
// convention already used in SavingsInsight.app_route elsewhere in this
// codebase, e.g. "/transactions?category=Bills&merchants=Ee,Lycamobile" —
// capitalised display names, not the lowercase insight.category keys).
// Shared across BASE_JOBS_OK and every one of ok_change's 8 periods/2
// averages below (2026-09-02, Kevin's redirect: "select a pay period ...
// or specify an average ... on the main card") so the same categories
// apply regardless of which period/average is selected — a real backend
// payload's categories can genuinely vary period to period, but the twin
// only needs to exercise MoneyShapeHero's link-building logic, not model
// that variation.
const FIXED_CATEGORIES = ["Bills", "Rent", "Debt Repayment"];
const MOVED_CATEGORIES = ["Savings", "Investment"];
const FREE_CATEGORIES = ["Groceries", "Eating Out", "Shopping", "Entertainment"];
const LEFT_CATEGORIES = ["Income"];

function buildJobs(
  fixed: { amount: number; share: number },
  moved: { amount: number; share: number },
  free: { amount: number; share: number },
  left: { amount: number; share: number }
) {
  return [
    { id: "fixed" as const, label: "Fixed (bills, debt, rent)", amount: fixed.amount, share: fixed.share, categories: FIXED_CATEGORIES, txn_type: "debit" as const },
    { id: "moved" as const, label: "Moved to savings", amount: moved.amount, share: moved.share, categories: MOVED_CATEGORIES, txn_type: "debit" as const },
    { id: "free" as const, label: "Free spending", amount: free.amount, share: free.share, categories: FREE_CATEGORIES, txn_type: "debit" as const },
    { id: "left" as const, label: "Left over", amount: left.amount, share: left.share, categories: LEFT_CATEGORIES, txn_type: "credit" as const },
  ];
}

const BASE_JOBS_OK = buildJobs(
  { amount: 2074, share: 61 },
  { amount: 340, share: 10 },
  { amount: 816, share: 24 },
  { amount: 170, share: 5 }
);

// delta = 61 - 57 = 4 (>= 3) → trend_line_for: "Fixed share is up 4 points
// over six pay periods."
const BASE_TREND = {
  periods: ["Mar", "Apr", "May", "Jun", "Jul", "Aug"],
  fixed: [57, 58, 59, 60, 60, 61],
  moved: [8, 8, 9, 10, 10, 10],
  free: [29, 28, 27, 25, 25, 24],
  left: [6, 6, 5, 5, 5, 5],
};

// early_saving evidence: hits = [Mar, Apr, May, Jul, Aug] (5), of which
// left_over > 0 for Mar/Apr/May/Aug (4) and NOT for Jul (-18) — k=4,
// hit_n=5, matching evaluate_patterns' early_saving headline template
// below exactly ("...4 times out of 5."). Jun is the lone "late" miss.
const BASE_EVIDENCE = [
  { period: "Mar", flag: "hit" as const, left_over: 212 },
  { period: "Apr", flag: "hit" as const, left_over: 68 },
  { period: "May", flag: "hit" as const, left_over: 95 },
  { period: "Jun", flag: "miss" as const, left_over: -40 },
  { period: "Jul", flag: "hit" as const, left_over: -18 },
  { period: "Aug", flag: "hit" as const, left_over: 170 },
];

// 8 recent pay periods (newest first, per the contract) for ok_change's
// period picker (Kevin's redirect 2026-09-02: "select a pay period and it
// gives the breakdown ... on the main card, not additional cards").
// idx0 mirrors this fixture's own top-level period/take_home/jobs/verdict
// exactly, so scope {kind:"period", index:0} reads identically to the old
// no-picker render. take_home held flat at 3400 across all 8 (a realistic
// salaried case); fixed share drifts down 61→55 going back in time,
// mirroring BASE_TREND's own 57→61 six-point climb one point further back
// on each end. Every period reuses FIXED/MOVED/FREE/LEFT_CATEGORIES (see
// buildJobs above) — a real payload's categories can vary period to
// period, this twin only needs to exercise the link-building logic.
const OK_CHANGE_PERIODS: MoneyShapePeriodEntry[] = [
  {
    start: "2026-07-28", end: "2026-08-27", label: "28 Jul to 27 Aug",
    take_home: 3400, overspent: 0,
    jobs: buildJobs({ amount: 2074, share: 61 }, { amount: 340, share: 10 }, { amount: 816, share: 24 }, { amount: 170, share: 5 }),
    verdict: "Of every £100 you take home, £61 is spoken for before you choose anything. £24 is yours to spend freely.",
  },
  {
    start: "2026-06-28", end: "2026-07-27", label: "28 Jun to 27 Jul",
    take_home: 3400, overspent: 0,
    jobs: buildJobs({ amount: 2040, share: 60 }, { amount: 340, share: 10 }, { amount: 850, share: 25 }, { amount: 170, share: 5 }),
    verdict: "Of every £100 you take home, £60 is spoken for before you choose anything. £25 is yours to spend freely.",
  },
  {
    start: "2026-05-28", end: "2026-06-27", label: "28 May to 27 Jun",
    take_home: 3400, overspent: 0,
    jobs: buildJobs({ amount: 2040, share: 60 }, { amount: 306, share: 9 }, { amount: 884, share: 26 }, { amount: 170, share: 5 }),
    verdict: "Of every £100 you take home, £60 is spoken for before you choose anything. £26 is yours to spend freely.",
  },
  {
    start: "2026-04-28", end: "2026-05-27", label: "28 Apr to 27 May",
    take_home: 3400, overspent: 0,
    jobs: buildJobs({ amount: 2006, share: 59 }, { amount: 306, share: 9 }, { amount: 918, share: 27 }, { amount: 170, share: 5 }),
    verdict: "Of every £100 you take home, £59 is spoken for before you choose anything. £27 is yours to spend freely.",
  },
  {
    start: "2026-03-28", end: "2026-04-27", label: "28 Mar to 27 Apr",
    take_home: 3400, overspent: 0,
    jobs: buildJobs({ amount: 1972, share: 58 }, { amount: 306, share: 9 }, { amount: 952, share: 28 }, { amount: 170, share: 5 }),
    verdict: "Of every £100 you take home, £58 is spoken for before you choose anything. £28 is yours to spend freely.",
  },
  {
    start: "2026-02-28", end: "2026-03-27", label: "28 Feb to 27 Mar",
    take_home: 3400, overspent: 0,
    jobs: buildJobs({ amount: 1938, share: 57 }, { amount: 272, share: 8 }, { amount: 1020, share: 30 }, { amount: 170, share: 5 }),
    verdict: "Of every £100 you take home, £57 is spoken for before you choose anything. £30 is yours to spend freely.",
  },
  {
    start: "2026-01-28", end: "2026-02-27", label: "28 Jan to 27 Feb",
    take_home: 3400, overspent: 0,
    jobs: buildJobs({ amount: 1904, share: 56 }, { amount: 272, share: 8 }, { amount: 1054, share: 31 }, { amount: 170, share: 5 }),
    verdict: "Of every £100 you take home, £56 is spoken for before you choose anything. £31 is yours to spend freely.",
  },
  {
    start: "2025-12-28", end: "2026-01-27", label: "28 Dec to 27 Jan",
    take_home: 3400, overspent: 0,
    jobs: buildJobs({ amount: 1870, share: 55 }, { amount: 272, share: 8 }, { amount: 1088, share: 32 }, { amount: 170, share: 5 }),
    verdict: "Of every £100 you take home, £55 is spoken for before you choose anything. £32 is yours to spend freely.",
  },
];

// Averages over the 3 most recent (Jun-Aug) and 6 most recent (Mar-Aug) of
// the periods above — means computed by hand from OK_CHANGE_PERIODS'
// jobs amounts (a real backend computes these server-side; this twin
// hand-derives them once so the numbers stay internally consistent with
// the periods list above rather than being invented separately). Verdict
// strings use the backend's own averaged-window template (distinct from
// the single-period verdict_for): "Over the last {k} pay periods, £{fixed}
// of every £100 you took home was spoken for before you chose anything.
// £{free} was yours to spend freely."
const OK_CHANGE_AVERAGES: MoneyShapeAverageEntry[] = [
  {
    months: 3, period_count: 3,
    start: "2026-05-28", end: "2026-08-27",
    take_home: 3400, overspent: 0,
    // fixed mean (2074+2040+2040)/3=2051 (60%), moved (340+340+306)/3=329
    // (10%), free (816+850+884)/3=850 (25%), left 170 (5%) — sums to 3400/100.
    jobs: buildJobs({ amount: 2051, share: 60 }, { amount: 329, share: 10 }, { amount: 850, share: 25 }, { amount: 170, share: 5 }),
    verdict: "Over the last 3 pay periods, £60 of every £100 you took home was spoken for before you chose anything. £25 was yours to spend freely.",
  },
  {
    months: 6, period_count: 6,
    start: "2026-02-28", end: "2026-08-27",
    take_home: 3400, overspent: 0,
    // fixed mean (2074+2040+2040+2006+1972+1938)/6=2012 (59%), moved
    // (340+340+306+306+306+272)/6=312 (9%), free
    // (816+850+884+918+952+1020)/6=907→906 (27%, nudged 1 to keep the sum
    // exact), left 170 (5%) — sums to 3400/100.
    jobs: buildJobs({ amount: 2012, share: 59 }, { amount: 312, share: 9 }, { amount: 906, share: 27 }, { amount: 170, share: 5 }),
    verdict: "Over the last 6 pay periods, £59 of every £100 you took home was spoken for before you chose anything. £27 was yours to spend freely.",
  },
];

// ok — early_saving pattern, trait marked "change" — the only trait.choice
// value proposal_for's Consent Rule allows a proposal to render on.
const MONEY_SHAPE_OK_CHANGE: MoneyShape = {
  status: "ok",
  computed_at: "2026-09-02T06:00:00.000000Z",
  period: { start: "2026-07-28", end: "2026-08-27", label: "28 Jul to 27 Aug" },
  take_home: 3400,
  overspent: 0,
  jobs: BASE_JOBS_OK,
  verdict: "Of every £100 you take home, £61 is spoken for before you choose anything. £24 is yours to spend freely.",
  periods: OK_CHANGE_PERIODS,
  averages: OK_CHANGE_AVERAGES,
  trend: BASE_TREND,
  trend_line: "Fixed share is up 4 points over six pay periods.",
  what_works: {
    state: "ok",
    periods_available: 6,
    periods_needed: 4,
    pattern_id: "early_saving",
    headline: "Pay periods where you moved money to savings in the first week ended with cash left over 4 times out of 5.",
    flag_labels: { hit: "early", miss: "late" },
    evidence: BASE_EVIDENCE,
    trait: { id: "saves_in_bursts", title: "you save in bursts", choice: "change" },
    proposal: {
      headline: "Move your payday transfer to the first week?",
      body: "Your early periods ended with cash left over more often. Penny can help you set this up in Planning, you approve before anything moves.",
      penny_ask: "Help me move my regular savings transfer to the first week of my pay period",
    },
  },
};

// ok — same early_saving pattern, trait already resolved to "keep" —
// proposal_for returns null for anything but "change", so no proposal.
const MONEY_SHAPE_OK_KEEP: MoneyShape = {
  ...MONEY_SHAPE_OK_CHANGE,
  what_works: {
    ...MONEY_SHAPE_OK_CHANGE.what_works,
    trait: { id: "saves_in_bursts", title: "saving in bursts", choice: "keep" },
    proposal: null,
  },
};

// ok — trait exists but the user hasn't made a keep/change call on it yet
// — also proposal: null (Consent Rule: silence unless explicitly "change").
const MONEY_SHAPE_OK_NOCHOICE: MoneyShape = {
  ...MONEY_SHAPE_OK_CHANGE,
  what_works: {
    ...MONEY_SHAPE_OK_CHANGE.what_works,
    trait: { id: "saves_in_bursts", title: "you save in bursts", choice: null },
    proposal: null,
  },
};

// ok hero, but what_works hasn't found an established pattern yet — no
// trait citation, no evidence rows, no consent block, just the one honest
// line (evaluate_patterns' no-candidates branch, n=6).
const MONEY_SHAPE_NO_PATTERN: MoneyShape = {
  ...MONEY_SHAPE_OK_CHANGE,
  what_works: {
    state: "no_pattern",
    periods_available: 6,
    periods_needed: 4,
    pattern_id: null,
    headline: "No clear pattern yet across 6 pay periods.",
    flag_labels: null,
    evidence: [],
    trait: null,
    proposal: null,
  },
};

// thin — not enough pay-period history for either card. Both the hero and
// WhatWorksCard fall back to their one-line honest placeholder
// (evaluate_patterns' n<4 branch).
const MONEY_SHAPE_THIN: MoneyShape = {
  status: "thin",
  computed_at: "2026-09-02T06:00:00.000000Z",
  period: null,
  take_home: 0,
  overspent: 0,
  jobs: null,
  verdict: null,
  trend: { periods: [], fixed: [], moved: [], free: [], left: [] },
  trend_line: null,
  what_works: {
    state: "thin",
    periods_available: 1,
    periods_needed: 4,
    pattern_id: null,
    headline: "Not enough history yet.",
    flag_labels: null,
    evidence: [],
    trait: null,
    proposal: null,
  },
};

// overspent — spend exceeded take-home this period (owner brief 2026-09-02
// exact figures: take_home 3100, fixed 2200, free 1000, moved 100 — sums
// to 3300, £200 over). shares_of computes shares over (fixed+moved+free)
// = 3300 when overspent, largest-remainder apportionment: raw fixed
// 2200/3300=66.67%, moved 100/3300=3.03%, free 1000/3300=30.30% → floors
// 66/3/30 (sum 99, 1pt remainder) → the largest fractional remainder
// (fixed, 0.67) gets the spare point → fixed 67, moved 3, free 30, left 0
// (sum 100). verdict_for's overspent branch: fixed_share=67, overspent=200.
// what_works uses calm_start (not early_saving) with a "change" trait, so
// the calm_start proposal renders — the "Beyond take-home" row itself
// (see MoneyShapeHero) is ink coloured, never red.
const MONEY_SHAPE_OVERSPENT: MoneyShape = {
  status: "ok",
  computed_at: "2026-09-02T06:00:00.000000Z",
  period: { start: "2026-07-28", end: "2026-08-27", label: "28 Jul to 27 Aug" },
  take_home: 3100,
  overspent: 200,
  jobs: [
    { id: "fixed", label: "Fixed (bills, debt, rent)", amount: 2200, share: 67, categories: ["Bills", "Rent", "Debt Repayment"], txn_type: "debit" as const },
    { id: "moved", label: "Moved to savings", amount: 100, share: 3, categories: ["Savings", "Investment"], txn_type: "debit" as const },
    { id: "free", label: "Free spending", amount: 1000, share: 30, categories: ["Groceries", "Eating Out", "Shopping", "Entertainment"], txn_type: "debit" as const },
    // `categories` present but irrelevant here — the overspent "left" job's
    // link (see MoneyShapeHero's jobHref) bypasses `categories`/`txn_type`
    // on the job entirely and hardcodes txn_type=debit itself, filtering on
    // the WHOLE outflow, not this "Income" list or this "credit" marker.
    { id: "left", label: "Left over", amount: 0, share: 0, categories: ["Income"], txn_type: "credit" as const },
  ],
  verdict: "Of every £100 you take home, £67 was spoken for before you chose anything, and spending went £200 past what came in.",
  trend: {
    // delta = 67 - 58 = 9 (>= 3) → trend_line_for: "Fixed share is up 9
    // points over six pay periods."
    periods: ["Mar", "Apr", "May", "Jun", "Jul", "Aug"],
    fixed: [58, 60, 62, 64, 66, 67],
    moved: [6, 5, 5, 4, 4, 3],
    free: [33, 32, 31, 31, 30, 30],
    left: [3, 3, 2, 1, 0, 0],
  },
  trend_line: "Fixed share is up 9 points over six pay periods.",
  what_works: {
    state: "ok",
    periods_available: 6,
    periods_needed: 4,
    pattern_id: "calm_start",
    // calm_start evidence: hits (calm, first3_discretionary <= threshold)
    // = [Mar, Apr, May, Jun, Aug] (5), of which left_over > 0 for
    // Mar/Apr/May/Jun (4) and NOT for Aug (-200, the current overspent
    // period) — k=4, hit_n=5, matching the headline template exactly
    // ("...4 times out of 5."). Jul is the lone "fast" miss.
    headline: "Pay periods that started calm, under £45 of free spending in the first three days, ended with cash left over 4 times out of 5.",
    flag_labels: { hit: "calm", miss: "fast" },
    evidence: [
      { period: "Mar", flag: "hit" as const, left_over: 95 },
      { period: "Apr", flag: "hit" as const, left_over: 68 },
      { period: "May", flag: "hit" as const, left_over: 40 },
      { period: "Jun", flag: "hit" as const, left_over: 22 },
      { period: "Jul", flag: "miss" as const, left_over: -55 },
      { period: "Aug", flag: "hit" as const, left_over: -200 },
    ],
    trait: { id: "fast_start", title: "you often spend fast in the first three days", choice: "change" },
    proposal: {
      headline: "Give the first three days a number?",
      body: "Your calm starts ended with cash left over more often. Penny can help you set a first-week allocation in Planning, you approve before anything moves.",
      penny_ask: "Help me set an allocation for the first week of my pay period",
    },
  },
};

export const MONEY_SHAPE_FIXTURES: Record<MoneyShapeFixtureKey, MoneyShape> = {
  ok_change: MONEY_SHAPE_OK_CHANGE,
  ok_keep: MONEY_SHAPE_OK_KEEP,
  ok_nochoice: MONEY_SHAPE_OK_NOCHOICE,
  no_pattern: MONEY_SHAPE_NO_PATTERN,
  thin: MONEY_SHAPE_THIN,
  overspent: MONEY_SHAPE_OVERSPENT,
};
