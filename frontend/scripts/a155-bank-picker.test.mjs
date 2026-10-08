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
import { PopularBody, IndexBody, IntroBody, ChooserBody, NoResults, RAIL_GROUPS, POPULAR_IDS } from "../app/design/bank-picker/proposals.tsx";

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
  if (variant !== "today") assert.ok(!/\b(?:line-clamp-\d+|truncate|overflow-hidden)\b|(?:^|\s)max-h-/.test(m[2]), `${variant}: sentence element is never clamped, truncated or height-capped (${m[2]})`);
  // every non-today disclosure line (footer line, button) is also 12px or more
  for (const cls of [...(r.footer + r.description).matchAll(/class="([^"]*)"/g)].map(x => x[1])) {
    assert.ok(!/text-\[(?:[0-9]|1[01])px\]/.test(cls), `${variant}: no class under 12px in the disclosure chrome (${cls})`);
  }
}

// Placement specifics
const a = render("a"), b = render("b"), c = render("c"), today = render("today");
assert.match(a.body, /id="bank-picker-disclosure"/, "A: the sentence is the last row of the list body");
assert.ok(a.body.lastIndexOf("bank-picker-disclosure") > a.body.lastIndexOf("</button><") - 1, "A: after the last bank row");
assert.ok(text(a.footer).includes("Provided by Finexer LTD. AURIQ LTD acts as its agent."), "A: short pinned line");
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
for (const rel of ["../app/design/bank-picker/BankPickerClient.tsx", "../app/design/bank-picker/fixtures.ts", "../app/design/bank-picker/proposals.tsx"]) {
  const t = read(rel);
  assert.ok(!/[—–]/.test(t), `${rel}: no em or en dash`);
  assert.ok(!/(["'`>])[^"'`<\n]*[A-Za-z]!(?=\s|["'`<])/.test(t), `${rel}: no exclamation marks in strings`);
}
assert.ok(!/[—–]/.test(src), "BankPickerSheet: no em or en dash");

// ---- Round 2 proposals (D popular first, E index rail, F two-step page) ----
// Hand-authored layouts in proposals.tsx; the production sheet above is untouched.
const searchRef = { current: null };
const common = { banks, query: "", setQuery: noop, inputRef: searchRef, onPick: noop };
const mk = (C, over = {}) => renderToStaticMarkup(h(C, { ...common, ...over }));
const proposals = {
  d: q => mk(PopularBody, { query: q }),
  e: q => mk(IndexBody, { query: q }),
  f1: () => renderToStaticMarkup(h(IntroBody)),
  f2: q => mk(ChooserBody, { query: q }),
};
const classesOf = html => [...html.matchAll(/class="([^"]*)"/g)].map(x => x[1]);
for (const [name, fn] of Object.entries(proposals)) {
  for (const q of ["", "bank", "zzq"]) {
    const html = fn(q);
    const t = text(html);
    // the sentence is verbatim, in full, in the default markup (no tap, not hidden, not collapsed)
    assert.ok(t.includes(SENTENCE), `${name}/${q || "empty"}: sentence verbatim and visible by default`);
    assert.ok(!/ hidden=""|aria-expanded|<details|<dialog|display:\s*none/.test(html), `${name}: nothing collapsed or hidden in the default markup`);
    assert.ok(!/[—–]|!/.test(t), `${name}: no em dash, en dash or exclamation mark in rendered text`);
    // 12px floor everywhere
    for (const cls of classesOf(html)) assert.ok(!/text-\[(?:[0-9]|1[01])px\]/.test(cls), `${name}: no text class under 12px (${cls})`);
    // the sentence carrier is text-xs and never clamped
    const m = html.match(/<p[^>]*class="([^"]*)"[^>]*>AURIQ LTD is acting/) ?? html.match(/<p[^>]*data-agent-disclosure[^>]*class="([^"]*)"/);
    assert.ok(m, `${name}: found the sentence carrier`);
    assert.match(m[1], /\btext-xs\b/, `${name}: sentence at the 12px Caption step`);
    assert.ok(!/\b(?:line-clamp-\d+|truncate|overflow-hidden)\b|(?:^|\s)max-h-/.test(m[1]), `${name}: sentence never clamped (${m[1]})`);
    assert.ok(!/text-(?:slate-(?:400|500)|red|amber)/.test(m[1]), `${name}: sentence ink is AA slate-600/300, no red or amber`);
  }
}
// Search is a fixed 44px in every state and sticky, in D, E and F step two.
for (const name of ["d", "e", "f2"]) {
  const empty = proposals[name](""), typed = proposals[name]("bank");
  assert.equal(field(empty), field(typed), `${name}: field classes identical empty versus typing`);
  assert.match(field(typed), /\bh-11\b/, `${name}: field is a fixed 44px`);
  assert.ok(!/\bflex\b|\bpy-|\bmin-h/.test(field(typed)), `${name}: field cannot be stretched by a taller child`);
  assert.match(input(typed), /\bh-11\b.*\btext-base\b/, `${name}: input is 44px and 16px (no iOS zoom)`);
  assert.ok(!/aria-label="Clear search"/.test(empty), `${name}: no clear button when empty`);
  const clear = typed.match(/<button[^>]*aria-label="Clear search"[^>]*class="([^"]*)"/)?.[1] ?? typed.match(/<button[^>]*class="([^"]*)"[^>]*aria-label="Clear search"/)?.[1];
  assert.match(clear, /\babsolute\b.*\bsize-11\b/, `${name}: clear button absolute, 44px`);
  assert.match(empty, /data-bank-search="sticky"[^>]*class="[^"]*\bsticky top-0\b[^"]*\bborder-b\b[^"]*\bbg-white\b[^"]*\bdark:bg-slate-900\b/, `${name}: sticky, hairline, paints the sheet surface`);
}
// 44px targets: tiles, rows, rail, close controls, primary button
const d = proposals.d("");
for (const btn of [...d.matchAll(/<button[^>]*class="([^"]*)"[^>]*>/g)].map(x => x[1])) assert.match(btn, /\b(?:min-h-(?:14|24)|size-11|h-11)\b/, `d: button is 44px or more (${btn})`);
assert.equal([...d.matchAll(/aria-label="Choose /g)].length, POPULAR_IDS.length + banks.length, "d: six popular tiles plus the full list");
assert.match(d, /How this connection works/, "d: the strip is titled");
assert.ok(d.indexOf(SENTENCE) < d.indexOf('data-bank-search="sticky"'), "d: the sentence strip sits above search");
assert.ok(!proposals.d("bank").includes(">Popular<"), "d: typing replaces Popular with matching banks");
const e = proposals.e("");
assert.equal([...e.matchAll(/aria-label="Jump to banks [A-Z] to [A-Z]"/g)].length, RAIL_GROUPS.length, "e: six rail groups");
for (const btn of [...e.matchAll(/<button[^>]*class="([^"]*)"[^>]*>/g)].map(x => x[1])) assert.match(btn, /\b(?:min-h-14|h-11)\b/, `e: rail and rows are 44px or more (${btn})`);
assert.match(e, /\bw-11\b/, "e: rail is 44px wide");
assert.ok(e.indexOf('data-bank-search="sticky"') < e.indexOf(SENTENCE) && e.indexOf(SENTENCE) < e.indexOf("pk-idx-A"), "e: search, then the notice as the opening row, then the list");
assert.ok(!proposals.e("bank").includes("Jump to banks"), "e: the rail is hidden while typing");
assert.match(e, /Provided by Finexer LTD/, "e: names Finexer");
const f1 = proposals.f1();
assert.ok(f1.includes("925695") && /Choose your bank|Connect your bank/.test(f1), "f: step one carries the FCA reference through the sentence");
assert.ok(!f1.includes("aria-hidden=\"true\" hidden"), "f: step one nothing hidden");
assert.ok(!text(proposals.d("zzq")).includes("Matching banks"), "d: no Matching banks heading when there are no results");
assert.ok(f1.includes("Sorted cannot move money.") && !f1.includes("separate approval"), "f: reassurance copy as signed off by review");
assert.ok(!/<h2[^>]*>Add a bank/.test(read("../app/design/bank-picker/proposals.tsx")) , "f: bar title is not a heading above the h1");
// the no-results copy
assert.ok(text(renderToStaticMarkup(h(NoResults))).includes("No banks found"), "no-results copy");
assert.ok(text(proposals.d("zzq")).includes("No banks found") && text(proposals.e("zzq")).includes("No banks found") && text(proposals.f2("zzq")).includes("No banks found"), "no results in d, e and f");
// F shell source: full-screen, primary action, 44px header controls, no motion on load
const prop = read("../app/design/bank-picker/proposals.tsx");
assert.match(prop, /fixed inset-0 z-50 flex h-dvh flex-col/, "f: full-screen shell");
assert.match(prop, /min-h-12 w-full rounded-xl bg-indigo-600/, "f: one primary Choose your bank button");
assert.ok(!/\banimate-|\btransition|@keyframes|motion\//.test(prop), "proposals: no motion on load");
assert.ok(!/gradient|violet|bg-red|text-red|amber/.test(prop.replace(/\/\/.*$/gm, "")), "proposals: no gradient, no red, no amber");
// the production component is not touched by round 2
assert.ok(!/proposals/.test(src), "BankPickerSheet does not import the proposals");
assert.ok(VARIANTS.filter(v => v.kind === "proposal").map(v => v.value).join() === "d,e,f", "d, e, f are the proposal variants");

console.log("a155-bank-picker OK");
