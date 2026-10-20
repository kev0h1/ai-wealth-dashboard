import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PreviewTraitCard from "./PreviewTraitCard.tsx";
import { ACTIVE, COMPLETED, fixtureAim, fixtureTraits, observationCount } from "./fixtures.ts";

const noop = () => {};
const asyncNoop = async () => {};
const render = props => renderToStaticMarkup(React.createElement(PreviewTraitCard, {
  variant: "a", selected: false, onEvidence: noop, ...props,
  onChoice: asyncNoop, onEdit: noop, onKeep: asyncNoop, onStop: asyncNoop, onRetry: noop,
}));
const text = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const traits = fixtureTraits("all");
assert.deepEqual(traits.map(({ id }) => id), ["saving_habit", "orchestrator", "signature_pleasure", "hygiene", "front_loader", "credit_switch"]);
assert.deepEqual(traits.map(({ kind }) => kind), ["habit", "structure", "pleasure", "hygiene", "structure", "structure"]);
assert.equal(traits.find(trait => trait.id === "signature_pleasure").ref_category, "Eating Out");

for (const choice of [null, "keep", "change"]) {
  const trait = { ...traits[2], choice };
  const html = render({ trait, category: "Eating Out", activeAim: ACTIVE, completed: COMPLETED, loading: false, error: null, masked: false });
  if (choice === "change") assert.match(html, /Choose what to do with/);
  else assert.doesNotMatch(text(html), /Adjust this aim|Stop checking this aim|Keep this pace|What happened|£82\.12/);
  assert.equal((html.match(/>View evidence</g) ?? []).length, 1);
}

for (const state of [
  { label: "loading", loading: true, error: null },
  { label: "error", loading: false, error: "offline" },
]) {
  const html = render({ trait: { ...traits[2], choice: "change" }, category: "Eating Out", activeAim: null, completed: null, masked: false, ...state });
  assert.match(html, state.label === "loading" ? /Loading aim feedback/ : /We could not load this check yet/);
  assert.doesNotMatch(text(html), /Adjust this aim|Stop checking this aim|£100\.25/);
}

const activeHtml = render({ trait: { ...traits[2], choice: "change" }, category: "Eating Out", activeAim: ACTIVE, completed: null, loading: false, error: null, masked: false });
assert.match(activeHtml, /£82\.12/); assert.match(activeHtml, /£100\.25/);
assert.equal(Math.round((154 / 179) * 30), 26);
assert.equal(Number((ACTIVE.spent_so_far / ACTIVE.pace.elapsed_fraction).toFixed(2)), ACTIVE.pace.projected);
assert.equal(Number((ACTIVE.aim_amount * ACTIVE.pace.elapsed_fraction).toFixed(2)), ACTIVE.pace.pace_today);
for (const amount of [50, 100, 120.5, 200]) {
  const aim = fixtureAim(amount);
  assert.equal(aim.aim_amount, amount);
  assert.equal(aim.pace.pace_today, Number((amount * aim.pace.elapsed_fraction).toFixed(2)));
  assert.equal(aim.pace.projected, ACTIVE.pace.projected, "changing the target does not rewrite recorded spending");
}
assert.equal(observationCount(1, "returned payment or late fee", "returned payments or late fees"), "1 returned payment or late fee");
assert.equal(observationCount(4, "returned payment or late fee", "returned payments or late fees"), "4 returned payments or late fees");
const completedHtml = render({ trait: { ...traits[2], choice: "change" }, category: "Eating Out", activeAim: null, completed: COMPLETED, loading: false, error: null, masked: false });
assert.match(completedHtml, /£82/); assert.match(completedHtml, /£100/);
const maskedHtml = render({ trait: { ...traits[2], choice: "change" }, category: "Eating Out", activeAim: ACTIVE, completed: COMPLETED, loading: false, error: null, masked: true });
assert.doesNotMatch(maskedHtml, /£82\.12|£100\.25|£127\.74/); assert.match(maskedHtml, /aria-label="Choose what to do with/);

const previewSource = readFileSync(new URL("./MirrorReadingEdgeClient.tsx", import.meta.url), "utf8");
assert.doesNotMatch(previewSource, /api\.\w+\(|fetch\(|localStorage|sessionStorage/);
assert.match(previewSource, /<AimSheet[\s\S]*baseline=\{\{ usual: 108, suggestedAim: 100\.25 \}\}/);
assert.match(previewSource, /onSubmit=\{async amount =>/);
assert.match(previewSource, /<MirrorEvidence[\s\S]*checkpointId=\{null\}/);
assert.ok(previewSource.includes('<div inert className={`${styles.reference}'), "comparison is inert");
const proposedCopy = [...fixtureTraits("all"), ...fixtureTraits("hygiene-clear")].flatMap(trait => [trait.title, trait.narrative, ...trait.evidence]).join(" ");
assert.doesNotMatch(proposedCopy, /(?:orchestrat|fee\(s\)|transaction\(s\)|~25\.8×|described above|without judgement)/i);

const css = readFileSync(new URL("./preview.module.css", import.meta.url), "utf8");
assert.match(css, /\.proposed\s*\{/); assert.match(css, /\.quietFooter\s*\{/); assert.match(css, /\.rowFooter\s*\{/);
assert.match(css, /\.evidenceAction\s*\{[^}]*min-height:44px/);
assert.match(readFileSync(new URL("../../../components/MirrorFeedbackCard.tsx", import.meta.url), "utf8"), /There is no current check for this trait yet/);
for (const variant of ["a", "b"]) {
  const html = render({ variant, trait: traits[0], category: null, activeAim: null, completed: null, loading: false, error: null, masked: false });
  assert.match(html, new RegExp(`data-variant="${variant}"`));
  assert.match(html, /<article[\s\S]*<footer[\s\S]*View evidence[\s\S]*<\/footer><\/article>/, "evidence action is inside one visible card boundary");
}
console.log("G302 contracts: trait identity, choice/coaching boundaries, guarded feedback, money masking, inert reference, AimSheet and evidence checkpoint isolation covered.");
