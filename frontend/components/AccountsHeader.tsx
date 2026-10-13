"use client";

// G236 fold-in of the approved "A, Verdict header" (Kevin 2026-10-10): the
// Accounts page header is the title, then Net worth as the one Display figure
// with an "across N accounts" caption, on the canvas (Canvas Before Cards). No
// eye: balances are hidden by the one global hide-balances preference (Settings
// switch), and while hidden a "Balances hidden · Show" chip sits under the
// figure and turns the same preference off. Add is the floating action in
// components/AccountsAddFab.tsx, not part of the header. State stays in
// AccountsPage; the header is pure props so check:g236-accounts-fold-in can
// render it.

import type { ReactNode } from "react";
import { EyeOff, RefreshCw } from "lucide-react";

export interface AccountsHeaderNetWorth {
  value: number;
  /** Every account counted in the figure: banks, investments and offline. */
  accountCount: number;
}

export interface AccountsHeaderProps {
  /** Null until the KPIs have loaded: no Net worth block. */
  netWorth: AccountsHeaderNetWorth | null;
  /** The figure is masked (global hide-balances preference, or not yet resolved). */
  hidden: boolean;
  /** Show the "Balances hidden · Show" chip (preference resolved and on). */
  showChip: boolean;
  /** Turns the global hide-balances preference off. */
  onShow: () => void;
  /** G250 options, all absent in production so today's render is unchanged. */
  /** "top" moves the hidden chip to the title row's right; "none" leaves it to the caller (aside or rail); default "below". */
  chipPlacement?: "below" | "top" | "none";
  /** Tighter spacing: the Home rhythm (G221) puts 20px before the next section. */
  tight?: boolean;
  /** Compact Cash / Cards / Investments reading beside Net worth. */
  breakdown?: AccountsHeaderBreakdownItem[];
  /** Pre-formatted freshness text, e.g. "Updated 8 min ago". Needs onRefresh. */
  lastSynced?: string | null;
  /** Sync now. With lastSynced, a 44px control sits top right. */
  onRefresh?: () => void;
  /** G250 round 2: the Add action returns to the top right of the title row. */
  topRight?: ReactNode;
  /** G250 round 2: a quiet right-aligned reading on the Net worth row (e.g. the hidden chip or "Updated N min ago"). */
  aside?: ReactNode;
  /** G250 round 2: a right action column spanning the header; top sits on the title line, bottom on the caption line. */
  rail?: { top: ReactNode; bottom?: ReactNode };
  /** G250 round 3: a different art direction for the whole header. Absent in production, so the default render is unchanged. */
  layout?: AccountsHeaderLayout;
  /** G250 round 3: pre-formatted freshness text for the caption row of a layout (display only, no control). */
  updated?: string;
}

export type AccountsHeaderLayout = "brief" | "register" | "console";

export interface AccountsHeaderBreakdownItem {
  label: string;
  /** Signed: cards are negative. */
  value: number;
}

function money(v: number, hidden: boolean): string {
  if (hidden) return "£••••";
  return `${v < 0 ? "−" : ""}£${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

export function HiddenChip({ onShow, className = "" }: { onShow: () => void; className?: string }) {
  return (
    <button
      type="button"
      data-hidden-chip
      onClick={onShow}
      className={`inline-flex min-h-11 items-center rounded-xl active:scale-95 transition-transform motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${className}`}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300">
        <EyeOff size={13} aria-hidden="true" />
        Balances hidden · Show
      </span>
    </button>
  );
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

/** Quiet, borderless hidden-balances reading for the round 3 layouts: Show is the one indigo word. */
function QuietShow({ onShow }: { onShow: () => void }) {
  return (
    <button
      type="button"
      data-hidden-chip
      onClick={onShow}
      className={`-my-3 -mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-xs text-slate-600 active:scale-95 transition-transform motion-reduce:transition-none dark:text-slate-400 ${focusRing}`}
    >
      <EyeOff size={13} aria-hidden="true" />
      <span>Balances hidden</span>
      <span aria-hidden="true">·</span>
      <span className="font-semibold text-indigo-700 underline decoration-indigo-700/40 underline-offset-2 dark:text-indigo-300 dark:decoration-indigo-300/40">Show</span>
    </button>
  );
}

/**
 * G250 round 3. Three whole-header treatments, each rendering the same pieces
 * (title, Net worth, caption, hidden reading, Add via topRight):
 *  brief     a sentence on the canvas, "Net worth is £1,365", the figure set inside it
 *  register  the first entry of the ledger: label left, figure right, between two hairlines
 *  console   one glass-card instrument, Add in its corner, a privacy rail when hidden
 */
function LayoutHeader({ layout, netWorth, hidden, showChip, onShow, topRight, updated }: {
  layout: AccountsHeaderLayout;
  netWorth: AccountsHeaderNetWorth | null;
  hidden: boolean;
  showChip: boolean;
  onShow: () => void;
  topRight?: ReactNode;
  updated?: string;
}) {
  const text = netWorth ? money(netWorth.value, hidden) : "";
  const title = <h1 className="text-[20px] font-bold leading-tight text-slate-950 dark:text-white">Accounts</h1>;
  const count = netWorth ? `across ${netWorth.accountCount} ${netWorth.accountCount === 1 ? "account" : "accounts"}` : "";
  const reading = showChip ? <QuietShow onShow={onShow} /> : updated ? <p className="text-xs text-slate-600 dark:text-slate-400" data-updated>{updated}</p> : null;
  const spoken = <span className="sr-only">{hidden ? "Balance hidden" : text}</span>;
  const titleRow = (corner: boolean) => (
    <div className="flex items-center justify-between gap-3">
      {title}
      {corner && topRight ? <div className="-my-2.5">{topRight}</div> : null}
    </div>
  );

  if (layout === "console") {
    return (
      <header data-layout="console">
        {titleRow(false)}
        {netWorth && (
          <div className="glass-card mt-3 rounded-2xl p-4" data-tutorial-id="tutorial-networth">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-slate-600 dark:text-slate-400">Net worth</p>
                <p className="money mt-1 text-[30px] font-bold leading-[1.2] tracking-[-0.025em] text-slate-950 dark:text-white">
                  <span aria-hidden="true">{text}</span>
                  {spoken}
                </p>
              </div>
              {topRight ? <div className="-mr-1 -mt-1 shrink-0">{topRight}</div> : null}
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {count}
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
                  className={`-mr-2 inline-flex min-h-11 items-center rounded-xl px-3 text-[13px] font-semibold text-indigo-700 active:scale-95 transition-transform motion-reduce:transition-none dark:text-indigo-300 ${focusRing}`}
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

  if (layout === "register") {
    return (
      <header data-layout="register">
        {titleRow(true)}
        {netWorth && (
          <div className="mt-4" data-tutorial-id="tutorial-networth">
            <div className="flex items-baseline justify-between gap-4 border-y border-slate-300 py-3.5 dark:border-slate-700">
              <p className="text-[15px] font-semibold text-slate-800 dark:text-slate-200">Net worth</p>
              <p className="money min-w-[7ch] text-right text-[24px] font-semibold leading-[1.2] tracking-[-0.03em] text-slate-950 dark:text-white">
                <span aria-hidden="true">{text}</span>
                {spoken}
              </p>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">{count}</p>
              {reading}
            </div>
          </div>
        )}
      </header>
    );
  }

  return (
    <header data-layout="brief">
      {titleRow(true)}
      {netWorth && (
        <div className="mt-4" data-tutorial-id="tutorial-networth">
          <p className="text-[22px] font-medium leading-[1.3] tracking-[-0.01em] text-slate-600 dark:text-slate-300">
            Net worth is{" "}
            <span className="money text-[26px] font-bold tracking-[-0.03em] text-slate-950 dark:text-white">
              <span aria-hidden="true">{text}</span>
              {spoken}
            </span>
          </p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-[13px] text-slate-600 dark:text-slate-400">{count}</p>
            {reading}
          </div>
        </div>
      )}
    </header>
  );
}

export default function AccountsHeader({ netWorth, hidden, showChip, onShow, chipPlacement = "below", tight = false, breakdown, lastSynced, onRefresh, topRight, aside, rail, layout, updated }: AccountsHeaderProps) {
  if (layout) return <LayoutHeader layout={layout} netWorth={netWorth} hidden={hidden} showChip={showChip} onShow={onShow} topRight={topRight} updated={updated} />;
  const text = netWorth
    ? hidden
      ? "£••••"
      : `${netWorth.value < 0 ? "−" : ""}£${Math.abs(netWorth.value).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
    : "";
  const title = <h1 className="text-[20px] font-bold leading-tight text-slate-950 dark:text-white">Accounts</h1>;
  const chipTop = showChip && chipPlacement === "top";
  const refresh = lastSynced && onRefresh;
  const titleRowExtra = topRight ? (
    <div className="-my-2.5">{topRight}</div>
  ) : chipTop ? (
    <HiddenChip onShow={onShow} className="-my-2.5 -mr-1" />
  ) : refresh ? (
    <button
      type="button"
      data-refresh
      onClick={onRefresh}
      className="-my-2.5 -mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-xs text-slate-600 active:scale-95 transition-transform motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400"
    >
      <RefreshCw size={13} aria-hidden="true" />
      {lastSynced}
      <span className="sr-only">. Refresh now</span>
    </button>
  ) : null;
  const hasBreakdown = !!breakdown && breakdown.length > 0;
  const hasAside = !!aside;
  const figure = netWorth ? (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Net worth</p>
      <p className="money mt-1 text-[30px] font-bold leading-[1.2] tracking-[-0.025em] text-slate-950 dark:text-white">
        <span aria-hidden="true">{text}</span>
        <span className="sr-only">{hidden ? "Balance hidden" : text}</span>
      </p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        across {netWorth.accountCount} {netWorth.accountCount === 1 ? "account" : "accounts"}
      </p>
      {showChip && chipPlacement === "below" && <HiddenChip onShow={onShow} className="mt-1" />}
    </>
  ) : null;
  const inner = (
    <>
      {titleRowExtra ? (
        <div className="flex items-center justify-between gap-3">
          {title}
          {titleRowExtra}
        </div>
      ) : (
        title
      )}
      {netWorth && (
        // Net worth is a position, not a risk: it stays hero-white even when
        // negative (Red Is Risk keeps red for genuine risk states).
        <div className={`${tight ? "mt-3" : "mt-5"}${hasBreakdown || hasAside ? " flex items-start justify-between gap-4" : ""}`} data-tutorial-id="tutorial-networth">
          {hasBreakdown || hasAside ? <div className="min-w-0">{figure}</div> : figure}
          {hasAside && <div className="mt-4 shrink-0" data-aside>{aside}</div>}
          {hasBreakdown && (
            <dl className="mt-5 shrink-0 space-y-1 text-xs" data-breakdown>
              {breakdown!.map((b) => (
                <div key={b.label} className="flex items-baseline justify-between gap-4">
                  <dt className="text-slate-600 dark:text-slate-400">{b.label}</dt>
                  <dd className="money font-semibold tabular-nums text-slate-800 dark:text-slate-200">{money(b.value, hidden)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </>
  );
  return (
    <header className={tight ? "mb-0" : "mb-4"}>
      {rail ? (
        <div className="flex items-stretch justify-between gap-4" data-rail>
          <div className="min-w-0">{inner}</div>
          <div className="flex shrink-0 flex-col items-end justify-between">
            <div className="-mt-2.5">{rail.top}</div>
            {rail.bottom && <div className="-mb-1">{rail.bottom}</div>}
          </div>
        </div>
      ) : (
        inner
      )}
    </header>
  );
}
