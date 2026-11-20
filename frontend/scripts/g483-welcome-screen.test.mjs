import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Onboarding, { WELCOME_BANK_ROW_STATEMENTS, WELCOME_BANK_ROW_OPEN_BANKING } from "../components/Onboarding.tsx";

const src = fs.readFileSync(new URL("../components/Onboarding.tsx", import.meta.url), "utf8");
const start = src.indexOf('if (step === "welcome")');
const end = src.indexOf("// ── profile", start);
assert.ok(start > 0 && end > start, "welcome step found");
const welcome = src.slice(start, end);

// Icons: Phosphor, no Lucide, on the feature rows.
assert.match(welcome, /PhosphorGlyph/, "feature rows render Phosphor glyphs");
assert.doesNotMatch(welcome, /Building2|Wallet|Upload\b|PennyMark|icon: Icon|<Icon\b/, "no Lucide icons on the welcome rows");
const glyphSrc = fs.readFileSync(new URL("../components/navigation/PhosphorGlyph.tsx", import.meta.url), "utf8");
assert.match(glyphSrc, /data-phosphor-weight="regular"/, "same regular weight as the idle nav");
assert.match(glyphSrc, /PHOSPHOR_NAV_ICONS/, "reuses the vendored nav set");

// Copy: banned claims absent.
const copyOf = (s) => [...s.matchAll(/"([^"\n]{12,})"/g)].map((m) => m[1]).join("\n");
const welcomeCopy = copyOf(welcome) + "\n" + WELCOME_BANK_ROW_STATEMENTS + "\n" + WELCOME_BANK_ROW_OPEN_BANKING + "\n" + (welcome.match(/>\s*([^<{}]*Set up[^<{}]*)</)?.[1] ?? "");
assert.doesNotMatch(welcome, /budgets|AI-powered|save more|insights/i, "no budgets, AI or savings claims");
assert.doesNotMatch(welcomeCopy, /—|–|!/, "no em dashes or exclamation marks");
assert.doesNotMatch(welcomeCopy, /\b(color|organize|optimi[sz]e|savings?)\b/i, "British English, no savings claims");
assert.doesNotMatch(welcome, /takes 2 minutes/, "no unjustified time promise");
assert.match(welcome, /Set up only takes a few minutes\./);

// Real-product rows.
for (const t of ["See what's left to spend before payday", "See which payments are coming and whether each account covers them", "Set plans for goals and card balances"]) {
  assert.ok(welcome.includes(t), `row copy: ${t}`);
}

// The bank row depends on the plan.
assert.match(welcome, /canConnectBank\s*\?/, "bank row branches on open-banking access");
assert.match(WELCOME_BANK_ROW_STATEMENTS, /statement/i);
assert.doesNotMatch(WELCOME_BANK_ROW_STATEMENTS, /open banking|connect/i, "Statements plan is never offered a bank connection");
assert.match(WELCOME_BANK_ROW_OPEN_BANKING, /open banking/i);
const html = renderToStaticMarkup(React.createElement(Onboarding, { onComplete() {} }));
assert.ok(html.includes(WELCOME_BANK_ROW_STATEMENTS), "before the plan resolves, the statements row shows");
assert.ok(!html.includes(WELCOME_BANK_ROW_OPEN_BANKING));
assert.match(html, /data-phosphor-icon="upload-simple"/);
const rows = html.slice(html.indexOf("space-y-3 mb-10"), html.indexOf("<button"));
assert.doesNotMatch(rows, /lucide/, "no Lucide svg on the feature rows");
assert.equal((rows.match(/data-phosphor-icon=/g) ?? []).length, 4, "four Phosphor rows");
console.log("G483: welcome rows use Phosphor, copy matches the product and the plan, banned phrases and copy rules hold.");
