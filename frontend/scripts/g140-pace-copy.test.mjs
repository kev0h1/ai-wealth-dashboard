// Pure production copy-model checks for G140. Preview A imports the actual
// evidence component rather than reproducing its ledger markup.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { derivePaceCopy, formatSignedMoney } from "../lib/spendPaceCopy.ts";
import SpendPaceEvidence from "../components/SpendPaceEvidence.tsx";
import { PACE_COPY_FIXTURES } from "../app/design/spend-pace-copy/fixtures.ts";

let failures = 0;
function check(label, condition) {
  if (!condition) { failures += 1; console.error(`FAIL: ${label}`); }
  else console.log(`PASS: ${label}`);
}

for (const [state, fixture] of Object.entries(PACE_COPY_FIXTURES)) {
  const copy = derivePaceCopy(fixture);
  if (fixture.usualByNow === null) {
    check(`${state}: does not invent a comparison`, copy.verdict === "unavailable" && copy.total === null);
    continue;
  }
  const expected = fixture.actualOut - fixture.usualByNow;
  check(`${state}: total preserves existing Out less usual arithmetic`, copy.total === expected);
  check(`${state}: baseline names its amount and derivation`, copy.baselineLine === `Your usual pace by day ${fixture.daysElapsed} is £${Math.round(fixture.usualByNow).toLocaleString("en-GB")}. Usual pace is based on the median of up to three 30-day spending totals for each category before this pay period, adjusted for how far through the period you are.`);
  if (fixture.namedCategories.length) {
    check(`${state}: residual reconciles named excess to total`, copy.residual === expected - fixture.namedExcess);
    check(`${state}: names the categories instead of a count`, copy.namedLabel?.includes(fixture.namedCategories[0]));
    check(`${state}: residual is honestly labelled a balancing amount`, copy.residualCaption?.includes("Balancing amount") && !copy.residualCaption?.includes("other spending"));
  } else {
    check(`${state}: no-notables state does not invent a named row`, copy.namedLabel === null && copy.residual === null);
  }
}

check("positive amounts receive an explicit plus sign", formatSignedMoney(42, { plus: true }) === "+£42");
check("negative values retain the currency minus", formatSignedMoney(-42, { plus: true }) === "−£42");
check("over and under retain their signed verdict state", derivePaceCopy(PACE_COPY_FIXTURES.over).verdict === "above" && derivePaceCopy(PACE_COPY_FIXTURES.under).verdict === "below");
check("level pace gets its own neutral verdict", derivePaceCopy(PACE_COPY_FIXTURES.level).verdict === "level");
check("zero residual states say the named excess fully reconciles the total", derivePaceCopy(PACE_COPY_FIXTURES.balanced).residual === 0 && derivePaceCopy(PACE_COPY_FIXTURES.balanced).total === derivePaceCopy(PACE_COPY_FIXTURES.balanced).namedExcess);
check("no-named state retains its total without inventing a residual", derivePaceCopy(PACE_COPY_FIXTURES.none).total === -30 && derivePaceCopy(PACE_COPY_FIXTURES.none).namedLabel === null && derivePaceCopy(PACE_COPY_FIXTURES.none).residual === null);
check("long amounts preserve grouped currency and pence", formatSignedMoney(1234567.5, { plus: true }) === "+£1,234,567.5");
check("tiny negative rounding never exposes negative zero", formatSignedMoney(-0.004, { plus: true }) === "£0" && formatSignedMoney(-0.001, { plus: true }) === "£0");
check("fractional amounts retain up to two decimals with a proper minus", formatSignedMoney(1234.567, { plus: true }) === "+£1,234.57" && formatSignedMoney(-0.006, { plus: true }) === "−£0.01");
check("negative half-pennies round with the same magnitude as the hero", formatSignedMoney(-0.005, { plus: true }) === "−£0.01" && formatSignedMoney(-10.125) === "−£10.13");
check("zero spend with a real baseline remains a valid comparison", derivePaceCopy({ daysElapsed: 12, actualOut: 0, usualByNow: 40, namedCategories: [], namedExcess: 0, unresolvedTotal: 0 }).total === -40);

const previewSource = readFileSync(new URL("../app/design/spend-pace-copy/SpendPaceCopyClient.tsx", import.meta.url), "utf8");
const productionSource = readFileSync(new URL("../components/SpendVerdictView.tsx", import.meta.url), "utf8");
check("approved preview A imports the production evidence component", previewSource.includes('import SpendPaceEvidence from "@/components/SpendPaceEvidence"'));
check("real journey renders the production evidence component", productionSource.includes("<SpendPaceEvidence"));
const evidenceSource = readFileSync(new URL("../components/SpendPaceEvidence.tsx", import.meta.url), "utf8");
check("no-notable comparisons retain the signed total row", evidenceSource.includes("Difference from usual pace") && !evidenceSource.includes('state === "nothing"'));
check("approved evidence stays in one enclosing card", evidenceSource.includes('rounded-2xl border border-slate-200 bg-white p-4 shadow-sm') && evidenceSource.includes('border-y border-slate-100'));
check("early and no-baseline states are explicitly withheld even with series data", productionSource.includes("state={state}") && evidenceSource.includes('state === "early" || state === "nobaseline"'));
check("preview does not wrap the production ledger in a second card", !previewSource.split("function LedgerTreatment")[1].split("function ExplanationTreatment")[0].includes("rounded-2xl"));

const props = { daysElapsed: 13, spent: 2480, paceSeries: [{ day: 13, actual: 2480, usual: 2510 }], notables: [], unresolvedTotal: 0 };
const render = (overrides = {}) => renderToStaticMarkup(React.createElement(SpendPaceEvidence, { ...props, ...overrides }));
const noNotables = render();
check("rendered no-notables evidence contains one card and its signed total", (noNotables.match(/<section/g) ?? []).length === 1 && noNotables.includes("−£30") && noNotables.includes("Difference from usual pace"));
check("rendered no-notables evidence has no invented named or residual row", !noNotables.includes("Above usual:") && !noNotables.includes("Other differences"));
check("rendered evidence withholds unreliable numeric history", render({ state: "early" }) === "" && render({ state: "nobaseline" }) === "");
check("rendered evidence withholds missing history", render({ paceSeries: [] }) === "");
check("rendered zero-spend comparison preserves the true baseline", render({ state: "nothing", spent: 0 }).includes("−£2,510"));
const named = { category: "Groceries", spent: 185, excess: 85, multiple: 1.85, payments_count: 2, cause: [], pace: { spent: 185, usual_by_now: 100 } };
const reconciliation = render({ spent: 2500, paceSeries: [{ day: 13, actual: 2500, usual: 2500 }], notables: [named] });
check("rendered level ledger keeps both meaningful signs and the zero total", ["+£85", "−£85", "£0"].every(value => reconciliation.includes(value)));

if (failures) process.exit(1);
console.log("All G140 pace-copy checks passed.");
