// TEMPORARY PREVIEW INDEX — delete with the preview routes
//
// Static index of the active /design/* preview routes so the owner can
// bookmark one URL on his phone instead of the individual previews.
// No data fetching, no client state — plain links only.

import Link from "next/link";

type PreviewRoute = {
  slug: string;
  name: string;
  description: string;
  states: { label: string; value: string }[];
};

const ROUTES: PreviewRoute[] = [
  {
    slug: "penny-usage-ring",
    name: "penny-usage-ring",
    description:
      "Penny message-allowance meter against static mocks of the sheet header, bottom nav and composer (copied markup, not imported) · A2 avatar ring RECOMMENDED (revised 2026-09-06 after Kevin's phone review of the first pass — square caps, ring geometrically concentric with the avatar via a shared SVG, no caption row): tap the avatar to crossfade the header TITLE itself to the usage line for ~2.5s, then back; at Cap the composer disables (borrows C's placeholder) and adds a 'Get more messages' link on the disclaimer's own row, opening a More Messages sheet mock (section D) with two priced options, no 'upgrade' wording / B nav button ring: the same ring as a halo on the raised centre Penny button, visible without opening the sheet, sheet header stays unchanged (kept for comparison, unchanged from the first round) / C composer meter: no ring, hairline bar + count above the composer input, placeholder and send disable at Cap (kept for comparison, unchanged) · ring reads Penny's indigo→violet gradient below 80% used, crossfades to Watch Amber at 80%+ and at Cap, never red · ?mode=light|dark&state=low|high|cap|unlimited, plus two combinable flags (not states): ?tapped=1 pre-crossfades A2's title, ?sheet=1 opens the More Messages overlay on A2 (also opens automatically at state=cap)",
    states: [
      { label: "Low (37/150)", value: "low" },
      { label: "High (128/150)", value: "high" },
      { label: "Cap (150/150)", value: "cap" },
      { label: "Unlimited", value: "unlimited" },
    ],
  },
  {
    slug: "planning-plans",
    name: "planning-plans",
    description:
      "Planning plans-density round: 3 variants for the priority ladder's plan list (A register / B priority / C dashboard) · ?variant=a|b|c&mode=light|dark",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "spend-penny-flow",
    name: "spend-penny-flow",
    description:
      "Spend (This period / Patterns) to Penny interaction prototype, fictional figures, no API calls or production navigation changes · ?view=period|patterns|penny&mode=light|dark",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "upcoming-plan",
    name: "upcoming-plan",
    description:
      "Proposed Upcoming/Planning information architecture split, not live navigation · ?view=upcoming|plan&mode=light|dark",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "spend-shape",
    name: "spend-shape",
    description:
      "Shape card on the Spend period view + the /spend/shape destination (owner decisions 2026-09-05: Insights page retired, shape hero left Patterns) · variant B, the instrument, is the SHIPPED design — renders the live components/SpendShapeCard.tsx; A (sentence) and C (change-led) kept as reference forks · the shape view renders the live app/spend/shape/ShapePage.tsx fed this route's fixture — hero, what works, reference shapes, nothing else, no tips index · ?variant=a|b|c&mode=light|dark&view=list|shape",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "spend-tips",
    name: "spend-tips",
    description:
      "Spend tips integration round (owner brief 2026-09-04: 'Penny noticed' rows wedged under category rows break the list grammar, truncate the fact and contradict 'Looking normal'; corrected 2026-09-05: a category tap routes to the transactions page, not a sheet) · A tip count + estimate folded into the category subline, tip waits behind a one-line row under the filter chips on the transactions page, above the payments / B one 'Ways to save' card under the list with a reconciled total and a door to Patterns / C both · real InsightCard over the owner's live tips · ?variant=a|b|c&mode=light|dark",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "planning-ladder",
    name: "planning-ladder",
    description:
      "Planning tab ladder-vs-immediate round (owner brief 2026-09-04: locked rungs push the 0% cliff and off-pace goal below the fold) · A collapsed ladder + jump strip (owner pick 2026-09-04) / B \"Needs you this month\" card above a collapsed ladder / C immediate sections first, full ladder last · real GrowHero/LadderRung/DebtPosition/GoalRow over the owner's live figures · ?variant=a|b|c&state=short|calm&mode=light|dark",
    states: [
      { label: "Short period", value: "short" },
      { label: "Calm period", value: "calm" },
    ],
  },
  {
    slug: "account-rows",
    name: "account-rows",
    description: "Credit-card row cleanup (taste + impeccable pass) · owner phone screenshot 2026-08-30 /accounts: rose balance + orphan \"owed\" line + ragged APR/promo-chip stack made credit rows read as a different component family to current/savings rows · 3 variants against the real 7 cards + one no-terms fixture (A one grammar, rows byte-identical to accounts, terms fold into the subline, amber dot only on an expiring promo / B disciplined card row, one right column, red reserved for cards actually accruing interest / C off the row, terms move to a group-header caption + CardTermsSheet, rows fully uniform) · in-page variant switcher, ?variant=a|b|c&mode=light|dark",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "account-picker",
    name: "account-picker",
    description: "\"Which account?\" declutter for the envelope flow (AllocationFields.tsx AccountRadioPicker) · owner feedback: 15 real accounts (banks + Monzo/Chase pots) render as one cluttered flat list · 3 variants (A grouped-by-bank accordion + Suggested pin / B search-first + recency shortlist / C horizontal bank chips filtering one list) embedded in a replica of the envelope sheet step, ?variant=a|b|c&state=few|many",
    states: [
      { label: "Many (15)", value: "many" },
      { label: "Few (3)", value: "few" },
    ],
  },
  {
    slug: "planning-create",
    name: "planning-create",
    description: "Consolidating Planning's three creation doors (\"+ Plan a big expense\", \"+ Allocation\", \"+ Plan a one-off\") into fewer, taste + impeccable pass · 3 variants (A one door, kind chosen inside as three shape cards / B one door, shape derived from a plain-English \"by when?\" follow-up, taxonomy never shown / C two doors, goal+allocation merge into one inline-toggle sheet, one-off stays separate and unchanged) · in-page control bar switches A/B/C, entry + create flow + resulting cards + design-note annotation all on one page per variant",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "planning",
    name: "planning",
    description: "Planning page revamp (taste + impeccable pass) · 3 art-direction variants (A ledger: banner merges into the TO LAST hero card, repeated culprit collapses to a per-row Why? toggle / B timeline: shortfall compresses to account chips + one footnote explanation / C brief: verdict as one sentence, disclaimer behind an info tap, list chunked into This week / Next two weeks / Next pay period) against the real Barclays £231.30 shortfall + repeated-culprit case",
    states: [
      { label: "Shortfall", value: "short" },
      { label: "Healthy", value: "healthy" },
    ],
  },
  {
    slug: "dismissed",
    name: "dismissed",
    description: "Set aside page · 3 variants (quiet ledger / two sections / undo log) for resurfacing dismissed payments + engine vetoes; plus a Planning-header entry-point round (?view=entry: bin glyph / recovery lockup / section chip) against a faithful header + shortfall-banner replica",
    states: [
      { label: "Mixed", value: "mixed" },
      { label: "Single", value: "single" },
      { label: "Empty", value: "empty" },
    ],
  },
  {
    slug: "reconnect",
    name: "reconnect",
    description: "Home reconnect banner · 3 variants at N=1/2/3 expired providers — C (quiet strip) chosen 2026-08-28, shipped as the real Home banner (components/ReconnectStrip.tsx); kept here for reference",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "spend-verdict-a",
    name: "spend-verdict-a",
    description: "Spend A, verdict first: net line leads, Out/In/Moved demoted to a hairline row, ranked cards",
    states: [
      { label: "Normal", value: "normal" },
      { label: "Nothing", value: "nothing" },
      { label: "Everything", value: "everything" },
      { label: "No baseline", value: "nobaseline" },
      { label: "Early", value: "early" },
    ],
  },
  {
    slug: "spend-verdict-b",
    name: "spend-verdict-b",
    description: "Spend B, weighted instrument: keeps the bordered panel, Out is hero, others grouped",
    states: [
      { label: "Normal", value: "normal" },
      { label: "Nothing", value: "nothing" },
      { label: "Everything", value: "everything" },
      { label: "No baseline", value: "nobaseline" },
      { label: "Early", value: "early" },
    ],
  },
  {
    slug: "spend-verdict-c",
    name: "spend-verdict-c",
    description: "Spend C, quiet ledger: no boxes, hairline figures, dense ledger rows",
    states: [
      { label: "Normal", value: "normal" },
      { label: "Nothing", value: "nothing" },
      { label: "Everything", value: "everything" },
      { label: "No baseline", value: "nobaseline" },
      { label: "Early", value: "early" },
    ],
  },
  {
    slug: "insights-live",
    name: "insights-live",
    description: "STANDING design twin for Insights, kept even after the Insights page itself retired 2026-09-05 (owner phone report 2026-09-01, \"still empty cards\"; updated same-day for the cost-driven TTL reversal; extended 2026-09-02 for the money-shape redesign, then again same-day for Kevin's phone feedback — job rows link to real transactions not Planning, and (after a short-lived separate \"Over time\" block was retired the same day per Kevin's redirect) a period/average PICKER built into the hero itself) · renders the REAL exported components/InsightCard.tsx components (InsightCard, CompactInsightRow, isCompactPullInsight, InsightsHero) against fixture payloads shaped field-for-field like the live GET /savings-insights serializer output · one fixture per insight.state (fresh with the weekly-default expiry line, fresh with a dated-claim expiry line, quiet never-researched, quiet expired-since-last-pass, substituted, verified) plus the is_new invariant case · ALSO renders the real MoneyShapeHero/WhatWorksCard/ReferenceShapesRow (now app/spend/shape/) against MONEY_SHAPE_FIXTURES (GET /money-shape shaped fixtures, copy mirrors backend/app/services/money_shape.py's deterministic templates) independently selectable via its own `shape` param: ok_change (live Penny proposal, carries 8 periods + 3/6-month averages exercising the hero's own period/average picker sheet), ok_keep (trait kept, celebration chip), ok_nochoice (undecided trait, \"choose in your Mirror\" link), no_pattern (headline-only, no rows), thin (both cards fall back to their one-line placeholder), overspent (\"Beyond take-home\" row, no red, calm_start proposal) · closes the verification blind spot that let three prior fix rounds ship on code-trace alone, before this twin existed nobody ever rendered the pixels · ?mode=light|dark&state=all|fresh_weekly|fresh_claim|quiet_never_researched|quiet_expired|substituted|verified|is_new&shape=ok_change|ok_keep|ok_nochoice|no_pattern|thin|overspent",
    states: [{ label: "Everything", value: "all" }],
  },
  {
    slug: "app-icon",
    name: "app-icon",
    description: "Launcher icon glow · 3 variants (lit panel / halo / ember) vs current, circle-masked 72/48px sims",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "dismiss-x",
    name: "dismiss-x",
    description: "Home dismiss × · 3 variants (whisper ghost / glass chip / anchored puck) vs brief + spotlight cards",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "scenario-a",
    name: "scenario-a",
    description: "What-if verdict · Delta-led comparison (now vs with this)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "scenario-b",
    name: "scenario-b",
    description: "What-if verdict · Verdict-led, quietest, one sentence + one fact",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "scenario-c",
    name: "scenario-c",
    description: "What-if verdict · Baseline-led (standing position leads)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "coming-up",
    name: "coming-up",
    description: "Coming up card · 3 variants (ledger / timeline / next three)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "penny-chat",
    name: "penny-chat",
    description: "One Penny · prompt bar + verdict answers",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "penny-thread",
    name: "penny-thread",
    description: "Penny thread · question/answer contrast, 3 variants (quiet label / anchored / inset)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "penny-sheet",
    name: "penny-sheet",
    description: "Penny sheet · bottom sheet over the nav vs full-page, cards vs bubbles grammar (?g=cards|bubbles)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "penny-glyph",
    name: "penny-glyph",
    description: "Sparkle replacement · 3 settle-mark-derived glyph candidates",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "month-story",
    name: "month-story",
    description: "Month in Review story · count-up scoped to the spending hero only, staggered category rows, per-card logo rows on Cards, three spotlight-glow variants (?variant=a|b|c)",
    states: [{ label: "Play", value: "everything" }],
  },
  {
    slug: "spend-live",
    name: "spend-live",
    description: "Spend page · fixtures reference (real components)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "spend-charts",
    name: "spend-charts",
    description: "SpendTrends.tsx's two new Charts widgets (pace_curve, debt_burndown), never screenshotted before this build · renders the real PaceCurveWidget/DebtBurndownWidget against fixtures (debt_burndown's /debt-plan/summary fetch swapped for a previewState seam, auth would 401 here) · pace: below usual / above usual (stays neutral, not red) / thin history (no usual line) / partially-null usual / very short (1-2 days) · debt: reaches zero / never clears (clipped to 24 months) / empty (good news) / fetch failed · ?widget=pace|debt&state=<slug>&compact=0|1",
    states: [
      { label: "Pace: below usual", value: "below-usual" },
      { label: "Debt: reaches zero", value: "reaches-zero" },
    ],
  },
  {
    slug: "miscategorised",
    name: "miscategorised",
    description: "Miscategorised-transfers review sheet · range/single/unresolved-account/capped-members/long-name fixtures (real component)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "type",
    name: "type",
    description: "Home hero · 4 typeface treatments (System / Figtree / DM Sans / Figtree+Mono)",
    states: [{ label: "Everything", value: "everything" }],
  },
];

export default function DesignIndexPage() {
  return (
    <div className="min-h-screen bg-[#f0f2f7] dark:bg-[#0f172a]">
      <div className="mx-auto max-w-[430px] px-4 py-8">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">
          Design previews
        </h1>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Temporary review builds. Newest first.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {ROUTES.map((route) => (
            <div key={route.slug} className="glass-card-flat rounded-2xl p-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {route.name}
              </div>
              <div className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                {route.description}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {route.states.map((s) => (
                  <Link
                    key={s.value}
                    href={`/design/${route.slug}?mode=dark&state=${s.value}`}
                    className="inline-flex items-center min-h-[44px] rounded-full px-3.5 py-2 text-[11px] font-semibold text-indigo-600 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-500/15 active:scale-95 transition-transform"
                  >
                    {s.label}
                  </Link>
                ))}
              </div>

              <div className="mt-2">
                <Link
                  href={`/design/${route.slug}?mode=light&state=${route.states[0].value}`}
                  className="text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2"
                >
                  light
                </Link>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 text-center">
          These routes are deleted after review.
        </p>
      </div>
    </div>
  );
}
