import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountStatusCard from "../app/design/g176-account-status/AccountStatusCard.tsx";
import { fixtureFor, PERIOD, SCENARIOS } from "../app/design/g176-account-status/fixtures.ts";
import { money, statusFor } from "../app/design/g176-account-status/status.ts";
import { accountPlan } from "../lib/upcomingPlans.ts";

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
  for (const variant of ["a", "b"]) {
    const html = renderToStaticMarkup(React.createElement(AccountStatusCard, { ...state, variant, periodLabel: PERIOD, onOpen() {}, onRetry() {} }));
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
}
const resultFor = (state, id) => { const data = fixtureFor(state); return statusFor(data.accounts.find((account) => account.id === id), data.plans); };
assert.deepEqual(resultFor("covered", "monzo"), { amount: 131, label: "Left after plans", signal: null, estimated: false });
assert.deepEqual(resultFor("estimated", "monzo"), { amount: 131, label: "Left after plans", signal: null, estimated: true });
assert.equal(resultFor("moves", "hsbc").signal, "move");
assert.equal(resultFor("moves", "hsbc").label, "Short for transfers");
assert.equal(resultFor("unknown", "monzo").amount, null);
assert.equal(resultFor("overlap", "monzo").label, "Calculation needs checking");
console.log("G176 account-formatting proposals: all presentation and unchanged-arithmetic checks passed");
