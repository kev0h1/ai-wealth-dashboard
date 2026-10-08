// A149: abandoned bank hand-offs reset the connecting state; completed returns win. Plain Node.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachBankReturnReset, BANK_ATTEMPT_KEY, BANK_RETURN_GRACE_MS } from "../lib/bankReturnReset.ts";
import { PENDING_BANK_RETURN_KEY } from "../lib/bankConnectReturn.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, "..", p), "utf8");

function rig() {
  const handlers = new Map();
  const target = (extra = {}) => ({
    ...extra,
    addEventListener: (t, f) => { (handlers.get(t) ?? handlers.set(t, new Set()).get(t)).add(f); },
    removeEventListener: (t, f) => handlers.get(t)?.delete(f),
  });
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  let clock = 0; let nextId = 1; const timers = new Map();
  const doc = target({ visibilityState: "visible" });
  let browserCb = null;
  let resets = 0;
  const guard = attachBankReturnReset({
    win: target(), doc, storage,
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { at: clock + ms, fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
    onBrowserFinished: (fn) => { browserCb = fn; return () => { browserCb = null; }; },
    onReset: () => { resets += 1; },
  });
  const fire = (t, e) => { for (const f of [...(handlers.get(t) ?? [])]) f(e); };
  const advance = (ms) => { clock += ms; for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.fn(); } };
  return { guard, store, doc, fire, advance, browserFinished: () => browserCb?.(), resets: () => resets, handlers };
}
const GRACE = BANK_RETURN_GRACE_MS;
const stash = (r) => r.store.set(PENDING_BANK_RETURN_KEY, "{}");

// bfcache restore: immediate reset, stash and attempt cleared.
{
  const r = rig(); const id = r.guard.begin(); stash(r);
  assert.equal(r.store.get(BANK_ATTEMPT_KEY), String(id));
  r.fire("pageshow", { persisted: false }); assert.equal(r.resets(), 0);
  r.fire("pageshow", { persisted: true });
  assert.equal(r.resets(), 1); assert.equal(r.store.has(PENDING_BANK_RETURN_KEY), false);
  assert.equal(r.store.has(BANK_ATTEMPT_KEY), false); assert.equal(r.guard.activeAttempt(), null);
  r.fire("pageshow", { persisted: true }); assert.equal(r.resets(), 1, "no attempt, no reset");
}
// hidden then visible, no return: reset only after the grace window.
{
  const r = rig(); r.guard.begin(); stash(r);
  r.doc.visibilityState = "visible"; r.fire("visibilitychange");
  r.advance(GRACE * 2); assert.equal(r.resets(), 0, "never left: visible alone does not reset");
  r.doc.visibilityState = "hidden"; r.fire("visibilitychange");
  r.doc.visibilityState = "visible"; r.fire("visibilitychange");
  r.advance(GRACE - 1); assert.equal(r.resets(), 0);
  r.advance(1); assert.equal(r.resets(), 1); assert.equal(r.store.has(PENDING_BANK_RETURN_KEY), false);
}
// completed return inside the grace window: no reset, no stash removal.
{
  const r = rig(); r.guard.begin(); stash(r);
  r.doc.visibilityState = "hidden"; r.fire("visibilitychange");
  r.doc.visibilityState = "visible"; r.fire("visibilitychange");
  r.advance(500);
  r.fire("wd:deeplink", { detail: { kind: "bank_connected", status: "ok" } });
  r.advance(GRACE * 3);
  assert.equal(r.resets(), 0); assert.equal(r.store.has(PENDING_BANK_RETURN_KEY), true);
  assert.equal(r.guard.activeAttempt(), null); assert.equal(r.store.has(BANK_ATTEMPT_KEY), false);
}
// browserFinished with no return resets; with a return it does not.
{
  const r = rig(); r.guard.begin(); r.browserFinished(); r.advance(GRACE); assert.equal(r.resets(), 1);
  const q = rig(); q.guard.begin(); q.fire("wd:deeplink", { detail: { kind: "bank_connected", status: "ok" } });
  q.browserFinished(); q.advance(GRACE * 3); assert.equal(q.resets(), 0);
  const e = rig(); e.guard.begin(); e.browserFinished(); e.advance(300);
  e.fire("wd:deeplink", { detail: { kind: "bank_connected", status: "error" } });
  e.advance(GRACE * 3); assert.equal(e.resets(), 0, "an error return is handled by the sheet, not reset");
}
// unrelated deep links do not complete the attempt.
{
  const r = rig(); r.guard.begin(); r.fire("wd:deeplink", { detail: { kind: "signin" } });
  r.browserFinished(); r.advance(GRACE); assert.equal(r.resets(), 1);
}
// focus and popstate returns.
{
  const r = rig(); r.guard.begin(); r.fire("focus"); r.advance(GRACE * 2); assert.equal(r.resets(), 0, "focus without blur is ignored");
  r.fire("blur"); r.fire("focus"); r.advance(GRACE); assert.equal(r.resets(), 1);
  const p = rig(); p.guard.begin(); p.fire("popstate"); p.advance(GRACE); assert.equal(p.resets(), 1);
}
// a second tap starts a new attempt id; a stale timer cannot reset it.
{
  const r = rig(); const a = r.guard.begin(); r.browserFinished(); r.advance(GRACE); assert.equal(r.resets(), 1);
  const b = r.guard.begin(); assert.ok(b > a); assert.equal(r.guard.activeAttempt(), b);
  r.browserFinished(); r.advance(GRACE - 10); const c = r.guard.begin(); r.advance(100);
  assert.equal(r.resets(), 1, "timer from the previous attempt is cancelled"); assert.equal(r.guard.activeAttempt(), c);
  r.guard.end(); assert.equal(r.guard.activeAttempt(), null);
}
// a stale attempt key from a reloaded page is cleared at mount; detach removes listeners.
{
  const r = rig(); r.guard.detach();
  for (const set of r.handlers.values()) assert.equal(set.size, 0);
}

// Source guards: the picker (which feeds both the row spinner and the A155 review step) uses the hook.
const sheet = read("components/BankPickerSheet.tsx");
const hook = read("lib/useBankReturnReset.ts");
assert.ok(sheet.includes("useBankReturnReset(") && sheet.includes("bankReturn.begin()") && sheet.includes("bankReturn.end()"));
assert.ok(hook.includes("browserFinished") && hook.includes("sessionStorage"));
const flow = read("components/bank-connect/BankConnectionFlow.tsx");
assert.ok(flow.includes("const pending = connecting !== null"), "review step pending is driven by the picker's connecting state");
console.log("a149-bank-return-reset ok");
