// E15: Settings must not PATCH /preferences without a user-made change.
// Imports the real helper and statically checks the real SettingsPage wiring.
// Run: node --no-warnings --experimental-strip-types scripts/e15-preference-blur-write.test.mjs
import { readFileSync } from "node:fs";
import { shouldWriteNumericPreference, numericBaselineFromSnapshot } from "../lib/numericPreferenceWrite.ts";

let failures = 0;
function check(label, actual, expected) {
  if (actual !== expected) { failures += 1; console.error(`FAIL: ${label}, expected ${expected}, got ${actual}`); }
  else console.log(`PASS: ${label}`);
}

check("unchanged value is not written", shouldWriteNumericPreference(50000, 50000), false);
check("changed value is written", shouldWriteNumericPreference(60000, 50000), true);
check("clearing a stored value is written", shouldWriteNumericPreference(0, 50000), true);
check("blur before the snapshot loads writes nothing", shouldWriteNumericPreference(0, null), false);
check("empty stored zero, blur with zero, no write", shouldWriteNumericPreference(0, 0), false);
check("baseline from number", numericBaselineFromSnapshot(1200), 1200);
check("baseline from missing", numericBaselineFromSnapshot(undefined), 0);

const src = readFileSync(new URL("../app/settings/SettingsPage.tsx", import.meta.url), "utf8");
for (const [fn, field, ref] of [["handleIncomeBlur", "income_value", "incomeStoredRef"], ["handlePensionBlur", "pension_annual", "pensionStoredRef"]]) {
  const start = src.indexOf(`function ${fn}()`);
  const body = src.slice(start, src.indexOf("\n  }\n", start));
  const guard = body.indexOf(`shouldWriteNumericPreference(value, ${ref}.current)`);
  const write = body.indexOf(`api.updatePreferences({ ${field}`);
  check(`${fn} guards its PATCH`, guard !== -1 && write !== -1 && guard < write, true);
}

// No effect in the Settings page body writes preferences on mount: every
// updatePreferences call sits inside a handler function, not a useEffect.
const lines = src.split("\n");
const effects = [];
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].includes("useEffect(")) continue;
  let j = i;
  while (j < lines.length && !/\}, \[[^\]]*\]\);/.test(lines[j])) j++;
  effects.push(lines.slice(i, j + 1).join("\n"));
}
check("no useEffect in SettingsPage calls updatePreferences", effects.some(e => e.includes("updatePreferences")), false);

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("all checks passed");
