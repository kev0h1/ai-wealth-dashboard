"use client";

// G250 fold-in of the approved round 3 "I, Console" (Kevin 2026-10-13), which
// replaced the G236 "A, Verdict header" block and the floating Add. The header is
// the title, then one glass-card instrument: a Net worth label, the one Display
// figure (30px), an "across N accounts" caption (with the freshness reading when
// the figures are shown) and a 44px indigo-tint Add in the card corner. While
// balances are hidden (the one global hide-balances preference) the figure is
// masked in a stable footprint and a privacy rail ("Balances hidden", Show) closes
// the card; Show turns the same preference off. There is no eye and no floating
// Add. State stays in AccountsPage; the header is pure props so the g236 checks
// can render it. Net worth is a position, not a risk: hero ink even when negative
// (Red Is Risk). Tokens only, the real glass-card surface, no gradient.

import type { ReactNode, RefObject, KeyboardEvent } from "react";
import { EyeOff, Plus } from "lucide-react";

export interface AccountsHeaderNetWorth {
  value: number;
  /** Every account counted in the figure: banks, investments and offline. */
  accountCount: number;
}

export interface AccountsHeaderProps {
  /** Null until the KPIs have loaded: no Net worth card. */
  netWorth: AccountsHeaderNetWorth | null;
  /** The figure is masked (global hide-balances preference, or not yet resolved). */
  hidden: boolean;
  /** Show the privacy rail (preference resolved and on). */
  showChip: boolean;
  /** Turns the global hide-balances preference off. */
  onShow: () => void;
  /** Opens or closes the Add menu. */
  onAdd: () => void;
  /** Pre-formatted freshness text, e.g. "Updated 8 min ago". Absent renders nothing. */
  updated?: string;
  /** The Add menu is open (aria-expanded on the Add button). */
  addOpen?: boolean;
  /** Wraps the Add button and its menu, so an outside tap can be told apart. */
  addRef?: RefObject<HTMLDivElement | null>;
  /** Closes the Add menu on Escape and returns focus to the Add button. */
  onAddClose?: () => void;
  /** The existing Add menu rows container (role="menu"), shown under the Add button. */
  addMenu?: ReactNode;
}

function money(v: number, hidden: boolean): string {
  if (hidden) return "£••••";
  return `${v < 0 ? "−" : ""}£${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export default function AccountsHeader({ netWorth, hidden, showChip, onShow, onAdd, updated, addOpen = false, addRef, onAddClose, addMenu }: AccountsHeaderProps) {
  const text = netWorth ? money(netWorth.value, hidden) : "";
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && addOpen && onAddClose) {
      onAddClose();
      addRef?.current?.querySelector<HTMLElement>("[data-add-control]")?.focus();
    }
  };
  return (
    <header className="relative z-30">
      <h1 className="text-[20px] font-bold leading-tight text-slate-950 dark:text-white">Accounts</h1>
      {netWorth && (
        <div className="glass-card mt-3 rounded-2xl p-4" data-tutorial-id="tutorial-networth">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-slate-600 dark:text-slate-400">Net worth</p>
              <p className="money mt-1 text-[30px] font-bold leading-[1.2] tracking-[-0.025em] text-slate-950 dark:text-white">
                <span aria-hidden="true">{text}</span>
                <span className="sr-only">{hidden ? "Balance hidden" : text}</span>
              </p>
            </div>
            <div ref={addRef} onKeyDown={onKeyDown} className="relative -mr-1 -mt-1 shrink-0">
              <button
                type="button"
                data-add-control
                data-tutorial-id="tutorial-add-account"
                onClick={onAdd}
                aria-haspopup="menu"
                aria-expanded={addOpen}
                aria-label="Add account"
                className={`inline-flex size-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 transition-transform hover:bg-indigo-100 active:scale-95 motion-reduce:transition-none dark:bg-indigo-400/15 dark:text-indigo-300 dark:hover:bg-indigo-400/25 ${focusRing}`}
              >
                <Plus size={20} aria-hidden="true" />
              </button>
              {addMenu}
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            across {netWorth.accountCount} {netWorth.accountCount === 1 ? "account" : "accounts"}
            {!showChip && updated ? <span data-updated> · {updated}</span> : null}
          </p>
          {showChip && (
            <div className="-mb-2 mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-1 dark:border-white/10" data-privacy-rail>
              <p className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <EyeOff size={13} aria-hidden="true" />
                Balances hidden
              </p>
              <button
                type="button"
                data-hidden-chip
                onClick={onShow}
                className={`-mr-2 inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-indigo-700 transition-transform active:scale-95 motion-reduce:transition-none dark:text-indigo-300 ${focusRing}`}
              >
                Show<span className="sr-only"> balances</span>
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
