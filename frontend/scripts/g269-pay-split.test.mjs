// G269 (A Tail, Kevin 2026-10-15): pins the one pay-split bar.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PaySplitBar, beyondFigures, beyondSentence, paradoxLine } from "../components/PaySplitBeyond.tsx";

const src = readFileSync(new URL("../components/PaySplitBeyond.tsx", import.meta.url), "utf8");

const mk = (takeHome, totalOut) => {
  const left = Math.max(0, takeHome - totalOut);
  const figs = { takeHome, totalOut, beyond: Math.max(0, totalOut - takeHome), source: null, cardGrowth: 0, savingsDrawdown: 0, moved: 200, average: false };
  const segs = [
    { id: "fixed", bg: "bg-f", amount: totalOut * 0.5 },
    { id: "moved", bg: "bg-m", amount: totalOut * 0.2 },
    { id: "free", bg: "bg-r", amount: totalOut * 0.3 },
    { id: "left", bg: "bg-l", amount: left },
  ];
  return { figs, segs, html: renderToStaticMarkup(React.createElement(PaySplitBar, { segs, figures: figs, size: "card" })) };
};
const widths = (html, cls) => [...html.matchAll(new RegExp(`class="${cls}" style="width:([\\d.]+)%`, "g"))].map((m) => Number(m[1]));
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ~ ${b}`);

// Beyond: take-home 2100, out 2710.
{
  const { html } = mk(2100, 2710);
  const scale = 2710;
  const tick = (2100 / scale) * 100;
  const tickM = html.match(/left:calc\(([\d.]+)% - 1px\)/);
  assert.ok(tickM, "tick present beyond");
  near(Number(tickM[1]), tick);
  const tail = html.match(/right:0[^"]*width:([\d.]+)%|width:([\d.]+)%;background-image/);
  near(Number(tail[1] ?? tail[2]), 100 - tick);
  near(widths(html, "bg-f")[0], (1355 / scale) * 100);
  near(widths(html, "bg-m")[0], (542 / scale) * 100);
  near(widths(html, "bg-r")[0], (813 / scale) * 100);
  assert.equal(widths(html, "bg-l").length, 0, "Left absent beyond");
  const text = html.replace(/<[^>]+>/g, "");
  assert.match(text, /Came in £2,100/);
  assert.match(text, /£610 beyond it/);
  assert.match(html, /h-\[2px\][^"]*bg-amber-500/, "hairline is amber");
  assert.match(html, /rgba\(255,255,255,0\.55\)/, "stripes are white-alpha");
  assert.doesNotMatch(html, /red-|rose-/);
}
// Under and at: no tick, no legend, Left present, scale is take-home.
for (const [th, out] of [[2100, 1500], [2100, 2100]]) {
  const { html } = mk(th, out);
  assert.doesNotMatch(html, /Came in|beyond it|w-0\.5|bg-amber-500|background-image/, `quiet state ${out}`);
  if (th - out >= 1) near(widths(html, "bg-l")[0], ((th - out) / th) * 100);
  near(widths(html, "bg-f")[0], (out * 0.5 / th) * 100);
}

// Source naming, averages, paradox.
const base = { takeHome: 2100, totalOut: 2710, beyond: 610, cardGrowth: 300, savingsDrawdown: 100, moved: 200, average: false };
const s = (source, extra = {}) => beyondSentence({ ...base, source, ...extra });
assert.equal(s("cards"), "You spent £610 more than came in. It came from your cards.");
assert.equal(s("savings"), "You spent £610 more than came in. It came from your savings.");
assert.equal(s("cards_and_savings"), "You spent £610 more than came in. It came from your savings and your cards.");
assert.equal(s(null), "You spent £610 more than came in. Your accounts do not show where it came from.");
assert.equal(s("cards", { average: true }), "You spent £610 more than came in on average.");
assert.equal(beyondSentence({ ...base, beyond: 0, source: null }), null);
assert.equal(paradoxLine({ ...base, source: "cards", average: true }, true), null, "no paradox on averages");
assert.equal(paradoxLine({ ...base, source: "cards" }, false), null, "no paradox without consent");
assert.ok(paradoxLine({ ...base, source: "cards" }, true));
const f = beyondFigures({ take_home: 2100, overspent: 610, jobs: [] });
assert.equal(f.beyond, 610);

// Source rules: amber only, never red or rose; no em dashes or exclamation marks in copy.
assert.doesNotMatch(src, /\b(?:bg|text|ring|border|from|to|via|fill|stroke)-(?:red|rose)-/);
assert.match(src, /bg-amber-500/);
const copy = [s("cards"), s("savings"), s("cards_and_savings"), s(null), paradoxLine({ ...base, source: "cards" }, true), paradoxLine({ ...base, source: "savings" }, true), paradoxLine({ ...base, source: null }, true)].join("\n");
for (const t of [copy, ...[...src.matchAll(/`([^`]*)`|"([^"]*)"/g)].map((m) => m[1] ?? m[2])]) {
  assert.doesNotMatch(t, /—|!/, t);
}
console.log("g269 pay-split: ok");
