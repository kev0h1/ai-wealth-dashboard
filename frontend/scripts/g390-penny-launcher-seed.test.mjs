import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PennyLauncherButton from "../components/PennyLauncherButton.tsx";
import {
  PENNY_APPEARANCE_STORAGE_KEY, readSeededPennyAppearance, writeSeededPennyAppearance,
} from "../lib/pennyAppearance.ts";

const noop = () => {};
const render = props => renderToStaticMarkup(React.createElement(PennyLauncherButton, {
  active: false, open: false, current: false, paydayActive: false, onClick: noop, ...props,
}));
const memory = () => {
  const data = new Map();
  return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
};
const ANIMATION = /animate-|transition-opacity|opacity-0|fade|stagger|\banimation\b/;

// A device with a stored seed: the first paint is the stored choice, never the default purple.
for (const stored of ["outline", "ink"]) {
  const storage = memory();
  storage.setItem(PENNY_APPEARANCE_STORAGE_KEY, stored);
  const seed = readSeededPennyAppearance(storage);
  assert.equal(seed, stored);
  const first = render({ appearance: seed, resolved: true });
  assert.match(first, new RegExp(`data-penny-appearance="${stored}"`));
  assert.doesNotMatch(first, /linear-gradient/, "no default-purple gradient on first paint when a seed exists");
  assert.doesNotMatch(first, ANIMATION);
}
const storedOriginal = memory();
storedOriginal.setItem(PENNY_APPEARANCE_STORAGE_KEY, "original");
assert.equal(readSeededPennyAppearance(storedOriginal), "original");
assert.match(render({ appearance: "original", resolved: true }), /linear-gradient/, "a stored Original choice keeps its gradient");

// No seed: null is not the default, and the launcher holds a neutral, markless door until ready.
assert.equal(readSeededPennyAppearance(memory()), null);
assert.equal(readSeededPennyAppearance(null), null);
const junk = memory();
junk.setItem(PENNY_APPEARANCE_STORAGE_KEY, "purple");
assert.equal(readSeededPennyAppearance(junk), null, "an unknown stored value is not a seed");
const pending = render({ appearance: "original", resolved: false });
assert.match(pending, /data-penny-appearance="pending"/);
assert.match(pending, /aria-label="Penny"/);
assert.doesNotMatch(pending, /linear-gradient|<svg|indigo-5|#4338ca/, "neutral door carries no mark and no Penny gradient");
assert.doesNotMatch(pending, ANIMATION);
assert.doesNotMatch(pending, /active:scale|transition-transform/, "no press or motion classes while neutral");
assert.equal(pending.replace(/<[^>]+>/g, "").trim(), "");

// After ready: the server value wins, whatever the default prop was.
const ready = render({ appearance: "ink", resolved: true });
assert.match(ready, /data-penny-appearance="ink"/);
assert.doesNotMatch(ready, ANIMATION);
const readyOriginal = render({ appearance: "original", resolved: true });
assert.match(readyOriginal, /data-penny-appearance="original"/);
assert.match(readyOriginal, /linear-gradient/);

// The server value is written back so the next load can seed from it.
const target = memory();
writeSeededPennyAppearance("outline", target);
assert.equal(target.data.get(PENNY_APPEARANCE_STORAGE_KEY), "outline");
assert.equal(readSeededPennyAppearance(target), "outline");
// The default prop is resolved by default, so every existing caller is unchanged.
assert.match(render({ appearance: "outline" }), /data-penny-appearance="outline"/);

console.log("G390: seeded launcher paints the stored look first, neutral and markless without a seed, no animation.");
