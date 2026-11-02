// G402: the payday plan card adds one muted line, "This doesn't include your
// habitual transfers", beside the "stays with you" figure, only when the plan
// payload says habitual_note. Layout is otherwise unchanged.
// Run: npm run -s check:g402-payday-plan-line
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import PaydayPlanCard from "../components/PaydayPlanCard.tsx";
import * as F from "./fixtures/g295-home-brief-anatomy.ts";

const noop = () => {};
const router = { bfcacheId: "g402", push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: async () => {} };
const render = (item) => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router },
  h(BalancesHiddenContext.Provider, { value: false }, h(PaydayPlanCard, { item, router, hideNetWorth: false, maskAmounts: (t) => t, dismissible: false }))));
const LINE = "This doesn&#x27;t include your habitual transfers";

const without = render({ ...F.PAYDAY_PLAN_ITEM, habitual_note: false });
const absent = render(F.PAYDAY_PLAN_ITEM);
const withNote = render({ ...F.PAYDAY_PLAN_ITEM, habitual_note: true });

assert.ok(!without.includes(LINE) && !absent.includes(LINE), "no line unless the plan says so");
assert.ok(withNote.includes(LINE), "the line renders when habitual_note is true");
assert.match(withNote, /stays with you in/, "the stays figure is still there");
assert.ok(withNote.indexOf("stays with you in") < withNote.indexOf(LINE), "the line follows the stays figure");
assert.match(withNote, /text-\[12px\] text-slate-400[^"]*"[^>]*>This doesn/, "muted, same 12px type as the usually-send line");
assert.equal(withNote.replace(/<p class="mt-0\.5[^>]*>This doesn&#x27;t include your habitual transfers<\/p>/, ""), without.replace(/<p class="mt-0\.5[^>]*>This doesn&#x27;t include your habitual transfers<\/p>/, ""), "nothing else on the card changes");

const src = readFileSync(new URL("../components/PaydayPlanCard.tsx", import.meta.url), "utf8");
assert.match(src, /This doesn&apos;t include your habitual transfers/, "exact copy");
console.log("g402 payday plan line: ok");
