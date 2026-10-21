import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import SafeToSpendCard from "../components/SafeToSpendCard.tsx";
import UpcomingHeroCard from "../components/upcoming/UpcomingHeroCard.tsx";
import ForecastStatusBadge from "../components/ForecastStatusBadge.tsx";
import { deriveSafeToSpendHeadline, buildSafeToSpendView, buildUpcomingRunwayView } from "../lib/pennyScreenViews.ts";
import { homeForecastPresentation, upcomingForecastPresentation } from "../lib/cashForecastStatus.ts";
import { G287_ORDER, G287_SCENARIOS, g287CardProps, g287UpcomingProps } from "./fixtures/g287-forecast.ts";

const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const render = child => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, child));
const plain = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const fixture = key => G287_SCENARIOS[key].data;
const ok = key => {
  const data = fixture(key);
  assert.equal(data?.status, "ok", `${key} is an usable forecast fixture`);
  return data;
};

for (const key of G287_ORDER) {
  const { data, ...cardProps } = g287CardProps(key);
  const home = render(React.createElement(SafeToSpendCard, { ...cardProps, data, onRetry: noop, onSyncRetry: noop, previewBalancesVisible: true }));
  if (!data || data.status !== "ok" || data.calculation_status === "degraded") {
    assert.doesNotMatch(home, /data-forecast-tone/, `${key}: no invented status badge`);
    continue;
  }
  assert.match(home, /data-g219-accounts-link/, `${key}: accounts route survives`);
  assert.match(home, /An estimate from your bank data, not financial advice\./, `${key}: safety disclaimer survives`);
  const cash = data.lowest_projected_balance - data.buffer - (data.commitments_reserved ?? 0) - (data.allocations_reserved ?? 0);
  assert.equal(cash, data.safe_to_spend_cash, `${key}: Home cash reconciles with reserves`);
  assert.equal(cash - (data.card_growth_reserved ?? 0), data.safe_to_spend, `${key}: card reserve stays separate`);
}

const homeStatus = key => {
  const data = ok(key);
  return homeForecastPresentation(data, deriveSafeToSpendHeadline(data));
};
for (const [key, tone, label] of [
  ["habitual", "risk", "Short"], ["plans", "watch", "Plans gap"], ["buffer", "watch", "Below buffer"],
  ["tight", "watch", "Tight"], ["even", "watch", "No headroom"], ["card-check", "watch", "Check card bill"], ["comfortable", "good", "On track"],
]) {
  const status = homeStatus(key);
  assert.equal(status.status.tone, tone, `${key}: semantic tone`);
  assert.equal(status.status.label, label, `${key}: plain-language status`);
}
assert.equal(homeStatus("habitual").signed, true, "cash payment risk keeps a visible minus");
assert.equal(homeStatus("card-check").signed, false, "card reserve does not become negative available cash");
assert.equal(buildSafeToSpendView(ok("habitual"), { hidden: false }).figures[0].value, "−£573", "Penny sees Home's actual sign");
assert.equal(buildSafeToSpendView(ok("buffer"), { hidden: false }).verdict, "Below buffer");

const upcoming = (key, patch = {}) => {
  const data = ok(key);
  const headline = deriveSafeToSpendHeadline(data);
  const props = g287UpcomingProps(data);
  return upcomingForecastPresentation({ runway: props.runway, lowestCash: data.lowest_projected_balance, evidenceCurrent: true, nextPayday: Date.parse(data.next_payday), isCalendarMonth: false, metadata: data, headline, plansAvailable: true, ...patch });
};
assert.deepEqual(upcoming("habitual"), { status: { tone: "risk", label: "Short" }, qualifierTone: "risk" });
assert.deepEqual(upcoming("chronology"), { status: { tone: "risk", label: "Earlier gap" }, qualifierTone: "neutral" }, "positive endpoint cannot hide an earlier payment gap");
assert.deepEqual(upcoming("plans"), { status: { tone: "watch", label: "Plans gap" }, qualifierTone: "watch" });
assert.deepEqual(upcoming("comfortable"), { status: { tone: "good", label: "On track" }, qualifierTone: "good" });
for (const patch of [
  { evidenceCurrent: false }, { lowestCash: NaN }, { nextPayday: Date.parse("2031-01-01") }, { isCalendarMonth: true },
  { metadata: null }, { headline: null }, { plansAvailable: false }, { metadata: { ...ok("comfortable"), calculation_status: "syncing" } },
]) assert.equal(upcoming("comfortable", patch).status.tone, "neutral", "unproved metadata cannot claim on-track");
assert.equal(upcoming("plans", { metadata: { ...ok("plans"), lowest_projected_balance: -1 } }).status.tone, "neutral", "conflicting metadata cannot turn a gap into reassurance");
for (const key of ["habitual", "comfortable", "plans", "buffer", "card-check", "chronology"]) {
  const props = g287UpcomingProps(ok(key));
  const status = upcoming(key).status;
  const published = buildUpcomingRunwayView({ ...props, forecastVerdict: status.label });
  assert.equal(published.verdict, status.label, `${key}: Penny uses the displayed dated-risk verdict`);
}
assert.equal(upcoming("habitual", { metadata: null, headline: null, plansAvailable: false }).status.tone, "risk", "known dated payment gap survives absent optional metadata");
for (const low of [undefined, NaN, Infinity]) {
  const data = { ...ok("comfortable"), lowest_projected_balance: low };
  assert.equal(homeForecastPresentation(data, deriveSafeToSpendHeadline(data)).status.tone, "neutral");
}
const ukBoundary = ok("comfortable").next_payday.slice(0, 10);
assert.equal(upcoming("comfortable", { metadata: { ...ok("comfortable"), next_payday: `${ukBoundary}T23:00:00-01:00` } }).status.tone, "neutral", "compare UK calendar day, not timestamp prefix");

for (const [tone, label] of [["risk", "Short"], ["watch", "Plans gap"], ["good", "On track"], ["neutral", "Check forecast"]]) {
  const badge = renderToStaticMarkup(React.createElement(ForecastStatusBadge, { status: { tone, label } }));
  assert.match(badge, new RegExp(`data-forecast-tone="${tone}"`));
  assert.match(badge, new RegExp(`>${label}</`));
}

const shortData = ok("habitual");
const shortHome = render(React.createElement(SafeToSpendCard, { ...g287CardProps("habitual"), onRetry: noop, previewBalancesVisible: true }));
assert.match(shortHome, /Shortfall before payday/);
assert.match(shortHome, /−£573/);
assert.match(shortHome, /See what’s due/);
assert.match(shortHome, /How we got £573 short/);
const maskedHome = render(React.createElement(SafeToSpendCard, { ...g287CardProps("habitual"), onRetry: noop }));
assert.match(maskedHome, /£••••/);
assert.doesNotMatch(maskedHome, /£573|£923|£350/, "Home honours unresolved/hidden preferences across all calculations");
const staleHome = render(React.createElement(SafeToSpendCard, { ...g287CardProps("stale"), onRetry: noop, previewBalancesVisible: true }));
assert.match(staleHome, /−£573/, "a last-known negative figure retains its sign");
assert.doesNotMatch(staleHome, /data-forecast-tone/, "syncing replaces the verdict with the neutral sync indicator");
const cardCheck = plain(render(React.createElement(SafeToSpendCard, { ...g287CardProps("card-check"), onRetry: noop, previewBalancesVisible: true })));
assert.match(cardCheck, /Check card bill/);
assert.match(cardCheck, /Review card bill/);
assert.match(cardCheck, /Safety position/);
const cards = plain(render(React.createElement(SafeToSpendCard, { ...g287CardProps("cards"), onRetry: noop, previewBalancesVisible: true })));
assert.match(cards, /See your cards/);
assert.match(cards, /Went on cards this pay period/);
assert.match(cards, /not deducted from the cash/);

const upcomingProps = g287UpcomingProps(shortData);
const upcomingShort = renderToStaticMarkup(React.createElement(UpcomingHeroCard, { ...upcomingProps, presentation: upcoming("habitual") }));
assert.match(upcomingShort, /Projected at payday/);
assert.match(upcomingShort, /−£573/);
assert.match(upcomingShort, /Full calculation/);
assert.match(upcomingShort, /Savings backup/);
assert.match(upcomingShort, /Payments can take a day or two to appear/);
assert.match(upcomingShort, /text-\[30px\].*text-slate-900/, "main Upcoming figure stays ink");
assert.match(upcomingShort, /grid-cols-\[minmax\(0,1fr\)_auto\]/, "status uses the real right-aligned header row");
const maskedUpcoming = renderToStaticMarkup(React.createElement(UpcomingHeroCard, { ...upcomingProps, balancesHidden: true, presentation: upcoming("habitual") }));
assert.match(maskedUpcoming, /£••••/);
assert.doesNotMatch(maskedUpcoming, /573|350|923|1,400/, "Upcoming masking does not leak figures");

console.log("PASS G287: production forecast fixtures, semantic precedence, real Home and Upcoming cards, status badge, financial reconciliation, actions, disclosures and masking.");
