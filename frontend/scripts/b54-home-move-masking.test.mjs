// Raw props through BriefBody exercise the production hide-balances function.
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { BriefBody } from "../components/HomeBrief.tsx";
import { COVER_MOVE_ITEM } from "./fixtures/g292-home-anatomy.ts";

const noop = () => {};
const router = { push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: async () => {} };
const legacyMove = { ...COVER_MOVE_ITEM, plan_dest: undefined };
const cases = [
  {
    name: "legacy move without a destination",
    item: legacyMove,
    hiddenBody: "£•••• across two moves keeps everything clearing at Premier Current.",
  },
  {
    name: "legacy prose without a brief lead",
    item: {
      ...legacyMove,
      brief_lead: undefined,
      body: "£1,234.56 was held before a −£70 adjustment, with 2 payments expected on 30 Oct.",
    },
    hiddenBody: "£•••• was held before a −£•••• adjustment, with 2 payments expected on 30 Oct.",
  },
  {
    name: "legacy move without a body or brief lead",
    item: { ...legacyMove, body: undefined, brief_lead: undefined },
  },
  {
    name: "destination without source legs",
    item: { ...COVER_MOVE_ITEM, moves: undefined, move_map: undefined },
  },
];

let renders = 0;
for (const { name, item, hiddenBody } of cases) {
  for (const hideNetWorth of [false, true]) {
    const html = renderToStaticMarkup(h(AppRouterContext.Provider, { value: router },
      h(BriefBody, { items: [item], router, hideNetWorth }),
    ));
    const text = html.replace(/<[^>]+>/g, "");
    assert.match(html, /data-move-card="fallback"/, `${name}: must exercise the fallback`);
    assert.match(html, /href="\/upcoming"/, `${name}: keep the existing action`);

    if (hideNetWorth) {
      assert.doesNotMatch(html, /£[\d,]+(?:\.\d+)?/, `${name}: no raw amount in text or accessible attributes`);
      assert.ok(text.includes("Move £•••• to Premier Current"), `${name}: headline is masked`);
      assert.match(html, /class="money">£••••<\/span>/, `${name}: masked currency keeps its money styling`);
      if (hiddenBody) assert.ok(text.includes(hiddenBody), `${name}: body is masked and non-money detail is preserved`);
    } else {
      assert.ok(text.includes(item.headline), `${name}: showing balances restores the raw headline`);
      assert.doesNotMatch(html, /£••••/, `${name}: showing balances does not mask figures`);
      if (!item.plan_dest && item.body) assert.ok(text.includes(item.body), `${name}: showing balances preserves the raw body`);
    }
    assert.doesNotMatch(text, /undefined|null/, `${name}: absent body stays empty`);
    renders++;
  }
}

console.log(`PASS B54: ${renders} raw-prop BriefBody fallback renders, hidden/shown headline and body, signed decimal prose, missing body and source-less destination.`);
