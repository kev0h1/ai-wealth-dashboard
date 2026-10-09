// G248: the Penny chat session as a plain controller, so the live sheet's hook
// (usePennyChatSession) is a thin wrapper and node checks can drive every rule
// with a fake api and a fake sessionStorage.
//
// It owns: which stored conversation is active, the history list, the "chat is
// full" flag, and a `restore` signal. `restore` is how a thread changes from
// OUTSIDE the conversation component (resume, load-latest, New chat); creating
// a chat on the first question never fires it, because the thread already holds
// that question. Text only: nothing here keeps tool payloads or secrets.

import type { PennyConversation, PennyConversationSummary, PennyConversationTurn } from "@/lib/api";
import {
  bootPennySession, decidePennyStart, readActivePennyConversation, writeActivePennyConversation,
} from "@/lib/pennyConversationSession";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface PennyChatApi {
  listPennyConversations: () => Promise<{ conversations: PennyConversationSummary[] }>;
  getPennyConversation: (id: string) => Promise<PennyConversation>;
  createPennyConversation: () => Promise<PennyConversation>;
  deletePennyConversation: (id: string) => Promise<unknown>;
}

export interface PennyChatSnapshot {
  /** True once the start decision (fresh, resume, load-latest) has settled. */
  ready: boolean;
  activeId: string | null;
  /** The active chat has reached its turn cap. */
  full: boolean;
  history: PennyConversationSummary[];
  /** Bumps when the thread must be replaced from outside. */
  restore: { seq: number; turns: PennyConversationTurn[] };
}

export function createPennyChatController(api: PennyChatApi, storage: StorageLike | null) {
  let activeId: string | null = null;
  let full = false;
  let ready = false;
  let history: PennyConversationSummary[] = [];
  let restore: PennyChatSnapshot["restore"] = { seq: 0, turns: [] };
  let started = false;
  let creating: Promise<string> | null = null;
  const listeners = new Set<() => void>();
  let snap: PennyChatSnapshot | null = null;

  const emit = () => { snap = null; listeners.forEach((fn) => fn()); };
  const setActive = (id: string | null) => { activeId = id; writeActivePennyConversation(storage, id); };
  const adopt = (c: PennyConversation) => {
    setActive(c.id);
    full = c.at_cap;
    restore = { seq: restore.seq + 1, turns: c.turns };
  };

  async function refreshHistory() {
    const res = await api.listPennyConversations();
    history = res.conversations;
    emit();
    return history;
  }

  function newChat() {
    setActive(null);
    full = false;
    restore = { seq: restore.seq + 1, turns: [] };
    emit();
  }

  return {
    snapshot(): PennyChatSnapshot {
      return (snap ??= { ready, activeId, full, history, restore });
    },
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    /** The id as of now, for guarding an answer that lands after New chat. */
    getActiveId: () => activeId,
    /** Per-send token: changes on New chat, resume and load-latest, never on create. */
    getRestoreSeq: () => restore.seq,

    /** Decide how this page load starts. Call when the sheet first opens and
     * again as preferences settle; it acts once. */
    async start(prefs: { preferencesReady: boolean; openLastChat: boolean }): Promise<void> {
      if (started) return;
      bootPennySession(storage);
      const stored = readActivePennyConversation(storage);
      if (!stored && !prefs.preferencesReady) return;
      started = true;
      try {
        const list = await refreshHistory().catch(() => [] as PennyConversationSummary[]);
        const decision = decidePennyStart({ activeId: stored, preferencesReady: prefs.preferencesReady, openLastChat: prefs.openLastChat, latest: list[0] ?? null });
        if (decision.action === "resume" || decision.action === "load-latest") {
          try {
            const loaded = await api.getPennyConversation(decision.id);
            // A question asked while this loaded already owns the thread.
            if (activeId === null || activeId === decision.id) adopt(loaded);
          } catch {
            if (activeId === decision.id) setActive(null);
          }
        }
      } finally {
        ready = true;
        emit();
      }
    },

    /** The id to send with a question. Creates the chat on the first question,
     * so an empty chat is never stored. Concurrent callers share one create. */
    async ensureConversationId(): Promise<string> {
      if (activeId) return activeId;
      creating ??= api.createPennyConversation().then((c) => {
        setActive(c.id);
        full = false;
        emit();
        return c.id;
      }).finally(() => { creating = null; });
      return creating;
    },

    /** New chat: forget the active id and empty the thread. */
    newChat,

    async resume(id: string) {
      adopt(await api.getPennyConversation(id));
      emit();
    },

    async remove(id: string) {
      await api.deletePennyConversation(id);
      if (activeId === id) newChat();
      await refreshHistory().catch(() => undefined);
    },

    /** The server said the active chat is full (409, or at_cap in a reply). */
    markFull() { if (!full) { full = true; emit(); } },
    refreshHistory,
  };
}
