// G248 fold-in (variant A, Quiet toolbar): the live Penny sheet's stored-chat
// behaviour. Drives lib/pennyChatController.ts (every start/resume/new/cap
// rule the sheet uses) with a fake api and a fake sessionStorage, the real
// api.canI against a stubbed fetch, the real PennyComposer and
// PennyHistorySheet components, and pins the wiring in PennySheet and
// PennyConversation. The thread rendering itself (PennyConversation fetches
// its own data) is not rendered here.
// Run: npm run -s check:g248-penny-history
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const store = new Map();
const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)), removeItem: k => void store.delete(k) };
globalThis.window = { sessionStorage: storage, location: { href: "https://x.test/" }, addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = storage;

const { createPennyChatController } = await import("../lib/pennyChatController.ts");
const { PENNY_CONVERSATION_KEY, resetPennyBootForTests } = await import("../lib/pennyConversationSession.ts");
const tick = () => new Promise(r => setTimeout(r, 0));

// ---- fake server -----------------------------------------------------------
function fakeApi(seed = []) {
  const chats = new Map(seed.map(c => [c.id, c]));
  const calls = { create: 0, list: 0, get: [], del: [] };
  const summary = c => ({ id: c.id, title: c.title, created_at: null, updated_at: c.updated_at ?? null, preview: "", turn_count: c.turns.length, at_cap: c.turns.length >= 30 });
  return {
    calls, chats,
    listPennyConversations: async () => { calls.list++; return { conversations: [...chats.values()].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")).map(summary) }; },
    getPennyConversation: async id => { calls.get.push(id); const c = chats.get(id); if (!c) throw new Error("404"); return { ...summary(c), turns: c.turns }; },
    createPennyConversation: async () => { calls.create++; const id = `new${calls.create}`; chats.set(id, { id, title: "New chat", turns: [] }); return { ...summary(chats.get(id)), turns: [] }; },
    deletePennyConversation: async id => { calls.del.push(id); chats.delete(id); return { deleted: true }; },
  };
}
const turns = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `t${i}` }));
const seed = () => [
  { id: "old", title: "Old", updated_at: "2026-10-01T00:00:00Z", turns: turns(4) },
  { id: "last", title: "Last", updated_at: "2026-10-08T00:00:00Z", turns: turns(6) },
];

// 1. First send creates the chat once (concurrent callers share one create) and
//    hands back the id that goes into /can-i.
{
  store.clear(); resetPennyBootForTests();
  const api = fakeApi();
  const c = createPennyChatController(api, storage);
  await c.start({ preferencesReady: true, openLastChat: false });
  assert.equal(c.snapshot().activeId, null, "a fresh chat stores nothing until the first question");
  assert.equal(api.calls.create, 0);
  const [a, b] = await Promise.all([c.ensureConversationId(), c.ensureConversationId()]);
  assert.equal(a, b);
  assert.equal(api.calls.create, 1, "one create for the first question");
  assert.equal(await c.ensureConversationId(), a, "later questions reuse it");
  assert.equal(api.calls.create, 1);
  assert.equal(store.get(PENNY_CONVERSATION_KEY), a, "the id is kept for this session");
  assert.equal(c.snapshot().restore.seq, 0, "creating a chat never replaces the thread that holds the question");
}

// 2. Same-session reopen restores the thread from the server (provider remount).
{
  store.clear(); resetPennyBootForTests();
  const api = fakeApi(seed());
  const first = createPennyChatController(api, storage);
  await first.start({ preferencesReady: true, openLastChat: false });
  await first.resume("old");
  assert.equal(store.get(PENNY_CONVERSATION_KEY), "old");
  const second = createPennyChatController(api, storage); // same page load, controller rebuilt
  await second.start({ preferencesReady: false, openLastChat: false }); // resume needs no preferences
  const s = second.snapshot();
  assert.equal(s.activeId, "old");
  assert.deepEqual(s.restore.turns, turns(4));
  assert.equal(s.restore.seq, 1);
  assert.equal(s.ready, true);
}

// 3. Cold start (a new page load clears the id) with the setting OFF starts fresh,
//    whatever history exists.
{
  store.set(PENNY_CONVERSATION_KEY, "last"); resetPennyBootForTests();
  const api = fakeApi(seed());
  const c = createPennyChatController(api, storage);
  await c.start({ preferencesReady: true, openLastChat: false });
  const s = c.snapshot();
  assert.equal(s.activeId, null);
  assert.equal(s.restore.seq, 0);
  assert.equal(s.history.length, 2, "history is still listed");
  assert.deepEqual(api.calls.get, [], "nothing was loaded");
}

// 4. Setting ON and the latest chat under the cap: it loads. At the cap: fresh.
//    Preferences not ready: waits, then acts once.
{
  store.clear(); resetPennyBootForTests();
  const api = fakeApi(seed());
  const c = createPennyChatController(api, storage);
  await c.start({ preferencesReady: false, openLastChat: true });
  assert.equal(c.snapshot().ready, false, "waits for preferences, never guesses");
  await c.start({ preferencesReady: true, openLastChat: true });
  const s = c.snapshot();
  assert.equal(s.activeId, "last");
  assert.deepEqual(s.restore.turns, turns(6));
  assert.equal(s.full, false);

  store.clear(); resetPennyBootForTests();
  const capped = fakeApi([{ id: "big", title: "Big", updated_at: "2026-10-08T00:00:00Z", turns: turns(30) }]);
  const d = createPennyChatController(capped, storage);
  await d.start({ preferencesReady: true, openLastChat: true });
  assert.equal(d.snapshot().activeId, null, "a full latest chat is not reopened");
}

// 5. New chat clears the thread and the id.
{
  store.clear(); resetPennyBootForTests();
  const api = fakeApi(seed());
  const c = createPennyChatController(api, storage);
  await c.start({ preferencesReady: true, openLastChat: false });
  await c.resume("last");
  const before = c.snapshot().restore.seq;
  c.markFull();
  assert.equal(c.snapshot().full, true);
  c.newChat();
  const s = c.snapshot();
  assert.equal(s.activeId, null);
  assert.equal(s.full, false);
  assert.deepEqual(s.restore.turns, []);
  assert.equal(s.restore.seq, before + 1, "the thread is told to clear");
  assert.equal(store.has(PENNY_CONVERSATION_KEY), false);
}

// 6. Cap state: the composer shows the notice and New chat, and /can-i's 409 is a
//    typed full error (no generic error path, so no error bubble).
{
  const { default: PennyComposer } = await import("../components/PennyComposer.tsx");
  const base = { inputRef: { current: null }, value: "", onChange() {}, onSend() {}, placeholder: "Ask", loading: false, atCap: false };
  const full = renderToStaticMarkup(React.createElement(PennyComposer, { ...base, chatFull: { notice: "This chat is full. Start a new chat to carry on.", actionLabel: "New chat", onAction() {} } }));
  assert.match(full, /This chat is full\. Start a new chat to carry on\./);
  assert.match(full, />New chat</);
  assert.doesNotMatch(full, /data-penny-input/, "no input at the cap");
  assert.doesNotMatch(full, /Something went wrong|Try again/i);
  const open = renderToStaticMarkup(React.createElement(PennyComposer, base));
  assert.match(open, /data-penny-input/);

  const bodies = [];
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ reply: "ok", conversation: { id: "c9", at_cap: false } }) }; };
  const { api, PennyConversationFullError } = await import("../lib/api.ts");
  await api.canI("Can I?", [], undefined, "home", undefined, "c9");
  assert.equal(bodies[0].conversation_id, "c9", "the stored conversation id is sent with the question");
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: false, status: 409, statusText: "Conflict", json: async () => ({ detail: { code: "PENNY_CONVERSATION_FULL", message: "x", at_cap: true } }) }; };
  await assert.rejects(() => api.canI("Can I?", [], undefined, "home", undefined, "c9"), e => e instanceof PennyConversationFullError);
  globalThis.fetch = async () => ({ ok: false, status: 409, statusText: "Conflict", json: async () => ({ detail: "other" }) });
  await assert.rejects(() => api.canI("Can I?"), e => !(e instanceof PennyConversationFullError), "any other 409 stays an ordinary error");
  const noId = []; globalThis.fetch = async (_u, init) => { noId.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ reply: "ok" }) }; };
  await api.canI("Hi");
  assert.equal("conversation_id" in noId[0], false, "no id, no field (the /penny page is unchanged)");
}

// 7. Delete: removing the open chat starts fresh; removing another keeps the thread.
{
  store.clear(); resetPennyBootForTests();
  const api = fakeApi(seed());
  const c = createPennyChatController(api, storage);
  await c.start({ preferencesReady: true, openLastChat: false });
  await c.resume("last");
  await c.remove("old");
  assert.equal(c.snapshot().activeId, "last");
  assert.deepEqual(c.snapshot().history.map(h => h.id), ["last"]);
  await c.remove("last");
  assert.equal(c.snapshot().activeId, null);
  assert.deepEqual(c.snapshot().history, []);
  assert.deepEqual(api.calls.del, ["old", "last"]);
}

// 8. History sheet: bin on every row, "Chat deleted" with Undo for 5 seconds,
//    commit after the 5 seconds, and the footer switch slot.
{
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const timers = [];
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  function mount(fn) {
    const cells = []; let n = 0, pending = [], dirty = false, result;
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const d = {
      useState(init) { const i = n++; if (!(i in cells)) cells[i] = { v: typeof init === "function" ? init() : init }; const cell = cells[i];
        return [cell.v, next => { const v = typeof next === "function" ? next(cell.v) : next; if (!Object.is(v, cell.v)) { cell.v = v; dirty = true; if (!rendering) rerender(); } }]; },
      useRef(init) { const i = n++; if (!(i in cells)) cells[i] = { current: init }; return cells[i]; },
      useEffect(f, deps) { const i = n++; const prev = cells[i]; if (prev && same(prev.deps, deps)) return; pending.push({ i, f, deps, prev }); },
    };
    let rendering = false;
    function rerender() {
      do { dirty = false; rendering = true; n = 0; pending = []; internals.H = d;
        try { result = fn(); } finally { internals.H = null; rendering = false; }
        for (const p of pending) p.prev?.cleanup?.();
        for (const p of pending) cells[p.i] = { deps: p.deps, cleanup: p.f() };
      } while (dirty);
    }
    rerender();
    return { get tree() { return result; }, unmount() { for (const c of cells) c?.cleanup?.(); } };
  }
  const find = (node, pred, out = []) => {
    if (node == null || typeof node !== "object") return out;
    if (Array.isArray(node)) { node.forEach(x => find(x, pred, out)); return out; }
    if (node.props) { if (pred(node.props)) out.push(node.props); find(node.props.children, pred, out); }
    return out;
  };
  const text = node => (node == null || typeof node === "boolean") ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
  const { default: PennyHistorySheet } = await import("../components/PennyHistorySheet.tsx");
  const rows = [
    { id: "a", title: "Chat A", created_at: "2026-10-09T08:00:00Z", updated_at: "2026-10-09T08:00:00Z", preview: "p", turn_count: 2, at_cap: false },
    { id: "b", title: "Chat B", created_at: "2026-10-08T08:00:00Z", updated_at: "2026-10-08T08:00:00Z", preview: "q", turn_count: 2, at_cap: false },
  ];
  const deleted = [];
  globalThis.setTimeout = (f, ms) => { const t = { f, ms }; timers.push(t); return t; };
  globalThis.clearTimeout = t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); };
  const h = mount(() => PennyHistorySheet({ conversations: rows, activeId: "a", now: new Date("2026-10-09T12:00:00Z"), onResume() {}, onDelete: id => deleted.push(id), onClose() {}, footer: React.createElement("span", null, "FOOTER") }));
  const bins = () => find(h.tree, p => typeof p["aria-label"] === "string" && p["aria-label"].startsWith("Delete chat:"));
  assert.equal(bins().length, 2, "a bin on every row");
  assert.match(text(h.tree), /Only your last 10 chats are kept, for 7 days after the last message\./);
  assert.match(text(h.tree), /FOOTER/);
  bins()[0].onClick();
  assert.match(text(h.tree), /Chat deleted/);
  assert.equal(bins().length, 1, "the row is hidden while the delete is pending");
  assert.deepEqual(deleted, [], "nothing committed yet");
  const undo = find(h.tree, p => text(p.children) === "Undo")[0];
  undo.onClick();
  assert.equal(bins().length, 2, "Undo brings the row back");
  assert.doesNotMatch(text(h.tree), /Chat deleted/);
  assert.deepEqual(deleted, []);
  bins()[1].onClick();
  const t = timers[timers.length - 1];
  assert.equal(t.ms, 5000, "the undo window is 5 seconds");
  t.f();
  assert.deepEqual(deleted, ["b"], "the delete commits when the window ends");
  h.unmount();
  globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear;
}

// 9. Wiring pinned in source.
{
  const sheet = readFileSync(new URL("../components/PennySheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /usePennyChatSession\(hasOpened\)/);
  assert.match(sheet, /toolbar=\{<PennyChatToolbar/);
  assert.match(sheet, /<PennyHistorySheet/);
  assert.match(sheet, /<PennyOpenLastChatRow checked=\{openLastChat\} onChange=\{setOpenLastChat\}/);
  assert.match(sheet, /chat=\{chat\}/);
  const conv = readFileSync(new URL("../components/PennyConversation.tsx", import.meta.url), "utf8");
  assert.match(conv, /const bucketKey: BucketKey = chat \? "chat" : currentScreen;/);
  assert.match(conv, /chat\.ensureConversationId\(\)/);
  assert.match(conv, /api\.canI\(question, history, context, sendScreen, sendView, conversationId\)/);
  assert.match(conv, /e instanceof PennyConversationFullError/);
  assert.match(conv, /if \(chatRef\.current\) return;/, "a stored chat is not idle-cleared");
  const all = [sheet, conv, readFileSync(new URL("../lib/pennyHistoryFormat.ts", import.meta.url), "utf8"), readFileSync(new URL("../lib/pennyConversationSession.ts", import.meta.url), "utf8")].join("\n");
  assert.doesNotMatch(readFileSync(new URL("../lib/pennyHistoryFormat.ts", import.meta.url), "utf8"), /—/, "no em dashes in history copy");
  void all;
}
console.log("g248-penny-history: ok");
