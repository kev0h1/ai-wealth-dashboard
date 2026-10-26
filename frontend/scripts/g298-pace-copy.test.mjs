// G298: plain-English wording for the pace comparison card and the notable cards.
import { readFileSync } from "node:fs";
import { derivePaceCopy } from "../lib/spendPaceCopy.ts";
import { paceLine } from "../components/SpendVerdictView.tsx";

let failures = 0;
function check(label, condition) {
  if (!condition) { failures += 1; console.error(`FAIL: ${label}`); }
  else console.log(`PASS: ${label}`);
}
const base = { daysElapsed: 13, actualOut: 2480, usualByNow: 2510.4, namedCategories: [], namedExcess: 0, unresolvedTotal: 0 };
const produced = [];
const note = (...v) => { for (const x of v) if (typeof x === "string") produced.push(x); };

const below = derivePaceCopy(base);
note(below.baselineLine, below.totalLabel);
check("baseline is whole pounds with the 3 month explanation", below.baselineLine === "By day 13 you usually spend about £2,510. We work this out from your last 3 months.");
check("below total label", below.totalLabel === "Less than usual in total" && below.verdict === "below");
check("no named row without categories", below.namedLabel === null && below.residualLabel === null && below.residualCaption === null);

const above = derivePaceCopy({ ...base, actualOut: 3000, namedCategories: ["Business", "Groceries", "Eating out"], namedExcess: 200 });
note(above.namedLabel, above.residualLabel, above.residualCaption, above.totalLabel);
check("named label joins with commas and a final and", above.namedLabel === "More than usual on Business, Groceries and Eating out");
check("above total label", above.totalLabel === "More than usual in total");
check("positive residual label", above.residualLabel === "More than usual on everything else");
check("caption without unresolved", above.residualCaption === "This is what's left after the categories above.");

const single = derivePaceCopy({ ...base, actualOut: 3000, namedCategories: ["Business"], namedExcess: 600 });
check("single category label", single.namedLabel === "More than usual on Business");
const two = derivePaceCopy({ ...base, actualOut: 3000, namedCategories: ["A", "B"], namedExcess: 600 });
check("two categories use and", two.namedLabel === "More than usual on A and B");

const negResidual = derivePaceCopy({ ...base, actualOut: 2700, namedCategories: ["Business"], namedExcess: 600, unresolvedTotal: 50 });
note(negResidual.residualLabel, negResidual.residualCaption);
check("negative residual label", negResidual.residualLabel === "Less than usual on everything else");
check("unresolved caption", negResidual.residualCaption === "This is what's left after the categories above. It may include payments not yet sorted.");

const level = derivePaceCopy({ ...base, actualOut: 2510.4, namedCategories: ["Business"], namedExcess: 0 });
note(level.residualLabel, level.totalLabel);
check("level labels", level.totalLabel === "Same as usual in total" && level.residualLabel === "Same as usual on everything else" && level.verdict === "level");

const unavailable = derivePaceCopy({ ...base, usualByNow: null });
check("unavailable has no labels", unavailable.totalLabel === null && unavailable.residualLabel === null && unavailable.baselineLine === null);
const zeroUsual = derivePaceCopy({ ...base, usualByNow: 0 });
check("zero usual still formats whole pounds", zeroUsual.baselineLine === "By day 13 you usually spend about £0. We work this out from your last 3 months.");

const lines = [paceLine(1.2, 150, 9), paceLine(2.0, 340, 13), paceLine(368.8, 5000, 9), paceLine(2.6, 400, 10)];
note(...lines);
check("paceLine more than usual", lines[0] === "£150 more than usual by day 9.");
check("paceLine twice", lines[1] === "About twice what you usually spend by day 13.");
check("paceLine large multiple", lines[2] === "About 369 times what you usually spend by day 9.");
check("paceLine 2.6", lines[3] === "About 3 times what you usually spend by day 10.");

const view = readFileSync(new URL("../components/SpendVerdictView.tsx", import.meta.url), "utf8");
check("badge shows a whole-number multiple", view.includes("{Math.round(multiple)}× usual") && !view.includes("multiple.toFixed(1)"));
check("amber threshold still compares the raw multiple", view.includes("paceBadgeClasses(multiple)") && view.includes("multiple >= AMBER_THRESHOLD"));
check("intent copy", view.includes("Is this a one-off, or will it happen again?") && view.includes("Keep my usual") && view.includes("Update my usual") && view.includes("ll happen again"));
check("cause line wording", view.includes("Biggest payments:") && view.includes('.join(", ")'));

check("no em dash in produced strings", produced.every((t) => !t.includes("—")));
check("no sentence starts lower case", produced.every((t) => t.split(/(?<=\.) /).every((x) => !/^[a-z]/.test(x))) && produced.every((t) => !/^[a-z]/.test(t)));
check("no exclamation marks", produced.every((t) => !t.includes("!")));

if (failures) process.exit(1);
console.log("All G298 pace-copy checks passed.");
