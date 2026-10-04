import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { tidyAccountText } from "../lib/accountDisplay.ts";

const source = path => readFileSync(new URL(path, import.meta.url), "utf8");

// Raw upper-case provider strings are sentence-cased; everything else is left alone.
assert.equal(tidyAccountText("PENTESTCANARYBANK"), "Pentestcanarybank");
assert.equal(tidyAccountText("CURRENT ACCOUNT"), "Current account");
assert.equal(tidyAccountText("HSBC UK"), "HSBC UK");
assert.equal(tidyAccountText("HSBC UK ADVANCE"), "HSBC UK Advance");
assert.equal(tidyAccountText("NS&I"), "NS&I");
assert.equal(tidyAccountText("TSB"), "TSB");
assert.equal(tidyAccountText("TSB CLASSIC PLUS"), "TSB Classic plus");
assert.equal(tidyAccountText("M&S BANK"), "M&S Bank");
assert.equal(tidyAccountText("Everyday account"), "Everyday account");
assert.equal(tidyAccountText("NatWest Rewards"), "NatWest Rewards");
assert.equal(tidyAccountText("  "), "");
assert.equal(tidyAccountText(null), "");
assert.equal(tidyAccountText("1234"), "1234");

// A fieldset defaults to min-inline-size: min-content, so nowrap/truncate rows inside it
// widen the whole sheet body. Every editor fieldset must opt out with min-w-0.
for (const file of ["../components/upcoming/GoalSourceForm.tsx", "../components/PlannedEditForm.tsx", "../components/AllocationEditForm.tsx", "../components/UpcomingEditForm.tsx"]) {
  const tags = source(file).match(/<fieldset disabled=[^>]*>/g) ?? [];
  assert.ok(tags.length > 0, `${file} has an editor fieldset`);
  for (const tag of tags) assert.match(tag, /className="min-w-0 /, `${file}: editor fieldset must carry min-w-0`);
}

// The shared picker row stays shrinkable and tidies raw names.
const picker = source("../components/AccountRadioPicker.tsx");
assert.match(picker, /flex-1 min-w-0/);
assert.match(picker, /truncate">\{tidyAccountText\(account\.name\)\}/);
assert.doesNotMatch(picker, /\bw-\[\d+px\]|min-w-\[\d+px\]/);
console.log("g204-goal-link-overflow OK");
