// check:finexer-intro (G226). Pins the shipped Finexer consent intro
// (backend/app/data/finexer_brand/header.html plus sorted*.css) against
// Finexer's limits and the copy rules.
import assert from "node:assert/strict";
import { build, minifyCss, read } from "./gen-finexer-intro-fixtures.mjs";
import { readFileSync } from "node:fs";
import { REGULATED_FOOTER } from "../app/design/finexer-consent-intro/footer.ts";

const LIMIT = 2000;
const shared = read("sorted.css");
assert.ok(!/\.sorted-intro/.test(shared), "old .sorted-intro rule must be gone from sorted.css");
assert.ok(/\.si-a\b/.test(shared), "variant A rules (.si-a) missing from sorted.css");

for (const mode of ["light", "dark"]) {
  const total = minifyCss(`${read(`sorted-${mode}.css`)}\n${shared}`).length;
  assert.ok(total < LIMIT, `${mode} CSS is ${total} chars, limit ${LIMIT}`);
  console.log(`${mode}: ${total} / ${LIMIT}`);
}

const html = read("header.html");
assert.ok(!/<img/i.test(html), "no <img");
assert.ok(!/<script/i.test(html), "no <script");
assert.ok(!html.includes("—") && !html.includes("–"), "no em or en dash");
assert.ok(!html.includes("!"), "no exclamation mark");
assert.ok(!/\son[a-z]+\s*=/i.test(html), "no inline on* handler");
assert.ok(!/http/i.test(html), "no http URL");
assert.ok(!/Nothing moves/i.test(html), 'no "Nothing moves" claim');
assert.ok(/<b>Sorted<\/b>/.test(html), "Sorted eyebrow present");
assert.ok(/read-only/.test(html), "read-only is stated");
assert.ok(!/gradient/i.test(shared), "no gradient (Penny's)");
assert.ok(!/border-left\s*:\s*[2-9]/.test(shared), "no side stripe");

assert.equal(
  REGULATED_FOOTER,
  "Sorted acts as Finexer Ltd's registered agent. Finexer Ltd is authorised by the Financial Conduct Authority under the Payment Services Regulations 2017 firm reference number 925695 as an Authorised Payment Institution to provide account information services and payment initiation services.",
);
const fixtures = readFileSync(new URL("../app/design/finexer-consent-intro/fixtures.ts", import.meta.url), "utf8");
assert.ok(fixtures.includes("REGULATED_FOOTER") && !fixtures.includes("registered agent"), "mock footer must come from footer.ts");

const generated = readFileSync(new URL("../app/design/finexer-consent-intro/brand.generated.ts", import.meta.url), "utf8");
assert.equal(generated, build(), "brand.generated.ts is stale, run node scripts/gen-finexer-intro-fixtures.mjs");
console.log("check:finexer-intro ok");
