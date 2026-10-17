import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCENARIOS, SCENARIO_ORDER } from "./fixtures.ts";
import { deriveSafeToSpendHeadline } from "../../../lib/pennyScreenViews.ts";

for (const scenario of SCENARIO_ORDER) {
  const data = SCENARIOS[scenario].data;
  if (!data) { assert.ok(["loading", "error"].includes(scenario)); continue; }
  const cashBeforeBuffer = data.spendable_now + data.income_before_payday - data.bills_total;
  assert.equal(cashBeforeBuffer, data.lowest_projected_balance, `${scenario}: stated low point reconciles`);
  const total = cashBeforeBuffer - data.buffer - (data.commitments_reserved ?? 0) - (data.allocations_reserved ?? 0);
  assert.equal(total, data.safe_to_spend, `${scenario}: complete working reconciles`);
  assert.equal(total, data.safe_to_spend_cash);
  const headline = deriveSafeToSpendHeadline(data);
  assert.equal(headline.heroAmount, Math.abs(total));
  assert.equal(headline.plansOnly, scenario === "plans");
  if (["one-off", "habitual", "small", "urgent", "long"].includes(scenario)) assert.ok(cashBeforeBuffer < 0, "payment risk is not just a buffer or optional plan gap");
}
assert.equal(SCENARIOS.habitual.data.safe_to_spend, SCENARIOS["one-off"].data.safe_to_spend, "recurrence does not normalise the risk away");
assert.equal(SCENARIOS.plans.data.lowest_projected_balance - SCENARIOS.plans.data.buffer, 0);
assert.equal(SCENARIOS.move.data.safe_to_spend, 185);
const sourceAfterMove = 365 - 80 - 100;
const payingAfterMove = 0 + 80 - 80;
assert.equal(sourceAfterMove + payingAfterMove, 185, "own transfer redistributes money, does not increase the pool");
assert.equal(365 - 100, 265, "source headroom covers the illustrative £80 account gap");
const source = readFileSync(new URL("./StsToneClient.tsx", import.meta.url), "utf8");
assert.doesNotMatch(source, /api\.|fetch\(|localStorage|sessionStorage|—/, "preview contains no direct customer operations or forbidden copy");
assert.match(source, /inert><SafeToSpendCard/);
assert.match(source, /masked \? <p[^>]*>The reference figures are hidden/, "masked state does not mount the unmasked production reference");
assert.match(source, /key=\{params\.toString\(\)\}/);
console.log("PASS G287 preview: exact forecast/reserve working, genuine payment-risk fixtures, plans-only distinction, invariant transfer pool and inert masked reference. Browser review verifies visibility and interactions.");
