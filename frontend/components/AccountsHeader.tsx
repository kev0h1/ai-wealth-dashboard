"use client";

// G250 fold-in of the approved round 3 "I, Console" (Kevin 2026-10-13), which
// replaced the G236 "A, Verdict header" block and the floating Add. The header is
// the title, then one glass-card instrument: a Net worth label, the one Display
// figure (30px), an "across N accounts" caption (with the legacy freshness reading when
// the figures are shown) and a 44px indigo-tint Add in the card corner. While
// balances are hidden (the one global hide-balances preference) the figure is
// masked in a stable footprint and a privacy rail ("Balances hidden", Show) closes
// the card; Show turns the same preference off. There is no eye and no floating
// Add. G389 adds Refresh beside Add and independent bank-data status. State
// stays in AccountsPage; the header accepts props so the g236 checks
// can render it. Net worth is a position, not a risk: hero ink even when negative
// (Red Is Risk). Tokens only, the real glass-card surface, no gradient.

import { useEffect, type ReactNode, type RefObject, type KeyboardEvent } from "react";
import { EyeOff, Plus, RefreshCw } from "lucide-react";

export interface AccountsHeaderNetWorth {
  value: number;
  /** Every account counted in the figure: banks, investments and offline. */
  accountCount: number;
}

export interface AccountsHeaderProps {
  /** Null until the KPIs have loaded, or when they fail: the card keeps the label and Add, with "Not available right now" in place of the figure. */
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
  /** G389 A: bank refresh beside Add; times come from bank data, not KPIs. */
  refresh?: { onRefresh: () => void; disabled: boolean; busy: boolean; freshness: string; message: string };
}

function money(v: number, hidden: boolean): string {
  if (hidden) return `${v < 0 ? "−" : ""}£••••`;
  return `${v < 0 ? "−" : ""}£${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export default function AccountsHeader({ netWorth, hidden, showChip, onShow, onAdd, updated, addOpen = false, addRef, onAddClose, addMenu, refresh }: AccountsHeaderProps) {
  const text = netWorth ? money(netWorth.value, hidden) : "";
  useEffect(() => {
    if (addOpen) addRef?.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [addOpen, addRef]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && addOpen && onAddClose) {
      onAddClose();
      addRef?.current?.querySelector<HTMLElement>("[data-add-control]")?.focus();
      e.preventDefault();
    }
    if (addOpen && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      const items = [...(addRef?.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (current + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
      e.preventDefault();
    }
  };
  return (
    <header className="relative z-30">
      <h1 className="text-[20px] font-bold leading-tight text-slate-950 dark:text-white">Accounts</h1>
      {(
        <div className="glass-card mt-3 rounded-2xl p-4" data-tutorial-id="tutorial-networth">
          <div className={refresh ? "flex flex-wrap items-start justify-between gap-x-3 gap-y-2" : "flex items-start justify-between gap-3"}>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-slate-600 dark:text-slate-400">Net worth</p>
              {netWorth ? (
                <p className="money mt-1 text-[30px] font-bold leading-[1.2] tracking-[-0.025em] text-slate-950 dark:text-white">
                  <span aria-hidden="true">{text}</span>
                  <span className="sr-only">{hidden ? (netWorth.value < 0 ? "Negative balance hidden" : "Balance hidden") : text}</span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400" data-networth-unavailable>Not available right now</p>
              )}
            </div>
            <div className={refresh ? "-mr-1 -mt-1 ml-auto flex shrink-0 items-start gap-2" : "contents"}>
            {refresh && <button
              type="button"
              onClick={refresh.onRefresh}
              disabled={refresh.disabled}
              aria-busy={refresh.busy}
              aria-label="Refresh connected banks"
              aria-describedby="accounts-refresh-status"
              title="Refresh connected banks"
              className={`inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 active:scale-95 disabled:opacity-50 dark:bg-indigo-400/15 dark:text-indigo-300 dark:hover:bg-indigo-400/25 ${focusRing}`}
            ><RefreshCw size={20} aria-hidden="true" /></button>}
            <div ref={addRef} onKeyDown={onKeyDown} onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) onAddClose?.(); }} className={refresh ? "relative shrink-0" : "relative -mr-1 -mt-1 shrink-0"}>
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
          </div>
          {netWorth && (
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              across {netWorth.accountCount} {netWorth.accountCount === 1 ? "account" : "accounts"}
              {!refresh && !showChip && updated ? <span data-updated> · {updated}</span> : null}
            </p>
          )}
          {netWorth && showChip && (
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
          {refresh && <div className="mt-3 space-y-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <p data-bank-freshness>{refresh.freshness}</p>
            <p id="accounts-refresh-status" role="status" aria-live="polite">{refresh.message}</p>
          </div>}
        </div>
      )}
    </header>
  );
}
