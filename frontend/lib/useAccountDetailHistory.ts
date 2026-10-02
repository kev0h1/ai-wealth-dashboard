"use client";

import { useEffect } from "react";
import { decideAccountPop } from "@/lib/accountSheetHistory";
import { openSheetHistoryCount } from "@/lib/useSheetA11y";

/**
 * Reconciles the Accounts detail state with the history entry reached by a
 * browser traversal. Sheets opened over account detail push their own entry,
 * so closing one (by any route) must leave the account open; only a pop with
 * no sheet open is the page's own Back/Forward. See decideAccountPop.
 *
 * Registered in the capture phase so the open-sheet count is read before any
 * sheet's own popstate handler removes itself from the stack.
 */
export function useAccountDetailHistory(
  setSelectedAccountId: (accountId: string | null) => void,
  clearSelectedTransaction: () => void,
) {
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const decision = decideAccountPop(event.state, openSheetHistoryCount());
      if (decision.accountId !== undefined) setSelectedAccountId(decision.accountId);
      if (decision.clearTransaction) clearSelectedTransaction();
    };
    window.addEventListener("popstate", onPop, true);
    return () => window.removeEventListener("popstate", onPop, true);
  }, [clearSelectedTransaction, setSelectedAccountId]);
}
