"use client";

import { createContext, useContext, type ReactNode } from "react";

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

/** G306: wrap a module-level money formatter so it honours Hide balances. Call inside a component. */
export function useMaskedFormatter<A extends unknown[]>(format: (...args: A) => string): (...args: A) => string {
  const hidden = useBalancesHidden();
  return (...args: A) => maskMoneyText(format(...args), hidden);
}

/** B56: the masked figure for sighted users; screen readers hear "Amount hidden", never the glyphs. */
export function MaskedAmount({ text = BALANCE_MASK, className = "money" }: { text?: string; className?: string }): ReactNode {
  return (
    <span role="img" aria-label="Amount hidden" className={className}>
      {text}
    </span>
  );
}
