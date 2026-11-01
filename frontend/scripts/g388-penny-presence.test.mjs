import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { AskGenericCard, CelebrationCard, MoveCard } from "../components/HomeBrief.tsx";
import PaydayPlanCard from "../components/PaydayPlanCard.tsx";
import PennyLauncherButton from "../components/PennyLauncherButton.tsx";
import PennyAppearanceIcon from "../components/PennyAppearanceIcon.tsx";
import PennyAppearanceSetting from "../components/settings/PennyAppearanceSetting.tsx";
import { BalancesHiddenContext, maskMoneyText } from "../lib/balancesHidden.tsx";
import { PRESENCE_FIXTURES as fixtures } from "./fixtures/g388-penny.ts";

const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: async () => {} };
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const plain = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const cards = [
  [AskGenericCard, fixtures.cardDetail, "Add my rates"],
  [MoveCard, fixtures.coverPlan, "See what’s due"],
  [PaydayPlanCard, fixtures.paydayPlan, "See the full plan"],
  [CelebrationCard, fixtures.covered, "Household account has enough"],
];
for (const [component, item, content] of cards) {
  for (const hidden of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router },
      React.createElement(BalancesHiddenContext.Provider, { value: hidden },
        React.createElement(component, {
          item, router, maskAmounts: text => maskMoneyText(text, hidden),
          hideNetWorth: hidden, dismissible: false, previewMode: true, onClose: noop,
        }),
      ),
    ));
    assert.match(plain(html), new RegExp(content));
    assert.doesNotMatch(html, /linear-gradient/, "C cards have no repeated gradient badge");
    assert.doesNotMatch(plain(html), /\bPenny\b/, "C card facts lead without repeated Penny attribution");
    if (hidden) assert.doesNotMatch(html, /£[\d,]+/, "masked amounts do not leak into accessible markup");
  }
}

for (const appearance of ["original", "outline", "ink"]) {
  const door = render(PennyLauncherButton, { appearance, active: false, open: false, current: false, paydayActive: false, onClick: noop });
  assert.match(door, /aria-label="Penny"/);
  assert.match(door, /aria-pressed="false"/);
  assert.equal(plain(door), "", "there is no visible Penny caption for any option");
  assert.equal(/linear-gradient/.test(door), appearance === "original", "only Original keeps the production gradient");
  const active = render(PennyLauncherButton, { appearance, active: true, open: true, current: true, paydayActive: true, onClick: noop });
  assert.match(active, /aria-pressed="true"/);
  assert.match(active, /aria-current="page"/);
  const picker = render(PennyAppearanceSetting, { value: appearance, onChange: noop });
  assert.equal((picker.match(/type="radio"/g) || []).length, 3);
  assert.equal((picker.match(/checked=""/g) || []).length, 1);
}
const outline = render(PennyAppearanceIcon, { appearance: "outline", size: 26 });
assert.match(outline, /stroke="currentColor"/);
assert.doesNotMatch(outline, /fill="currentColor"|opacity=|linear-gradient/);
const ink = render(PennyAppearanceIcon, { appearance: "ink", size: 26 });
assert.match(ink, /fill="currentColor"/);
assert.doesNotMatch(ink, /linear-gradient/);
console.log("G388: real card facts/masking, attribution removal, three accessible icon choices and caption-free launcher verified.");
