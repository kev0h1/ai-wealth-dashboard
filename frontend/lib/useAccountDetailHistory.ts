"use client";

import { useEffect } from "react";
import { accountDetailIdFromState } from "@/lib/accountSheetHistory";

/**
 * Reconciles the Accounts detail state with the history entry reached by a
 * browser traversal. A child SheetFrame sits above the account marker, so
 * closing it lands back on the marker and must retain the account detail.
 */
export function useAccountDetailHistory(
  setSelectedAccountId: (accountId: string | null) => void,
  clearSelectedTransaction: () => void,
) {
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      setSelectedAccountId(accountDetailIdFromState(event.state));
      clearSelectedTransaction();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [clearSelectedTransaction, setSelectedAccountId]);
}
