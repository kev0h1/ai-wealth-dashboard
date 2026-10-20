// Approved G292 A: exercise production components, not a retained preview.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { CelebrationCard, MoveCard, UnfundedMoveCard } from "../components/HomeBrief.tsx";
import HomeInsightSpotlight from "../components/HomeInsightSpotlight.tsx";
import {
  COVERED_ITEM, LONG_COVERED_ITEM, MISSING_BODY_COVERED_ITEM,
  COVER_MOVE_ITEM, UNFUNDED_MOVE_ITEM, TIP,
} from "./fixtures/g292-home-anatomy.ts";

const noop = () => {};
const router = { push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: async () => {} };
const render = element => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, element));
const mask = text => text.replace(/£[\d,]+(?:\.\d+)?/g, "£••••");
const stripTags = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const common = { router, dismissible: true, onHomeDismiss: noop, previewMode: true };
const fallbackMove = { ...COVER_MOVE_ITEM, plan_dest: undefined };
const fallbackUnfunded = {
  ...UNFUNDED_MOVE_ITEM,
  moves: UNFUNDED_MOVE_ITEM.moves.map(move => ({ ...move, suggested_covers_all: false })),
};
const cases = [
  [CelebrationCard, COVERED_ITEM], [CelebrationCard, LONG_COVERED_ITEM],
  [CelebrationCard, MISSING_BODY_COVERED_ITEM],
  [MoveCard, COVER_MOVE_ITEM], [MoveCard, fallbackMove],
  [UnfundedMoveCard, UNFUNDED_MOVE_ITEM], [UnfundedMoveCard, fallbackUnfunded],
];
let renders = 0;
for (const [Component, item] of cases) {
  for (const hidden of [false, true]) {
    const maskAmounts = hidden ? mask : text => text;
    const html = render(h(Component, { ...common, item, maskAmounts, hideNetWorth: hidden }));
    assert.match(html, /class="pr-9"><div class="min-w-0 flex-1">/, `${Component.name}: full-width block header, no icon column`);
    assert.equal((html.match(/aria-label="Hide on Home"/g) ?? []).length, 1, "one unchanged dismiss button");
    assert.match(html, /h-11 w-11 touch-manipulation/, "44px native dismiss target");
    assert.match(html, /w-7 h-7 flex items-center justify-center rounded-full/, "V2 visual chip retained");
    if (Component === CelebrationCard) {
      assert.equal((html.match(/class="lucide lucide-check /g) ?? []).length, 1, "one small success tick");
      assert.doesNotMatch(html, /lucide-circle-check/, "no second success tile");
      assert.match(html, /role="button" tabindex="0"/, "existing keyboard opening retained");
      if (item.body) assert.match(stripTags(html), /should go through/, "Covered is not paid");
      else assert.doesNotMatch(html, /mt-3 text-pretty/, "missing detail does not create empty body");
    } else {
      assert.match(html, /href="\/upcoming"/, "existing CTA route retained");
      assert.match(html, /Penny/, "Penny identity retained without its decorative tile");
      assert.match(html, /Premier Current/, "destination account identity retained");
      if (item.plan_dest || Component === UnfundedMoveCard) assert.match(html, /Barclays/, "existing bank identity retained");
      if (Component === UnfundedMoveCard) assert.match(html, /text-amber-500 dark:text-amber-400/, "watch cue survives removal of tile");
    }
    if (hidden) assert.doesNotMatch(html, /£[\d,]+/, "no visible or accessible unmasked money in any branch");
    renders++;
  }
}
assert.equal(COVER_MOVE_ITEM.moves.reduce((sum, move) => sum + move.amount, 0), 70);
assert.equal(COVER_MOVE_ITEM.plan_dest.balance + COVER_MOVE_ITEM.amount, COVER_MOVE_ITEM.plan_dest.needs_total);
for (const move of COVER_MOVE_ITEM.moves) assert.notEqual(move.move_map.from.account_id, move.move_map.to.account_id);
const tip = render(h(HomeInsightSpotlight, { previewInsight: TIP }));
assert.match(tip, /^<div class="px-4 lg:px-0 fade-in">/, "loaded tip supplies the mobile page gutter in HomePage's unpadded group");
assert.match(tip, /w-full text-left p-4/, "one 16px internal reading inset");
assert.match(tip, /aria-label="Dismiss insight"/, "tip dismissal retained");
const source = readFileSync(new URL("../components/HomeBrief.tsx", import.meta.url), "utf8");
for (const [start, end] of [
  ["export function CelebrationCard", "interface CliffCardProps"],
  ["export function UnfundedMoveCard", "interface IntentPaceCardProps"],
  ["export function MoveCard", "interface RhythmCardProps"],
]) assert.doesNotMatch(source.slice(source.indexOf(start), source.indexOf(end)), /<BriefIcon/, "both move branches and Covered must stay tile-free");
const tipSkeleton = render(h(HomeInsightSpotlight));
assert.match(tipSkeleton, /^<div class="px-4 lg:px-0"><div class="h-32 /, "loading tip supplies the same mobile page gutter as the loaded card");
console.log(`PASS G292 A: ${renders} production card states, both move branches, masking, semantic marks, actions, financial fixtures and tip alignment.`);
