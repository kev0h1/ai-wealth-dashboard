// G244: closing the full-screen Penny sheet without its X. Two halves.
//
// 1. History pairing. Drives the REAL useSheetA11y hook (the H71/H72
//    back-to-close capability PennySheet reuses) against a fake window and a
//    fake History, through a minimal hooks dispatcher installed on React's own
//    internals, so no DOM or renderer is needed. Cases: open + X, open + Back,
//    open + navigate away, double close, reopen, unmount without close.
// 2. The swipe gate (lib/pennySheetClose.ts over G205's canStartSheetSwipe).
//
// Run: npm run -s check:g244-penny-sheet-close
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";

// ---- fake browser ---------------------------------------------------------
const win = new EventTarget();
win.location = { href: "https://x.test/spend" };
win.scrollY = 0;
win.innerWidth = 390;
const entries = [{ state: null, href: "https://x.test/" }, { state: null, href: "https://x.test/spend" }];
let idx = 1;
const fakeHistory = {
  get state() { return entries[idx].state; },
  get length() { return entries.length; },
  pushState(state, _t, url) {
    entries.splice(idx + 1);
    entries.push({ state, href: url ?? win.location.href });
    idx += 1;
    win.location.href = entries[idx].href;
  },
  back() {
    queueMicrotask(() => {
      if (idx === 0) return;
      idx -= 1;
      win.location.href = entries[idx].href;
      const ev = new Event("popstate");
      ev.state = entries[idx].state;
      win.dispatchEvent(ev);
    });
  },
};
const doc = new EventTarget();
doc.activeElement = null;
globalThis.window = win;
globalThis.document = doc;
globalThis.history = fakeHistory;
const tick = () => new Promise(r => setTimeout(r, 0));

// ---- minimal hooks runtime on React's dispatcher slot ----------------------
const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
function mount(fn) {
  const cells = [];
  let n = 0;
  let pending = [];
  let rendering = false;
  let dirty = false;
  let result;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const dispatcher = {
    useState(init) {
      const i = n++;
      if (!(i in cells)) cells[i] = { v: typeof init === "function" ? init() : init };
      const cell = cells[i];
      return [cell.v, next => {
        const v = typeof next === "function" ? next(cell.v) : next;
        if (Object.is(v, cell.v)) return;
        cell.v = v; dirty = true; if (!rendering) rerender();
      }];
    },
    useRef(init) {
      const i = n++;
      if (!(i in cells)) cells[i] = { current: init };
      return cells[i];
    },
    useCallback(f, deps) {
      const i = n++;
      if (!(i in cells) || !same(cells[i].deps, deps)) cells[i] = { f, deps };
      return cells[i].f;
    },
    useEffect(f, deps) { effect(f, deps, false); },
    useLayoutEffect(f, deps) { effect(f, deps, true); },
  };
  function effect(f, deps, layout) {
    const i = n++;
    const prev = cells[i];
    if (prev && same(prev.deps, deps)) return;
    pending.push({ i, f, deps, layout, prev });
  }
  function rerender() {
    do {
      dirty = false; rendering = true; n = 0; pending = [];
      internals.H = dispatcher;
      try { result = fn(); } finally { internals.H = null; rendering = false; }
      const run = [...pending.filter(p => p.layout), ...pending.filter(p => !p.layout)];
      for (const p of run) p.prev?.cleanup?.();
      for (const p of run) cells[p.i] = { deps: p.deps, cleanup: p.f() };
    } while (dirty);
  }
  rerender();
  return {
    get result() { return result; },
    unmount() { for (const c of cells) c?.cleanup?.(); },
  };
}

const { useSheetA11y, openSheetHistoryCount } = await import("../lib/useSheetA11y.ts");
const node = { querySelectorAll: () => [], focus() {}, isConnected: true };

function sheet(onClose) {
  const h = mount(() => useSheetA11y(onClose, { backToClose: true }));
  h.result.ref(node); // the panel becomes visible
  return h;
}
function resetHistory() {
  entries.splice(0, entries.length, { state: null, href: "https://x.test/" }, { state: null, href: "https://x.test/spend" });
  idx = 1; win.location.href = "https://x.test/spend";
}

// 1. open, close by X: one entry pushed, one popped, onClose once, a later Back behaves normally.
{
  resetHistory(); let closes = 0;
  const h = sheet(() => { closes += 1; });
  assert.equal(entries.length, 3, "open pushes exactly one entry");
  assert.equal(idx, 2);
  h.result.close();
  await tick();
  assert.equal(closes, 1, "X closes via the pop");
  assert.equal(idx, 1, "pushed entry consumed, back on the opener");
  h.result.ref(null); // parent stops rendering the panel
  await tick();
  assert.equal(idx, 1, "no second pop on teardown (never double-pop)");
  fakeHistory.back(); await tick();
  assert.equal(idx, 0, "a later Back leaves the page as normal");
  assert.equal(closes, 1, "and does not close anything");
  h.unmount();
}

// 2. open, Back.
{
  resetHistory(); let closes = 0;
  const h = sheet(() => { closes += 1; });
  fakeHistory.back(); await tick();
  assert.equal(closes, 1, "Back closes the sheet");
  assert.equal(idx, 1, "and lands on the opener, not the page before it");
  h.result.ref(null); await tick();
  assert.equal(idx, 1, "teardown after a Back-close does not pop again");
  assert.equal(openSheetHistoryCount(), 0);
  h.unmount();
}

// 3. open, navigate away (a route push), then the sheet unmounts.
{
  resetHistory(); let closes = 0;
  const h = sheet(() => { closes += 1; });
  fakeHistory.pushState({ route: "next" }, "", "https://x.test/upcoming"); // router.push
  h.result.ref(null); await tick();
  assert.equal(idx, 3, "the destination entry is kept, the teardown does not pop it");
  assert.equal(win.location.href, "https://x.test/upcoming");
  assert.equal(closes, 0);
  h.unmount();
}

// 4. double close request: one traversal only.
{
  resetHistory(); let closes = 0;
  const h = sheet(() => { closes += 1; });
  h.result.close(); h.result.close(); h.result.close();
  await tick();
  assert.equal(closes, 1);
  assert.equal(idx, 1, "three taps consumed a single entry");
  h.unmount();
}

// 5. close then reopen: pairing holds on the second cycle.
{
  resetHistory(); let closes = 0;
  const h = sheet(() => { closes += 1; });
  h.result.close(); await tick(); h.result.ref(null); await tick();
  h.result.ref(node);
  assert.equal(entries.length, 3, "reopen pushes one fresh entry");
  assert.equal(idx, 2);
  fakeHistory.back(); await tick();
  assert.equal(closes, 2);
  assert.equal(idx, 1);
  h.unmount();
}

// 6. unmounted without close() or Back: the entry is consumed, not left dangling.
{
  resetHistory();
  const h = sheet(() => {});
  h.result.ref(null); await tick();
  assert.equal(idx, 1, "teardown pop consumed the dangling entry");
  h.unmount();
}

// ---- swipe gate -------------------------------------------------------------
const { pennySwipeGate } = await import("../lib/pennySheetClose.ts");
const mk = (parent, extra = {}) => ({ parentElement: parent, hasAttribute: () => false, ...extra });
const panel = mk(null);
const header = mk(panel);
const headerLink = mk(header, { tagName: "A" });
const scroller = (scrollTop) => mk(panel, { scrollTop, scrollHeight: 900, clientHeight: 400 });
const composer = mk(panel);
const textarea = mk(composer, { tagName: "TEXTAREA" });
const base = { pointerType: "touch", viewportWidth: 390, keyboardUp: false, overlayOpen: false };
const gate = (target, over = {}, parts = {}) => pennySwipeGate({ ...base, target, header, scroller: parts.scroller ?? scroller(0), ...over }, () => "auto");

{
  const s0 = scroller(0); const bubble0 = mk(s0);
  assert.equal(gate(bubble0, {}, { scroller: s0 }), true, "conversation at scrollTop 0 starts a swipe");
  const s1 = scroller(120); const bubble1 = mk(s1);
  assert.equal(gate(bubble1, {}, { scroller: s1 }), false, "conversation scrolled (scrollTop > 0) never starts one");
  const sTiny = scroller(1); assert.equal(gate(mk(sTiny), {}, { scroller: sTiny }), false, "one pixel down is still mid-scroll");
  assert.equal(gate(headerLink), true, "the header starts a swipe");
  assert.equal(gate(headerLink, {}, { scroller: scroller(300) }), true, "the header starts one even when the thread is scrolled");
  assert.equal(gate(composer), false, "the composer never starts one");
  assert.equal(gate(textarea), false, "text inputs never start one");
  assert.equal(gate(bubble0, { keyboardUp: true }, { scroller: s0 }), false, "no drag while the keyboard is up");
  assert.equal(gate(headerLink, { keyboardUp: true }), false, "not even from the header with the keyboard up");
  assert.equal(gate(headerLink, { overlayOpen: true }), false, "not with the More messages overlay open");
  assert.equal(gate(headerLink, { pointerType: "mouse" }), false, "a mouse never swipes");
  assert.equal(gate(headerLink, { viewportWidth: 1280 }), false, "desktop never swipes");
  assert.equal(gate(null), false);
  const nested = mk(s0, { scrollTop: 40, scrollHeight: 300, clientHeight: 100 });
  assert.equal(gate(mk(nested), {}, { scroller: s0 }), false, "a nested scroller mid-scroll under the finger blocks it");
}

// ---- source guards ----------------------------------------------------------
const src = p => readFileSync(new URL(p, import.meta.url), "utf8");
const sheetSrc = src("../components/PennySheet.tsx");
const convo = src("../components/PennyConversation.tsx");
const pkg = JSON.parse(src("../package.json"));
assert.match(sheetSrc, /useSheetA11y<HTMLDivElement>\(finishClose, \{ backToClose: phone \}\)/, "history entry only on phones, via the shared hook");
assert.match(sheetSrc, /useSwipeDismiss<HTMLDivElement>/, "G205's swipe controller");
assert.match(sheetSrc, /pennySwipeGate\(/);
assert.match(sheetSrc, /close=\{requestClose\}/, "the X goes through the history-aware close");
assert.match(sheetSrc, /onClick=\{requestClose\}/, "the click-catcher uses the history-aware close");
assert.match(convo, /overflow-y-auto space-y-3 px-5 pt-3/, "thread top padding equals the space-y-3 message gap");
assert.doesNotMatch(convo, /closePennySheet\(\); router\.push/, "navigation closes wait for the pop");
assert.ok(pkg.scripts["check:g244-penny-sheet-close"], "registered in package.json");
console.log("g244-penny-sheet-close: all checks passed");
