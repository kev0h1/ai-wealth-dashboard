// G479 (Kevin 2026-11-19, option A): Left to spend follows each account's day-by-day timing.
//
// Each counted current account contributes its LOWEST balance before payday, money in counted only from
// its expected date; a dip below zero is a shortfall that reduces the total; a covered dip is counted once.
// The fixtures are the REAL server payloads of the backend scenarios (the committed snapshots under
// backend/tests/scenarios/out), so this gate cannot drift from the engine. It checks that the surfaces
// the phone renders read the SAME stored per-account figures: the Home evidence ("How we got" and the dip
// line), the account page working, Spend from and Upcoming By account.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountAvailabilityDetail from "../components/AccountAvailabilityDetail.tsx";
import { accountAvailability, formatAvailabilityAmount } from "../lib/accountAvailability.ts";
import { buildLeftToSpendEvidence, dipNamed, dipReading, dipSentence, DIP_TONE_CLASS } from "../lib/leftToSpendEvidence.ts";
import { bestSpendAccount } from "../lib/spendFromAccount.ts";
import { walkUpcomingAccounts } from "../lib/upcomingAccountWalk.ts";
import { deriveSafeToSpendHeadline, homeForecastPresentation } from "../lib/pennyScreenViews.ts";
const chip = (data) => homeForecastPresentation(data, deriveSafeToSpendHeadline(data)).status.label;

const h = React.createElement;
const root = new URL("../../backend/tests/scenarios/out/", import.meta.url);
const load = (prefix) => {
  const file = readdirSync(root).find((f) => f.startsWith(prefix));
  assert.ok(file, `no scenario snapshot starting ${prefix}`);
  const snap = JSON.parse(readFileSync(new URL(file, root), "utf8"));
  return { snap, accounts: snap.accounts.map((a) => ({ ...a, manual: false, paused: false })) };
};
const text = (html) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ok = (snap) => ({
  status: "ok", ...snap.safe_to_spend, next_payday: "2026-11-27", days_until_payday: snap.days_to_payday, bills_total: 0, income_before_payday: 0,
  buffer: 0, state: snap.safe_to_spend.safe_to_spend <= 0 ? "short" : "comfortable", estimated: false, spendable_now: 0,
});
const reading = (snap, accounts, id) => accountAvailability(accounts.find((a) => a.id === id), { status: "ready", positions: snap.account_eligibility });
const detail = (snap, accounts, id, hidden = false) => {
  const r = reading(snap, accounts, id);
  return { r, html: renderToStaticMarkup(h(AccountAvailabilityDetail, { reading: r, position: snap.account_eligibility[id], hidden, layout: "calm" })) };
};

// ── Kevin's production shape: short before the money lands ──
{
  const { snap, accounts } = load("g479-bill-before-the-income");
  const lines = snap.safe_to_spend.left_to_spend_lines;
  const ev = buildLeftToSpendEvidence(ok(snap), snap.safe_to_spend.safe_to_spend);
  // The status chip reads the same stored low point: short, where the old period totals said "Looks on track".
  assert.equal(chip(ok(snap)), "Short");

  // How we got: the timing-aware accounts line, then the dip line, never period totals.
  // With no plans, set-asides or buffer the accounts line and the total are one figure, so the ledger is one row.
  assert.deepEqual(ev.rows.map((r) => [r.label, r.value]), [["Left to spend at each account's lowest point", -43.02]]);
  assert.match(ev.ledgerNote, /lowest balance before payday/);
  assert.match(ev.ledgerNote, /only from the day it is due/);
  assert.equal(ev.dips.length, 1);
  assert.equal(dipSentence(ev.dips[0], formatAvailabilityAmount, dipNamed(ev.dips[0])), "£43 short on 23 Nov, before about £650 is expected on 26 Nov.");
  assert.equal(dipNamed(ev.dips[0]), false, "one counted account: the line does not name it");
  const masked = dipSentence(ev.dips[0], () => "£••••", false);
  assert.equal(masked, "£•••• short on 23 Nov, before about £•••• is expected on 26 Nov.", "hide balances masks the amounts");

  // The account page reads the same figure: Available -43, working from its lowest balance.
  const { r, html } = detail(snap, accounts, "acc-hb");
  assert.equal(r.value, -43.02);
  assert.equal(r.value, snap.safe_to_spend.safe_to_spend, "the hero and the account agree");
  assert.equal(r.working.basis, -43.02);
  assert.equal(r.working.basisLabel, "Lowest balance before payday");
  assert.deepEqual(r.dip, lines.dips[0] && { short_by: 43.02, short_on: "2026-11-23", money_in_date: "2026-11-26", money_in_amount: 649.59 });
  const t = text(html);
  assert.match(t, /Lowest balance before payday −£43\.02/);
  assert.match(t, /Available to spend −£43\.02/);
  assert.match(t, /£43 short on 23 Nov, before about £650 is expected on 26 Nov\./, "the account says it in the same words as Home");
  assert.doesNotMatch(html, /<button/, "no button on a recommendation");
  const hidden = text(detail(snap, accounts, "acc-hb", true).html);
  assert.doesNotMatch(hidden, /£\d/, "hidden balances leave no pound figure");

  // Spend from lists nothing for a short account; the account's contribution is 0 and the shortfall 43.02.
  const best = bestSpendAccount(snap.account_eligibility, accounts);
  assert.equal(best.kind, "none", "Spend from names no account when the only one is short");
  assert.deepEqual([snap.account_eligibility["acc-hb"].contribution, snap.account_eligibility["acc-hb"].uncovered_shortfall], [0, 43.02]);
}

// ── The same figures with the money first: no dip anywhere ──
{
  const { snap, accounts } = load("g479-income-lands-before-the-bill");
  const ev = buildLeftToSpendEvidence(ok(snap), snap.safe_to_spend.safe_to_spend);
  assert.deepEqual(ev.dips, []);
  assert.equal(chip(ok(snap)), "Looks on track", "the money lands first: no dip, on track");
  assert.equal(ev.rows[0].value, 606.57);
  assert.equal(ev.rows[0].label, "Left to spend at each account's lowest point");
  const { r, html } = detail(snap, accounts, "acc-hb");
  assert.equal(r.value, 606.57);
  assert.doesNotMatch(text(html), /short on/);
  assert.equal(r.dip, undefined);
}

// ── A dip a suggested move covers: counted once, the pair adds up to the headline ──
{
  const { snap, accounts } = load("g479-one-account-dips-another-has-room");
  const hb = detail(snap, accounts, "acc-hb");
  const md = detail(snap, accounts, "acc-md");
  assert.equal(hb.r.value, 710);
  assert.deepEqual(hb.r.working.movesOut.map((m) => m.amount), [290]);
  assert.equal(md.r.value, 14, "-276 plus the 290 suggested move in");
  assert.equal(md.r.working.basis, -276);
  assert.deepEqual(md.r.working.movesIn.map((m) => m.amount), [290]);
  assert.equal(Math.round((hb.r.value + md.r.value) * 100) / 100, snap.safe_to_spend.safe_to_spend, "the dip is counted once: 710 + 14 = 724");
  const ev = buildLeftToSpendEvidence(ok(snap), snap.safe_to_spend.safe_to_spend);
  assert.equal(ev.rows[0].value, 724);
  assert.equal(dipSentence(ev.dips[0], formatAvailabilityAmount, dipNamed(ev.dips[0])), "Meadow Current: £276 short on 23 Nov, before about £500 is expected on 24 Nov.");
  assert.match(text(md.html), /A suggested move from .* would cover this/);
  assert.doesNotMatch(md.html, /<button/);
}

// ── A dip nothing covers reduces the total and stays on its account ──
{
  const { snap, accounts } = load("g479-one-account-dips-and-nothing-can-cover-it");
  const md = reading(snap, accounts, "acc-md");
  assert.equal(md.value, -276);
  assert.equal(md.coveredByMove, undefined);
  assert.equal(snap.safe_to_spend.safe_to_spend, -264);
  assert.equal(reading(snap, accounts, "acc-hb").value + md.value, snap.safe_to_spend.safe_to_spend);
}

// ── Payday and today edge cases ──
{
  const today = load("g479-a-payment-due-today");
  const ev = buildLeftToSpendEvidence(ok(today.snap), today.snap.safe_to_spend.safe_to_spend);
  assert.equal(dipSentence(ev.dips[0], formatAvailabilityAmount, false), "£43 short today.");
  const payday = load("g479-a-bill-and-money-on-payday");
  assert.equal(reading(payday.snap, payday.accounts, "acc-hb").value, 34.89);
  assert.deepEqual(buildLeftToSpendEvidence(ok(payday.snap), 34.89).dips, []);
}

// ── Dip colour: red only for a Short dip nothing covers; a covered or absorbed dip is amber ──
{
  const money = formatAvailabilityAmount;
  const kevin = load("g479-bill-before-the-income").snap.safe_to_spend.left_to_spend_lines.dips[0];
  const short = dipReading(kevin, { short: true }, money);
  assert.equal(short.tone, "risk");
  assert.match(DIP_TONE_CLASS[short.tone], /rose/, "a Short dip is red");
  const covered = load("g479-one-account-dips-another-has-room").snap.safe_to_spend.left_to_spend_lines.dips[0];
  const c = dipReading(covered, { short: false, coveredIds: [covered.account_id] }, money);
  assert.equal(c.tone, "covered");
  assert.doesNotMatch(DIP_TONE_CLASS[c.tone], /rose/, "a covered dip is not red");
  assert.equal(c.text, "Meadow Current dips £276 on 23 Nov; a move would cover it.");
  // Covered wins even when the total is Short, and a dip the other accounts absorb is amber, not red.
  assert.equal(dipReading(covered, { short: true, coveredIds: [covered.account_id] }, money).tone, "covered");
  const absorbed = dipReading(covered, { short: false }, money);
  assert.equal(absorbed.tone, "watch");
  assert.doesNotMatch(DIP_TONE_CLASS[absorbed.tone], /rose/);
  assert.ok(!/\u2014|!/.test(c.text));
}

{
  const card = readFileSync(new URL("../components/SafeToSpendCard.tsx", import.meta.url), "utf8");
  const list = readFileSync(new URL("../components/SafeToSpendDisclosures.tsx", import.meta.url), "utf8");
  for (const [name, src] of [["hero", card], ["disclosure list", list]]) {
    assert.match(src, /DIP_TONE_CLASS\[/, `${name} takes the dip colour from the tone`);
    assert.ok(!/data-g479-dip[^>]*rose/.test(src), `${name} never hard-codes red on the dip line`);
  }
}

// ── Upcoming By account reads the same dip as the ledger (the client walk, replayed on the snapshots) ──
{
  for (const prefix of ["g479-bill-before-the-income", "g479-one-account-dips-another-has-room", "g479-one-account-dips-and-nothing-can-cover-it"]) {
    const { snap, accounts } = load(prefix);
    for (const [id, entry] of Object.entries(snap.account_eligibility)) {
      if (!entry.is_current_account) continue;
      const serverShort = Math.max(0, -Math.min(entry.after_payments ?? 0, entry.low_point ?? 0));
      assert.equal(Math.round(serverShort * 100), Math.round((entry.dips_below_zero?.short_by ?? 0) * 100), `${prefix} ${id}: Upcoming/cover shortfall equals the ledger dip`);
    }
  }
}

// ── One rule everywhere (Kevin 2026-11-19, option 1): a transfer counts on BOTH legs even when its source cannot fund it ──
{
  const { snap, accounts } = load("g479-a-transfer-counts-on-both-legs");
  assert.equal(snap.safe_to_spend.safe_to_spend, 30, "the pooled 100 + 50 - 120");
  assert.equal(reading(snap, accounts, "acc-hb").value + reading(snap, accounts, "acc-md").value, 30, "the two accounts add up to the hero");
  assert.equal(reading(snap, accounts, "acc-hb").value, -200, "Harbour, the source, carries the shortfall; Meadow, the destination, is never offered as its lender");
  assert.equal(snap.account_eligibility["acc-hb"].covered_by_move, undefined);
  assert.equal(snap.account_eligibility["acc-md"].earmarks_out, undefined);
  const walk = walkUpcomingAccounts(snap.cashflow, Date.parse("2026-11-26T23:59:59Z"), [], new Set());
  const hb = walk.accounts.find((a) => a.id === "acc-hb");
  const md = walk.accounts.find((a) => a.id === "acc-md");
  assert.equal(hb.closing, -200, "the client deducts the order from Harbour");
  assert.equal(hb.status, "short");
  assert.equal(md.closing, 230, "and credits Meadow, never flagging it short for a transfer due to arrive");
  assert.equal(md.status, "covered");
  assert.equal(hb.closing, snap.account_eligibility["acc-hb"].after_payments);
  assert.equal(md.closing, snap.account_eligibility["acc-md"].after_payments);
  assert.equal(snap.account_eligibility["acc-hb"].dips_below_zero.short_by, 200, "the ledger dip is the same 200");
  assert.equal(snap.account_eligibility["acc-md"].dips_below_zero, undefined);
}

// ── No copy rule broken: British English, no em dashes, no exclamation marks, hedged predictions ──
{
  const files = ["lib/leftToSpendEvidence.ts", "lib/accountAvailability.ts", "components/AccountAvailabilityDetail.tsx"];
  for (const file of files) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const strings = [...src.matchAll(/`([^`]*)`|"([^"\n]*)"/g)].map((m) => m[1] ?? m[2]).filter((s) => /short|lowest|expected/i.test(s));
    for (const s of strings) assert.ok(!/\u2014|[A-Za-z.]!(\s|$)/.test(s), `${file}: "${s}" breaks the copy rules`);
  }
}

console.log("g479 low point ok");
