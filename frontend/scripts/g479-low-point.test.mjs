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
import { buildLeftToSpendEvidence, dipNamed, dipSentence } from "../lib/leftToSpendEvidence.ts";
import { bestSpendAccount } from "../lib/spendFromAccount.ts";
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

// ── No copy rule broken: British English, no em dashes, no exclamation marks, hedged predictions ──
{
  const files = ["lib/leftToSpendEvidence.ts", "lib/accountAvailability.ts", "components/AccountAvailabilityDetail.tsx"];
  for (const file of files) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const strings = [...src.matchAll(/`([^`]*)`|"([^"\n]*)"/g)].map((m) => m[1] ?? m[2]).filter((s) => /short|lowest|expected/i.test(s));
    for (const s of strings) assert.ok(!/—|!/.test(s.replace(/!==?/g, "")), `${file}: "${s}" breaks the copy rules`);
  }
}

console.log("g479 low point ok");
