// G477: Connect a bank (and the other Add paths) did nothing on the iPhone app.
// Guards: the access read has loading, allowed, denied and error states with a
// retry; the Add menu never shows a silent dead button; every path opens its
// sheet; the on-device diagnostic reports at most once per launch.
// Run: npm run -s check:g477-accounts-add
import assert from "node:assert/strict";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { api } from "../lib/api.ts";
import { watchOpenBankingAccessStatus, invalidateOpenBankingAccess } from "../lib/openBankingAccess.ts";
import AccountsAddMenu from "../components/AccountsAddMenu.tsx";
import { createAddDiagnostic } from "../lib/accountsAddDiagnostic.ts";

const h = React.createElement;
let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok", name); };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const sub = (open) => ({ tier: open ? "plus" : "statements", status: "active", limits: { open_banking: open } });

async function track(read, timeoutMs) {
  invalidateOpenBankingAccess();
  api.getSubscription = read;
  const seen = [];
  const watch = watchOpenBankingAccessStatus((s) => seen.push(s), timeoutMs);
  return { seen, watch };
}

// ---- access state transitions ----
await ok("loading then allowed", async () => {
  const { seen, watch } = await track(async () => sub(true));
  await tick(); assert.deepEqual(seen, ["loading", "allowed"]); watch.unsubscribe();
});
await ok("loading then denied", async () => {
  const { seen, watch } = await track(async () => sub(false));
  await tick(); assert.deepEqual(seen, ["loading", "denied"]); watch.unsubscribe();
});
await ok("loading then error, then retry reaches allowed", async () => {
  let fail = true;
  const { seen, watch } = await track(async () => { if (fail) throw new Error("network"); return sub(true); });
  await tick(); assert.deepEqual(seen, ["loading", "error"]);
  fail = false; watch.retry(); await tick();
  assert.deepEqual(seen, ["loading", "error", "loading", "allowed"]); watch.unsubscribe();
});
await ok("a read that never settles becomes error, and a late answer still wins", async () => {
  let release;
  const { seen, watch } = await track(() => new Promise((r) => { release = r; }), 20);
  await tick(60); assert.deepEqual(seen, ["loading", "error"]);
  release(sub(true)); await tick(); assert.equal(seen.at(-1), "allowed"); watch.unsubscribe();
});
await ok("retry after a hung read asks again", async () => {
  let calls = 0;
  const { seen, watch } = await track(() => { calls++; return calls === 1 ? new Promise(() => {}) : Promise.resolve(sub(false)); }, 20);
  await tick(60); watch.retry(); await tick(); assert.equal(seen.at(-1), "denied"); assert.equal(calls, 2); watch.unsubscribe();
});

// ---- the menu never has a silent dead button ----
const noop = () => {};
const menu = (props) => renderToStaticMarkup(h(AccountsAddMenu, { onBank: noop, onStatement: noop, onInvestment: noop, onOffline: noop, ...props }));
const bankDisabled = (html) => /<button[^>]*disabled=""[^>]*>[^<]*(<svg[\s\S]*?<\/svg>)?Connect a bank/.test(html);
await ok("loading: Connect disabled with a visible loading line, other paths enabled", () => {
  const html = menu({ allowed: false, ready: false });
  assert.ok(bankDisabled(html)); assert.ok(html.includes("Checking bank connection access"));
  for (const t of ["Upload a statement", "Add an investment", "Add an offline account"]) assert.ok(html.includes(t));
  assert.equal((html.match(/disabled=""/g) || []).length, 1);
});
await ok("allowed: Connect enabled, no reason line", () => {
  const html = menu({ allowed: true, ready: true });
  assert.ok(!bankDisabled(html)); assert.ok(!html.includes("accounts-bank-access"));
});
await ok("denied: reason and Manage subscription shown", () => {
  const html = menu({ allowed: false, ready: true });
  assert.ok(bankDisabled(html)); assert.ok(html.includes("not included in your plan")); assert.ok(html.includes("Manage subscription"));
});
await ok("error: retry line and Try again, no plan wording", () => {
  const html = menu({ allowed: false, ready: true, error: true, onRetry: noop });
  assert.ok(bankDisabled(html)); assert.ok(html.includes("could not check bank connection access")); assert.ok(html.includes("Try again"));
  assert.ok(!html.includes("not included in your plan") && !html.includes("Manage subscription"));
});
await ok("every row fires its handler (element tree)", () => {
  const calls = [];
  const tree = AccountsAddMenu({ allowed: true, ready: true, onBank: (p) => calls.push("bank:" + p), onStatement: () => calls.push("statement"), onInvestment: () => calls.push("investment"), onOffline: () => calls.push("offline") });
  const buttons = [];
  const walk = (el) => { if (!el || typeof el !== "object") return; if (Array.isArray(el)) return el.forEach(walk); if (el.type === "button") buttons.push(el); walk(el.props?.children); };
  walk(tree);
  const text = (el) => { const out = []; const w = (x) => { if (typeof x === "string") out.push(x); else if (Array.isArray(x)) x.forEach(w); else if (x?.props) w(x.props.children); }; w(el); return out.join(""); };
  for (const b of buttons) b.props.onClick();
  assert.deepEqual(calls.sort(), ["bank:finexer", "offline", "investment", "statement"].sort());
  assert.ok(buttons.some((b) => text(b).includes("Connect a bank")));
});

// ---- each path opens its sheet in the page ----
const page = readFileSync(new URL("../app/components/AccountsPage.tsx", import.meta.url), "utf8");
await ok("each Add handler sets the state that renders its sheet", () => {
  assert.match(page, /onBank=\{provider => \{ watchAddTap\("bank"\); setAddMenuOpen\(false\); setShowBankPicker\(provider\); \}\}/);
  assert.match(page, /onStatement=\{\(\) => \{ watchAddTap\("statement"\); setAddMenuOpen\(false\); setShowStatementUpload\(true\); \}\}/);
  assert.match(page, /onInvestment=\{\(\) => \{ watchAddTap\("investment"\); setAddMenuOpen\(false\); setShowInvestmentUpload\(true\); \}\}/);
  assert.match(page, /onOffline=\{\(\) => \{ watchAddTap\("offline"\); setAddMenuOpen\(false\); openAddManual\(\); \}\}/);
  assert.match(page, /\{showBankPicker && \(\s*<BankPickerSheet/);
  assert.match(page, /\{showStatementUpload && \(\s*<StatementUpload/);
  assert.match(page, /\{showInvestmentUpload && \(\s*<InvestmentUpload/);
  assert.match(page, /\{manualModalOpen && modalsMounted && <SheetFrame/);
  assert.match(page, /error=\{bankAccess\.status === "error"\}/);
  assert.match(page, /onRetry=\{bankAccess\.retry\}/);
});

// ---- diagnostic ----
function rig({ platform = "ios", sheet = false } = {}) {
  const timers = []; const sent = [];
  const state = { sheet };
  const d = createAddDiagnostic({
    platform: () => platform, build: "build test", sheetOpen: () => state.sheet,
    send: (stage, detail, p) => sent.push({ stage, detail, p }),
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { t.live = false; },
  });
  const fire = () => timers.filter((t) => t.live).forEach((t) => { t.live = false; t.fn(); });
  return { d, sent, fire, state, timers };
}
const snap = (access) => () => ({ access, ready: access !== "loading", allowed: access === "allowed" });
await ok("tap with no sheet after 2s sends one report with state only", () => {
  const r = rig(); r.d.tapped("bank", snap("allowed"));
  assert.equal(r.timers[0].ms, 2000); r.fire();
  assert.equal(r.sent.length, 1); assert.equal(r.sent[0].stage, "accounts-add-bank");
  assert.equal(r.sent[0].detail, "reason=no-sheet-after-tap access=allowed ready=true allowed=true platform=ios build=build test");
  assert.equal(r.sent[0].p, "ios");
});
await ok("at most one report per launch across taps and the watchdog", () => {
  const r = rig(); r.d.tapped("statement", snap("allowed")); r.d.tapped("offline", snap("allowed")); r.d.watchAccess(snap("loading")); r.fire(); r.fire();
  r.d.tapped("bank", snap("allowed")); r.d.watchAccess(snap("loading")); r.fire();
  assert.equal(r.sent.length, 1);
});
await ok("a sheet that opened is not reported", () => {
  const r = rig({ sheet: true }); r.d.tapped("investment", snap("allowed")); r.fire(); assert.equal(r.sent.length, 0);
});
await ok("access unresolved at 8s reports; resolved does not", () => {
  const a = rig(); a.d.watchAccess(snap("loading")); assert.equal(a.timers[0].ms, 8000); a.fire();
  assert.equal(a.sent.length, 1); assert.match(a.sent[0].detail, /reason=access-unresolved access=loading ready=false allowed=false/);
  const b = rig(); b.d.watchAccess(snap("allowed")); b.fire(); assert.equal(b.sent.length, 0);
  const c = rig(); c.d.watchAccess(snap("denied")); c.fire(); assert.equal(c.sent.length, 0);
});
await ok("web builds never report; a throwing sender is swallowed; cancel works", () => {
  const w = rig({ platform: null }); w.d.tapped("bank", snap("allowed")); w.fire(); assert.equal(w.sent.length, 0);
  const t = createAddDiagnostic({ platform: () => "android", build: "b", sheetOpen: () => false, send: () => { throw new Error("boom"); }, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {} });
  t.tapped("bank", snap("allowed"));
  const r = rig(); const cancel = r.d.tapped("bank", snap("allowed")); cancel(); r.fire(); assert.equal(r.sent.length, 0);
});
const diagSrc = readFileSync(new URL("../lib/accountsAddDiagnosticClient.ts", import.meta.url), "utf8");
await ok("client wiring never chains on a plugin proxy", () => {
  assert.ok(!/registerPlugin/.test(diagSrc));
  assert.match(diagSrc, /api\.reportPushDiagnostic\(stage, detail, platform\)\.catch/);
});
console.log(`g477-accounts-add: ${n} ok`);
