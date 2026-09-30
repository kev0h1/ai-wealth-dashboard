import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import { fixtureFor, PERIOD, SCENARIOS } from "../app/design/g176-account-status/fixtures.ts";
import { money, statusFor } from "../lib/upcomingAccountStatus.ts";
import { accountPlan } from "../lib/upcomingPlans.ts";

const renderCard = (state) => renderToStaticMarkup(React.createElement(UpcomingAccountsCard, { ...state, periodLabel: PERIOD, onOpen() {}, onRetry() {} }));
const fixture = fixtureFor("mixed");
const results = fixture.accounts.map((account) => statusFor(account, fixture.plans));
assert.deepEqual(results, [
  { amount: 42, label: "Left after payments", signal: null, estimated: false },
  { amount: 86.35, label: "Left after payments", signal: null, estimated: false },
  { amount: 124.2, label: "Short for payments", signal: "risk", estimated: false },
  { amount: 18.4, label: "Short for plans", signal: "plan", estimated: true },
]);
assert.equal(money(42), "£42.00");
assert.equal(money(-10.06), "−£10.06");
assert.equal(money(1234567.89), "£1,234,567.89");
assert.equal(money(-0), "£0.00");
const paymentGap = fixture.accounts[2];
assert.equal(statusFor({ ...paymentGap, closing: 500 }, fixture.plans).amount, 124.2, "A later credit must not conceal an earlier shortfall");
const zero = statusFor({ ...fixture.accounts[0], closing: 0 }, []);
assert.equal(zero.amount, 0);
assert.equal(zero.label, "Left after payments");

for (const scenario of SCENARIOS) {
  const state = fixtureFor(scenario.id);
  const readyPlans = state.plansStatus === "ready" ? state.plans : [];
  for (const account of state.accounts) {
    const result = statusFor(account, readyPlans);
    const plan = accountPlan(account, readyPlans);
    if (account.status === "short" || account.status === "unfunded") assert.equal(result.amount, account.shortfall);
    else if (plan.uncertain || account.status === "unknown") assert.equal(result.amount, null);
    else assert.equal(result.amount, plan.assigned.length ? (plan.planGap > 0 ? plan.planGap : plan.afterPlans) / 100 : account.closing);
    assert.equal(result.estimated, account.status === "covered" && !plan.uncertain && plan.estimated);
  }
  const html = renderCard(state);
  assert.match(html, /data-account-status-card="b"/, "Production renders approved B");
  assert.equal((html.match(/data-account-row=/g) ?? []).length, state.accounts.length);
  assert.equal((html.match(/data-status-amount=/g) ?? []).length, state.accounts.length);
  assert.doesNotMatch(html, /Savings challenge|Challenge pot/, "By account must contain accounts, not duplicate plan rows");
  if (scenario.id === "empty") assert.match(html, /No account payments are expected/);
  if (scenario.id === "error") assert.match(html, /Try again/);
  if (scenario.id === "loading" || scenario.id === "error") {
    assert.match(html, /Figures show payments only/);
    assert.doesNotMatch(html, /Short for plans|>Estimated</);
  }
}
const resultFor = (state, id) => { const data = fixtureFor(state); return statusFor(data.accounts.find((account) => account.id === id), data.plans); };
assert.deepEqual(resultFor("covered", "monzo"), { amount: 131, label: "Left after plans", signal: null, estimated: false });
assert.deepEqual(resultFor("estimated", "monzo"), { amount: 131, label: "Left after plans", signal: null, estimated: true });
assert.equal(resultFor("moves", "hsbc").signal, "move");
assert.equal(resultFor("moves", "hsbc").label, "Short for transfers");
assert.equal(resultFor("unknown", "monzo").amount, null);
assert.equal(resultFor("overlap", "monzo").label, "Calculation needs checking");

// Freeze B's distinguishing presentation, including the accessible amount/caption.
const mixed = renderCard(fixture);
assert.match(mixed, /aria-label="Open NatWest, Bills account: £42\.00, left after payments"/);
assert.match(mixed, /aria-label="Open HSBC, Current account: £124\.20, short for payments"/);
assert.match(mixed, /aria-label="Open Monzo, Everyday account: £18\.40, short for plans, estimated"/);
assert.match(mixed, /grid-cols-\[2rem_minmax\(0,1fr\)_1rem_minmax\(0,8rem\)\]/, "Fixed badge, signal and amount columns match B");
assert.equal((mixed.match(/lucide-triangle-alert/g) ?? []).length, 1, "Only payment risk uses the warning triangle");
assert.equal((mixed.match(/lucide-info/g) ?? []).length, 1, "Optional plans use an information symbol");
assert.equal((mixed.match(/data-status-signal="none"/g) ?? []).length, 2, "Healthy rows keep an empty marker slot");
assert.match(mixed, /data-status-amount="true"[^>]*font-mono tabular-nums[^>]*>£42\.00</);
assert.match(mixed, /data-status-caption="true"[^>]*font-sans[^>]*>Left after payments</);
assert.match(renderCard(fixtureFor("unknown")), />Unavailable</);
assert.match(renderCard(fixtureFor("overlap")), />Calculation needs checking</);

// The approved preview and live Upcoming page must use one implementation.
const preview = readFileSync(new URL("../app/design/g176-account-status/PreviewClient.tsx", import.meta.url), "utf8");
assert.match(preview, /import UpcomingAccountsCard from "@\/components\/upcoming\/UpcomingAccountsCard"/);
assert.equal((preview.match(/<UpcomingAccountsCard /g) ?? []).length, 1);
assert.doesNotMatch(preview, /AccountStatusCard|statusFor|data-status-amount|Compare with the current card|Proposal only/);
assert.equal(existsSync(new URL("../app/design/g176-account-status/AccountStatusCard.tsx", import.meta.url)), false);
assert.equal(existsSync(new URL("../app/design/g176-account-status/status.ts", import.meta.url)), false);
const page = readFileSync(new URL("../app/planning/PlanningPage.tsx", import.meta.url), "utf8");
assert.match(page, /<UpcomingAccountsCard /);
console.log("G176 approved B: production/preview parity, accessible formatting and unchanged-arithmetic checks passed");
