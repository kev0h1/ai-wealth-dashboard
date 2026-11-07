// G436 (Kevin 2026-11-07): Left to spend and each account's Available are what is
// left after payments, goals and set-asides, account by account. Nothing is shared
// out across preferred accounts.
//
// The fixtures are the REAL server payloads of the backend scenarios (the committed
// snapshots under backend/tests/scenarios/out), so this gate cannot drift from the
// engine: Kevin's production shape (three current accounts, a healthy account with
// 116 after payments), a covered shortfall (earmark out, move in) and a shortfall
// only savings can cover.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountAvailabilityDetail from "../components/AccountAvailabilityDetail.tsx";
import SpendFromAccountList from "../components/SpendFromAccountList.tsx";
import { accountAvailability, formatAvailabilityAmount } from "../lib/accountAvailability.ts";
import { buildLeftToSpendEvidence } from "../lib/leftToSpendEvidence.ts";
import { bestSpendAccount, spendFromTreatmentPlan, topSpendFromAccounts } from "../lib/spendFromAccount.ts";

const h = React.createElement;
const root = new URL("../../backend/tests/scenarios/out/", import.meta.url);
const load = (prefix) => {
  const file = readdirSync(root).find((f) => f.startsWith(prefix));
  assert.ok(file, `no scenario snapshot starting ${prefix}`);
  const snap = JSON.parse(readFileSync(new URL(file, root), "utf8"));
  const accounts = snap.accounts.map((a) => ({ ...a, manual: false, paused: false }));
  return { snap, accounts };
};
const text = (html) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const detail = (account, snap, accounts) => {
  const position = snap.account_eligibility[account];
  const reading = accountAvailability(accounts.find((a) => a.id === account), { status: "ready", positions: snap.account_eligibility });
  return { reading, position, html: renderToStaticMarkup(h(AccountAvailabilityDetail, { reading, position, hidden: false, layout: "calm" })) };
};

// ── Kevin's production shape (invented figures): a healthy account never reads 0 ──
{
  const { snap, accounts } = load("g436-healthy-account-keeps-its-own-figure");
  const figure = (id) => accountAvailability(accounts.find((a) => a.id === id), { status: "ready", positions: snap.account_eligibility }).value;
  assert.deepEqual([figure("acc-bc"), figure("acc-mz"), figure("acc-hs")], [1200, 375, 116], "each account shows its own figure");
  assert.notEqual(figure("acc-hs"), 0, "HSBC has 116 after its payments and nothing else on it: never 0");
  const sum = figure("acc-bc") + figure("acc-mz") + figure("acc-hs");
  const lines = snap.safe_to_spend.left_to_spend_lines;
  assert.equal(sum, lines.accounts_total, "the account figures add up with no allocation step");
  assert.equal(snap.safe_to_spend.safe_to_spend, sum - lines.plans_total, "Left to spend is that sum less the set-aside held on no account");
  assert.equal(lines.plans_total, 300);

  // Home Spend from: the top two by this figure, positive only.
  const result = bestSpendAccount(snap.account_eligibility, accounts);
  assert.deepEqual(topSpendFromAccounts(result.entries).map((e) => e.accountId), ["acc-bc", "acc-mz"]);
  const plan = spendFromTreatmentPlan(result, () => true);
  const list = renderToStaticMarkup(h(SpendFromAccountList, { entries: plan.entries, amount: formatAvailabilityAmount, coverMoveVisible: false, onLogoError() {}, kind: "bank-rail" }));
  assert.deepEqual([...list.matchAll(/data-spend-from-account="([^"]+)"/g)].map((m) => m[1]), ["acc-bc", "acc-mz"]);
  assert.ok(list.includes("£1,200") && list.includes("£375") && !list.includes("£116"), "two rows, whole pounds");

  // Account page working: After payments and plans, then Available, one line each.
  const { html, reading } = detail("acc-hs", snap, accounts);
  assert.ok(reading.working && reading.working.basis === 116 && reading.working.movesIn.length === 0 && reading.working.movesOut.length === 0);
  const t = text(html);
  assert.equal((t.match(/After payments and plans/g) ?? []).length, 1, "the same figure is not repeated");
  assert.match(t, /After payments and plans £116\.00/);
  assert.match(t, /Available to spend £116\.00/);
  assert.doesNotMatch(t, /After scheduled payments|Plans held back|Lowest after payments|Lowest after plans/, "the repeated rows are collapsed");

  // Home's Full calculation: the accounts line, then the set-aside, then Left to spend.
  const ev = buildLeftToSpendEvidence({
    status: "ok", ...snap.safe_to_spend, next_payday: "2026-11-27", days_until_payday: 18, bills_total: 259, income_before_payday: 0,
    buffer: 0, state: "comfortable", estimated: false, spendable_now: 1950,
  }, snap.safe_to_spend.safe_to_spend);
  assert.deepEqual(ev.rows.map((r) => [r.label, r.value]), [
    ["Your current accounts, each at its lowest before payday", 1691], ["Set-asides", -300], ["Left to spend", 1391],
  ]);
}

// ── A shortfall covered by a move between current accounts: earmark out, move in, nets to zero ──
{
  const { snap, accounts } = load("g410-earmark-suggested-move");
  const src = detail("acc-hc", snap, accounts);
  const dest = detail("acc-mc", snap, accounts);
  assert.equal(src.reading.value, 1800, "the source shows what is left after setting the move aside");
  assert.deepEqual(src.reading.working.movesOut.map((m) => m.amount), [200]);
  assert.match(text(src.html), /Set aside for the move to .* −£200\.00/);
  assert.equal(dest.reading.value, 10, "the destination counts the suggested move in from a current account");
  assert.equal(dest.reading.requiresMove, true);
  assert.deepEqual(dest.reading.working.movesIn.map((m) => m.amount), [200]);
  assert.equal(dest.reading.working.basis, -190);
  assert.match(text(dest.html), /Available after suggested move/);
  assert.match(text(dest.html), /Suggested move in from .* £200\.00/);
  assert.equal(src.reading.value + dest.reading.value, snap.safe_to_spend.safe_to_spend, "the moves net to zero in the total");
  assert.doesNotMatch(dest.html, /<button/, "a move is a recommendation sentence, never a button");
}

// ── A shortfall only savings can cover: shown, never counted ──
{
  const { snap, accounts } = load("g428-salary-account-short");
  const bc = detail("acc-bc", snap, accounts);
  assert.equal(bc.reading.value, -1050, "−1,200 plus the 150 from current accounts; the 1,060 from savings is not counted");
  assert.equal(bc.reading.working.savingsMove.amount, 1060);
  assert.deepEqual(bc.reading.working.movesIn.map((m) => m.amount).sort((a, b) => a - b), [50, 100]);
  const t = text(bc.html);
  assert.match(t, /A suggested move of £1,060 from .* would cover the rest\. It counts once you make the move\./);
  assert.match(t, /Available to spend −£1,050\.00/);
  assert.equal(
    ["acc-bc", "acc-hs", "acc-mz"].reduce((n, id) => n + accountAvailability(accounts.find((a) => a.id === id), { status: "ready", positions: snap.account_eligibility }).value, 0),
    snap.safe_to_spend.safe_to_spend, "the figures, the negative one included, add up to Left to spend");
}

// ── A shortfall no account covers stays negative on its account and reduces the total ──
{
  const { snap, accounts } = load("g422-own-savings-standing-order-nothing");
  const bc = accountAvailability(accounts.find((a) => a.id === "acc-bc"), { status: "ready", positions: snap.account_eligibility });
  assert.equal(bc.kind, "ready");
  assert.equal(bc.value, -200);
  assert.equal(snap.safe_to_spend.safe_to_spend, -200);
}

// ── The allocation copy is gone from every surface ──
{
  const banned = [/allocation of your shared/i, /shared Left to spend/, /Adding the account amounts/, /cannot yet be safely allocated/, /Allocated from your/, /Your other accounts make up the rest/, /of your estimate\./];
  const files = ["components/AccountAvailabilityDetail.tsx", "components/SpendFromAccountList.tsx", "components/SafeToSpendCard.tsx", "lib/accountAvailability.ts", "lib/spendFromAccount.ts", "lib/leftToSpendEvidence.ts", "lib/upcomingAccounts.ts", "lib/upcomingPlans.ts"];
  for (const file of files) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const pattern of banned) assert.ok(!pattern.test(src), `${file} still carries ${pattern}`);
    assert.ok(!/allocation_unassigned|allocation_order|spend_from_capped|account_headroom_raw/.test(src.replace(/\/\/.*$/gm, "")), `${file} still reads a retired G414 field`);
  }
}

console.log("g436 account by account ok");
