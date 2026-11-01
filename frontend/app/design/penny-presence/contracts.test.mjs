import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PresenceGallery } from "./PresenceGallery.tsx";
import { PRESENCE_FIXTURES, PRESENCE_STACK_ORDER } from "./fixtures.ts";
import { AskGenericCard, CelebrationCard, MoveCard } from "@/components/HomeBrief";
import PaydayPlanCard from "@/components/PaydayPlanCard";
import { BalancesHiddenContext, maskMoneyText } from "@/lib/balancesHidden";
import PresenceGlyph from "./PresenceGlyph.tsx";

const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: async () => {} };
const render = (props = {}) => renderToStaticMarkup(
  React.createElement(AppRouterContext.Provider, { value: router },
    React.createElement(PresenceGallery, {
      variant: "current", state: "stack", masked: false, onAction: noop, onPennyOpen: noop, ...props,
    }),
  ),
);
const plain = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const cardStack = html => html.match(/<div class="[^"]*cardStack[^"]*">([\s\S]*?)<\/section>/)?.[1] ?? "";
const structural = html => html.replace(/\s(?:class|style|data-[\w-]+)="[^"]*"/g, "");
const cardText = (html, key) => {
  const marker = `data-g388-card="${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}"`;
  const at = html.indexOf(marker);
  if (at < 0) return "";
  const start = html.indexOf(">", at) + 1;
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 1;
  for (let tag; (tag = tags.exec(html));) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return plain(html.slice(start, tag.index));
  }
  throw new Error(`Unclosed card region ${key}`);
};

const variants = ["a", "b", "c", "d", "e", "f", "current"];
const states = ["card-detail", "cover-plan", "payday-plan", "covered"];

// Every comparison is the real Home card family, with only the preview shell changing.
for (const state of states) {
  const baseline = structural(cardStack(render({ state, variant: "current" })));
  assert.ok(baseline, `${state} renders a card stack`);
  for (const variant of variants) {
    const html = render({ state, variant });
    assert.equal(structural(cardStack(html)), baseline, `${state} financial/card content is identical in ${variant}`);
    assert.match(html, /aria-label="Penny presence preview"/);
  }
}

const stack = render({ state: "stack", variant: "a" });
for (const key of PRESENCE_STACK_ORDER) {
  assert.ok(cardText(stack, key), `${key} has a marked real card region`);
}

// The preview must render the same production component with the same fixture, not a copied card.
const direct = key => {
  const item = PRESENCE_FIXTURES[key];
  const maskAmounts = text => maskMoneyText(text, false);
  const child = key === "cardDetail"
    ? React.createElement(AskGenericCard, { item, router, maskAmounts, dismissible: false })
    : key === "coverPlan"
      ? React.createElement(MoveCard, { item, hideNetWorth: false, maskAmounts, dismissible: false, previewMode: true })
      : key === "paydayPlan"
        ? React.createElement(PaydayPlanCard, { item, router, hideNetWorth: false, maskAmounts, dismissible: false, onClose: noop })
        : React.createElement(CelebrationCard, { item, router, maskAmounts, dismissible: false });
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, child));
};
for (const key of PRESENCE_STACK_ORDER) {
  assert.equal(cardText(stack, key), plain(direct(key)), `${key} is rendered by its production component`);
}

// Fixture arithmetic must reconcile before it is allowed into a financial-product preview.
const cover = PRESENCE_FIXTURES.coverPlan;
assert.equal(cover.plan_dest.needs_total, 160);
assert.equal(cover.plan_dest.bills.reduce((sum, bill) => sum + bill.amount, 0), 160);
assert.equal(cover.moves.reduce((sum, move) => sum + move.amount, 0), 72);
assert.equal(cover.plan_dest.balance + cover.amount, cover.plan_dest.needs_total);
assert.equal(cover.moves[0].amount + cover.moves[1].amount, cover.amount);
assert.equal(PRESENCE_FIXTURES.paydayPlan.salary.amount, 2450);
assert.equal(PRESENCE_FIXTURES.paydayPlan.salary.stays + PRESENCE_FIXTURES.paydayPlan.total, 2450);
assert.equal(PRESENCE_FIXTURES.paydayPlan.dests.reduce((sum, dest) => sum + dest.move, 0), PRESENCE_FIXTURES.paydayPlan.total);
for (const destination of PRESENCE_FIXTURES.paydayPlan.dests) assert.equal(destination.move, Math.max(0, destination.target - destination.balance), `${destination.name} top-up reconciles to its target`);

// Covered is deliberately not attributed to Penny. The surrounding nav may still contain Penny,
// so scope this assertion to the actual card-stack content.
const coveredText = plain(cardStack(render({ state: "covered", variant: "a" })));
assert.doesNotMatch(coveredText, /Penny|Ask Penny|gradient/i);
assert.match(coveredText, /Household account has enough/);
assert.doesNotMatch(coveredText, /Bills account/, "the Covered verdict never contradicts the separate short paying account");

// The shared hidden-balance context must mask every displayed pound figure, including accessible text.
const masked = render({ state: "stack", variant: "a", masked: true });
assert.doesNotMatch(cardStack(masked), /£\d/);
assert.match(cardStack(masked), /£••••/);

// Preview actions are intercepted locally. It must not introduce customer I/O or production navigation.
const gallerySource = readFileSync(new URL("./PresenceGallery.tsx", import.meta.url), "utf8");
assert.match(gallerySource, /onAction\(action\.label, action\.route\)/);
assert.match(gallerySource, /onPennyOpen/);
assert.match(gallerySource, /role="button"|\[role="button"\]/);
assert.match(gallerySource, /preventDefault\(\)/);
assert.match(gallerySource, /stopPropagation\(\)/);
assert.doesNotMatch(gallerySource, /fetch\(|localStorage|sessionStorage|\bapi\.(?:get|post|put|patch|delete)\b/);
assert.doesNotMatch(gallerySource, /router\.(?:push|replace)\(/);
for (const component of ["AskGenericCard", "MoveCard", "PaydayPlanCard", "CelebrationCard"]) assert.match(gallerySource, new RegExp(`\\b${component}\\b`));

// The preview boundary stays under app/design and does not mutate production card sources.
const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
assert.match(pageSource, /PennyPresenceClient/);
assert.doesNotMatch(pageSource, /@\/lib\/api|fetch\(|localStorage|sessionStorage/);

// The outline proposals draw an outline, rather than putting the old filled tile in a border.
for (const variant of ["d", "e"]) {
  const glyph = renderToStaticMarkup(React.createElement(PresenceGlyph, { variant }));
  assert.match(glyph, /fill="none"/);
  assert.match(glyph, /stroke="currentColor"/);
  assert.doesNotMatch(glyph, /fill="currentColor"|opacity=|linear-gradient|linearGradient/);
}

console.log("G388 contracts: four real Home card families, cross-variant fidelity, Covered attribution boundary, masking, local actions, dates and preview-only I/O covered.");
