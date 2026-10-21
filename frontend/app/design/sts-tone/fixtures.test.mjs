import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import SafeToSpendCard from "../../../components/SafeToSpendCard.tsx";
import CompleteCard from "./CompleteCard.tsx";
import UpcomingHeroCard from "../../../components/upcoming/UpcomingHeroCard.tsx";
import UpcomingColourReference, { upcomingPropsFor } from "./UpcomingColourReference.tsx";
import { SCENARIOS, SCENARIO_ORDER, cardPropsFor, previewRouteFor } from "./fixtures.ts";
import { deriveSafeToSpendHeadline } from "../../../lib/pennyScreenViews.ts";

const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const render = child => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, child));
// React may hoist local image preloads before the root element. Compare the
// component markup, not hoisted resource hints, which the browser checks load.
const markup = html => html.replace(/<link\b[^>]*\/>/g, "");
const plain = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const rendered = {};

for (const scenario of SCENARIO_ORDER) {
  const props = cardPropsFor(scenario);
  const direct = markup(render(React.createElement(SafeToSpendCard, { ...props, onRetry: noop, onSyncRetry: noop, previewBalancesVisible: true })));
  rendered[scenario] = plain(direct);
  for (const variant of ["a", "b", "c", "current"]) {
    const wrapped = markup(render(React.createElement(CompleteCard, { scenario, variant, onRetry: noop, onDestination: noop })));
    assert.equal(wrapped.replace(/^<div\b[^>]*>/, "").replace(/<\/div>$/, ""), direct, `${scenario}/${variant}: exact production component content`);
    assert.equal((wrapped.match(/id="safe-to-spend-heading"/g) ?? []).length, ["loading", "error", "empty", "degraded"].includes(scenario) ? 0 : 1, `${scenario}/${variant}: one card identity`);
  }
  const upcomingProps = upcomingPropsFor(scenario);
  const upcoming = markup(render(React.createElement(UpcomingColourReference, { scenario, consolidated: true })));
  if (upcomingProps) {
    const directUpcoming = markup(render(React.createElement(UpcomingHeroCard, upcomingProps)));
    assert.ok(upcoming.includes(directUpcoming), `${scenario}: exact Upcoming production content`);
    assert.equal(upcomingProps.runway, upcomingProps.spendableNow + upcomingProps.runwayIncomeTotal - upcomingProps.runwayBillsTotal - upcomingProps.allocationsRemainingTotal - upcomingProps.plansReservedTotal, `${scenario}: true end-of-period forecast, not Home's low point`);
  } else assert.doesNotMatch(upcoming, /id="runway-heading"/, `${scenario}: no invented current Upcoming amount`);
  if (["loading", "error", "empty", "degraded"].includes(scenario)) {
    assert.doesNotMatch(direct, /data-g219-accounts-link/, `${scenario}: no invented figure/action`);
    continue;
  }
  assert.equal((direct.match(/data-g219-accounts-link/g) ?? []).length, 1, `${scenario}: Your accounts retained once`);
  assert.match(direct, /href="\/accounts"/);
  assert.match(direct, /An estimate from your bank data, not financial advice\./);
  const data = props.data;
  const low = data.lowest_projected_balance;
  const cash = low - data.buffer - (data.commitments_reserved ?? 0) - (data.allocations_reserved ?? 0);
  assert.equal(cash, data.safe_to_spend_cash, `${scenario}: cash forecast less existing reserves`);
  assert.equal(cash - (data.card_growth_reserved ?? 0), data.safe_to_spend, `${scenario}: separate card reserve`);
  if (scenario !== "chronology") assert.equal(data.spendable_now + data.income_before_payday - data.bills_total, low, `${scenario}: simple fixture walk reconciles`);
  const headline = deriveSafeToSpendHeadline(data);
  assert.equal(headline.heroAmount, scenario === "card-check" ? 0 : Math.abs(cash));
  assert.equal(headline.plansOnly, scenario === "plans");
}

assert.match(rendered.cards, /See your cards/);
assert.match(rendered.cards, /Went on cards this pay period/);
assert.match(rendered.cards, /not deducted from the cash/);
assert.match(rendered.cards, /Transfers between your own included accounts do not change the total/);
assert.match(rendered["card-check"], /Review card bill/);
assert.match(rendered["card-check"], /Check card bill/);
assert.match(rendered["card-check"], /Safety position.*−£73\.00/);
assert.match(rendered["card-check"], /Unconfirmed card reserve.*£325\.00/);
assert.equal(cardPropsFor("card-check").spendFrom.kind, "none", "no positive spend-from guidance while card safety position is short");
assert.match(rendered.habitual, /See what’s due/);
assert.doesNotMatch(rendered.comfortable, /See what’s due|See your cards|Review card bill/);
assert.doesNotMatch(rendered.stale, /See what’s due|See your cards|Review card bill/);
assert.match(rendered.stale, /Last known amount/);
assert.match(rendered.chronology, /in date order/);
assert.doesNotMatch(rendered.chronology, /Bills before payday|Income before payday/, "withhold totals that do not reconcile with the dated low point");
assert.equal(SCENARIOS.habitual.data.safe_to_spend, SCENARIOS["one-off"].data.safe_to_spend, "recurrence does not normalise away genuine risk");
assert.equal(SCENARIOS.plans.data.lowest_projected_balance - SCENARIOS.plans.data.buffer, 0);
assert.equal(SCENARIOS.move.data.safe_to_spend, 185);
assert.equal(upcomingPropsFor("chronology").runway, 427, "later income changes the end forecast, not Home's negative low point");
assert.equal(upcomingPropsFor("cards").runway, 352, "Upcoming does not deduct Home's buffer");
for (const [label, href] of [["See your cards", "/cards"], ["Review card bill", "/cards"], ["See what’s due", "/upcoming"], ["Retry", null]]) assert.equal(previewRouteFor(label), href);

const client = readFileSync(new URL("./StsToneClient.tsx", import.meta.url), "utf8");
const wrapper = readFileSync(new URL("./CompleteCard.tsx", import.meta.url), "utf8");
const reference = readFileSync(new URL("./UpcomingColourReference.tsx", import.meta.url), "utf8");
for (const source of [client, wrapper, reference]) assert.doesNotMatch(source, /api\.|fetch\(|localStorage|sessionStorage|—/, "no direct customer operations or forbidden copy");
assert.match(client, /key=\{params\.toString\(\)\}/);
assert.match(client, /masked \? <div[\s\S]*: <CompleteCard/, "legacy mask links do not mount an unmasked card");
assert.match(client, /!masked && <p>\{SCENARIOS\[displayed\]\.note\}/, "masked notes do not leak fixture amounts");
assert.match(wrapper, /onClickCapture=\{captureNavigation\}/);
assert.match(wrapper, /event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\)/);
assert.match(client, /!masked && paired && <UpcomingColourReference/, "privacy gate applies to both cards");
assert.match(wrapper, /\(variant === "a" \|\| variant === "b"\) && cashShort/, "C retains coloured cash risk, not A/B's ink override");
const css = readFileSync(new URL("./sts-tone.module.css", import.meta.url), "utf8");
assert.match(css, /--g287-risk-foreground: var\(--color-rose-700\)/);
assert.match(css, /\.dark \.sharedRisk \{ --g287-risk-foreground: var\(--color-rose-300\)/);
assert.doesNotMatch(css.slice(css.indexOf(".sharedRisk {"), css.indexOf("/* The design shell")), /amber|emerald|background:/, "shared foreground never recolours warning/success or fills surfaces");
assert.doesNotMatch(client + wrapper, /4 of 6|<dialog|aria-modal/, "no unshippable history or replacement sheet");
console.log(`PASS G287: ${SCENARIO_ORDER.length} fixtures × four Home presentations and real Upcoming comparison; exact production content, independent financial lenses, shared semantic colour, unchanged amber/emerald, actions and privacy gate.`);
