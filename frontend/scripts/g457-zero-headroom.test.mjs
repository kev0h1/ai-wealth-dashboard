// G457: Penny's Home line and the Left to spend card chip must agree at and
// around £0. Both read lib/pennyScreenViews.ts (classifyLeftToSpend).
// Run: npm run -s check:g457-zero-headroom
import assert from "node:assert/strict";
import { homeBriefFallbackText, homeForecastPresentation, deriveSafeToSpendHeadline } from "../lib/pennyScreenViews.ts";

const payday = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
const make = (free, over = {}) => ({
  status: "ok", calculation_status: "complete",
  safe_to_spend: free, safe_to_spend_cash: free,
  state: free < 0 ? "short" : free < 100 ? "tight" : "comfortable",
  next_payday: payday, days_until_payday: 10,
  bills_total: 50, buffer: 0, allocations_reserved: 0, commitments_reserved: 0,
  spendable_now: free + 50, income_before_payday: 0,
  lowest_projected_balance: Math.max(free, 0),
  ...over,
});
const HEADROOM = /has headroom/;
const NOTHING = /nothing left to spend/;
const SHORT = /short this pay period/;

const cases = [
  ["exactly £0 (comfortable state)", make(0, { state: "comfortable" }), "No headroom", NOTHING],
  ["exactly £0 (tight state)", make(0), "No headroom", NOTHING],
  ["-£0.40", make(-0.4), null, SHORT],
  ["-£1.00", make(-1), null, SHORT],
  ["+£0.40", make(0.4), "Tight", null],
  ["comfortable £500", make(500, { spendable_now: 600 }), "Looks on track", HEADROOM],
];
for (const [name, data, chip, line] of cases) {
  const text = homeBriefFallbackText(data);
  const label = homeForecastPresentation(data, deriveSafeToSpendHeadline(data)).status.label;
  if (chip) assert.equal(label, chip, `${name}: chip`);
  else assert.ok(["Short", "Below buffer", "Plans gap"].includes(label), `${name}: chip is a shortfall (${label})`);
  if (line) assert.match(text, line, `${name}: line "${text}"`);
  if (label === "No headroom" || label === "Short") assert.doesNotMatch(text, HEADROOM, `${name}: no headroom claim`);
  if (label === "No headroom") assert.match(text, NOTHING, `${name}: agrees with chip`);
  if (label === "Short") assert.match(text, SHORT, `${name}: agrees with chip`);
  assert.doesNotMatch(text, /—|!/, `${name}: copy rules`);
}
// +£0.40 is a real sliver: tight, never the headroom claim.
assert.doesNotMatch(homeBriefFallbackText(make(0.4)), HEADROOM);
// Never claims bills are covered when the forecast is unknown or degraded.
const unknown = make(0, { calculation_status: "degraded" });
assert.doesNotMatch(homeBriefFallbackText(unknown), /covered so far/);
assert.match(homeBriefFallbackText(unknown), NOTHING);
assert.doesNotMatch(homeBriefFallbackText(make(0, { lowest_projected_balance: null })), /covered so far/);
import { readFileSync } from "node:fs";
const brief = readFileSync(new URL("../components/HomeBrief.tsx", import.meta.url), "utf8");
assert.match(brief, /homeBriefFallbackText\(safeToSpend/, "HomeBrief reads the shared classifier");
assert.ok(!brief.includes("Your estimate has headroom"), "no inline headroom line left in HomeBrief");
console.log("g457 zero headroom: ok");

// Reconnect: outranks every verdict branch and insufficient_data, never a first sync.
{
  const one = homeBriefFallbackText(make(500, { spendable_now: 600 }), ["Barclays"]);
  assert.equal(one, "Barclays needs reconnecting, so your estimate isn't counting it yet.");
  const many = homeBriefFallbackText(make(500, { spendable_now: 600 }), ["Barclays", "Monzo"]);
  assert.equal(many, "2 banks need reconnecting, so your estimate isn't counting them yet.");
  for (const data of [make(0), make(0, { state: "comfortable" }), make(-0.4), make(0.4), make(20), { status: "insufficient_data" }]) {
    const t = homeBriefFallbackText(data, ["Barclays"]);
    assert.match(t, /needs reconnecting/, "reconnect wins");
    assert.doesNotMatch(t, /Nothing needs you|headroom|nothing left/i);
    assert.doesNotMatch(t, /—|!/);
  }
  assert.match(homeBriefFallbackText(make(0, { calculation_status: "syncing" }), ["Barclays"]), /first sync is still running/, "first sync outranks reconnect");
  assert.equal(homeBriefFallbackText(make(0), []), homeBriefFallbackText(make(0)), "empty list changes nothing");
  assert.match(brief, /reconnectNames/, "HomeBrief passes the list");
  const page = readFileSync(new URL("../app/components/HomePage.tsx", import.meta.url), "utf8");
  assert.match(page, /reconnectNames=\{reconnectNames\}/, "HomePage feeds it from expiredProviders");
  console.log("g457 reconnect line: ok");
}
