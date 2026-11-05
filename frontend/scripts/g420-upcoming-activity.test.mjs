import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import { accountHasPeriodActivity, accountsWithPeriodActivity } from "../lib/upcomingAccounts.ts";

// G420: By account lists only accounts with something in the period. Invented data.
const base = (id, extra = {}) => ({ id, bank: `Bank ${id}`, name: "Current account", opening: 40, income: 0, transfersIn: 0, outgoing: 0, closing: 40, shortfall: 0, status: "covered", firstShortDate: null, hasUnassignedIncome: false, events: [], ...extra });
const pay = { id: "p", name: "Gym", amount: -20, kind: "payment", date: "2026-11-06", after: 20 };
const idle = base("idle");
const withPayment = base("pay", { events: [pay], closing: 20 });
const moveOnly = base("move", { suggestedMoves: [{ id: "m", counterpartId: "pay", counterpartName: "Bank pay", amount: -15, byDate: "2026-11-06" }] });
const earmarkOnly = base("earmark", { position: { afterPayments: 40, lowPoint: 40, plansReserved: 0, afterPaymentsAndPlans: 40, lowPointAndPlans: 40, spendFrom: 40, uncertain: false, earmarksOut: [{ toAccountId: "pay", toName: "Bank pay", amount: 15 }], earmarkedTotal: 15 } });
const shortOnly = base("short", { status: "short", shortfall: 12 });
const plan = { id: "pl", kind: "allocation", name: "Holiday", destination: "Pot", sourceId: "planonly", evidence: "chosen", periodPence: 5000, filledPence: 0, active: true };
const planOnly = base("planonly");

assert.equal(accountHasPeriodActivity(idle, undefined, []), false, "no items: omitted");
assert.equal(accountHasPeriodActivity(withPayment, undefined, []), true);
assert.equal(accountHasPeriodActivity(moveOnly, undefined, []), true, "only a suggested move: shown");
assert.equal(accountHasPeriodActivity(earmarkOnly, earmarkOnly.position, []), true, "only an earmark: shown");
assert.equal(accountHasPeriodActivity(shortOnly, undefined, []), true, "only a shortfall: shown");
assert.equal(accountHasPeriodActivity(planOnly, undefined, [plan]), true, "only a plan: shown");
assert.equal(accountHasPeriodActivity(planOnly, undefined, [{ ...plan, active: false }]), false, "inactive plan does not count");
assert.deepEqual(accountsWithPeriodActivity([idle, withPayment, planOnly], [plan]).map((a) => a.id), ["pay", "planonly"]);

const render = (accounts, plansStatus = "ready", plans = []) => renderToStaticMarkup(h(UpcomingAccountsCard, { accounts, periodLabel: "Payments through Sun 29 Nov", onOpen() {}, plans, plansStatus }));
const fineCount = (html) => Number((html.match(/(\d+) accounts? (?:is|are) fine/) ?? [])[1] ?? 0);

const listed = accountsWithPeriodActivity([idle, withPayment, base("pay2", { events: [pay], closing: 20 })], []);
assert.equal(fineCount(render(listed)), 2, "fine count excludes the omitted account");
assert.equal(fineCount(render([withPayment, base("pay2", { events: [pay], closing: 20 })])), 2);

assert.equal(render(accountsWithPeriodActivity([idle, base("idle2")], [])), "", "all omitted: nothing renders");
assert.ok(!render([]).includes("By account"));
const loading = render([], "loading");
assert.ok(loading.includes("Checking goals") && !loading.includes("By account"), "loading state kept, no heading");
const errored = render([], "error");
assert.ok(errored.includes("could not be checked"), "error state kept");
// A filled plan stays active but must not keep an idle account listed.
assert.equal(accountHasPeriodActivity(planOnly, undefined, [{ ...plan, filledPence: 5000 }]), false, "filled active plan does not list an idle account");
assert.equal(accountHasPeriodActivity(planOnly, undefined, [{ ...plan, filledPence: 5000, amountUnavailable: true }]), true, "unreadable plan amount is listed");
assert.equal(accountHasPeriodActivity(planOnly, undefined, [{ ...plan, remainingPence: 1200, filledPence: 5000 }]), true, "live remainder wins");

// Loading: no plans yet. A server-reserved account stays through loading and ready, so it never pops out then in.
const reserved = base("reserved", { position: { afterPayments: 40, lowPoint: 40, plansReserved: 50, afterPaymentsAndPlans: -10, lowPointAndPlans: -10, spendFrom: 0, uncertain: false } });
const loadingList = accountsWithPeriodActivity([idle, reserved], []).map((a) => a.id);
const readyList = accountsWithPeriodActivity([idle, reserved], [{ ...plan, sourceId: "reserved" }]).map((a) => a.id);
assert.deepEqual(loadingList, ["reserved"]);
assert.deepEqual(loadingList, readyList, "list is stable across plan loading");
console.log("g420 upcoming activity: ok");
