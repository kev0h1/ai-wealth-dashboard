import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import AccountAvailabilityDetail from "../components/AccountAvailabilityDetail.tsx";
import { buildUpcomingAccountSummaries, positionsFromToday, reconcileWithServerPosition } from "../lib/upcomingAccounts.ts";
import { statusFor } from "../lib/upcomingAccountStatus.ts";
import { withCoverSuggestions, coveredByMoveSentence } from "../lib/coverSuggestion.ts";
import { accountAvailability } from "../lib/accountAvailability.ts";

// G410: invented names and figures. Meadow holds 600 against 790 of payments (short 190); a suggested move
// of 200 from Harbour covers it. The earmark fields come straight from the engine's account_eligibility.
const end = Date.parse("2026-11-26T23:59:59Z");
const bill = (name, amount, expected_date) => ({ name, amount, account_id: "mc", account_bank: "natwest", account_name: "Meadow Current", account_balance: 600, expected_date, days_away: 2, kind: "commitment" });
const bills = [bill("Rent share", 450, "2026-11-04"), bill("Broadband", 40, "2026-11-08"), bill("Gym", 35, "2026-11-10"), bill("Insurance", 265, "2026-11-20")];
const walk = buildUpcomingAccountSummaries({ upcoming_bills: bills, upcoming_income: [], internal_inflows: [] }, end)[0];
assert.equal(walk.status, "short");

const accounts = [{ id: "mc", type: "BANK", subtype: "TRANSACTION" }, { id: "hc", type: "BANK", subtype: "TRANSACTION" }];
const base = { short: true, headroom: -200, spend_from_headroom: 0, after_payments: -190, low_point: -190, plans_reserved: 0, after_payments_and_plans: -190, low_point_and_plans: -190, uncertain: false };
const covered = { ...base, covered_by_move: { amount: 200, from: [{ account_id: "hc", name: "Harbour Current", amount: 200 }], shortfall: 190 }, short_after_cover: 0 };
const summarise = (entry) => {
  const positions = positionsFromToday({ mc: entry }, accounts);
  return withCoverSuggestions([reconcileWithServerPosition(walk, positions.mc)], []);
};

// Row: covered reads watch (amber "move"), never the red risk signal, and keeps the walk verdict (short).
let row = summarise(covered)[0];
assert.equal(row.status, "short");
assert.equal(row.coverSuggestion.amount, 200);
assert.deepEqual(statusFor(row, []), { amount: 190, label: "Short, a move would cover it", signal: "move", estimated: false });

// Partial cover: what is still short stays a genuine short (risk).
row = summarise({ ...covered, covered_by_move: { ...covered.covered_by_move, amount: 140, from: [{ account_id: "hc", name: "Harbour Current", amount: 140 }] }, short_after_cover: 50 })[0];
assert.deepEqual(statusFor(row, []), { amount: 50, label: "Short after the suggested move", signal: "risk", estimated: false });

// Dismissed (or no longer needed): the engine leaves the fields off, so the row is plain short again.
row = summarise(base)[0];
assert.equal(row.coverSuggestion, undefined);
assert.deepEqual(statusFor(row, []), { amount: 190, label: "Short for payments", signal: "risk", estimated: false });

// Sentences, British English, no em dashes.
const suggestion = { amount: 200, fromName: "Harbour Current", fromCount: 1, shortAfterCover: 0 };
assert.equal(coveredByMoveSentence("£190", suggestion), "Short £190, covered by the suggested move from Harbour Current.");
assert.equal(coveredByMoveSentence("£190", { ...suggestion, shortAfterCover: 50 }, "£50"), "Short £50 after the suggested move from Harbour Current.");
assert.equal(coveredByMoveSentence("£190", { ...suggestion, fromCount: 2 }), "Short £190, covered by the suggested move from 2 of your other accounts.");

// Sheet verdict: the approved A caution icon is informational, never a red
// payment-risk warning, and all account-sheet figures mask together.
const sheet = (hidden, entry) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingAccountDetails, { account: summarise(entry)[0], periodLabel: "Payments through Wed 25 Nov", plans: [], plansStatus: "ready" })));
let html = sheet(false, covered);
assert.match(html, /data-covered-by-move/);
assert.match(html, /Suggested moves are for you to make\. They are not scheduled payments\./);
assert.doesNotMatch(html, /data-suggested-bridge=/, "the suggestion appears only in activity, not beneath the balance");
assert.match(html, /lucide-info/);
assert.doesNotMatch(html, /lucide-triangle-alert/);
assert.ok(!html.includes("—"));
html = sheet(true, covered);
assert.ok(!/£190|£200/.test(html.replace(/£••••/g, "")), "hidden balances mask every new figure");
html = sheet(false, base);
assert.ok(!html.includes("data-covered-by-move") && html.includes("Payments need more money. No covering move is suggested."));

// Accounts page Available: working shows the set-aside line, the destination is amber when covered, dismiss reverts.
const acct = (o = {}) => ({ id: "hc", name: "Harbour Current", provider: "barclays", type: "BANK", subtype: "TRANSACTION", currency: "GBP", status: "connected", balance: 2000, ...o });
const src = { short: false, headroom: 1990, spend_from_headroom: 1800, after_payments: 2000, low_point: 2000, plans_reserved: 0, after_payments_and_plans: 2000, low_point_and_plans: 2000, uncertain: false, earmarked_total: 200, earmarks_out: [{ to_account_id: "mc", to_name: "Meadow Current", amount: 200 }] };
const reading = accountAvailability(acct(), { status: "ready", positions: { hc: src } });
assert.equal(reading.kind, "ready");
assert.equal(reading.value, 1800);
const working = (r, position, hidden = false) => renderToStaticMarkup(h(AccountAvailabilityDetail, { reading: r, position, hidden, layout: "calm" }));
html = working(reading, src);
assert.ok(html.includes("Set aside for the move to Meadow Current") && html.includes("−£200.00"));
assert.ok(!working(reading, src, true).includes("£200"), "hidden balances mask the set-aside line");
const destReading = accountAvailability(acct({ id: "mc", name: "Meadow Current", balance: 600 }), { status: "ready", positions: { mc: { ...covered, spend_from_headroom: 0 } } });
assert.equal(destReading.warning, "payments");
assert.deepEqual(destReading.coveredByMove, { fromLabel: "Harbour Current", shortAfterCover: 0 });
assert.match(destReading.note, /covered by the suggested move from Harbour Current/);
html = working(destReading, covered);
assert.ok(html.includes("would cover this. Nothing has been moved.") && html.includes("text-amber-800"));
const plain = accountAvailability(acct({ id: "mc", name: "Meadow Current", balance: 600 }), { status: "ready", positions: { mc: { ...base, spend_from_headroom: 0 } } });
assert.equal(plain.coveredByMove, undefined);
assert.match(plain.note, /^Payments look short this pay period\. Open the account/);

// G414: the same move contract covers a plans-only gap. The payment forecast
// remains positive; only the server's plan position is short.
const plansOnly = {
  short: false, headroom: 20, spend_from_headroom: 10, spend_from_requires_move: true,
  after_payments: 40, low_point: 40, plans_reserved: 80,
  after_payments_and_plans: -40, low_point_and_plans: -40, uncertain: false,
  covered_by_move: { amount: 50, from: [{ account_id: "hc", name: "Harbour Current", amount: 50 }], shortfall: 40 },
  short_after_cover: 0,
};
row = withCoverSuggestions([{ ...walk, status: "covered", shortfall: 0, position: positionsFromToday({ mc: plansOnly }, accounts).mc }], [])[0];
assert.equal(row.coverSuggestion.amount, 50);
assert.deepEqual(statusFor(row, []), { amount: 40, label: "Short for plans, a move would cover it", signal: "move", estimated: false });
const planReading = accountAvailability(acct({ id: "mc", name: "Meadow Current", balance: 600 }), { status: "ready", positions: { mc: plansOnly } });
assert.equal(planReading.warning, "plans");
assert.deepEqual(planReading.coveredByMove, { fromLabel: "Harbour Current", shortAfterCover: 0 });
assert.match(planReading.note, /^Plans look short this pay period, covered by the suggested move/);
html = working(planReading, plansOnly);
assert.ok(html.includes("Available after suggested move") && html.includes("would cover this. Nothing has been moved."));

// A combined shortfall remains honest: the £200 recommendation first clears
// the £190 bill gap, leaving £100 of plans short. By account retains both the
// plans warning and the conditional £10 allocation.
const combined = { ...covered, spend_from_headroom: 10, spend_from_requires_move: true,
  after_payments_and_plans: -300, low_point_and_plans: -300,
  covered_by_move: { ...covered.covered_by_move, shortfall: 300 }, short_after_cover: 100 };
row = summarise(combined)[0];
assert.equal(row.coverSuggestion.shortfall, 300);
assert.deepEqual(statusFor(row, []), { amount: 100, label: "Short after the suggested move for plans", signal: "plan", estimated: false });
const byAccount = renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: false }, h(UpcomingAccountsCard, { accounts: [row], periodLabel: "Payments through Wed 25 Nov", plans: [], plansStatus: "ready", onOpen() {} })));
assert.ok(!byAccount.includes("Available") && !byAccount.includes("Spend from"), "By account does not promote the conditional pooled allocation");
assert.match(byAccount, /data-g417-variant="a"/);
assert.match(byAccount.replace(/<[^>]+>/g, ""), /−£300Short/, "the combined payment-and-plan gap leads before the £200 move");
assert.match(byAccount.replace(/<[^>]+>/g, ""), /−£100 after the move, still short/, "the remaining plans-only gap stays explicit after payments are covered");
console.log("G410 earmark checks passed.");
