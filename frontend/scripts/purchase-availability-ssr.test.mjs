// Plain-Node test for usePurchaseAvailability() (B40, 2026-09-14). Same
// framework-free pattern as scripts/serial-queue.test.mjs: this repo has
// no jest/vitest, but lib/nativeAuth.ts has no JSX in it, so (unlike a
// .tsx component) it can be imported directly by
// `node --experimental-strip-types`. react-dom/server's
// renderToStaticMarkup gives a real SSR-style render pass in plain Node,
// with no window/Capacitor bridge and, crucially, no effects run — the
// same guarantee Next.js's own server render makes, which is exactly the
// property this hook depends on.
//
// Bug this guards: canPurchaseInApp() resolves to "web" (purchasable)
// during server-side rendering, not because it throws, but because
// there is no Capacitor bridge in the Node build, so
// Capacitor.isNativePlatform() cleanly returns false there —
// indistinguishable, from inside that function, from a genuine web
// visitor. A component that calls canPurchaseInApp() directly in its
// render body would therefore server-render a purchase-allowed UI
// state, which was only ever safe by accident (every real purchase
// surface happens to gate on an unresolved async fetch first). A future
// surface that renders synchronously would inherit the bug.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/purchase-availability-ssr.test.mjs
// or:
//   npm run -s check:purchase-availability-ssr

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { usePurchaseAvailability, canPurchaseInApp } from "../lib/nativeAuth.ts";

let failures = 0;

function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// Documents the root cause: this plain-Node process has no window and no
// Capacitor bridge, exactly like a Next.js server render, and
// canPurchaseInApp() genuinely (not via its catch block) resolves to
// "web" here. If this assertion itself ever fails, the premise of the
// whole ticket no longer holds and the rest of this file needs
// rethinking, not just the fix.
check(
  "root cause still holds: canPurchaseInApp() alone resolves to web (purchasable) with no Capacitor bridge present",
  canPurchaseInApp() === true
);

function Probe() {
  const availability = usePurchaseAvailability();
  return React.createElement("span", { id: "availability" }, availability);
}

const ssrMarkup = renderToStaticMarkup(React.createElement(Probe));

check(
  "usePurchaseAvailability() renders 'unknown' on an SSR-style pass, never resolving from inside render",
  ssrMarkup.includes(">unknown<")
);
check(
  "usePurchaseAvailability() never renders 'web' on an SSR-style pass (the bug this guards against)",
  !ssrMarkup.includes(">web<")
);
check(
  "usePurchaseAvailability() never renders 'native' on an SSR-style pass either (no false purchasable AND no false unpurchasable label)",
  !ssrMarkup.includes(">native<")
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("\nAll checks passed");
}
