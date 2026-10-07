// G225: pins the PRODUCTION CardTermsSheet after the alignment pass.
//
// Renders the real component through react-dom/server for each fixture card.
// SheetFrame (a portal) is swapped for scripts/_sheetframe-stub.mjs by a
// resolve hook registered below; the frame itself is covered by
// check:g192-sheet-anatomy. Effects do not run on the server, so only cards
// with confirmed terms (which prefill synchronously) reach the full form here;
// the lookup path is covered by source assertions.
//
// Run: npm run -s check:g225-card-terms
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const stubUrl = new URL("./_sheetframe-stub.mjs", import.meta.url).href;
const hook = `export async function resolve(s, c, next) { if (/(^|\\/)components\\/SheetFrame$/.test(s)) return { url: ${JSON.stringify(stubUrl)}, shortCircuit: true }; return next(s, c); }`;
register("data:text/javascript," + encodeURIComponent(hook));

const { default: CardTermsSheet } = await import("../components/CardTermsSheet.tsx");
const { CARDS } = await import("../app/design/card-terms-sheet/fixtures.ts");
const src = readFileSync(new URL("../components/CardTermsSheet.tsx", import.meta.url), "utf8");
const noop = () => {};

// The server never runs effects, so the £0 card is rendered with confirmed terms (the edit path) to reach the form.
const SERVER_CARDS = { ...CARDS, zero: { ...CARDS.zero, terms: CARDS.balance.terms } };
function render(id) {
  return renderToStaticMarkup(createElement(CardTermsSheet, {
    cards: Object.values(SERVER_CARDS), ready: true, startAccountId: CARDS[id].account_id, onClose: noop, onSaved: noop,
  }));
}
const text = html => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const group = (html, label) => {
  const m = new RegExp(`<div role="radiogroup" aria-label="${label}"[^>]*>([\\s\\S]*?)</div>`).exec(html);
  assert.ok(m, `radiogroup ${label} present`);
  return m[1];
};

for (const id of ["balance", "zero", "promos"]) {
  const html = render(id);
  const t = text(html);
  assert.ok(t.includes("Barclaycard") || t.includes("Everyday") || t.includes("Platinum"), `${id}: sheet rendered`);
  assert.doesNotMatch(t, /dangling/i, `${id}: no "dangling"`);
  assert.doesNotMatch(t, /—/, `${id}: no em dash`);
  assert.doesNotMatch(t, /!/, `${id}: no exclamation mark`);
  assert.doesNotMatch(t, /It.s on a 0% deal/, `${id}: no stray 0% button`);
  assert.match(t, /advertising that you haven.t used yet/, `${id}: offers copy`);
}

// Balance £0: the question is about the card, never "£0 on a 0% deal".
const zero = render("zero");
assert.doesNotMatch(text(zero), /£0 on a 0% deal/);
assert.match(text(zero), /Is this card on a 0% deal\?/);
// Balances default to hidden without a provider, so the figure is masked in this server render.
assert.match(text(render("balance")), /Is any of this £\S+ on a 0% deal\?/);

// promoOn null: exactly two radio options in the 0% pair, and no third answer.
const pair = group(render("balance"), "Is any of this balance on a 0% deal\\?");
assert.equal((pair.match(/role="radio"/g) ?? []).length, 2, "Yes and No only");
assert.doesNotMatch(pair, /It.s on a 0% deal/);
assert.equal((group(zero, "Is this card on a 0% deal\\?").match(/role="radio"/g) ?? []).length, 2);

// Rate input: a typed value is ink, only the true placeholder is grey.
const balance = render("balance");
const input = /<input[^>]*aria-label="Interest rate, percent APR"[^>]*>/.exec(balance)?.[0];
assert.ok(input, "rate input rendered");
assert.match(input, /value="24.9"/);
assert.match(input, /text-slate-900 dark:text-slate-100/, "value in ink");
assert.match(input, /placeholder:text-slate-500 dark:placeholder:text-slate-400/, "placeholder grey");
assert.doesNotMatch(input, /(?<![:\w-])text-slate-[45]00/, "no grey value class");

// Existing deals: per-deal rows on the G136 month field, quiet add action.
const promos = render("promos");
assert.match(promos, /Deal 1/);
assert.match(promos, /Deal 2/);
assert.match(promos, /Month deal 1 ends, August 2027/);
assert.match(promos, /Add another deal/);

// Source-level pins for what the server cannot reach.
assert.doesNotMatch(src, /dangling/i);
assert.doesNotMatch(src, /zeroDealButton/);
assert.match(src, /import \{ SheetFrame \} from "@\/components\/SheetFrame"/, "G192 frame");
assert.match(src, /import \{ DateField \} from "@\/components\/DatePicker"/, "G136 month field");
assert.doesNotMatch(src, /type="(date|month)"/, "no native date inputs");
assert.doesNotMatch(src, /—/, "no em dash in source");
assert.match(src, /variant="compact"/, "sheet hugs its content, no dead area above the footer");
assert.match(src, /className="space-y-6">\s*\{!ready/, "one section rhythm between question groups");
assert.doesNotMatch(src, /min-h-\[(?!44px|48px)\d+/, "no tall spacer or min-height");
console.log("g225-card-terms: ok");
