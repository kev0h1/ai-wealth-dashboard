import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { accountReading, fixtureFor, isManaged, LIMITS, offerFor, PERIODS, plansFor, PLANS, PRICE_PENCE, periodFor, SCENARIOS } from "./model.ts";

// Read literal configuration only. No backend imports, database or billing calls.
const backend = fileURLToPath(new URL("../../../../backend/app/core/subscription.py", import.meta.url));
const truth = JSON.parse(execFileSync("python3", ["-c", `
import ast, json, sys
from pathlib import Path
tree = ast.parse(Path(sys.argv[1]).read_text())
names = {"TIER_PRICES_GBP", "TIER_BILLING_PRICES_GBP", "SUBSCRIPTION_PERIODS_ENABLED", "SUBSCRIPTION_TRIAL_DAYS", "TIER_LIMITS"}
out = {}
for node in tree.body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in names:
                if target.id == "TIER_LIMITS":
                    out[target.id] = {key.attr.lower(): ast.literal_eval(value) for key, value in zip(node.value.keys, node.value.values)}
                else:
                    out[target.id] = ast.literal_eval(node.value)
print(json.dumps(out))
`, backend], { encoding: "utf8" }));
assert.deepEqual(PERIODS.map(p => p.id), truth.SUBSCRIPTION_PERIODS_ENABLED);
assert.deepEqual(LIMITS, truth.TIER_LIMITS);
for (const plan of PLANS) {
  assert.equal(PRICE_PENCE[plan.id].monthly, Math.round(truth.TIER_PRICES_GBP[plan.id] * 100));
  for (const period of PERIODS) {
    const actual = periodFor(plan.id, period.id);
    const totalPence = Math.round(truth.TIER_BILLING_PRICES_GBP[plan.id][period.id] * 100);
    assert.equal(actual.total, totalPence / 100);
    assert.equal(actual.saving_gbp, Math.max(0, PRICE_PENCE[plan.id].monthly * period.months - totalPence) / 100);
    assert.equal(actual.per_month_gbp, Math.round(totalPence / period.months) / 100);
  }
}
for (const platform of ["web", "ios", "android"]) {
  assert.deepEqual(plansFor(platform, false).map(p => p.id), ["statements", "lite", "standard", "max"]);
  assert.equal(plansFor(platform, true).some(p => p.id === "connect"), platform === "web");
  for (const scenario of SCENARIOS) {
    for (const provider of ["stripe", "apple", "google"]) {
      const fixture = fixtureFor(scenario.id, platform, provider);
      assert.equal(fixture.info.trial_days, truth.SUBSCRIPTION_TRIAL_DAYS);
      assert.deepEqual(fixture.info.limits, truth.TIER_LIMITS[fixture.info.tier]);
      for (const plan of plansFor(platform, true)) for (const period of PERIODS) {
        const reading = accountReading(fixture);
        const offer = offerFor(fixture, platform, plan.id, period.id, "settings");
        if (isManaged(fixture)) {
          assert.equal(offer.kind, "manage");
          assert.equal(offer.provider, fixture.provider);
          assert.match(offer.details.join(" "), /does not start a second subscription/);
          assert.deepEqual(accountReading(fixture), reading); // selection does not mutate renewal
        } else if (plan.id === "statements") {
          assert.equal(offer.kind, "free"); assert.equal(offer.disabled, true);
        } else if (!fixture.priceReady || fixture.phase !== "ready") {
          assert.equal(offer.kind, "unavailable"); assert.equal(offer.disabled, true);
          assert.doesNotMatch(offer.details.join(" "), /free trial/);
        } else if (fixture.eligible === null) {
          assert.equal(offer.kind, "review"); assert.match(offer.details.join(" "), /not confirmed/);
        } else if (fixture.eligible) {
          assert.equal(offer.kind, "trial");
          assert.match(offer.details.join(" "), /31 October 2026/);
          assert.ok(offer.details.some(line => line.includes("Cancel")));
          if (platform === "ios") assert.match(offer.details.join(" "), /24 hours/);
          if (platform === "web") assert.ok(offer.details.includes("Card required."));
        } else {
          assert.equal(offer.kind, "purchase"); assert.match(offer.details.join(" "), /No free trial/);
        }
      }
    }
  }
}
assert.equal(offerFor(fixtureFor("free", "web"), "web", "statements", "annual", "onboarding").disabled, false);
assert.match(accountReading(fixtureFor("cancelled", "web")).detail, /will not renew/);
assert.equal(fixtureFor("legacy-connect", "ios").provider, "stripe");
assert.equal(fixtureFor("legacy-connect", "android").info.tier, "connect");
const ui = readFileSync(new URL("./PlanPickerV2Client.tsx", import.meta.url), "utf8");
assert.match(ui, /previewOnly/);
assert.doesNotMatch(ui, /(?:fetch\(|localStorage|sessionStorage|api\.|\/api\/)/);
assert.match(ui, /role="status"/);
console.log("B50: catalogue, periods, limits, offer eligibility, provider ownership, unavailable states and inert reference passed.");
