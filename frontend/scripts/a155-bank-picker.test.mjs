// A155 bank picker round. Pins, for every placement (today, A, B, C):
//  1. The A4.1 sentence is in the rendered markup verbatim and in full, at no
//     less than the 12px Caption step (class check), B included (collapsed it
//     is still in the DOM, only hidden).
//  2. The search field is a fixed 44px (h-11) with an absolutely positioned
//     clear button, identical field classes empty versus typing, no flex row
//     that a 44px button could stretch (the cause of the growth Kevin saw).
//  3. The sticky variants pin the search under the header with a hairline.
//  4. Default props render exactly what production renders today (golden).
//  5. No em dash or exclamation mark in our new strings.
//
// Run: npm run -s check:a155-bank-picker
// Regenerate the golden (only if production markup is changed on purpose):
//   A155_WRITE_GOLDEN=1 npm run -s check:a155-bank-picker

import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { BankPickerBody, pickerDescription, pickerFooter } from "../components/BankPickerSheet.tsx";
import { AGENT_DISCLOSURE } from "../lib/regulatoryCopy.ts";
import { fixtureBanks, VARIANTS } from "../app/design/bank-picker/fixtures.ts";

const h = React.createElement;
const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");
const SENTENCE = "AURIQ LTD is acting as an agent of Finexer LTD, which is authorised by the Financial Conduct Authority under the Payment Services Regulations 2017, firm reference number 925695, as an Authorised Payment Institution to provide account information services and payment initiation services.";
assert.equal(AGENT_DISCLOSURE, SENTENCE, "the constant is the fixed A4.1 text");
const text = html => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const banks = fixtureBanks("https://example.test");
const noop = () => {};

function render(variant, query = "") {
  const v = VARIANTS.find(x => x.value === variant);
  const filtered = query ? banks.filter(b => b.name.toLowerCase().includes(query)) : banks;
  const parts = {
    description: renderToStaticMarkup(h("p", null, pickerDescription("finexer", v.placement))),
    footer: renderToStaticMarkup(h("footer", null, pickerFooter(v.placement))),
    body: renderToStaticMarkup(h(BankPickerBody, {
      query, setQuery: noop, searchRef: { current: null }, error: null, loading: false, filtered,
      connecting: null, onSelect: noop, stickySearch: v.sticky, disclosurePlacement: v.placement,
    })),
  };
  return { ...parts, all: parts.description + parts.footer + parts.body, v };
}

for (const variant of ["today", "a", "b", "c"]) {
  for (const q of ["", "bank"]) {
    const r = render(variant, q);
    // 1. verbatim sentence, in full
    assert.ok(text(r.all).includes(SENTENCE), `${variant}/${q || "empty"}: sentence verbatim in the rendered picker`);
    // 5. no em dash, en dash or exclamation mark in rendered text
    assert.ok(!/[—–!]/.test(text(r.all)), `${variant}: no em dash or exclamation mark in rendered text`);
  }
  // sentence element sizing: every element carrying the sentence is text-xs (12px) and no arbitrary px below 12
  const r = render(variant);
  const carrier = /<(p|span)[^>]*class="([^"]*)"[^>]*>(?:(?!<\/\1>).)*AURIQ LTD is acting/s;
  const m = r.all.match(carrier);
  assert.ok(m, `${variant}: found the element carrying the sentence`);
  assert.match(m[2], /\btext-xs\b/, `${variant}: sentence is at the 12px Caption step`);
  assert.ok(!/text-\[(?:[0-9]|1[01])px\]/.test(m[2]), `${variant}: no sentence text under 12px`);
  // every non-today disclosure line (footer line, button) is also 12px or more
  for (const cls of [...(r.footer + r.description).matchAll(/class="([^"]*)"/g)].map(x => x[1])) {
    assert.ok(!/text-\[(?:[0-9]|1[01])px\]/.test(cls), `${variant}: no class under 12px in the disclosure chrome (${cls})`);
  }
}

// Placement specifics
const a = render("a"), b = render("b"), c = render("c"), today = render("today");
assert.match(a.body, /id="bank-picker-disclosure"/, "A: the sentence is the last row of the list body");
assert.ok(a.body.lastIndexOf("bank-picker-disclosure") > a.body.lastIndexOf("</button><") - 1, "A: after the last bank row");
assert.ok(text(a.footer).includes("Provided by Finexer Ltd. AURIQ LTD acts as its agent."), "A: short pinned line");
assert.ok(!text(a.footer).includes("authorised by the Financial Conduct"), "A: footer carries only the short line");
assert.match(b.footer, /aria-expanded="false"/, "B: collapsed by default");
assert.match(b.footer, /aria-controls="bank-picker-disclosure-region"/);
assert.match(b.footer, /id="bank-picker-disclosure-region"[^>]*hidden=""|hidden=""[^>]*id="bank-picker-disclosure-region"/, "B: sentence is in the DOM, hidden until opened");
assert.ok(text(b.footer).includes("Regulated by the FCA through Finexer LTD"), "B: compact line");
assert.match(b.footer, /text-left/, "B: control is left aligned, not centred");
assert.equal(c.footer, "<footer></footer>", "C: footer is freed");
assert.ok(text(c.description).includes(SENTENCE) && text(c.description).includes("Powered by Finexer"), "C: sentence sits under Powered by Finexer");
assert.match(today.footer, /max-h-28 overflow-y-auto overscroll-contain text-center text-xs leading-relaxed/, "Today keeps the old footer");

// 2 and 3. Search
const field = html => html.match(/<div data-bank-search-field[^>]*class="([^"]*)"/)?.[1];
const input = html => html.match(/<input[^>]*class="([^"]*)"/)?.[1];
for (const variant of ["a", "b", "c"]) {
  const empty = render(variant, ""), typed = render(variant, "bank");
  assert.equal(field(empty.body), field(typed.body), `${variant}: field classes identical empty versus typing`);
  assert.match(field(typed.body), /\bh-11\b/, `${variant}: field is a fixed 44px`);
  assert.match(field(typed.body), /\brelative\b/);
  assert.ok(!/\bflex\b|\bpy-|\bmin-h/.test(field(typed.body)), `${variant}: field is not a flex row with padding that a taller child can stretch`);
  assert.match(input(typed.body), /\bh-11\b/, `${variant}: input is 44px`);
  assert.ok(!/aria-label="Clear search"/.test(empty.body), `${variant}: no clear button when empty`);
  const clear = typed.body.match(/<button[^>]*aria-label="Clear search"[^>]*class="([^"]*)"/)?.[1] ?? typed.body.match(/<button[^>]*class="([^"]*)"[^>]*aria-label="Clear search"/)?.[1];
  assert.ok(clear, `${variant}: clear button renders when typing`);
  assert.match(clear, /\babsolute\b.*\bsize-11\b|\bsize-11\b.*\babsolute\b/, `${variant}: clear button is absolutely positioned inside the field`);
  assert.match(typed.body, /<button[^>]*data-compact/, `${variant}: clear opts out of the sheet min-height rule`);
  assert.match(empty.body, /data-bank-search="sticky"[^>]*class="[^"]*\bsticky top-0\b[^"]*\bborder-b\b|class="[^"]*\bsticky top-0\b[^"]*\bborder-b\b[^"]*"[^>]*data-bank-search="sticky"/, `${variant}: search is sticky with a hairline below`);
  assert.match(empty.body, /\bbg-white\b.*\bdark:bg-slate-900\b/, `${variant}: sticky bar paints the sheet surface so rows do not show through`);
}
assert.ok(!render("today").body.includes("data-bank-search"), "Today keeps the old, non-sticky search");

// 4. Inertness: default props equal today's production markup.
const golden = new URL("./a155-bank-picker.golden.html", import.meta.url);
const todayHtml = [today.description, today.footer, render("today", "bank").body, today.body].join("\n");
if (process.env.A155_WRITE_GOLDEN) writeFileSync(golden, todayHtml);
assert.equal(todayHtml, readFileSync(golden, "utf8"), "default props render the same markup as production today");
const src = read("../components/BankPickerSheet.tsx");
assert.match(src, /disclosurePlacement = "footer"/, "placement defaults to today's footer");
assert.match(src, /stickySearch = false/, "sticky search defaults off");
assert.match(src, /className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-100 outline-none placeholder:text-slate-400/, "old search classes untouched");
assert.match(src, /description=\{pickerDescription\(provider, disclosurePlacement\)\}/);
assert.match(src, /\{AGENT_DISCLOSURE\}/, "picker still renders AGENT_DISCLOSURE");

// 5. Source strings: no dashes or exclamation marks in what we wrote
for (const rel of ["../app/design/bank-picker/BankPickerClient.tsx", "../app/design/bank-picker/fixtures.ts"]) {
  const t = read(rel);
  assert.ok(!/[—–]/.test(t), `${rel}: no em or en dash`);
  assert.ok(!/(["'`>])[^"'`<\n]*[A-Za-z]!(?=\s|["'`<])/.test(t), `${rel}: no exclamation marks in strings`);
}
assert.ok(!/[—–]/.test(src), "BankPickerSheet: no em or en dash");

console.log("a155-bank-picker OK");
