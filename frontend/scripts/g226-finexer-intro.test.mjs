// check:finexer-intro (G226). Pins the shipped Finexer consent intro
// (backend/app/data/finexer_brand/header.html plus sorted*.css) against
// Finexer's limits and the copy rules.
import assert from "node:assert/strict";
import { build, minifyCss, read, appName } from "./gen-finexer-intro-fixtures.mjs";
import { readFileSync, existsSync } from "node:fs";
import { regulatedFooter } from "../app/design/finexer-consent-intro/footer.ts";

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

// A151: app_name is the registered agent's legal name, Finexer is named in the header.
assert.equal(appName(), "AURIQ LTD");
assert.ok(regulatedFooter(appName()).startsWith("AURIQ LTD acts as Finexer Ltd's registered agent."), "footer sentence names AURIQ LTD");
assert.ok(html.includes("<strong>Provided by Finexer Ltd</strong>, authorised by the FCA (firm reference 925695). AURIQ LTD, trading as Sorted, acts as its agent."), "Finexer prominence line");
assert.ok(!existsSync(new URL("../../backend/app/data/finexer_brand/footer.html", import.meta.url)), "no footer_html: Finexer's own footer must remain");
const fixtures = readFileSync(new URL("../app/design/finexer-consent-intro/fixtures.ts", import.meta.url), "utf8");
assert.ok(fixtures.includes("regulatedFooter") && !fixtures.includes("registered agent"), "mock footer must come from footer.ts");
for (const [name, text] of [["header", html], ["css", shared], ["footer", regulatedFooter("x")], ["preview", readFileSync(new URL("../app/design/finexer-consent-intro/FinexerConsentIntroClient.tsx", import.meta.url), "utf8")]]) {
  assert.ok(!/—|–/.test(text), `${name}: no em or en dash`);
  assert.ok(!/appointed representative|tied agent/i.test(text), `${name}: banned status wording`);
}
// Client Terms 7.4: no size, opacity, display or visibility rule on Finexer's
// list or footer, and no root font-size that would rescale Finexer's rem sizes.
const rules = [...minifyCss(shared).matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1], body: m[2] }));
for (const { sel, body } of rules) {
  if (/^(html|body)\b/.test(sel.trim()) || /^html,body$/.test(sel.replace(/\s/g, ""))) assert.ok(!/font-size/.test(body), `root rule ${sel} must not set font-size`);
  if (/footer|\bdl\b|\bdt\b|\bdd\b|\bli\b|\bul\b|\bsmall\b|\[class\*=/.test(sel) && !/si-a/.test(sel)) {
    assert.ok(!/font-size|opacity|display|visibility|transform|height|clip/.test(body), `${sel} must be colour only`);
  }
}
const footerRule = rules.find((r) => /footer/.test(r.sel));
assert.ok(footerRule && /color:var\(--s-ink\)/.test(footerRule.body), "footer is full ink");

const generated = readFileSync(new URL("../app/design/finexer-consent-intro/brand.generated.ts", import.meta.url), "utf8");
assert.equal(generated, build(), "brand.generated.ts is stale, run node scripts/gen-finexer-intro-fixtures.mjs");
console.log("check:finexer-intro ok");
