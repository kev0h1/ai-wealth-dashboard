"use client";

import { createContext, useContext } from "react";

// B55: one place for the Hide balances mask on Upcoming. The mask string is
// the same one Home uses ("£••••"). The context defaults to visible so design
// previews and tests that render these components with raw props are
// unchanged; PlanningPage provides the real preference (hidden until
// preferences resolve, exactly like SafeToSpendCard).
export const BALANCE_MASK = "£••••";

export const BalancesHiddenContext = createContext(false);

export function useBalancesHidden(): boolean {
  return useContext(BalancesHiddenContext);
}

/** Replace every £ figure in already-formatted text, keeping any sign or prefix. */
export function maskMoneyText(text: string, hidden: boolean): string {
  return hidden ? text.replace(/£\d[\d,]*(?:\.\d+)?[km]?/gi, BALANCE_MASK) : text;
}
