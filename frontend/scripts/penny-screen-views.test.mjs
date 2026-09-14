// Plain-Node test for lib/pennyScreenViews.ts (B39), same framework-free
// pattern as scripts/preferences-version.test.mjs et al — imports the REAL
// production module (the exact functions SafeToSpendCard.tsx,
// app/components/SpendPage.tsx and app/planning/PlanningPage.tsx call to
// both render AND publish a screen's Penny context), not a hand-copied
// re-implementation, so this can never drift from what actually ships.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/penny-screen-views.test.mjs
// or:
//   npm run -s check:penny-screen-views
//
// What this asserts, mapped onto B39's own verification checklist:
// - a screen's published view figure matches its own rendered figure
//   exactly (deriveSafeToSpendHeadline's heroAmount is what buildSafeToSpendView
//   quotes, byte for byte — they're literally the same call, this just pins
//   the mapping against fixtures so a future edit can't quietly split them)
// - the hidden-balances case omits figures rather than masking them
// - Spend/Upcoming views carry the server's own verdict/reading text
//   verbatim, never a client-invented paraphrase

import {
  deriveSafeToSpendHeadline,
  buildSafeToSpendView,
  buildSpendPeriodView,
  buildUpcomingRunwayView,
} from "../lib/pennyScreenViews.ts";

let failures = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// ── Home / Safe to Spend ─────────────────────────────────────────────────

const comfortableSts = {
  status: "ok",
  safe_to_spend: 83.4,
  next_payday: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
  days_until_payday: 4,
  bills_total: 0,
  income_before_payday: 0,
  buffer: 0,
  state: "comfortable",
  estimated: false,
  last_synced: "2026-09-14T08:00:00.000Z",
};

{
  const headline = deriveSafeToSpendHeadline(comfortableSts);
  check("comfortable state maps to On track", headline.stateLabel, "On track");
  // zeroSafe only snaps a NEAR-ZERO value to 0 (< £1) — 83.4 is untouched,
  // the rounding to a whole £ happens only in the DISPLAY formatter
  // (fmt/fmtGbp), checked separately just below via the published view.
  check("comfortable heroAmount is the raw safe_to_spend, unrounded", headline.heroAmount, 83.4);

  const view = buildSafeToSpendView(comfortableSts, { hidden: false });
  // The published figure is the FORMATTED (rounded) string, same as what
  // fmt(heroAmount) renders on screen — proves the two never disagree even
  // though the underlying raw number carries decimals.
  check("published figure matches the rendered, rounded £ string", view.figures[0].value, "£83");
  check("published verdict matches rendered stateLabel exactly", view.verdict, headline.stateLabel);
  check("published label is 'Safe to spend' when not short", view.figures[0].label, "Safe to spend");
  check("asOf uses the payload's own last_synced, not 'now'", view.asOf, "2026-09-14T08:00:00.000Z");
}

// Hidden balances: figures OMITTED (not masked), verdict still publishes —
// see components/SafeToSpendCard.tsx's own comment on why this is a real
// omission, not a "£••••" placeholder, since this view rides into a model
// prompt.
{
  const view = buildSafeToSpendView(comfortableSts, { hidden: true });
  check("hidden balances publish zero figures", view.figures, []);
  check("hidden balances still publish the verdict word", view.verdict, "On track");
}

// Short (genuine shortfall, not the cards-unconfirmed carve-out): label
// switches to "Short before payday", matching SafeToSpendCard.tsx's own
// heroCaption/label logic exactly.
const shortSts = {
  ...comfortableSts,
  safe_to_spend: -45,
  safe_to_spend_cash: -45,
  state: "short",
  short_reason: "bills",
};
{
  const headline = deriveSafeToSpendHeadline(shortSts);
  check("genuine short state label", headline.stateLabel, "Short");
  check("genuine short hero amount is the absolute shortfall", headline.heroAmount, 45);
  const view = buildSafeToSpendView(shortSts, { hidden: false });
  check("short figure label reflects the shortfall framing", view.figures[0].label, "Short before payday");
  check("short figure value is the positive shortfall amount", view.figures[0].value, "£45");
}

// cards_unconfirmed short carve-out — never treated as a genuine shortfall
// for the figure/label (SafeToSpendCard.tsx's own isCardsUnconfirmedShort
// branch keeps the ordinary "Safe to spend" framing at £0, not a red
// "short" figure — a repayment that hasn't been matched yet is not the
// same as the user actually running out of cash).
const cardsUnconfirmedSts = {
  ...comfortableSts,
  safe_to_spend: -10,
  state: "short",
  short_reason: "cards_unconfirmed",
};
{
  const headline = deriveSafeToSpendHeadline(cardsUnconfirmedSts);
  check("cards-unconfirmed short label", headline.stateLabel, "Check card bill");
  check("cards-unconfirmed short hero amount is zero, not the raw negative", headline.heroAmount, 0);
}

// ── Spend period view — pure mapping over an already-server-computed
// SpendVerdict, no arithmetic of its own ──────────────────────────────────

const verdict = {
  state: "normal",
  reading: "You're on pace this period, a little under usual.",
  notables: [],
  quiet_flags: [],
  majority: [],
  unresolved: { total: 0, items: [] },
  moved: [],
  pills: { spent: 612, income: 1800, net: 1188 },
  period: { start: "2026-09-01", end: "2026-09-14", days_elapsed: 14, days_left: 14, offset: 0, closed: false },
};
{
  const view = buildSpendPeriodView(verdict);
  check("spend route", view.route, "/spend");
  check("spend verdict is the server's reading sentence verbatim", view.verdict, verdict.reading);
  check("spend figures are Out/In/Net with the pill amounts verbatim", view.figures, [
    { key: "spend_out", label: "Out", value: "£612" },
    { key: "spend_in", label: "In", value: "£1,800" },
    { key: "spend_net", label: "Net", value: "+£1,188" },
  ]);
  // Node/ICU's en-GB short month form for September is "Sept" (4 letters,
  // not 3) — this matches every other date label already rendered
  // app-wide via the identical `{weekday: "short", day: "numeric", month:
  // "short"}`/`{day: "numeric", month: "short"}` pattern (e.g.
  // SafeToSpendCard.tsx's own paydayLabel), not a quirk introduced here.
  check("spend scope names the open period as 'so far'", view.scope, "1 Sept to 14 Sept (so far)");
}

{
  const closedVerdict = { ...verdict, pills: { spent: 900, income: 900, net: 0 }, period: { ...verdict.period, closed: true } };
  const view = buildSpendPeriodView(closedVerdict);
  check("closed period scope has no '(so far)' qualifier", view.scope, "1 Sept to 14 Sept");
  check("net of exactly zero is not shown as negative", view.figures[2].value, "+£0");
}

{
  const negativeNet = { ...verdict, pills: { spent: 2000, income: 900, net: -1100 } };
  const view = buildSpendPeriodView(negativeNet);
  check("negative net uses the app's minus sign convention", view.figures[2].value, "−£1,100");
}

// ── Upcoming runway view ──────────────────────────────────────────────────

{
  const view = buildUpcomingRunwayView({ runway: 240, runwayStatus: "left", isCalendarMonth: false });
  check("upcoming route", view.route, "/upcoming");
  check("upcoming scope for a pay-period cycle", view.scope, "Projected at payday");
  check("upcoming verdict for money left over", view.verdict, "Left over");
  check("upcoming figure for money left over", view.figures[0], { key: "runway", label: "Projected at payday", value: "£240" });
}

{
  const view = buildUpcomingRunwayView({ runway: -60, runwayStatus: "short", isCalendarMonth: true });
  check("upcoming scope for a calendar-month cycle", view.scope, "Projected at month end");
  check("upcoming verdict for a shortfall", view.verdict, "Short");
  check("upcoming figure carries the minus sign for a shortfall", view.figures[0].value, "−£60");
}

{
  const view = buildUpcomingRunwayView({ runway: 0, runwayStatus: "even", isCalendarMonth: false });
  check("upcoming verdict for exactly covered", view.verdict, "Exactly covered");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
