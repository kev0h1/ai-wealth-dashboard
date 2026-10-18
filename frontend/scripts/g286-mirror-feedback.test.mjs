import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import MirrorFeedbackCard from "../components/MirrorFeedbackCard.tsx";
import { mirrorMoney, mirrorText, completedFor, leadingTrait, periodLabel } from "../lib/mirrorFeedback.ts";

const noop = async () => {};
const trait = { id: "signature_pleasure", title: "Your Signature: Eating Out", narrative: "£14872 recorded, not a judgement.", evidence: ["£2270 across the window"], ref_category: "Eating Out", kind: "pleasure", choice: "change" };
const active = { id: "current", ref: "Eating Out", aim_amount: 100.25, spent_so_far: 82.12, days_left: 13, on_track: true, period_start: "2026-10-03", period_end: "2026-10-30", pace: { state: "on", phrase: "on pace", period_days: 28, elapsed_fraction: 0.5, pace_today: 50.13, projected: 164.24, spent_fraction: 0.8192 } };
const completed = { id: "closed", ref: "Eating Out", aim_amount: 100, result_amount: 82, period_start: "2026-09-05", period_end: "2026-10-02", status: "met", resolved_at: "2026-10-03T10:00:00+00:00" };
const props = { trait, category: "Eating Out", activeAim: active, completed: null, loading: false, error: null, masked: false, onChoice: noop, onEdit: noop, onKeep: noop, onStop: noop, onRetry: noop };
const render = (patch = {}) => renderToStaticMarkup(React.createElement(MirrorFeedbackCard, { ...props, ...patch }));
const text = html => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

assert.equal(mirrorMoney(123358.75), "£123,358.75");
assert.equal(mirrorMoney(-7.62), "−£7.62");
assert.equal(mirrorMoney(8), "£8");
assert.equal(mirrorMoney(82.12, true), "£••••");
assert.equal(mirrorText("£14872 and -£7.62 with +£10.50", false), "£14,872 and −£7.62 with +£10.50");
assert.equal(mirrorText("£14872 and −£7.62", true), "£•••• and £••••");
assert.ok(periodLabel("2026-09-05", "2026-10-02").includes("5 Sept 2026"));
assert.equal(completedFor("Eating Out", [completed, { ...completed, id: "older", period_end: "2026-09-02" }]).id, "closed");
assert.equal(leadingTrait([{ ...trait, id: "kept", choice: "keep" }, trait], [active], [completed]).id, trait.id);

const current = render();
assert.ok(text(current).includes("Your chosen pace is being checked"));
assert.ok(text(current).includes("£82.12 of a £100.25 aim"));
assert.ok(text(current).includes("13 days left. on pace"));
assert.ok(text(current).includes("There is nothing to tick off."));
assert.ok(text(current).includes("Adjust this aim") && text(current).includes("Stop checking this aim"));
assert.ok(!current.includes("Keep this pace"), "an active aim does not need saving again");
assert.ok(!/<input[^>]*checkbox/.test(current));
for (const choice of ["keep", null]) {
  const quiet = text(render({ trait: { ...trait, choice }, completed }));
  assert.ok(!quiet.includes("£82.12") && !quiet.includes("What happened") && !quiet.includes("Adjust this aim"), "keep and unchosen never expose coaching");
  assert.ok(quiet.includes(choice === "keep" ? "no coaching" : "Coaching stays off"));
}
for (const result of [82, 98, 100, 118]) {
  const html = render({ activeAim: null, completed: { ...completed, result_amount: result } });
  assert.ok(text(html).includes("What happened"));
  assert.ok(text(html).includes(`${mirrorMoney(result)} against a £100 aim`));
  assert.ok(text(html).includes("current pay period"), "no unsupported future aim scheduling");
  assert.ok(!text(html).includes("Stop"), "a completed check cannot be cancelled after the fact");
}
const masked = render({ masked: true, completed });
assert.ok(!/14,?872|2,?270|82\.12|100\.25/.test(masked), "money hidden in text and accessible attributes");
assert.ok(!masked.includes('role="img"'), "masked ring cannot leak an accessible money sentence");
const failed = text(render({ error: "offline" }));
assert.ok(failed.includes("Try again") && !failed.includes("£82.12"));
const source = readFileSync(new URL("../app/mirror/MirrorPage.tsx", import.meta.url), "utf8");
assert.ok(source.includes("!preferencesReady || hideNetWorth"));
assert.ok(source.includes("api.completedCheckpoints()") && source.includes("api.setMirrorChoice"));
assert.ok(!source.includes("WHAT YOU&apos;RE WORKING ON"), "no detached aim dashboard");
const evidence = readFileSync(new URL("../components/MirrorEvidence.tsx", import.meta.url), "utf8");
assert.ok(evidence.includes('trait.id === "hygiene"'), "payment-related records stay with their own trait");
assert.ok(evidence.includes("changed_since_result"));
console.log("PASS G286 production: trait consent, real history contract, neutral reconciled comparisons, pence, masking and current-period reflection.");
