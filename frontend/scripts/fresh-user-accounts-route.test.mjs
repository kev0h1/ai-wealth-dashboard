// Pins G135: a fresh user (zero accounts) must have an explicit route to
// /accounts from every surface the item named as in scope — Home and
// Planning. Spend and Upcoming were audited and deliberately left alone
// (see the G135 doc comments in app/components/SpendPage.tsx and
// app/planning/PlanningPage.tsx): neither page has any notion of a fresh
// user at all, so giving them a route is a new empty state needing a design
// round, not something this check can pin.
//
// Run with:
//   node --no-warnings --experimental-loader ./scripts/_tsx-loader.mjs scripts/fresh-user-accounts-route.test.mjs
// or:
//   npm run -s check:fresh-user-accounts-route
//
// Why two techniques, not one.
//
// HomePage.tsx cannot be rendered in isolation: it calls useAuth(),
// usePreferences() and useRouter() at the top of its own body and fetches
// its own data in useEffect, none of which resolve outside a mounted app
// (see scripts/spend-from-render.test.mjs's own note on SafeToSpendCard for
// the same ceiling). FirstAccountCard — the actual "nothing connected yet"
// card, extracted to its own file by this same G135 pass specifically so it
// COULD be pinned — takes no hooks and no data of its own, so it is rendered
// directly below. That proves the "Other ways to add accounts" door exists,
// is visible, and is wired to whatever callback its caller gives it.
//
// It does NOT prove where that callback goes: `onOtherWays={() => router.
// push("/accounts")}` is a closure that lives in HomePage.tsx's own body,
// over a `router` this file cannot construct. A rendered check that only
// forwards a mock callback would pass just as happily if HomePage started
// wiring it to a different route, or to nothing — testing the mock, not the
// wiring. So the destination is pinned the other way: read HomePage.tsx's
// own source and assert the literal wiring survives inside the fresh-user
// block specifically, not merely somewhere in the file. Same technique for
// Planning's own fix, GrowPanel.tsx's empty-ladder "Add an account" button,
// which is not extractable at all (it calls useRouter() itself).
//
// A source match alone is foolable (dead code, a comment, a differently
// gated block) — pairing it with the render check on the one piece that
// COULD be rendered is the strongest pin available without mounting a full
// app router, which is what the /design preview and Playwright would be for
// if this needed to go further.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import FirstAccountCard from "../components/FirstAccountCard.tsx";

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");

// ── Walk a React element tree (no DOM, no renderer) looking for a node
//    whose props match a predicate. FirstAccountCard is a plain function —
//    calling it directly returns the element tree React would otherwise
//    build for us, so this needs nothing beyond `React.createElement`'s own
//    output shape.
function findNode(element, predicate) {
  if (element == null || typeof element !== "object") return null;
  if (predicate(element)) return element;
  const children = element.props?.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function textOf(element) {
  if (element == null || typeof element === "string" || typeof element === "number") return String(element ?? "");
  const children = element.props?.children;
  const list = Array.isArray(children) ? children : [children];
  return list.map(textOf).join("");
}

// ── FirstAccountCard: the "Other ways to add accounts" door renders and is
//    wired, for both copy variants (open-banking tier and statements tier). ──
for (const canConnect of [true, false]) {
  const onOtherWays = () => {};
  const onConnect = () => {};
  const onUploadStatement = () => {};
  const element = FirstAccountCard({ canConnect, onConnect, onUploadStatement, onOtherWays });

  const doorButton = findNode(
    element,
    (n) => n.type === "button" && textOf(n).includes("Other ways to add accounts"),
  );
  check(`canConnect=${canConnect}: "Other ways to add accounts" button renders`, doorButton !== null);
  check(
    `canConnect=${canConnect}: that button's onClick is wired to the caller's onOtherWays`,
    doorButton?.props?.onClick === onOtherWays,
  );

  // renderToStaticMarkup as a second, independent check: the label is
  // actually emitted as visible text, not just present in the element graph
  // (e.g. behind a `hidden` class, which the element-tree walk above cannot
  // see — see spend-from-render.test.mjs's note on this exact ceiling).
  const markup = renderToStaticMarkup(React.createElement(FirstAccountCard, {
    canConnect, onConnect, onUploadStatement, onOtherWays,
  }));
  check(`canConnect=${canConnect}: markup contains the door's visible label`, markup.includes("Other ways to add accounts"));
  check(`canConnect=${canConnect}: door label is not hidden`, !/class="[^"]*\bhidden\b[^"]*"[^>]*>Other ways/.test(markup));
}

// ── Source guard: HomePage.tsx wires that door to /accounts specifically,
//    inside the fresh-user branch (not merely somewhere in the file). ──
{
  const homePageSrc = readFileSync(path.join(frontendRoot, "app/components/HomePage.tsx"), "utf8");
  const freshUserIdx = homePageSrc.indexOf("{isFreshUser && (");
  check("HomePage.tsx still has an isFreshUser-gated branch", freshUserIdx !== -1);

  const window1 = homePageSrc.slice(freshUserIdx, freshUserIdx + 700);
  check("the fresh-user branch renders FirstAccountCard", window1.includes("<FirstAccountCard"));
  check(
    'the fresh-user branch wires onOtherWays to router.push("/accounts")',
    window1.includes('onOtherWays={() => router.push("/accounts")}'),
  );

  // Second call site: the "Your estate" empty state (accounts.length === 0
  // while !isFreshUser, e.g. investment-only accounts with no bank yet)
  // carries the same door, so it does not regress to a dead end either.
  const estateIdx = homePageSrc.indexOf("accounts.length === 0", freshUserIdx + window1.length);
  check("HomePage.tsx also has a second zero-accounts branch (Your estate empty state)", estateIdx !== -1);
  if (estateIdx !== -1) {
    const window2 = homePageSrc.slice(estateIdx, estateIdx + 400);
    check(
      'the "Your estate" empty state also wires onOtherWays to router.push("/accounts")',
      window2.includes('onOtherWays={() => router.push("/accounts")}'),
    );
  }
}

// ── Same technique for Planning: GrowPanel.tsx's empty-ladder branch is the
//    fresh-user case there (no live priority reading with zero accounts),
//    and it calls useRouter() itself, so it cannot be extracted and rendered
//    the way FirstAccountCard was. Source guard only, same as above. ──
{
  const growPanelSrc = readFileSync(path.join(frontendRoot, "app/planning/GrowPanel.tsx"), "utf8");
  const emptyLadderIdx = growPanelSrc.indexOf("No order to show yet");
  check("GrowPanel.tsx still has the empty-ladder message", emptyLadderIdx !== -1);
  if (emptyLadderIdx !== -1) {
    const window3 = growPanelSrc.slice(emptyLadderIdx, emptyLadderIdx + 600);
    check(
      'the empty-ladder branch routes to /accounts (router.push("/accounts"))',
      window3.includes('router.push("/accounts")'),
    );
    check('the empty-ladder branch labels the door "Add an account"', window3.includes("Add an account"));
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll fresh-user accounts-route (G135) checks passed.");
