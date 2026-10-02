"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
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
  // Callbacks live in a ref and the listener is registered exactly once. Next's
  // own popstate handler can flush a React render synchronously inside the same
  // event dispatch; a listener that re-registers on every render is removed and
  // re-added mid-dispatch and the browser then skips it for that very event.
  const handlers = useRef({ setSelectedAccountId, clearSelectedTransaction });
  useLayoutEffect(() => {
    handlers.current = { setSelectedAccountId, clearSelectedTransaction };
  });
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const decision = decideAccountPop(event.state, openSheetHistoryCount());
      if (decision.accountId !== undefined) handlers.current.setSelectedAccountId(decision.accountId);
      if (decision.clearTransaction) handlers.current.clearSelectedTransaction();
    };
    window.addEventListener("popstate", onPop, true);
    return () => window.removeEventListener("popstate", onPop, true);
  }, []);
}
