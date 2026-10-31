import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountPaymentGap, buildUpcomingAccountSummaries, reconcileWithServerPosition } from "../lib/upcomingAccounts.ts";
import { statusFor } from "../lib/upcomingAccountStatus.ts";
import { withCoverSuggestions } from "../lib/coverSuggestion.ts";

// G372: NatWest 667.66, bills 956.31, one predicted income 603.92 with no credit_basis.
const end = Date.parse("2026-11-26T23:59:59Z");
const bill = (name, amount, expected_date) => ({ name, amount, account_id: "nw", account_bank: "natwest", account_name: "The Number One", account_balance: 667.66, expected_date, days_away: 1, kind: "commitment" });
const bills = [bill("British Gas", 159.7, "2026-11-02"), bill("Council", 133, "2026-11-03"), bill("Gym", 117, "2026-11-05"), bill("Water", 62.4, "2026-11-06"), bill("EE", 48.21, "2026-11-09"), bill("Sky", 59.5, "2026-11-11"), bill("TV", 14.5, "2026-11-15"), bill("Car", 362, "2026-11-18")];
const income = (o = {}) => ({ name: "Side income", amount: 603.92, account_id: "nw", expected_date: "2026-11-06", days_away: 4, ...o });
const summarise = (inc) => buildUpcomingAccountSummaries({ upcoming_bills: bills, upcoming_income: inc, internal_inflows: [] }, end)[0];
const pos = (o = {}) => ({ afterPayments: -288.65, lowPoint: -288.65, plansReserved: 0, afterPaymentsAndPlans: -288.65, lowPointAndPlans: -288.65, spendFrom: null, uncertain: false, ...o });

// Walk credit rule: only a server-credited income funds the account.
let walk = summarise([income()]);
assert.equal(walk.closing, -288.65, "uncredited income is not counted");
assert.equal(walk.status, "short");
assert.equal(walk.income, 0);
for (const basis of ["confirmed", "reliable", "steady"]) {
  walk = summarise([income({ credit_basis: basis })]);
  assert.equal(walk.closing, 315.27, `${basis} income is credited`);
  assert.equal(walk.status, "covered");
}

// Verdict: a negative server figure is short on every path, uncertain or not, never covered.
const coveredWalk = summarise([income({ credit_basis: "reliable" })]);
for (const uncertain of [false, true]) {
  const r = reconcileWithServerPosition(coveredWalk, pos({ uncertain }));
  assert.equal(r.status, "short", `uncertain=${uncertain}`);
  assert.equal(r.shortfall, 288.65);
  assert.equal(accountPaymentGap(r), 288.65);
  assert.deepEqual(statusFor(r, []), { amount: 288.65, label: "Short for payments", signal: "risk", estimated: false });
}
// Even an unreconciled summary that carries a negative position reads short, never covered.
const raw = { ...coveredWalk, position: pos() };
assert.equal(accountPaymentGap(raw), 288.65);
assert.equal(statusFor(raw, []).label, "Short for payments");
assert.equal(accountPaymentGap({ ...coveredWalk, position: pos({ afterPayments: 10, lowPoint: 10 }) }), null);
assert.equal(accountPaymentGap(coveredWalk), null);

// A recommended but unmade cover move is never received: attaching it changes no figure.
const short = reconcileWithServerPosition(summarise([income()]), pos());
const [withMove] = withCoverSuggestions([short], [{ type: "move", moves: [{ amount: 300, move_map: { from: { account_id: "bc", name: "Barclays" }, to: { account_id: "nw" } } }] }]);
assert.equal(withMove.closing, short.closing);
assert.equal(withMove.status, "short");
assert.equal(withMove.income, short.income);
assert.equal(withMove.transfersIn, 0);
assert.equal(withMove.coverSuggestion?.amount, 300);
const walkSource = readFileSync(new URL("../lib/upcomingAccountWalk.ts", import.meta.url), "utf8");
assert.ok(!/coverSuggestion|withCoverSuggestions|moves/.test(walkSource.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")), "the walk never reads a cover move");

// Consumer wiring (source assertions): every account figure and verdict reads the reconciled summaries.
const page = readFileSync(new URL("../app/planning/PlanningPage.tsx", import.meta.url), "utf8");
assert.match(page, /const accountSummaries = withCoverSuggestions\(\(accountWalk\?\.accounts \?\? \[\]\)\.map\(\(account\) => reconcileWithServerPosition\(account, accountPositions\[account\.id\]\)\)/);
assert.equal((page.match(/accountWalk\?*\.accounts/g) ?? []).length, 1, "only the reconciling map reads the raw walk accounts");
assert.equal((page.match(/<UpcomingAccountsCard accounts=\{accountSummaries\}/g) ?? []).length, 2);
assert.match(page, /<UpcomingDetailFlow[\s\S]{0,400}?summaries=\{accountSummaries\}/);
const details = readFileSync(new URL("../components/upcoming/UpcomingAccountDetails.tsx", import.meta.url), "utf8");
assert.match(details, /const gap = accountPaymentGap\(account\);\n\s+if \(gap !== null\)/, "the sheet verdict derives short from the payment gap");
assert.ok(details.indexOf("accountPaymentGap(account)") < details.indexOf('"Payments are covered"'), "short is decided before any covered wording");
console.log("g372-natwest-three-answers ok");
