// G476: card repayment plans prefill from the card's real history.
// Pins: picking a card defaults the name to "<card> repayment plan" (and never
// overwrites a typed name); the amount step lists recent repayments, preselects
// the usual source and amount, and offers several paying accounts grouped
// rather than picking one; recognising the payment preselects the found card
// leg, else lists the card's recent credits and a search field that calls the
// scoped endpoint; and the copy follows the rules.
// Run: npm run -s check:g476-card-plan-history
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CARD_PLAN_COPY, legMatchFor, legMatchLine, prefillBasisLine, repaymentLine } from "../lib/cardRepaymentPlan.ts";
import { RecentRepayments, RecognisePayment } from "../components/plans/CardPaymentHistory.tsx";

const text = (html) => html.replace(/<[^>]+>/g, "");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sheet = read("components/CommitmentSheet.tsx");
const api = read("lib/api.ts");
const panel = read("components/plans/CardPaymentHistory.tsx");

const pair = { date: "2026-09-24", card_date: "2026-09-26", debit_date: "2026-09-24", amount: 200, source_account_id: "cur", source_account_name: "Example Current", matched: true, narrative: "PAYMENT RECEIVED", fill_rule: { match_type: "description_contains", match_value: "20001" } };
const loose = { ...pair, date: "2026-10-02", card_date: "2026-10-02", debit_date: null, amount: 75, source_account_id: null, source_account_name: null, matched: false, fill_rule: null, narrative: "CARD PYMT" };
const other = { ...pair, source_account_id: "two", source_account_name: "Example Second", amount: 150, fill_rule: { match_type: "description_contains", match_value: "REF2" } };

// ── default name ─────────────────────────────────────────────────────────────
assert.match(sheet, /if \(!nameTouched\.current\) setName\(\(found\.default_name \?\? `\$\{found\.card_name\} repayment plan`\)\.slice\(0, 40\)\)/, "the default name is the server's, unless the user typed one");
assert.match(sheet, /nameTouched\.current = true; setName\(e\.target\.value\)/, "typing a name marks it as the user's");
assert.match(api, /default_name\?: string/);

// ── amount step: recent repayments, usual source and amount, grouped sources ─
assert.match(sheet, /setSourceId\(found\.source_account_id\)/, "the usual paying account is preselected");
assert.match(sheet, /setPerPeriod\(found\.amount != null \? String\(found\.amount\) : ""\)/, "the usual amount is preselected, still an editable fixed amount");
assert.match(sheet, /<RecentRepayments repayments=\{cardHistory\.repayments \?\? \[\]\}/, "the amount step lists the repayments");
assert.match(sheet, /onPickAmount=\{amount => \{ setPerPeriod\(String\(amount\)\)/, "one tap sets a fixed amount from a repayment");
assert.equal(prefillBasisLine("usual_repayments", true), "About, from what you usually pay this card. Change it if you like.");
const one = renderToStaticMarkup(React.createElement(RecentRepayments, { repayments: [pair, loose], sources: [{ account_id: "cur", name: "Example Current", count: 2, usual_amount: 200, last_date: "2026-09-24" }], sourceId: "cur", onPickSource() {}, onPickAmount() {} }));
assert.match(text(one), /About £200\.00 on 24 Sep(?:t)? from Example Current/);
assert.match(text(one), /About £75\.00 on 2 Oct, paying account not found/, "an unmatched credit is listed and says so");
assert.doesNotMatch(one, /role="radiogroup"/, "one paying account needs no choice");
const many = renderToStaticMarkup(React.createElement(RecentRepayments, { repayments: [pair, other], sources: [{ account_id: "cur", name: "Example Current", count: 2, usual_amount: 200, last_date: "2026-09-24" }, { account_id: "two", name: "Example Second", count: 1, usual_amount: 150, last_date: "2026-08-24" }], sourceId: "", onPickSource() {}, onPickAmount() {} }));
assert.match(many, /data-testid="card-plan-source-groups"/, "several paying accounts are shown grouped");
assert.equal((many.match(/aria-checked="false"/g) ?? []).length, 2, "none is picked for the user");
assert.match(text(many), /Usually about £200\.00, 2 payments/);
assert.match(sheet, /onPickSource=\{source => chooseCardSource\(source\.account_id, source\.usual_amount\)\}/);

// ── recognise your payment: found leg, else credits and search ───────────────
assert.equal(legMatchFor([loose, pair], "cur"), pair, "the pair for that paying account");
assert.equal(legMatchFor([pair], "two"), null);
assert.equal(legMatchFor([pair], ""), null);
assert.match(legMatchLine(pair), /Found a payment of about £200\.00 that left Example Current on 24 Sep(?:t)? and appeared on the card on 26 Sep(?:t)?/, "debit and credit may be on different days");
const found = renderToStaticMarkup(React.createElement(RecognisePayment, { cardId: "card", sourceId: "cur", legMatch: pair, credits: [loose], ruleChosen: true, onPickRule() {} }));
assert.match(found, /data-testid="card-leg-match"/);
assert.doesNotMatch(found, /card-plan-search/, "no search when the leg was found");
const missing = renderToStaticMarkup(React.createElement(RecognisePayment, { cardId: "card", sourceId: "cur", legMatch: null, credits: [loose, { ...loose, amount: 40, fill_rule: pair.fill_rule }], ruleChosen: false, onPickRule() {} }));
assert.match(missing, /data-testid="card-plan-recent-credits"/, "the card's recent credits are listed");
assert.match(text(missing), /CARD PYMT/);
assert.match(missing, /id="card-plan-search"/, "a search field is offered");
assert.match(missing, /PAYMENT RECEIVED or 200/, "it hints at raw narrative and amount");
assert.match(missing, /Could not be matched to a payment from your paying account/);
assert.match(sheet, /<RecognisePayment cardId=\{cardId\} sourceId=\{sourceId\} legMatch=\{legMatchFor\(cardHistory\.repayments, sourceId\)\}/, "the tracking step shows it for a new plan");
assert.match(sheet, /ruleChosen=\{rule\.match_value\.trim\(\) !== ""\}/);
assert.match(sheet, /if \(pair\?\.fill_rule\) \{ setRule\(\{ \.\.\.pair\.fill_rule/, "the found pair is preselected as the fill rule");
assert.match(sheet, /setRule\(\{ \.\.\.found\.fill_rule/, "the server's rule is preselected on load");
assert.match(api, /cardPlanSearch: \(cardAccountId: string, sourceAccountId: string, q: string, skip = 0\)/);
assert.match(api, /\/commitments\/card-plan-search\?card_account_id=/);

// ── copy rules ───────────────────────────────────────────────────────────────
const words = [JSON.stringify(CARD_PLAN_COPY), repaymentLine(pair), legMatchLine(pair), panel.replace(/\/\/.*$/gm, "")].join("\n");
assert.doesNotMatch(words, /—|–/, "no em or en dashes in copy");
assert.doesNotMatch(CARD_PLAN_COPY.creditsHelper + CARD_PLAN_COPY.recentHelper + CARD_PLAN_COPY.searchHelper + legMatchLine(pair), /!/, "no exclamation marks");
assert.doesNotMatch(panel, /text-red|bg-red|border-red/, "no red: nothing here is cash risk");
console.log("g476 card plan history: ok");
