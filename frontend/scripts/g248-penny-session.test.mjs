// G248: the Penny chat session rules (lib/pennyConversationSession.ts) driven
// with a fake sessionStorage, and the cap composer state.
// Run: npm run -s check:g248-penny-session
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PENNY_CONVERSATION_KEY, PENNY_FULL_ACTION, PENNY_FULL_NOTICE, bootPennySession, decidePennyStart,
  pennyComposerCapState, readActivePennyConversation, resetPennyBootForTests, writeActivePennyConversation,
} from "../lib/pennyConversationSession.ts";

const fake = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), m };
};
const latest = (at_cap = false) => ({ id: "c-latest", at_cap });

// Swipe down and reopen: the same page load, so the id survives a remount.
{
  const s = fake();
  resetPennyBootForTests();
  bootPennySession(s);
  writeActivePennyConversation(s, "c1");
  bootPennySession(s); // provider remounts when the sheet reopens
  assert.equal(readActivePennyConversation(s), "c1");
  assert.deepEqual(decidePennyStart({ activeId: "c1", preferencesReady: false, openLastChat: true, latest: latest() }), { action: "resume", id: "c1" });
  assert.deepEqual(decidePennyStart({ activeId: "c1", preferencesReady: true, openLastChat: false, latest: latest() }), { action: "resume", id: "c1" });
}
// Cold start or refresh: sessionStorage may still hold an id (a refresh keeps
// it), and boot clears it.
{
  const s = fake();
  s.setItem(PENNY_CONVERSATION_KEY, "stale");
  resetPennyBootForTests();
  bootPennySession(s);
  assert.equal(readActivePennyConversation(s), null);
}
// After boot, with the setting OFF (default): fresh, whatever history exists.
assert.deepEqual(decidePennyStart({ activeId: null, preferencesReady: true, openLastChat: false, latest: latest() }), { action: "fresh" });
// ON and under the cap: reopen the most recent chat.
assert.deepEqual(decidePennyStart({ activeId: null, preferencesReady: true, openLastChat: true, latest: latest() }), { action: "load-latest", id: "c-latest" });
// ON but the latest is at the cap: fresh.
assert.deepEqual(decidePennyStart({ activeId: null, preferencesReady: true, openLastChat: true, latest: latest(true) }), { action: "fresh" });
// ON with no history at all: fresh.
assert.deepEqual(decidePennyStart({ activeId: null, preferencesReady: true, openLastChat: true, latest: null }), { action: "fresh" });
// Preferences not settled yet: wait, never guess.
assert.deepEqual(decidePennyStart({ activeId: null, preferencesReady: false, openLastChat: true, latest: latest() }), { action: "wait" });
// Blocked storage never throws.
{
  const blocked = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };
  resetPennyBootForTests();
  bootPennySession(blocked);
  assert.equal(readActivePennyConversation(blocked), null);
  writeActivePennyConversation(blocked, "x");
}
// Composer at the cap.
assert.deepEqual(pennyComposerCapState(false), { disabled: false, notice: null, action: null });
assert.deepEqual(pennyComposerCapState(true), { disabled: true, notice: "This chat is full. Start a new chat to carry on.", action: "New chat" });
assert.equal(PENNY_FULL_NOTICE, "This chat is full. Start a new chat to carry on.");
assert.equal(PENNY_FULL_ACTION, "New chat");

// The cap mirrors the backend constant.
const backend = readFileSync(new URL("../../backend/app/services/penny_conversations.py", import.meta.url), "utf8");
assert.match(backend, /PENNY_MAX_TURNS = 30/);
// Copy rules in the new strings.
for (const s of [PENNY_FULL_NOTICE, PENNY_FULL_ACTION]) assert.ok(!/[—!]/.test(s));
console.log("g248 penny session: all checks passed");
