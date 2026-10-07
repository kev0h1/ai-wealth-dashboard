// check:finexer-intro (G226). Guards the Finexer consent intro variants under
// backend/app/data/finexer_brand/intro against Finexer's limits and the copy
// rules. The variants replace the .sorted-intro rules in sorted.css, so the
// budget is the shared CSS without that old block plus the variant's own CSS.
import assert from "node:assert/strict";
import { build, minifyCss, read, sharedWithoutOldIntro } from "./gen-finexer-intro-fixtures.mjs";
import { readFileSync } from "node:fs";
import { REGULATED_FOOTER } from "../app/design/finexer-consent-intro/footer.ts";

const LIMIT = 2000;
const shared = sharedWithoutOldIntro();
assert.ok(shared.length < read("sorted.css").length, "old .sorted-intro block was not found in sorted.css");

for (const mode of ["light", "dark"]) {
  const tokens = read(`sorted-${mode}.css`);
  for (const v of ["a", "b", "c"]) {
    const total = minifyCss(`${tokens}\n${shared}\n${read("intro", `${v}.css`)}`).length;
    assert.ok(total < LIMIT, `variant ${v} ${mode} CSS is ${total} chars, limit ${LIMIT}`);
    console.log(`variant ${v} ${mode}: ${total} / ${LIMIT} (own CSS ${minifyCss(read("intro", `${v}.css`)).length})`);
  }
}

for (const v of ["a", "b", "c"]) {
  const html = read("intro", `${v}.html`);
  assert.ok(!/<img/i.test(html), `${v}: no <img`);
  assert.ok(!/<script/i.test(html), `${v}: no <script`);
  assert.ok(!html.includes("—") && !html.includes("–"), `${v}: no em or en dash`);
  assert.ok(!html.includes("!"), `${v}: no exclamation mark`);
  assert.ok(!/\son[a-z]+\s*=/i.test(html), `${v}: no inline on* handler`);
  assert.ok(!/http/i.test(html), `${v}: no http URL`);
  assert.ok(!/Nothing moves/i.test(html), `${v}: no "Nothing moves" claim`);
  assert.ok(/read-only|Read only/.test(html), `${v}: read-only is stated`);
  const css = read("intro", `${v}.css`);
  assert.ok(!/gradient/i.test(css), `${v}: no gradient (Penny's)`);
  assert.ok(!/border-left\s*:\s*[2-9]/.test(css), `${v}: no side stripe`);
}

assert.equal(
  REGULATED_FOOTER,
  "Sorted acts as Finexer Ltd's registered agent. Finexer Ltd is authorised by the Financial Conduct Authority under the Payment Services Regulations 2017 firm reference number 925695 as an Authorised Payment Institution to provide account information services and payment initiation services.",
);
const fixtures = readFileSync(new URL("../app/design/finexer-consent-intro/fixtures.ts", import.meta.url), "utf8");
assert.ok(fixtures.includes("REGULATED_FOOTER") && !fixtures.includes("registered agent"), "mock footer must come from footer.ts");

const generated = readFileSync(new URL("../app/design/finexer-consent-intro/brand.generated.ts", import.meta.url), "utf8");
assert.equal(generated, build(), "brand.generated.ts is stale, run node scripts/gen-finexer-intro-fixtures.mjs");
console.log("check:finexer-intro ok");
