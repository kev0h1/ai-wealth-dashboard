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

// ---- G247: reopen after a swipe-dismiss must not leave the panel displaced ----
// The panel node stays mounted while closed; only its ref is nulled. Drives
// the REAL swipe controller (G205/G207) with PennySheet's wiring.
const { createSwipeController } = await import("../lib/swipeController.ts");
const { createPennyPanelRef, resetPennyPanelStyle } = await import("../lib/pennySheetClose.ts");
const { createSwipeGesture } = await import("../lib/swipeGesture.ts");
void createSwipeGesture;
const mkPanel = () => ({ style: { transform: "", opacity: "", transition: "" }, offsetWidth: 390, offsetHeight: 800, setPointerCapture() {} });
const clean = p => p.style.transform === "" && p.style.opacity === "" && p.style.transition === "";
function harness(useFactory) {
  const panel = mkPanel();
  const slot = { current: null }; // swipe.ref
  let open = false; let closes = 0; let t = 0;
  const attach = useFactory
    ? createPennyPanelRef(n => { slot.current = n; })
    : n => { slot.current = n; };
  const ctl = createSwipeController({
    getEl: () => slot.current,
    onDismiss: () => { closes += 1; open = false; attach(null); }, // requestClose -> popstate -> close
    options: { axis: "y", sign: 1, dismissFraction: 0.2, flickVelocity: 0.4, fade: false, restoreAfterMs: 400 },
    reducedMotion: () => false,
    now: () => t,
  });
  const ev = (y) => ({ pointerId: 1, pointerType: "touch", clientX: 100, clientY: y, buttons: 1, button: 0, target: panel, currentTarget: panel });
  return {
    panel, ctl, get closes() { return closes; },
    openSheet() { open = true; attach(panel); },
    get isOpen() { return open; },
    drag(to) { t = 0; ctl.onPointerDown(ev(100)); for (let y = 100; y <= to; y += 20) { t += 16; ctl.onPointerMove(ev(y)); } t += 16; ctl.onPointerUp(ev(to)); },
  };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

{ // the bug: legacy wiring (ref nulled on close) strands the dismiss transform
  const h = harness(false);
  h.openSheet(); h.drag(500);
  await sleep(500); // dismiss animation, onDismiss, then the 400ms restore finds no element
  assert.equal(h.closes, 1);
  assert.equal(h.isOpen, false);
  assert.ok(!clean(h.panel), "legacy wiring reproduces the stray translateY/opacity left on the closed panel");
  assert.match(h.panel.style.transform, /translateY\(/);
}
{ // swipe-dismiss then reopen: clean panel, on attach and after the late restore timer
  const h = harness(true);
  h.openSheet(); h.drag(500);
  await sleep(500);
  assert.equal(h.closes, 1);
  assert.ok(clean(h.panel), "closed panel carries no transform or opacity after a swipe-dismiss");
  h.openSheet();
  assert.ok(clean(h.panel), "reopened panel renders in place, not translated off-screen");
  h.drag(500); await sleep(500); h.openSheet();
  assert.ok(clean(h.panel), "second swipe-dismiss then reopen is clean too");
}
{ // reopen before the 400ms restore fires: the late timer resets a clean node, harmless
  const h = harness(true);
  h.openSheet(); h.drag(500);
  await sleep(250); h.openSheet();
  assert.ok(clean(h.panel), "reopen inside the restore window is clean");
  await sleep(300);
  assert.ok(clean(h.panel), "and stays clean after the late restore timer");
}
{ // Back then reopen, X then reopen: nothing inline to strand
  const h = harness(true);
  h.openSheet(); h.ctl.onPointerDown({ pointerId: 2, pointerType: "touch", clientX: 1, clientY: 1, target: h.panel, currentTarget: h.panel });
  h.ctl.onPointerCancel({ pointerId: 2, currentTarget: h.panel });
  h.panel.style.transform = "translateY(3px)"; // any residue at all
  h.openSheet();
  assert.ok(clean(h.panel), "attach clears residue left by any earlier path");
  const orphan = mkPanel(); orphan.style.transform = "translateY(9px)"; resetPennyPanelStyle(orphan);
  assert.ok(clean(orphan));
  resetPennyPanelStyle(null);
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
assert.match(sheetSrc, /createPennyPanelRef<HTMLDivElement>/, "G247: panel ref clears swipe residue on attach and detach");
assert.match(sheetSrc, /\{hasOpened && <PennyConversation /, "G247: the conversation (thread or starter) renders whenever the panel has opened, independent of the swipe");
assert.doesNotMatch(sheetSrc, /presentation="fullscreen"[^>]*opacity/, "no opacity gate on the panel");
assert.ok(pkg.scripts["check:g244-penny-sheet-close"], "registered in package.json");
console.log("g244-penny-sheet-close: all checks passed");
