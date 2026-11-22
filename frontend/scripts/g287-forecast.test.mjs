import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import SafeToSpendCard from "../components/SafeToSpendCard.tsx";
import ForecastStatusBadge from "../components/ForecastStatusBadge.tsx";
import { deriveSafeToSpendHeadline, buildSafeToSpendView } from "../lib/pennyScreenViews.ts";
import { homeForecastPresentation } from "../lib/cashForecastStatus.ts";
import { G287_ORDER, G287_SCENARIOS, g287CardProps } from "./fixtures/g287-forecast.ts";

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
  assert.doesNotMatch(home, /data-g219-accounts-link/, `${key}: G397 removes the standalone hero Accounts route`);
  assert.match(home, /An estimate from your bank data\. It can be wrong, so check your bank for your latest balance\. Not financial advice\./, `${key}: safety disclaimer survives`);
  const cash = data.lowest_projected_balance - data.buffer - (data.commitments_reserved ?? 0) - (data.allocations_reserved ?? 0);
  assert.equal(cash, data.safe_to_spend_cash, `${key}: Home cash reconciles with reserves`);
  assert.equal(cash, data.safe_to_spend, `${key}: G413 no card reserve, cash is the figure`);
}

const homeStatus = key => {
  const data = ok(key);
  return homeForecastPresentation(data, deriveSafeToSpendHeadline(data));
};
for (const [key, tone, label] of [
  ["habitual", "risk", "Short"], ["plans", "watch", "Plans gap"], ["buffer", "watch", "Below buffer"],
  ["tight", "watch", "Tight"], ["even", "watch", "No headroom"], ["card-check", "watch", "Tight"], ["comfortable", "good", "Looks on track"],
]) {
  const status = homeStatus(key);
  assert.equal(status.status.tone, tone, `${key}: semantic tone`);
  assert.equal(status.status.label, label, `${key}: plain-language status`);
}
assert.equal(homeStatus("habitual").signed, true, "cash payment risk keeps a visible minus");
assert.equal(homeStatus("card-check").signed, false, "card growth never becomes negative available cash");
assert.equal(buildSafeToSpendView(ok("habitual"), { hidden: false }).figures[0].value, "−£573", "Penny sees Home's actual sign");
assert.equal(buildSafeToSpendView(ok("buffer"), { hidden: false }).verdict, "Below buffer");

for (const low of [undefined, NaN, Infinity]) {
  const data = { ...ok("comfortable"), lowest_projected_balance: low };
  assert.equal(homeForecastPresentation(data, deriveSafeToSpendHeadline(data)).status.tone, "neutral");
}
for (const [tone, label] of [["risk", "Short"], ["watch", "Plans gap"], ["good", "On track"], ["neutral", "Check forecast"]]) {
  const badge = renderToStaticMarkup(React.createElement(ForecastStatusBadge, { status: { tone, label } }));
  assert.match(badge, new RegExp(`data-forecast-tone="${tone}"`));
  assert.match(badge, new RegExp(`>${label}</`));
}

const shortHome = render(React.createElement(SafeToSpendCard, { ...g287CardProps("habitual"), onRetry: noop, previewBalancesVisible: true }));
assert.match(shortHome, /Shortfall before payday/);
assert.match(shortHome, /−£573/);
assert.match(shortHome, /See what’s due/);
assert.match(plain(shortHome), /How we got −£573/);
const maskedHome = render(React.createElement(SafeToSpendCard, { ...g287CardProps("habitual"), onRetry: noop }));
assert.match(maskedHome, /£••••/);
assert.doesNotMatch(maskedHome, /£573|£923|£350/, "Home honours unresolved/hidden preferences across all calculations");
const staleHome = render(React.createElement(SafeToSpendCard, { ...g287CardProps("stale"), onRetry: noop, previewBalancesVisible: true }));
assert.match(staleHome, /−£573/, "a last-known negative figure retains its sign");
assert.doesNotMatch(staleHome, /data-forecast-tone/, "syncing replaces the verdict with the neutral sync indicator");
const cardCheck = plain(render(React.createElement(SafeToSpendCard, { ...g287CardProps("card-check"), onRetry: noop, previewBalancesVisible: true })));
assert.doesNotMatch(cardCheck, /Check card bill|Review card bill|After card hold|held while a card bill/, "G413: no card hold copy");
assert.match(cardCheck, /Tight/);
const cards = plain(render(React.createElement(SafeToSpendCard, { ...g287CardProps("cards"), onRetry: noop, previewBalancesVisible: true })));
assert.match(cards, /See your cards/);
assert.match(cards, /Card spending this pay period/);
assert.match(cards, /Card purchases aren&#x27;t deducted again/);

console.log("PASS G287: production forecast fixtures, semantic precedence, the real Home card, status badge, financial reconciliation, actions, disclosures and masking.");
