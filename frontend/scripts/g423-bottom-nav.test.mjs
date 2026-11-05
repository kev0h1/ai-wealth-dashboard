import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BottomNavRail from "../components/navigation/BottomNavRail.tsx";

const base = { resolved: true, pennyActive: false, pennyOpen: false, pennyCurrent: false, paydayActive: false, atRiskCount: 0, onPennyClick: () => {} };
const render = props => renderToStaticMarkup(React.createElement(BottomNavRail, { ...base, ...props }));
const hrefs = ["/", "/spend?view=period", "/upcoming", "/planning"];
const tabs = ["home", "spend", "upcoming", "planning"];

for (const appearance of ["ink", "outline", "original"]) {
  for (const activeTab of tabs) {
    const html = render({ appearance, activeTab });
    assert.deepEqual([...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]), hrefs, "all route destinations and the explicit Spend pay-period link survive");
    const selected = [...html.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/g)].filter(match => match[1].includes('aria-current="page"'));
    assert.equal(selected.length, 1);
    assert.match(selected[0][1], new RegExp(`data-nav-tab="${activeTab}"`));
    assert.match(selected[0][2], new RegExp(`data-phosphor-weight="${appearance === "ink" ? "fill" : appearance === "original" ? "duotone" : "regular"}"`));
    assert.equal((html.match(/data-phosphor-weight="regular"/g) || []).length, appearance === "outline" ? 4 : 3, "idle tabs remain regular");
    assert.equal((html.match(/data-penny-navigation="true"/g) || []).length, 2, "both scrim and rail still participate in keyboard hiding");
    const order = [...html.matchAll(/<(?:a|button)\b[^>]*(?:data-nav-tab="([^"]+)"|aria-label="(Penny)")/g)].map(match => match[1] || match[2]);
    assert.deepEqual(order, ["home", "spend", "Penny", "upcoming", "planning"], "keyboard order follows the visual slots");
  }
  const offTab = render({ appearance });
  assert.doesNotMatch(offTab, /aria-current="page"/, "non-tab routes never pretend Home is current");
  const open = render({ appearance, activeTab: "spend", pennyActive: true, pennyOpen: true, paydayActive: true, atRiskCount: 2 });
  assert.match(open, /aria-label="Penny"[^>]*aria-pressed="true"/);
  assert.match(open, /data-payday-ready="true"/);
  assert.match(open, /aria-label="Upcoming, 2 payments may need funding"/);
  assert.equal((open.match(/data-upcoming-attention="true"/g) || []).length, 1);
  const pennyPage = render({ appearance, pennyActive: true, pennyCurrent: true });
  assert.equal((pennyPage.match(/aria-current="page"/g) || []).length, 1, "Penny alone is current on its hub");
  assert.match(pennyPage, /<button[^>]*aria-current="page"/);
}

const pending = render({ appearance: "original", resolved: false, activeTab: "home", paydayActive: true });
assert.match(pending, /data-appearance="pending"/);
assert.equal((pending.match(/data-phosphor-weight="regular"/g) || []).length, 4);
const pendingDoor = pending.match(/<button\b[\s\S]*?<\/button>/)[0];
assert.match(pendingDoor, /data-penny-appearance="pending"/);
assert.doesNotMatch(pendingDoor, /<svg|linear-gradient|pennyPress/);
assert.match(pendingDoor, /data-payday-ready="true"/);
assert.doesNotMatch(render({ appearance: "ink", atRiskCount: 0 }), /data-upcoming-attention/);
assert.match(render({ appearance: "ink", atRiskCount: 1 }), /Upcoming, 1 payment may need funding/);

console.log("G423: real rail route links, logical keyboard order, appearance/current states, independent attention dots and pending first paint passed.");
