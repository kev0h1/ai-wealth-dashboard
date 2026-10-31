// H140: replay every backend scenario snapshot through the client walks.
//
// backend/tests/test_scenarios.py seeds each synthetic scenario into a
// disposable database, runs the real server functions and commits the computed
// payloads to backend/tests/scenarios/out/<slug>.json. This gate feeds the SAME
// payloads to the code the phone runs (the Upcoming account walk, the server
// position mapping, the account plan and the Accounts availability reading) and
// asserts they agree with the server's positions and with the hand-computed
// `expected` block in backend/tests/scenarios/<slug>.json.
//
// A scenario may list `expected.frontend_known_gaps` (assertion key -> reason) for a
// divergence that is a tracked defect. Each gap is printed on every run, the named
// assertion must still fail, and a gap whose assertion now passes fails the run.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import UpcomingHeroCard from "../components/upcoming/UpcomingHeroCard.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";
import AccountBankEmpty from "../components/AccountBankEmpty.tsx";
import AccountCountRow from "../components/AccountCountRow.tsx";
import { COUNT_TOWARDS_LABEL } from "../components/CountTowardsSafeToSpendRow.tsx";
import { NO_BANK_TRANSACTIONS, SAVINGS_NOT_COUNTED, bankDataTimeLine, isSavingsAccount } from "../lib/accountSheetNotes.ts";
import { accountAvailability } from "../lib/accountAvailability.ts";
import { positionsFromToday, reconcileWithServerPosition, upcomingAccountWindow } from "../lib/upcomingAccounts.ts";
import { walkUpcomingAccounts } from "../lib/upcomingAccountWalk.ts";
import { resolveUpcomingPeriod } from "../lib/upcomingPeriod.ts";
import { accountPlan, assessPlanOverlap, hasPlanSource, isPlanSourceAccount, plansFromApi } from "../lib/upcomingPlans.ts";

const root = new URL("../../backend/tests/scenarios/", import.meta.url);
const slugs = readdirSync(new URL("out/", root)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
assert.ok(slugs.length > 0, "no scenario snapshots found; run backend/tests/test_scenarios.py with SCENARIO_WRITE=1");

const pence = (pounds) => (pounds === null || pounds === undefined ? null : Math.round(pounds * 100));
const money = (pounds) => (pounds === null || pounds === undefined ? null : Math.round(pounds * 100) / 100);
// Same window rule as the server (pay_period.in_current_window), restated here as an
// independent check that the client's end-of-window agrees with it.
const inServerWindow = (daysAway, daysToPay) => daysAway >= 0 && daysAway < daysToPay; // G360: strictly before payday, no lookahead

let checked = 0;
for (const slug of slugs) {
  const snap = JSON.parse(readFileSync(new URL(`out/${slug}.json`, root), "utf8"));
  const spec = JSON.parse(readFileSync(new URL(`${slug}.json`, root), "utf8"));
  const gaps = spec.expected.frontend_known_gaps ?? {};
  const where = `[${slug}]`;
  // One assertion key per check and account ("walk agrees with server positions: acc-bc").
  // A known gap names ONE key: it must still fail (else the gap is stale and the run
  // fails), and every gap is printed with its reason on every run.
  const usedGaps = new Set();
  const assertKey = (key, fn) => {
    if (gaps[key]) {
      usedGaps.add(key);
      let failed = false;
      try { fn(); } catch { failed = true; }
      assert.ok(failed, `${where} stale known gap "${key}": the assertion now passes, delete it from frontend_known_gaps`);
      console.log(`scenarios: known gap in ${slug} (${key}): ${gaps[key]}`);
      return;
    }
    try { fn(); } catch (error) { error.message = `${where} ${key}: ${error.message}`; throw error; }
  };

  const nowMs = Date.parse(`${snap.today}T09:00:00Z`);
  const cashflow = { ...snap.cashflow };
  const accounts = snap.accounts.map((a) => ({ ...a, manual: false, paused: false }));
  const period = resolveUpcomingPeriod(cashflow, { config: spec.pay_period_config, nowMs });
  assert.equal(period.fromServer, true, `${where} period must come from the server payload`);
  const endMs = upcomingAccountWindow(period.end.getTime(), nowMs, period.daysToPayday);
  assert.equal(period.daysToPayday, snap.days_to_payday, `${where} client and server disagree on days to payday`);

  // The page's own composition (PlanningPage.tsx): plans, plan sources, excluded accounts, walk, positions.
  const plans = assessPlanOverlap(plansFromApi(snap.account_plans ?? []), cashflow, endMs, accounts);
  const sourceIds = new Set(plans.filter((p) => p.active && hasPlanSource(p)).map((p) => p.sourceId));
  const excluded = new Set(accounts.filter((a) => a.include_in_safe_to_spend === false).map((a) => a.id));
  const planSources = accounts.filter((a) => sourceIds.has(a.id) && isPlanSourceAccount(a) && !excluded.has(a.id)).map((a) => ({ id: a.id, bank: a.provider, name: a.name, balance: a.balance }));
  const walk = walkUpcomingAccounts(cashflow, endMs, planSources, excluded);
  const positions = positionsFromToday(snap.account_eligibility, accounts) ?? {};

  for (const bill of cashflow.upcoming_bills) {
    assertKey(`window: ${bill.name} ${bill.expected_date}`, () => assert.equal(Date.parse(bill.expected_date) <= endMs, inServerWindow(bill.days_away, snap.days_to_payday),
      `bill ${bill.name} on ${bill.expected_date}: client window (end ${new Date(endMs).toISOString()}) and server window disagree`));
  }

  const sources = new Map();
  for (const account of walk.accounts) {
    for (const event of account.events) if (event.kind === "payment" || event.kind === "movement") sources.set(event.source, (sources.get(event.source) ?? 0) + 1);
  }
  for (const bill of cashflow.upcoming_bills) {
    assertKey(`every bill in exactly one walk: ${bill.name} ${bill.expected_date}`, () => {
      const inWalk = Date.parse(bill.expected_date) <= endMs && !bill.is_credit_card && !bill.observed_pending;
      assert.equal(sources.get(bill) ?? 0, inWalk ? 1 : 0, `bill ${bill.name} on ${bill.expected_date} appears ${sources.get(bill) ?? 0} times across the account walks`);
    });
  }

  for (const [id, entry] of Object.entries(snap.account_eligibility)) {
    assertKey(`positions map: ${id}`, () => {
      const position = positions[id];
      assert.ok(position, `no client position for ${id}`);
      assert.equal(position.afterPayments, entry.after_payments, `${id} after payments`);
      assert.equal(position.uncertain, entry.uncertain, `${id} uncertain`);
      const account = accounts.find((a) => a.id === id);
      const isCurrent = !`${account.type} ${account.subtype}`.toLowerCase().match(/saving|isa/);
      assert.equal(position.spendFrom, isCurrent && !entry.uncertain ? entry.spend_from_headroom : null, `${id} spend from`);
    });
  }

  for (const account of walk.accounts) {
    assertKey(`walk agrees with server positions: ${account.id}`, () => {
      const server = snap.account_eligibility[account.id];
      assert.ok(server, `${account.id} is walked on the client but has no server position`);
      assert.notEqual(account.status, "unknown", `${account.id} walk is unverifiable`);
      assert.equal(money(account.closing), money(server.after_payments), `${account.id} closing (client walk) vs after payments (server)`);
      const serverShort = (server.after_payments ?? 0) < 0 || (server.low_point ?? 0) < 0;
      const clientShort = account.status === "short" || account.status === "unfunded";
      assert.equal(clientShort, serverShort, `${account.id} client status ${account.status} vs server verdict ${serverShort ? "short" : "covered"}`);
    });
    assertKey(`account plan agrees with server: ${account.id}`, () => {
      const server = snap.account_eligibility[account.id];
      const withServer = accountPlan({ ...account, position: positions[account.id] }, plans);
      const clientOnly = accountPlan(account, plans);
      assert.equal(withServer.afterPayments, pence(server.after_payments), `${account.id} accountPlan after payments (server position)`);
      assert.equal(clientOnly.afterPayments, withServer.afterPayments, `${account.id} accountPlan after payments, client fallback vs server`);
      assert.equal(clientOnly.afterPlans, withServer.afterPlans, `${account.id} accountPlan after plans, client fallback vs server`);
    });
  }

  for (const account of accounts) {
    assertKey(`availability: ${account.id}`, () => {
      const reading = accountAvailability({ ...account, currency: account.currency }, { status: "ready", positions: snap.account_eligibility });
      const server = snap.account_eligibility[account.id];
      const isCurrent = !`${account.type} ${account.subtype}`.toLowerCase().match(/saving|isa|credit/);
      if (!isCurrent) { assert.equal(reading, undefined, `${account.id} is not a current account and must show no availability`); return; }
      assert.ok(reading, `${account.id} has no availability reading`);
      if (reading.kind !== "ready") { assert.ok(server.uncertain || server.spend_from_headroom < 0, `${account.id} unavailable although the server has a figure`); return; }
      assert.equal(reading.value, server.spend_from_headroom, `${account.id} availability vs server Spend from`);
      const serverShort = (server.after_payments ?? 0) < 0 || (server.low_point ?? 0) < 0;
      assert.equal(reading.warning === "payments", serverShort, `${account.id} availability warning vs server verdict`);
    });
  }

  for (const [id, want] of Object.entries(spec.expected.accounts ?? {})) {
    assertKey(`expected values (figures shown on the account): ${id}`, () => {
      const reading = accountAvailability(accounts.find((a) => a.id === id), { status: "ready", positions: snap.account_eligibility });
      const spendFrom = want.spend_from ?? want.available;
      if (spendFrom !== undefined) assert.equal(reading.kind === "ready" ? reading.value : 0, spendFrom, `${id} Spend from shown on the account`);
      if (want.after_payments !== undefined) assert.equal(snap.account_eligibility[id].after_payments, want.after_payments, `${id} after payments`);
    });
    const walked = walk.accounts.find((a) => a.id === id);
    if (walked) {
      assertKey(`expected values (client walk): ${id}`, () => {
        if (want.after_payments !== undefined) assert.equal(money(walked.closing), want.after_payments, `${id} after payments`);
        if (want.verdict) assert.equal(walked.status === "covered", want.verdict === "covered", `${id} verdict (client status ${walked.status})`);
      });
    }
  }

  // Backend known gaps (expected.known_gaps) are pinned and policed by test_scenarios.py; the figures
  // asserted above are the pinned current behaviour, so say so on every run.
  for (const [key, gap] of Object.entries(spec.expected.known_gaps ?? {})) {
    console.log(`scenarios: known backend gap in ${slug} (${key}): pinned current figures above, correct figure ${JSON.stringify(gap.correct)}. ${gap.reason}`);
  }

  // Scenario 9, Hide balances (H142): a client preference (PreferencesContext wd_hide_balances) with no
  // server figure, so the gate renders every Upcoming surface this scenario's payload feeds, with the
  // BalancesHiddenContext the page provides. Hidden must leave no pound figure in the text or the aria
  // labels, shown must show them. Payment and income lines are payment amounts, not balances, and stay
  // visible by policy (B55), so each account sheet is checked above its payments list.
  if (spec.expected.hide_balances) {
    const wrap = (hidden, el) => renderToStaticMarkup(React.createElement(BalancesHiddenContext.Provider, { value: hidden }, el));
    const RAW = /£\d/;
    const summaries = walk.accounts.map((account) => reconcileWithServerPosition(account, positions[account.id]));
    const windowIncome = cashflow.upcoming_income.filter((i) => inServerWindow(i.days_away, snap.days_to_payday)).reduce((t, i) => t + i.amount, 0);
    const windowBills = cashflow.upcoming_bills.filter((b) => inServerWindow(b.days_away, snap.days_to_payday) && !b.is_credit_card && !b.observed_pending).reduce((t, b) => t + b.amount, 0);
    const spendableNow = cashflow.spendable_balance;
    const plansReservedTotal = cashflow.plans_reserved ?? 0;
    const runway = spendableNow + windowIncome - windowBills - plansReservedTotal;
    const heroProps = {
      isCalendarMonth: spec.pay_period_config.type === "calendar_month", daysToPayday: snap.days_to_payday, paydayLabel: "Fri 27 Nov",
      spendableNow, runwayIncomeTotal: windowIncome, runwayBillsTotal: windowBills, allocationsRemainingTotal: 0, plansReservedTotal,
      allocationsCount: 0, plansCount: cashflow.plans_count ?? 0, savingsNow: accounts.filter((a) => isSavingsAccount(a)).reduce((t, a) => t + a.balance, 0),
      runway, runwayStatus: runway < 0 ? "short" : "left",
    };
    const renders = [
      ["hero", (hidden) => wrap(hidden, React.createElement(UpcomingHeroCard, heroProps))],
      ["by account", (hidden) => wrap(hidden, React.createElement(UpcomingAccountsCard, { accounts: summaries, periodLabel: "Thu 26 Nov", plans, plansStatus: "ready", onOpen() {} }))],
      ...summaries.map((account) => [`account sheet ${account.id}`, (hidden) => wrap(hidden, React.createElement(UpcomingAccountDetails, { account, periodLabel: "Thu 26 Nov", plans, plansStatus: "ready" })).split(/<section aria-labelledby="[^"]*-events">/)[0]]),
    ];
    assertKey("hide balances masks every money figure", () => {
      for (const [label, render] of renders) {
        const hiddenHtml = render(true);
        assert.doesNotMatch(hiddenHtml, RAW, `${label}: a pound figure is visible while balances are hidden`);
        assert.match(hiddenHtml, /£••••/, `${label}: no mask shown while balances are hidden`);
        const shownHtml = render(false);
        assert.match(shownHtml, RAW, `${label}: no figure shown while balances are visible`);
        assert.doesNotMatch(shownHtml, /£••••/, `${label}: masked while balances are visible`);
      }
      // The same figures are really there to hide: the shown hero carries the pooled balance and the plans reserved.
      const hero = renders[0][1](false);
      assert.match(hero, new RegExp(`£${spendableNow.toLocaleString("en-GB")}(\\.\\d+)?`), "shown hero carries the spendable balance");
      assert.ok(renders.length >= 3, "hero, by account and at least one account sheet rendered");
    });
  }

  // Scenario 10 (A175): a connected savings pot the bank sent no transactions for.
  for (const account of accounts.filter((a) => a.transactions_last_count === 0)) {
    assertKey(`bank empty state and savings line: ${account.id}`, () => {
      // The scenario's own instant: 09:00 London on the day (08:00 UTC in BST), as the backend freezes it.
      const guess = Date.parse(`${snap.today}T09:00:00Z`);
      const londonHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" }).formatToParts(guess).find((p) => p.type === "hour").value);
      const nowEmpty = guess - (londonHour - 9) * 3_600_000;
      const html = renderToStaticMarkup(React.createElement(AccountBankEmpty, { account, now: nowEmpty }));
      assert.ok(html.includes(NO_BANK_TRANSACTIONS), `${account.id}: the empty-state copy is missing`);
      const timeLine = bankDataTimeLine(account, nowEmpty);
      if (timeLine) assert.ok(html.includes(timeLine), `${account.id}: the bank data time line (${timeLine}) is missing`);
      const row = renderToStaticMarkup(React.createElement(AccountCountRow, { account, counted: account.include_in_safe_to_spend !== false, onChange() {} }));
      if (isSavingsAccount(account)) {
        assert.ok(row.includes(SAVINGS_NOT_COUNTED), `${account.id}: the static savings line replaces the switch`);
        assert.ok(!row.includes(COUNT_TOWARDS_LABEL) && !/role="switch"|<button|checkbox/.test(row), `${account.id}: the savings pot still shows a switch`);
      }
    });
  }
  for (const id of spec.expected.not_spendable ?? []) {
    assertKey(`never spendable: ${id}`, () => {
      const account = accounts.find((a) => a.id === id);
      assert.equal(accountAvailability(account, { status: "ready", positions: snap.account_eligibility }), undefined, `${id} must show no availability`);
      assert.equal(positions[id]?.spendFrom ?? null, null, `${id} must carry no Spend from`);
      assert.ok(!walk.accounts.some((a) => a.id === id && (a.status === "short" || a.status === "unfunded")), `${id} is not a payment source`);
    });
  }

  for (const key of Object.keys(gaps)) assert.ok(usedGaps.has(key), `${where} known gap "${key}" matches no assertion key`);
  checked += 1;
}
console.log(`scenarios ok (${checked} scenarios)`);
