// G478: on iPhone nothing in the Accounts "+ Add" dropdown responded.
// Guards: the menu is portalled to document.body above every fixed shell
// layer; outside-close is pointerup, ignores the menu and trigger, and never
// relies on blur; each item calls its handler; the TEMPORARY on-device probe
// sends once, native iOS only, with no personal data.
// Run: npm run -s check:g478-accounts-add-layer
import assert from "node:assert/strict";
import React from "react";
import { readFileSync } from "node:fs";
import { AccountsAddMenuContent } from "../components/AccountsAddMenu.tsx";
import { ADD_MENU_Z, ADD_MENU_ATTR, addMenuPosition, isOutsideAddMenu, attachAddMenuOutsideClose } from "../lib/accountsAddMenuLayer.ts";
import { createAddProbe, describeElement } from "../lib/accountsAddProbe.ts";

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok", name); };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const menuSrc = read("../components/AccountsAddMenu.tsx");
const headerSrc = read("../components/AccountsHeader.tsx");
const pageSrc = read("../app/components/AccountsPage.tsx");
const layout = read("../app/layout.tsx");

// ---- layering ----
await ok("menu is portalled to document.body, fixed, at ADD_MENU_Z", () => {
  assert.match(menuSrc, /createPortal\(<AccountsAddMenuContent[^]*?document\.body\)/);
  assert.match(menuSrc, /position: "fixed"/);
  assert.match(menuSrc, /zIndex: ADD_MENU_Z/);
  assert.ok(!/absolute right-0 top-\[calc/.test(menuSrc), "no more in-header absolute positioning");
});
await ok("ADD_MENU_Z is above BottomNav (50), safe-top frost (40) and PennySheet (56), below the tour overlay (60) and sheets (70)", () => {
  assert.equal(ADD_MENU_Z, 58);
  assert.match(layout, /safe-top-frost[^]*?z-40/);
  assert.ok(ADD_MENU_Z > 56 && ADD_MENU_Z < 60);
});
await ok("position sits 8px under the trigger, right-aligned, never within 8px of the edge", () => {
  assert.deepEqual(addMenuPosition({ top: 50, bottom: 94, left: 300, right: 344 }, 390), { top: 102, right: 46 });
  assert.deepEqual(addMenuPosition({ top: 50, bottom: 94, left: 300, right: 390 }, 390), { top: 102, right: 8 });
  assert.match(menuSrc, /env\(safe-area-inset-right/);
});

// ---- dismissal ----
const el = (inside = {}) => ({ closest: (sel) => (inside[sel] ? {} : null) });
await ok("isOutsideAddMenu ignores the menu, the trigger and the tour card", () => {
  const trigger = { contains: (t) => t === "trig" };
  assert.equal(isOutsideAddMenu(el({ [`[${ADD_MENU_ATTR}]`]: 1 }), trigger), false);
  assert.equal(isOutsideAddMenu(el({ "[data-tutorial-overlay]": 1 }), trigger), false);
  assert.equal(isOutsideAddMenu("trig", trigger), false);
  assert.equal(isOutsideAddMenu(el(), trigger), true);
});
await ok("outside-close listens for pointerup only, closes outside, ignores inside, detaches", () => {
  const listeners = {};
  const doc = { addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t, f) => { if (listeners[t] === f) delete listeners[t]; } };
  let closed = 0;
  const detach = attachAddMenuOutsideClose(doc, () => ({ contains: () => false }), () => { closed++; });
  assert.deepEqual(Object.keys(listeners), ["pointerup"]);
  listeners.pointerup({ target: el({ [`[${ADD_MENU_ATTR}]`]: 1 }) });
  assert.equal(closed, 0);
  listeners.pointerup({ target: el() });
  assert.equal(closed, 1);
  detach(); assert.deepEqual(Object.keys(listeners), []);
});
await ok("neither the header nor the page depends on blur, touchstart or mousedown to close the menu", () => {
  assert.ok(!/onBlur/.test(headerSrc), "no onBlur close in AccountsHeader");
  assert.ok(!/addEventListener\("(touchstart|mousedown)"/.test(pageSrc), "no touchstart/mousedown outside-close in AccountsPage");
  assert.match(pageSrc, /attachAddMenuOutsideClose\(document, \(\) => addMenuRef\.current/);
  assert.match(pageSrc, /anchorRef=\{addMenuRef\}/);
});
await ok("keyboard: Escape and arrow keys still handled, items looked up in the portalled menu", () => {
  assert.match(headerSrc, /e\.key === "Escape"/);
  assert.match(headerSrc, /ArrowDown/);
  assert.match(headerSrc, /document\.querySelectorAll<HTMLElement>\(ADD_MENU_ITEM_SELECTOR\)/);
  assert.match(headerSrc, /\[data-add-control\]/);
});

// ---- handlers ----
await ok("each of the four items calls its handler when clicked", () => {
  const calls = [];
  const tree = AccountsAddMenuContent({ allowed: true, ready: true, onBank: (p) => calls.push("bank:" + p), onStatement: () => calls.push("statement"), onInvestment: () => calls.push("investment"), onOffline: () => calls.push("offline") });
  const buttons = [];
  const walk = (x) => { if (!x || typeof x !== "object") return; if (Array.isArray(x)) return x.forEach(walk); if (x.type === "button") buttons.push(x); walk(x.props?.children); };
  walk(tree);
  const labels = buttons.map((b) => JSON.stringify(b.props.children));
  for (const b of buttons) b.props.onClick();
  assert.deepEqual(calls.sort(), ["bank:finexer", "investment", "offline", "statement"]);
  assert.equal(buttons.filter((b) => b.props.role === "menuitem").length, buttons.length);
  assert.ok(labels.some((l) => l.includes("Connect a bank")) && labels.some((l) => l.includes("Add an offline account")));
});

// ---- probe ----
const items = [0, 1, 2, 3].map((i) => ({ el: { id: `item${i}` }, rect: { left: 100, top: 100 + i * 48, width: 200, height: 44 } }));
function rig(platform = "ios") {
  const sent = [];
  const probe = createAddProbe({
    platform: () => platform, build: "build 7724de3",
    insets: () => ({ top: "59px", right: "0px", bottom: "34px", left: "0px" }),
    viewport: () => ({ w: 390, h: 844, dpr: 3 }),
    elementFromPoint: (x, y) => ({ tagName: "DIV", id: "cover", className: "safe-top-frost fixed z-40", getAttributeNames: () => ["data-x"], parentElement: { tagName: "BODY" }, closest: () => null }),
    send: (stage, detail, p) => sent.push({ stage, detail, p }),
  });
  return { probe, sent };
}
await ok("probe sends exactly once, stage accounts-add-probe, with insets, viewport, build and every item", () => {
  const { probe, sent } = rig();
  assert.equal(probe.run({ contains: () => false }, items), true);
  assert.equal(probe.run({ contains: () => false }, items), false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].stage, "accounts-add-probe");
  assert.equal(sent[0].p, "ios");
  assert.ok(sent[0].detail.includes("insets=59px/0px/34px/0px") && sent[0].detail.includes("vp=390x844@3") && sent[0].detail.includes("build 7724de3"));
  for (const i of [0, 1, 2, 3]) assert.ok(sent[0].detail.includes(`i${i}@200,`));
  assert.ok(sent[0].detail.includes("OTHER:div#cover.safe-top-frost.fixed.z-40"));
  assert.ok(sent[0].detail.length <= 500, "fits the server's 500 char cap");
});
await ok("probe never sends on android or web", () => {
  for (const p of ["android", null]) { const { probe, sent } = rig(p); assert.equal(probe.run({}, items), false); assert.equal(sent.length, 0); }
});
await ok("probe carries tags, ids and classes only: no text content, and survives a throwing page", () => {
  assert.equal(describeElement({ tagName: "BUTTON", textContent: "Barclays 1234", id: "", className: "a" }, null, null).includes("Barclays"), false);
  const probe = createAddProbe({ platform: () => "ios", build: "b", insets: () => { throw new Error("x"); }, viewport: () => ({ w: 1, h: 1, dpr: 1 }), elementFromPoint: () => null, send: () => { throw new Error("y"); } });
  assert.doesNotThrow(() => probe.run({}, items));
});
await ok("the menu runs the probe on open, not on tap", () => {
  assert.match(menuSrc, /runAddMenuProbe\(menuRef\.current\)/);
  const client = read("../lib/accountsAddProbeClient.ts");
  assert.match(client, /isNativePlatform/);
});

console.log(`\n${n} checks passed`);
