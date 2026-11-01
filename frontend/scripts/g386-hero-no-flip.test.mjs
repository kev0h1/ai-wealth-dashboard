import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UpcomingHeroCard from "../components/upcoming/UpcomingHeroCard.tsx";
import { upcomingForecastPresentation } from "../lib/cashForecastStatus.ts";
import { deriveSafeToSpendHeadline } from "../lib/pennyScreenViews.ts";

// G386: Upcoming's hero must never paint a neutral verdict that flips to green.
const page = readFileSync(new URL("../app/planning/PlanningPage.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("../components/upcoming/UpcomingHeroCard.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");

// 1. The presentation is built from the payload's forecast key when present.
assert.match(api, /forecast\?: SafeToSpend/, "CashflowData types the embedded forecast");
assert.match(api, /cashflowWithForecast: \(\) => get<CashflowData>\("\/cashflow\?include=forecast"\)/);
assert.match(page, /const embeddedForecast = cashflow\?\.forecast \?\? null;/);
assert.match(page, /useForecastContext\(embeddedForecast \? null : cashflow, api\.safeToSpend\)/, "second request only when the key is absent");
assert.match(page, /embeddedForecast \? \{ data: embeddedForecast, pending: false \} : fetchedForecast/, "embedded verdict is never pending");
assert.doesNotMatch(page, /api\.cashflow\(\)/, "every Upcoming cashflow read carries the forecast, so a refresh cannot drop back to the pending path");
assert.match(page, /presentation=\{forecastPresentation\}/, "the hero is always handed a presentation");

// 2. Fallback rule: while the verdict is pending, chip AND coloured word are held together.
const base = {
  isCalendarMonth: false, daysToPayday: 5, paydayLabel: "Fri 6 Nov", spendableNow: 500, runwayIncomeTotal: 0,
  runwayBillsTotal: 100, allocationsRemainingTotal: 0, savingsNow: 0, runway: 400, runwayStatus: "left", balancesHidden: false,
};
const pending = renderToStaticMarkup(React.createElement(UpcomingHeroCard, {
  ...base, presentation: { status: { tone: "neutral", label: "Check forecast" }, qualifierTone: "neutral", pending: true },
}));
assert.doesNotMatch(pending, /Check forecast|data-forecast-tone/, "no neutral chip while pending");
assert.match(pending, /data-forecast-pending="true"/, "chip placeholder held");
assert.match(pending, /data-forecast-pending-word[^>]*invisible/, "coloured word held with the chip");
assert.match(pending, /£400/, "figure is not hidden");
const settled = renderToStaticMarkup(React.createElement(UpcomingHeroCard, {
  ...base, presentation: { status: { tone: "good", label: "Looks on track" }, qualifierTone: "good" },
}));
assert.match(settled, /Looks on track/);
assert.match(settled, /text-emerald-800/, "coloured word and chip arrive together");
assert.doesNotMatch(settled, /data-forecast-pending|invisible/);
assert.doesNotMatch(card, /animate-|transition-opacity|@keyframes/, "no load animation on the hero");

// 3. With the embedded verdict, the first render is already final (no pending, no neutral flip).
const ok = {
  status: "ok", state: "comfortable", safe_to_spend: 300, safe_to_spend_cash: 300, buffer: 50, calculation_status: "complete",
  next_payday: "2026-11-06", days_until_payday: 5, lowest_projected_balance: 400, spendable_now: 500, income_before_payday: 0,
  bills_total: 100, allocations_reserved: 0, commitments_reserved: 0,
};
const first = upcomingForecastPresentation({
  runway: 400, lowestCash: 400, evidenceCurrent: true, nextPayday: Date.parse("2026-11-06T00:00:00Z"), isCalendarMonth: false,
  metadata: ok, headline: deriveSafeToSpendHeadline(ok), metadataPending: false, plansAvailable: true,
});
assert.equal(first.pending, undefined);
assert.equal(first.status.label, "Looks on track");
assert.equal(first.qualifierTone, "good");
console.log("g386-hero-no-flip: ok");
