// B60: the backend pay-split reference table (penny_pay_split.py GUIDES) must
// carry the same numbers and names as frontend/lib/paySplitReference.ts GUIDES.
// Run: npm run -s check:b60-pay-split-parity
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GUIDES } from "../lib/paySplitReference.ts";

const py = readFileSync(new URL("../../backend/app/services/penny_pay_split.py", import.meta.url), "utf8");
const block = py.slice(py.indexOf("GUIDES = {"), py.indexOf("DEFAULT_REFERENCE"));
const rows = [...block.matchAll(/^\s+"([\w-]+)": \{"name": "([^"]*)", "short_name": "([^"]*)", "shares": (None|\{[^}]*\})/gm)];
assert.equal(rows.length, GUIDES.length, "same number of guides");
for (const guide of GUIDES) {
  const row = rows.find((r) => r[1] === guide.id);
  assert.ok(row, `backend has guide ${guide.id}`);
  assert.equal(row[2], guide.name, `${guide.id} name`);
  assert.equal(row[3], guide.shortName, `${guide.id} shortName`);
  if (guide.shares === null) {
    assert.equal(row[4], "None", `${guide.id} has no shares`);
  } else {
    const shares = Object.fromEntries([...row[4].matchAll(/"(\w+)": (\d+)/g)].map((m) => [m[1], Number(m[2])]));
    assert.deepEqual(shares, guide.shares, `${guide.id} shares`);
  }
}
console.log(`b60 pay-split parity: ${GUIDES.length} guides match`);
