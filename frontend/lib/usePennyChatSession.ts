"use client";

// G248: the chat session behind the live Penny sheet. A thin React wrapper
// over lib/pennyChatController.ts (which holds every rule and is what the node
// checks drive). PennySheet owns it and hands the result to PennyConversation
// so the header actions, the history sheet and the thread share one session.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { createPennyChatController } from "@/lib/pennyChatController";

export type PennyChatSession = ReturnType<typeof usePennyChatSession>;

export function usePennyChatSession(enabled: boolean) {
  const { preferencesReady, openLastChat } = usePreferences();
  const controller = useMemo(
    () => createPennyChatController(api, typeof window === "undefined" ? null : window.sessionStorage),
    [],
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);

  useEffect(() => {
    if (enabled) void controller.start({ preferencesReady, openLastChat });
  }, [enabled, preferencesReady, openLastChat, controller]);

  return useMemo(() => ({
    ...snapshot,
    getActiveId: controller.getActiveId,
    getRestoreSeq: controller.getRestoreSeq,
    ensureConversationId: controller.ensureConversationId,
    newChat: controller.newChat,
    resume: controller.resume,
    remove: controller.remove,
    markFull: controller.markFull,
    refreshHistory: controller.refreshHistory,
  }), [snapshot, controller]);
}
