// G242 (approved C, 2026-10-11): aims for any category, the ring always on
// Spend, the aim on the transactions hub, the Mirror's next step and Penny's
// nudge.
//  1. A Spend row with an aim keeps the slate ring with AND without a tip, with
//     the sr-only sentence; a row with no aim has no ring.
//  2. The client pace fallback matches the server table (backend/tests/test_g242_aims.py).
//  3. The hub shows the aim only for a single category on the current period.
//  4. HubAim wording: set-an-aim row, and the ring / sentence / even pace / edit.
//  5. The Mirror: 44px indigo choice buttons, one next step per trait kind, the
//     warm keep note, "Back to Spend".
//  6. The nudge card, and where it is mounted.
//  7. No red or amber on an aim state; copy rules; the round's leftovers are gone.
//
// Run: npm run -s check:g242-aims

import assert from "node:assert/strict";
import React from "react";
import { readFileSync, existsSync } from "node:fs";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import { MajorityRowView } from "../components/SpendVerdictView.tsx";
import { HubAim } from "../components/HubAim.tsx";
import MirrorNextStep from "../components/MirrorNextStep.tsx";
import AimNudgeCard from "../components/AimNudgeCard.tsx";
import { TraitCard, nextStepKind, KEEP_NOTE } from "../app/mirror/MirrorPage.tsx";
import { aimPace } from "../lib/aimPace.ts";
import { hubAimEligible } from "../lib/hubAim.ts";
import { openTipsFor } from "../lib/spendTips.ts";

const h = React.createElement;
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const render = (el) => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, el));

const serverPace = (state, phrase, paceToday = 78.57, spentFraction = 0.82) => ({
  state, phrase, period_days: 28, elapsed_fraction: 0.7857, pace_today: paceToday, projected: 104.4, spent_fraction: spentFraction,
});
const aim82 = { id: "a1", aim_amount: 100, spent_so_far: 82, days_left: 6, on_track: true, pace: serverPace("on", "on pace") };

// 1. the ring is always there ---------------------------------------------
const tip = {
  id: "t1", category: "eating", app_category: "Eating Out", icon: "x", label: "Lunch",
  title: "Pack lunch twice a week", body: "A cheaper option exists.",
  savings_estimate: "~£20/mo", savings_estimate_monthly: 20, pinned: false, is_new: false,
  refreshed_at: null, verified_savings: null, verified_merchant: null, substituted: false,
  substituted_merchant: null, substituted_amount: null, claim_valid_until: null,
  content_valid_until: null, expiry_line: "Researched 2d ago", researched_at: null, state: "fresh",
  triggered_by: [{ merchant_key: "pret", display_name: "Pret", monthly_amount: 40, occurrences: 6 }],
  user_context: null, has_workflow: false, app_route: null,
};
const row = { category: "Eating Out", spent: 82, payments_count: 9 };
const rowHtml = (aim, tips) => render(h(MajorityRowView, { row, colours: {}, quietTag: false, onOpen: noop, tips, aim, periodDays: 28 }));
const withTip = rowHtml(aim82, openTipsFor("Eating Out", [tip]));
const noTip = rowHtml(aim82, []);
const noAim = rowHtml(null, openTipsFor("Eating Out", [tip]));
assert.ok(/<svg[^>]*role="img"/.test(withTip), "ring is kept when the row carries a tip");
assert.ok(/1 tip/.test(withTip), "the tip subline is still there beside the ring");
assert.ok(/<svg[^>]*role="img"/.test(noTip), "ring with no tip");
assert.ok(text(withTip).includes("£82 of a £100 aim, on pace"), "sr-only sentence");
assert.ok(/class="sr-only"/.test(withTip));
assert.ok(!/<svg/.test(noAim.replace(/<svg[^>]*aria-hidden[^>]*>[\s\S]*?<\/svg>/g, "")) || !noAim.includes("aim"), "no aim, no ring sentence");
assert.ok(!noAim.includes("of a £100 aim"));

// 2. pace parity with the server table -------------------------------------
const fb = (spent, daysLeft, amount = 100) => aimPace({ aim_amount: amount, spent_so_far: spent, days_left: daysLeft }, 28);
assert.equal(fb(20, 14).state, "under");
assert.equal(fb(50, 14).state, "on");
assert.equal(fb(60, 14).state, "likely");
assert.equal(fb(122, 5).state, "past");
assert.equal(fb(40, 25).state, "on", "too early to project");
assert.equal(fb(96, 6).state, "likely");
assert.equal(fb(96, 6).phrase, "likely to pass your aim");
assert.ok(Math.abs(fb(96, 6).paceToday - 78.57) < 0.01);
assert.equal(fb(82, 6).state, "on");
// the server reading wins over the fallback
assert.equal(aimPace({ ...aim82, spent_so_far: 5000, pace: serverPace("on", "on pace") }, 28).state, "on");

// 3. hub scope ---------------------------------------------------------------
const cur = { start: "2026-09-28", end: "2026-10-25" };
const scope = { categoryFilter: "Eating Out", categoriesFilter: null, merchantsFilter: null, searchQuery: "", txnType: null, periodFrom: cur.start, periodTo: cur.end };
assert.equal(hubAimEligible(scope, cur), true);
assert.equal(hubAimEligible(scope, null), false, "no current period known");
assert.equal(hubAimEligible({ ...scope, categoryFilter: null }, cur), false, "no category");
assert.equal(hubAimEligible({ ...scope, categoriesFilter: ["A", "B"] }, cur), false, "multi-category link");
assert.equal(hubAimEligible({ ...scope, merchantsFilter: ["Pret"] }, cur), false, "merchant scope");
assert.equal(hubAimEligible({ ...scope, searchQuery: "pret" }, cur), false, "search");
assert.equal(hubAimEligible({ ...scope, txnType: "credit" }, cur), false, "credit scope");
assert.equal(hubAimEligible({ ...scope, periodFrom: "2026-08-31", periodTo: "2026-09-27" }, cur), false, "past period");
assert.equal(hubAimEligible({ ...scope, periodFrom: null, periodTo: null }, cur), false, "all history");

// 4. HubAim wording ----------------------------------------------------------
const noAimHub = renderToStaticMarkup(h(HubAim, { category: "Eating Out", aim: null, suggestedAim: 100, periodDays: 28, onOpenEditor: noop }));
assert.ok(text(noAimHub).includes("A pace to check Eating Out against? Your usual would put it near £100 a period."));
assert.ok(noAimHub.includes("Set an aim") && noAimHub.includes("min-h-[44px]"));
const aimHub = renderToStaticMarkup(h(HubAim, { category: "Eating Out", aim: aim82, suggestedAim: 100, periodDays: 28, onOpenEditor: noop }));
assert.ok(text(aimHub).includes("£82 of a £100 aim"));
assert.ok(aimHub.includes("on pace"));
assert.ok(text(aimHub).includes("An even pace would be about £79 by today."));
assert.ok(aimHub.includes("A pace check, not a limit."));
assert.ok(aimHub.includes("Edit or remove this aim") && aimHub.includes("min-h-[44px]"));
assert.ok(aimHub.includes("h-8") && aimHub.includes("w-8"), "32px ring");
const tp = read("../app/transactions/TransactionsPage.tsx");
assert.ok(tp.includes("<HubAimSection"), "hub mounts the aim block");
assert.ok(tp.indexOf("<HubAimSection") < tp.indexOf("<TipsLine"), "aim above the tips line");

// 5. the Mirror --------------------------------------------------------------
const eat = { id: "signature_pleasure", title: "Your Signature: Eating Out", narrative: "n", evidence: ["e"], kind: "pleasure", choice: "change", ref_category: "Eating Out" };
const front = { id: "front_loader", title: "The Front-Loader", narrative: "n", evidence: [], kind: "structure", choice: "change" };
const saver = { id: "saving_habit", title: "Regular Saver", narrative: "n", evidence: [], kind: "habit", choice: "change" };
const orch = { id: "orchestrator", title: "The Orchestrator", narrative: "n", evidence: [], kind: "structure", choice: "change" };
assert.equal(nextStepKind(eat), "aim");
assert.equal(nextStepKind({ ...eat, ref_category: null }), "aim", "falls back to the signature title");
assert.equal(nextStepKind(front), "checkpoint");
assert.equal(nextStepKind(saver), "plan");
assert.equal(nextStepKind(orch), null);
const card = (trait, nextStep) => render(h(TraitCard, { trait, activeAim: null, onChoice: noop, onSetAim: noop, nextStep }));
const eatHtml = card(eat, h(MirrorNextStep, { kind: "aim", category: "Eating Out", amount: 100, status: "open", onAct: noop, onSeeNext: noop }));
assert.ok(text(eatHtml).includes("Set an aim for Eating Out"));
assert.ok((eatHtml.match(/min-h-\[44px\]/g) ?? []).length >= 3, "both choice buttons and the step are 44px");
assert.ok(/bg-indigo-50[^"]*text-indigo-700/.test(eatHtml), "a chosen change is neutral indigo");
assert.ok(!/amber/.test(eatHtml));
const doneHtml = render(h(MirrorNextStep, { kind: "aim", category: "Eating Out", status: "done", onSeeNext: noop }));
assert.ok(text(doneHtml).includes("Aim set. It sits beside Eating Out on Spend.") && doneHtml.includes("See it on Spend"));
const cpHtml = render(h(MirrorNextStep, { kind: "checkpoint", onSeeNext: noop }));
assert.ok(text(cpHtml).includes("there is nothing for you to tick"));
assert.ok(/would let me look at your transactions/.test(text(cpHtml)), "hedged, read from transactions");
assert.equal((cpHtml.match(/<button/g) ?? []).length, 1, "checkpoint step has only a way back, nothing to tick");
const planHtml = render(h(MirrorNextStep, { kind: "plan", onAct: noop, onSeeNext: noop }));
assert.ok(planHtml.includes("See the plan on Planning"));
const keepHtml = card({ ...eat, choice: "keep" });
assert.ok(text(keepHtml).includes(KEEP_NOTE) && KEEP_NOTE === "That is part of how you do things, so it stays as it is and I will not nag you about it.");
const mp = read("../app/mirror/MirrorPage.tsx");
assert.ok(mp.includes("Back to Spend"));
assert.ok(!read("../components/SpendHeader.tsx").includes("MirrorRouteLink"), "G262: route no longer under the Spend title");
assert.ok(read("../components/SpendVerdictView.tsx").includes("{mirrorRoute && <MirrorRouteLink />}"), "G262: route heads the rest-of-spending list");
assert.ok(read("../app/components/SpendPage.tsx").includes("mirrorRoute={mirrorReady}") && read("../app/components/SpendPage.tsx").includes('portrait.status === "ok" && portrait.traits.length > 0'), "G262: route gated on a portrait");
assert.ok(read("../components/MirrorRouteLink.tsx").includes("How your money behaves"));

// 6. the nudge ---------------------------------------------------------------
const nudge = renderToStaticMarkup(h(AimNudgeCard, {
  category: "Eating Out", traitTitle: "Your Signature: Eating Out", aimAmount: 100, spentSoFar: 96, projected: 122, daysLeft: 6, onOpen: noop, onDismiss: noop,
}));
assert.ok(text(nudge).includes("Eating Out looks likely to pass your aim."));
assert.ok(text(nudge).includes("Your Signature: Eating Out"), "names the trait by its real title");
assert.ok(["£96", "£100", "£122"].every((f) => text(nudge).includes(f)));
assert.ok(nudge.includes('aria-label="Dismiss"'), "shared DismissChip");
assert.ok(!/(red|amber|rose|orange)-\d/.test(nudge));
assert.ok(!read("../app/components/HomePage.tsx").includes("AimNudge"), "not on Home: Penny never repeats what a visible surface shows");
assert.ok(read("../app/penny/PennyPage.tsx").includes("<AimNudge"), "mounted on Penny");
const one = renderToStaticMarkup(h(AimNudgeCard, { category: "Eating Out", traitTitle: "T", aimAmount: 100, spentSoFar: 96, projected: 122, daysLeft: 1, onOpen: noop }));
assert.ok(text(one).includes("with 1 day left.") && !text(one).includes("1 days"), "singular day");
assert.ok(text(nudge).includes("with 6 days left."));
const nudgeMount = read("../components/AimNudge.tsx");
assert.ok(nudgeMount.includes("api.aimNudge()") && nudgeMount.includes("dismissAimNudge"));

// 7. neutral, copy rules, leftovers gone -------------------------------------
const aimFiles = ["AimProgress", "HubAim", "AimNudgeCard", "MirrorNextStep", "MirrorRouteLink", "AimNudge"].map((n) => [n, read(`../components/${n}.tsx`)]);
for (const [name, src] of aimFiles) {
  assert.ok(!/\b(?:text|bg|border|ring|stroke|fill)-(?:red|amber|rose|orange|yellow)-\d/.test(src), `${name}: no red or amber on an aim state`);
  assert.ok(!src.includes(String.fromCharCode(0x2014)), `${name}: no em dash`);
  assert.ok(!/over budget/i.test(src), `${name}: never "over budget"`);
  for (const m of src.matchAll(/\blimit\b/gi)) {
    const before = src.slice(Math.max(0, m.index - 8), m.index).toLowerCase();
    const line = src.slice(src.lastIndexOf("\n", m.index) + 1, src.indexOf("\n", m.index));
    assert.ok(/(not a |no |never a |not as a )$/.test(before) || line.trim().startsWith("//") || line.trim().startsWith("*") || line.trim().startsWith("/*"), `${name}: "limit" only in negation: ${line.trim()}`);
  }
  assert.ok(!/>[^<{]*!(?:\s|<)/.test(src.replace(/!==?|!\w|!\(|!\[/g, "")), `${name}: no exclamation marks in copy`);
}
const sheet = read("../components/AimSheet.tsx");
assert.ok(sheet.includes("Adjust the aim you check against:") && sheet.includes("Remove this aim"));
assert.ok(!sheet.split("\n").filter((l) => !l.includes("//") && !l.includes("{/*")).join("\n").includes(String.fromCharCode(0x2014)), "no em dash in AimSheet copy");
const gradients = ["HubAim", "AimProgress", "MirrorNextStep", "MirrorRouteLink"].filter((n) => /#4f46e5|#7c3aed|linear-gradient/.test(read(`../components/${n}.tsx`)));
assert.deepEqual(gradients, [], "the Penny gradient stays on Penny's own chip");

for (const dead of ["ringUnlessTip", "AimLine", "AimRule", "aimOffer", "CategoryAimSection", "aimSlot", "HubMock"]) {
  for (const f of ["../components/SpendVerdictView.tsx", "../components/AimProgress.tsx", "../components/CategorySheet.tsx", "../app/mirror/MirrorPage.tsx", "../app/design/page.tsx"]) {
    assert.ok(!read(f).includes(dead), `${dead} is gone from ${f}`);
  }
}
assert.ok(!existsSync(new URL("../app/design/mirror-aims", import.meta.url)), "the design round is deleted");
assert.ok(!existsSync(new URL("../components/CategoryAimSection.tsx", import.meta.url)));

console.log("g242-aims: ok");
