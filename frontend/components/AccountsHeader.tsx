"use client";

// G236: the Accounts page header block (title, subtitle, "Add" menu, Net worth
// reading and its eye toggle), extracted UNCHANGED from AccountsPage.tsx so the
// /design/accounts-header round can render today's header through props. Markup
// is pinned byte-for-byte against the origin/main block by
// `check:g236-accounts-header` (scripts/g236-accounts-header.test.mjs).
// State and handlers stay in AccountsPage: it passes the open flag, the toggle,
// the menu ref, the menu rows (children of the role="menu" container) and the
// derived position figures.

import type { ReactNode, RefObject } from "react";
import { Plus, ChevronDown, Eye, EyeOff } from "lucide-react";

export interface AccountsHeaderNetWorth {
  value: number;
  /** Total owed across cards, as a positive figure. */
  cardTotal: number;
  bankCount: number;
  investmentCount: number;
  offlineCount: number;
}

export interface AccountsHeaderProps {
  /** Banks tab only: the "+ Add" button and its menu. */
  showAdd: boolean;
  addMenuOpen: boolean;
  onToggleAdd: () => void;
  addMenuRef: RefObject<HTMLDivElement | null>;
  /** The menu rows, rendered inside the role="menu" container. */
  addMenuItems: ReactNode;
  /** Null until the KPIs have loaded: no Net worth block. */
  netWorth: AccountsHeaderNetWorth | null;
  hidden: boolean;
  onToggleHidden: () => void;
}

export default function AccountsHeader({
  showAdd, addMenuOpen, onToggleAdd, addMenuRef, addMenuItems, netWorth, hidden, onToggleHidden,
}: AccountsHeaderProps) {
  return (
  <div className="mb-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.03em] text-slate-950 dark:text-white">Accounts</h1>
        <p className="mt-1 max-w-[62ch] text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">Everything you own and owe, in one position.</p>
      </div>
      {/* "+ Add" inline beside the title (G113 — matches the ratified
          preview's AccountsCanvasHeader). Was previously a full-width
          primary button below net worth: louder than the preview and
          pushing the whole list down. Condensed from the old 3/4-
          button row (header Variant B) still holds — every
          destination below is the same handler the separate buttons
          used to call, only the entry point and position changed. */}
      {showAdd && (
        <div className="relative shrink-0" ref={addMenuRef}>
          <button
            data-tutorial-id="tutorial-add-account"
            onClick={onToggleAdd}
            className="inline-flex min-h-11 items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all px-4 rounded-xl text-sm font-semibold text-white"
            aria-expanded={addMenuOpen}
            aria-haspopup="menu"
          >
            <Plus size={15} />
            Add
            <ChevronDown size={13} className={`opacity-70 transition-transform ${addMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {addMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+6px)] z-30 w-56 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-100 dark:border-white/10 py-1 divide-y divide-slate-100 dark:divide-white/5 overflow-hidden"
            >
              {addMenuItems}
            </div>
          )}
        </div>
      )}
    </div>
    {netWorth && (() => {
      const { cardTotal } = netWorth;
      // Net worth is a position, not a risk — it stays hero-white even
      // when negative (Red Is Risk keeps red for genuine risk states).
      // Canvas Before Cards (DESIGN.md 2026-09-15): the page title,
      // this reading, and its context line sit directly on the
      // canvas — no card boundary — since account-group cards below
      // already carry the evidence (G87, Kevin approved Variant A
      // "Quiet position" 2026-09-16).
      return (
        <div data-tutorial-id="tutorial-networth" className="flex items-start justify-between gap-3 mt-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Net worth</p>
            <p
              className="mt-1 text-[34px] font-bold leading-none tracking-[-0.035em] money text-slate-950 dark:text-white"
              aria-label={hidden ? "Balance hidden" : undefined}
            >
              {hidden
                ? "••••••"
                : `${netWorth.value < 0 ? "−" : ""}£${Math.abs(netWorth.value).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}
            </p>
            {/* The two stats + counts, whispered onto one line. No
                month-over-month trend here — KPIs carries only a
                point-in-time net_worth, no history/delta to report
                honestly, so nothing is fabricated in its place. */}
            <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">
              {cardTotal > 0 && (
                <span className="font-mono tabular-nums">
                  {hidden ? "−£••••" : `−£${cardTotal.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}
                </span>
              )}
              {cardTotal > 0 && " across cards · "}
              {netWorth.bankCount} bank · {netWorth.investmentCount} investment
              {netWorth.offlineCount > 0 && ` · ${netWorth.offlineCount} offline`}
            </p>
          </div>
          <button
            onClick={onToggleHidden}
            aria-label={hidden ? "Show balance" : "Hide balance"}
            className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-300/70 dark:hover:bg-slate-700 transition-colors flex-shrink-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      );
    })()}
  </div>
  );
}
