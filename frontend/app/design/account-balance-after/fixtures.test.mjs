import assert from "node:assert/strict";
import { CASES, getFixture } from "./fixtures.ts";

const epsilon = 1e-9;
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < epsilon, `${label}: expected ${expected}, got ${actual}`);

assert.deepEqual(CASES.map(({ value }) => value), ["mixed", "unknown", "early", "plans", "excluded", "loading", "stale", "long", "pence"]);

function assertReportedArithmetic(fixture, id) {
  const item = fixture.current.find((candidate) => candidate.account.id === id);
  assert.ok(item?.position, `${id}: a reported server position exists`);
  const payments = item.events.filter((event) => event.kind === "payment").reduce((sum, event) => sum + event.amount, 0);
  const income = item.events.filter((event) => event.kind === "income").reduce((sum, event) => sum + event.amount, 0);
  const plans = item.events.filter((event) => event.kind === "plan").reduce((sum, event) => sum + event.amount, 0);
  close(item.account.balance + income - payments, item.position.after_payments, `${id}: after payments`);
  close(item.account.balance + income - payments - plans, item.position.after_payments_and_plans, `${id}: after payments and plans`);
  close(plans, item.position.plans_reserved, `${id}: plan reserve counted once`);
}

function assertOrderedPaymentLows(fixture) {
  for (const item of fixture.current) {
    const position = item.position;
    if (!position || position.uncertain) continue;
    let running = item.account.balance;
    let low = running;
    for (const event of [...item.events]
      .filter((event) => event.kind !== "plan")
      .sort((left, right) => left.date.localeCompare(right.date))) {
      running += event.kind === "income" ? event.amount : -event.amount;
      low = Math.min(low, running);
    }
    const reserved = item.events.filter((event) => event.kind === "plan").reduce((sum, event) => sum + event.amount, 0);
    close(low, position.low_point, `${item.account.id}: ordered payment low point`);
    close(low - reserved, position.low_point_and_plans, `${item.account.id}: plans reserve stays separate from payment walk`);
  }
}

const mixed = getFixture("mixed");
for (const id of ["acc1", "acc2", "acc3", "acc4", "acc5", "acc6"]) assertReportedArithmetic(mixed, id);
assertOrderedPaymentLows(mixed);
assert.equal(mixed.current.reduce((sum, item) => sum + item.account.balance, 0), 486, "six current bank balances total £486");
assert.equal(
  mixed.current.reduce((sum, item) => sum + item.account.balance, 0) + mixed.other.reduce((sum, item) => sum + item.balance, 0),
  -255,
  "eight bank accounts total -£255 net worth",
);

const early = getFixture("early");
assertReportedArithmetic(early, "acc4");
assertOrderedPaymentLows(early);
const earlyPosition = early.current.find((item) => item.account.id === "acc4").position;
assert.equal(earlyPosition.low_point, -39, "the earlier payment gap is not hidden by later income");
assert.equal(earlyPosition.low_point_and_plans, -59, "plan reserve remains separate from the ordered payment walk");
assert.equal(earlyPosition.spend_from_headroom, 0, "Spend from does not claim closing cash across an earlier gap");

const plans = getFixture("plans");
assertReportedArithmetic(plans, "acc3");
assertOrderedPaymentLows(plans);
const plansPosition = plans.current.find((item) => item.account.id === "acc3").position;
assert.equal(plansPosition.after_payments, 52, "plans-only case retains the payments figure");
assert.equal(plansPosition.after_payments_and_plans, -28, "plans-only case reports the separate plan consequence");

const unknown = getFixture("unknown");
assert.equal(unknown.current.find((item) => item.account.id === "acc3").position, null, "unknown is not £0");
const uncertain = unknown.current.find((item) => item.account.id === "acc5").position;
assert.equal(uncertain.uncertain, true);
assert.equal(uncertain.after_payments_and_plans, null, "uncertain combined figure is withheld");

const excluded = getFixture("excluded");
const excludedAccount = excluded.current.find((item) => item.account.id === "acc2");
assert.equal(excludedAccount.account.include_in_safe_to_spend, false);
assert.equal(excludedAccount.position, null, "excluded account receives no invented position");

const loading = getFixture("loading");
assert.equal(loading.phase, "loading");
assert.ok(loading.current.every((item) => item.position === null), "loading is not a zeroed position");
const stale = getFixture("stale");
assert.equal(stale.phase, "stale");
assertOrderedPaymentLows(stale);
assertOrderedPaymentLows(getFixture("long"));

const pence = getFixture("pence");
assertReportedArithmetic(pence, "acc6");
assertOrderedPaymentLows(pence);
assert.equal(pence.current.find((item) => item.account.id === "acc6").position.after_payments_and_plans, -0.2, "pence sign is retained");

console.log("account-balance-after fixtures: ok");
