// Plain-Node test for A121's DOM gate (see scripts/app-lock.test.mjs's own
// header for the full pentest context). This half — lib/appLockInert.ts's
// createInertTracker() — is the attribute-tracking logic BiometricLock.tsx
// uses to make every other direct child of document.body inert while
// locked, and to restore each one's PRIOR state exactly on unlock.
//
// No jsdom (or happy-dom/linkedom) is installed in this repo's
// node_modules — checked directly, none present — so there is no real
// `document`, `Element` or `MutationObserver` available to this test
// runner. createInertTracker() was written to need none of that: it only
// calls `.inert` (get/set), `.getAttribute`/`.setAttribute`/
// `.removeAttribute` on whatever object it's handed, so this file hands it
// plain fake objects that satisfy exactly that surface instead. What this
// deliberately does NOT prove: that a MutationObserver on a real
// document.body actually reports late-mounted nodes, that `inert` really
// removes focus/hit-testing on a real element, or the WebKit-vs-Chromium
// stacking behaviour named in the pentest finding — only a real
// browser/device (the retest after this ships) can confirm those.
//
// Run with:
//   npm run -s check:app-lock-inert
// or:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/app-lock-inert.test.mjs

import { createInertTracker } from "../lib/appLockInert";

let failures = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

function ok(label, cond) {
  check(label, !!cond, true);
}

// A minimal fake element: exactly the surface InertableElement needs, and
// nothing that hints at being a DOM node (no tagName, no children) — the
// point is that createInertTracker never asks for anything more than this.
function fakeElement(initial = {}) {
  const attrs = new Map(Object.entries(initial.attrs ?? {}));
  return {
    inert: initial.inert ?? false,
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    setAttribute(name, value) {
      attrs.set(name, value);
    },
    removeAttribute(name) {
      attrs.delete(name);
    },
    // test-only introspection, not part of InertableElement
    _attrs: attrs,
  };
}

// ── Basic lock/restore round trip ──────────────────────────────────────
{
  const tracker = createInertTracker();
  const root = fakeElement(); // e.g. the Next root holding BottomNav/#app-shell
  const portalNode = fakeElement(); // e.g. a PennySheet portal mounted before lock

  check("inert: nothing tracked before any lock() call", tracker.size(), 0);

  tracker.lock(root);
  tracker.lock(portalNode);

  ok("inert: root.inert is true after lock()", root.inert);
  check("inert: root aria-hidden set to \"true\"", root.getAttribute("aria-hidden"), "true");
  ok("inert: portalNode.inert is true after lock()", portalNode.inert);
  ok("inert: tracker.isTracked(root) is true", tracker.isTracked(root));
  check("inert: two elements tracked", tracker.size(), 2);

  tracker.restoreAll();

  ok("inert: root.inert restored to its prior (false) value", !root.inert);
  check("inert: root's aria-hidden removed on restore (it had none before)", root.getAttribute("aria-hidden"), null);
  ok("inert: portalNode.inert restored", !portalNode.inert);
  check("inert: tracker forgets everything after restoreAll()", tracker.size(), 0);
}

// ── An element already inert/aria-hidden for its own reason before the
//    lock engaged (e.g. TipsLine's collapsed-panel usage) must come back
//    EXACTLY as it was, not un-inerted — the tracker was never supposed to
//    touch it if it isn't a direct child of body, but this proves that IF
//    it ever were handed one, restore is still a no-op change relative to
//    what it found. ────────────────────────────────────────────────────
{
  const tracker = createInertTracker();
  const alreadyInert = fakeElement({ inert: true, attrs: { "aria-hidden": "true" } });
  const customAriaHidden = fakeElement({ attrs: { "aria-hidden": "some-other-value" } });

  tracker.lock(alreadyInert);
  tracker.lock(customAriaHidden);
  tracker.restoreAll();

  ok("inert: an element already inert before lock() is still inert after restore", alreadyInert.inert);
  check("inert: its pre-existing aria-hidden value survives restore untouched", alreadyInert.getAttribute("aria-hidden"), "true");
  check("inert: a non-\"true\" pre-existing aria-hidden value is restored verbatim, not cleared", customAriaHidden.getAttribute("aria-hidden"), "some-other-value");
}

// ── lock() is idempotent: calling it twice on the same element (e.g. the
//    initial body-children scan racing a MutationObserver callback for a
//    node that was already there) must not overwrite the ORIGINAL snapshot
//    with an already-inerted one, which would make restore a no-op. ─────
{
  const tracker = createInertTracker();
  const el = fakeElement({ attrs: { "aria-hidden": "false" } });

  tracker.lock(el);
  tracker.lock(el); // second call — must be a no-op against the snapshot
  check("inert: locking twice keeps a single tracked entry", tracker.size(), 1);

  tracker.restoreAll();
  check("inert: restore uses the ORIGINAL snapshot even after a double lock()", el.getAttribute("aria-hidden"), "false");
}

// ── restoreAll() with nothing tracked is a safe no-op. ──────────────────
{
  const tracker = createInertTracker();
  tracker.restoreAll();
  check("inert: restoreAll() with nothing tracked does not throw and stays empty", tracker.size(), 0);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
