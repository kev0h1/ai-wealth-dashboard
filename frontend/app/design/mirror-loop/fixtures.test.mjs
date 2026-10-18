import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evidenceFor, exampleFor, fees, frequency, scenarios } from "./fixtures.ts";

for (const scenario of scenarios) {
  const example = exampleFor(scenario);
  const evidence = evidenceFor(scenario);
  assert.equal(Math.round(evidence.reduce((sum, row) => sum + row.amount, 0) * 100), Math.round(example.spent * 100), `${scenario}: evidence reconciles`);
  assert.ok(evidence.every(row => row.amount >= 0 && row.date && row.name));
  assert.ok(example.aim > 0);
  assert.equal(example.closed, ["below", "near", "past"].includes(scenario));
  assert.equal(example.period, example.closed ? "5 Sep–2 Oct" : "3–30 Oct");
}
assert.equal(exampleFor("below").spent - exampleFor("below").aim, -18);
assert.equal(exampleFor("near").spent - exampleFor("near").aim, -2);
assert.equal(exampleFor("past").spent - exampleFor("past").aim, 18);
assert.equal(exampleFor("long").spent, 123358.75);
assert.equal(fees.length, 4);
assert.equal(fees.reduce((sum, fee) => sum + fee.amount, 0), 36);
assert.deepEqual(frequency.map(row => row.count), [6, 5, 5, 4]);
const source = readFileSync(new URL("./MirrorLoopClient.tsx", import.meta.url), "utf8");
assert.doesNotMatch(source, /api\.|fetch\(|localStorage|sessionStorage|—/, "preview has no direct customer operations or forbidden copy");
assert.match(source, /<div inert/, "API-backed production reference is not interactive");
assert.match(source, /choice === "change"/);
assert.match(source, /example\.spent.*example\.aim/, "completed result keeps its period's original benchmark");
assert.match(source, /key=\{params\.toString\(\)\}/, "URL scenario changes reset local demo state");
console.log("PASS G286 preview: reconciled evidence, explicit periods, neutral outcomes, dated counts/charges and inert local operation guards. Visibility and interaction are verified separately in the browser.");
