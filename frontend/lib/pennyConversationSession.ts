// G248: which Penny conversation is "current", as pure rules over an injected
// Storage so node checks can drive them with a fake sessionStorage.
//
// The rules (Kevin 2026-10-09):
//  1. Swipe down and reopen within one app session RESUMES the chat. The page's
//     JavaScript keeps running, so the id just stays in sessionStorage.
//  2. A cold start or a page refresh starts a new JavaScript session, so
//     bootPennySession() clears the id once per page load. Nothing is carried
//     over by sessionStorage itself (a browser refresh would otherwise keep it).
//  3. After a boot, a chat is either fresh (no id yet, created on the first
//     question so empty chats are never stored) or, only when the "Open my last
//     chat" setting is ON and the newest chat is under the turn cap, that chat.
//  4. The setting is a server preference. Until preferencesReady is true the
//     answer is "wait", never a guess.

export const PENNY_CONVERSATION_KEY = "wd_penny_conversation";

/** Per-conversation turn cap. Mirrors backend PENNY_MAX_TURNS. */
export const PENNY_MAX_TURNS = 30;

export const PENNY_FULL_NOTICE = "This chat is full. Start a new chat to carry on.";
export const PENNY_FULL_ACTION = "New chat";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let booted = false;

/** Call once per page load. Clears the active id so a cold start or refresh
 * never resumes by accident. Idempotent within a page load, so a remount of the
 * provider (swipe down and reopen, route change) keeps the id. */
export function bootPennySession(storage: StorageLike | null | undefined): void {
  if (booted) return;
  booted = true;
  try { storage?.removeItem(PENNY_CONVERSATION_KEY); } catch { /* storage blocked */ }
}

/** Test seam: pretend the page was reloaded. */
export function resetPennyBootForTests(): void { booted = false; }

export function readActivePennyConversation(storage: StorageLike | null | undefined): string | null {
  try { return storage?.getItem(PENNY_CONVERSATION_KEY) || null; } catch { return null; }
}

export function writeActivePennyConversation(storage: StorageLike | null | undefined, id: string | null): void {
  try {
    if (id) storage?.setItem(PENNY_CONVERSATION_KEY, id);
    else storage?.removeItem(PENNY_CONVERSATION_KEY);
  } catch { /* storage blocked */ }
}

export type PennyStartDecision =
  | { action: "wait" }
  | { action: "resume"; id: string }
  | { action: "load-latest"; id: string }
  | { action: "fresh" };

export function decidePennyStart(input: {
  activeId: string | null;
  preferencesReady: boolean;
  openLastChat: boolean;
  latest: { id: string; at_cap: boolean } | null;
}): PennyStartDecision {
  if (input.activeId) return { action: "resume", id: input.activeId };
  if (!input.preferencesReady) return { action: "wait" };
  if (input.openLastChat && input.latest && !input.latest.at_cap) return { action: "load-latest", id: input.latest.id };
  return { action: "fresh" };
}

/** What the composer shows for the current chat. */
export function pennyComposerCapState(atCap: boolean): { disabled: boolean; notice: string | null; action: string | null } {
  return atCap
    ? { disabled: true, notice: PENNY_FULL_NOTICE, action: PENNY_FULL_ACTION }
    : { disabled: false, notice: null, action: null };
}
