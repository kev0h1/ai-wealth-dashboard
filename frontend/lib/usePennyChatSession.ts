"use client";

// G248: the chat session behind the Penny sheet. Not mounted by the live sheet
// yet: the live PennyConversation keeps per-screen thread buckets, and how a
// stored chat restores into them is decided with the header and history
// design (/design/penny-history). This hook is the tested contract it will use.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PennyConversation, type PennyConversationSummary } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import {
  bootPennySession, decidePennyStart, readActivePennyConversation, writeActivePennyConversation,
} from "@/lib/pennyConversationSession";

export function usePennyChatSession(enabled: boolean) {
  const { preferencesReady, openLastChat } = usePreferences();
  const [conversation, setConversation] = useState<PennyConversation | null>(null);
  const [history, setHistory] = useState<PennyConversationSummary[]>([]);
  const [ready, setReady] = useState(false);
  const started = useRef(false);

  const refreshHistory = useCallback(async () => {
    const res = await api.listPennyConversations();
    setHistory(res.conversations);
    return res.conversations;
  }, []);

  useEffect(() => {
    if (!enabled || started.current) return;
    const storage = typeof window === "undefined" ? null : window.sessionStorage;
    bootPennySession(storage);
    const activeId = readActivePennyConversation(storage);
    if (!activeId && !preferencesReady) return;
    started.current = true;
    (async () => {
      try {
        const list = await refreshHistory().catch(() => [] as PennyConversationSummary[]);
        const decision = decidePennyStart({ activeId, preferencesReady, openLastChat, latest: list[0] ?? null });
        if (decision.action === "resume" || decision.action === "load-latest") {
          try {
            const loaded = await api.getPennyConversation(decision.id);
            setConversation(loaded);
            writeActivePennyConversation(storage, loaded.id);
          } catch {
            writeActivePennyConversation(storage, null);
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, [enabled, preferencesReady, openLastChat, refreshHistory]);

  /** The id to send with a question. Creates the chat on the first question. */
  const ensureConversationId = useCallback(async (): Promise<string> => {
    if (conversation) return conversation.id;
    const created = await api.createPennyConversation();
    setConversation(created);
    writeActivePennyConversation(window.sessionStorage, created.id);
    return created.id;
  }, [conversation]);

  const newChat = useCallback(() => {
    setConversation(null);
    writeActivePennyConversation(window.sessionStorage, null);
  }, []);

  const resume = useCallback(async (id: string) => {
    const loaded = await api.getPennyConversation(id);
    setConversation(loaded);
    writeActivePennyConversation(window.sessionStorage, loaded.id);
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deletePennyConversation(id);
    if (conversation?.id === id) newChat();
    await refreshHistory();
  }, [conversation, newChat, refreshHistory]);

  return { ready, conversation, history, ensureConversationId, newChat, resume, remove, refreshHistory };
}
