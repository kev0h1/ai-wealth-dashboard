import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TutorialIcon from "../components/TutorialIcon.tsx";
import { TUTORIAL_FLOWS } from "../components/TutorialContext.tsx";
import PhosphorNavIcon from "../components/navigation/PhosphorNavIcon.tsx";
import PennyAppearanceIcon from "../components/PennyAppearanceIcon.tsx";

const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const tabs = { Home: "home", Spend: "spend", Upcoming: "upcoming", Planning: "planning" };
for (const appearance of ["ink", "outline", "original"]) {
  for (const [iconName, tab] of Object.entries(tabs)) {
    for (const resolved of [true, false]) {
      const actual = render(TutorialIcon, { iconName, appearance, resolved });
      const canonical = render(PhosphorNavIcon, { tab, selected: true, appearance: resolved ? appearance : "pending" });
      assert.ok(actual.includes(canonical), `${iconName} uses the real navigation asset and appearance weight`);
      assert.match(actual, /aria-hidden="true"/, "tutorial symbols are decorative beside their text");
    }
  }
  const penny = render(TutorialIcon, { iconName: "Penny", appearance, resolved: true });
  assert.ok(penny.includes(render(PennyAppearanceIcon, { appearance, size: 24 })), "Penny uses the canonical saved appearance");
  const pending = render(TutorialIcon, { iconName: "Penny", appearance, resolved: false });
  assert.match(pending, /data-penny-appearance="pending"/);
  assert.doesNotMatch(pending, /<svg|linear-gradient/, "unknown appearance has no default glyph or gradient");
  for (const flow of TUTORIAL_FLOWS) {
    assert.ok(flow.steps.length > 0, "an offered flow always has a leading icon");
    for (const step of flow.steps) {
      const html = render(TutorialIcon, { iconName: step.iconName, appearance, resolved: true });
      assert.match(html, /<svg/, `${flow.id}/${step.id} has a known, renderable icon`);
    }
  }
}

for (const name of ["spend", "upcoming", "planning"]) {
  assert.equal(TUTORIAL_FLOWS.find(flow => flow.id === name).steps[0].iconName.toLowerCase(), name, "screen tours start with their canonical nav icon");
}
const text = TUTORIAL_FLOWS.flatMap(flow => [flow.label, flow.blurb, ...flow.steps.flatMap(step => [step.title, step.description, step.tip ?? ""])]).join("\n");
assert.doesNotMatch(text, /safe to spend|left to last|\bAdd Bank\b|—|💡/i, "visible tutorial copy uses current names and the copy rules");
assert.match(text, /payday or month end/, "forecast copy also fits calendar-month users");
assert.match(text, /Help, tours and legal/, "replay directions name the current Account menu entry");
console.log("G424: tutorial icons match production nav and Penny across appearances, pending stays markless, every step renders and visible copy uses current labels.");
