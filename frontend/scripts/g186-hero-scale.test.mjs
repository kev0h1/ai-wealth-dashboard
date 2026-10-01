import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SpendHeroScale from "../app/design/spend-hero-scale/SpendHeroScale.tsx";
import { scaleFixture, scaleIncomeFor } from "../app/design/spend-hero-scale/fixtures.ts";
import { STATES } from "../app/design/spend-hero/fixtures.ts";
import { spendHeroModel, spendHeroMoney } from "../lib/spendHero.ts";

const noop = () => {};
const render = (variant, verdict) => renderToStaticMarkup(React.createElement(SpendHeroScale, { variant, verdict, incomeTxns: [], onOutTap: noop, onMovedTap: noop, onTransactionClick: noop }));
const phone = scaleFixture("phone");
assert.equal(Math.round((phone.pills.spent - spendHeroModel(phone).usual) * 100), 66792);
assert.equal(spendHeroModel(phone).totalDays, 35);
assert.equal(scaleIncomeFor(phone)[0].date, "2026-09-25", "The phone example's income belongs to its selected pay period");
assert.equal(scaleIncomeFor(phone)[0].amount, phone.pills.income);
for (const { id } of [{ id: "phone" }, ...STATES]) {
  const verdict = scaleFixture(id);
  for (const variant of ["a", "b"]) {
    const html = render(variant, verdict);
    if (!verdict) { assert.equal(html, ""); continue; }
    const model = spendHeroModel(verdict);
    assert.equal(Math.round((model.named + model.other + model.unresolved) * 100), Math.round(verdict.pills.spent * 100));
    assert.match(html, /How Out adds up/);
    assert.match(html, /Show income payments/);
    assert.match(html, /Moved separately is not included in Out/);
    assert.ok(html.includes(spendHeroMoney(verdict.pills.spent)));
    assert.ok(html.includes(spendHeroMoney(verdict.pills.income)));
    assert.equal(html.includes("Show money moved separately"), model.hasMoved);
    if (id === "early" || id === "nobaseline") assert.doesNotMatch(html, /above usual pace|below usual pace/);
    assert.equal((html.match(/class="glass-hero\b/g) ?? []).length, 1);
  }
}
assert.match(render("a", phone), /text-base font-bold[^>]*>This pay period/);
assert.match(render("b", phone), /Out this pay period/);
assert.match(render("b", phone), /data-out-amount[^>]*text-\[30px\]/);
const source = readFileSync(new URL("../app/design/spend-hero-scale/SpendHeroScale.tsx", import.meta.url), "utf8");
assert.doesNotMatch(source, /break-all|clamp\(/, "Currency stays whole and the product type scale is fixed");
assert.match(source, /spendHeroModel\(verdict\)/, "Proposals use the unchanged live model");
const client = readFileSync(new URL("../app/design/spend-hero-scale/SpendHeroScaleClient.tsx", import.meta.url), "utf8");
assert.match(client, /<SpendPaceHero/);
assert.match(client, /<SpendPaceEvidence/);
assert.doesNotMatch(client, /api\./);
assert.match(client, /shell\.style\.overflowX = "clip"/);
assert.match(client, /prefers-reduced-motion: reduce/);
console.log("G186 smaller-type proposals preserve the real Spend figures and controls");
