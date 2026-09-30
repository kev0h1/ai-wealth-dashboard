// Pure copy-model checks for the G140 preview. The preview treatments share
// this helper, so both directions retain one signed reconciliation.
import { derivePaceCopy, formatMoney } from "../app/design/spend-pace-copy/copyModel.ts";
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

check("positive addends receive an explicit plus sign", formatMoney(42, { plus: true }) === "+£42");
check("negative values retain the currency minus", formatMoney(-42, { plus: true }) === "−£42");
check("over and under use parallel usual-pace verdicts", derivePaceCopy(PACE_COPY_FIXTURES.over).headline === "£1,301 above your usual pace so far" && derivePaceCopy(PACE_COPY_FIXTURES.under).headline === "£501 below your usual pace so far");
check("level pace gets its own neutral verdict", derivePaceCopy(PACE_COPY_FIXTURES.level).headline === "In line with your usual pace so far");
check("zero residual states say the named excess fully reconciles the total", derivePaceCopy(PACE_COPY_FIXTURES.balanced).residual === 0 && derivePaceCopy(PACE_COPY_FIXTURES.balanced).total === derivePaceCopy(PACE_COPY_FIXTURES.balanced).namedExcess);
check("no-named state retains its total without inventing a residual", derivePaceCopy(PACE_COPY_FIXTURES.none).total === -30 && derivePaceCopy(PACE_COPY_FIXTURES.none).namedLabel === null && derivePaceCopy(PACE_COPY_FIXTURES.none).residual === null);

if (failures) process.exit(1);
console.log("All G140 pace-copy checks passed.");
