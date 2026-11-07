import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// G432: (1) the Penny launcher and tabs must not keep a sticky touch :hover look
// after the sheet closes; (2) the Income list must not be a nested touch scroller.
const dir = new URL("..", import.meta.url);
const read = (p) => readFileSync(process.env[p.env] ?? new URL(p.path, dir), "utf8");
const css = read({ env: "G432_CSS", path: "components/navigation/BottomNav.module.css" });
const hero = read({ env: "G432_HERO", path: "components/SpendPaceHero.tsx" });
const sheet = readFileSync(new URL("components/PennySheet.tsx", dir), "utf8");

// Every :hover rule must sit inside @media (hover: hover).
const stripped = css.replace(/@media \(hover: hover\) \{[^{}]*\{[^{}]*\}\s*\}/g, "");
assert.ok(!/:hover/.test(stripped), "BottomNav.module.css has a :hover rule outside @media (hover: hover)");
assert.ok(/@media \(hover: hover\) \{ \.penny:hover/.test(css), "launcher hover must be gated to hover devices");
// Pressed look is driven by data-active and focus-visible, never plain :focus.
assert.ok(!/:focus(?!-visible)/.test(css), "plain :focus styling found in nav css");
assert.ok(/\.penny\[data-active="true"\]/.test(css));

// Every sheet close path funnels through the provider's close().
assert.ok(/const finishClose = useCallback\(\(\) => \{[\s\S]{0,200}\bclose\(\);/.test(sheet), "finishClose must call the provider close()");

// Income list: no unprefixed max-h / overflow-y-auto on touch.
const m = hero.match(/<div className="([^"]*)">\{incomeTxns\.map/);
assert.ok(m, "income list container not found");
for (const c of m[1].split(/\s+/)) {
  assert.ok(!/^(max-h-|overflow-y-|overflow-auto|overscroll-)/.test(c), `income list has unprefixed scroll class ${c}`);
}
console.log("g432 nav and income scroll: ok");
