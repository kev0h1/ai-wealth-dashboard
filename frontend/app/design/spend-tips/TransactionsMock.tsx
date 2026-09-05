"use client";

// TransactionsMock — a faithful mock of the real global transactions hub
// (app/transactions/TransactionsPage.tsx), the actual tap target for a
// Spend category row. Owner correction (2026-09-05): tapping a category in
// the live app does NOT open a bottom sheet, it routes to
// /transactions?category=X&from=&to= with the category and pay period as
// removable chips, a search box, and a paginated white list of
// TransactionRows. This mirrors that markup verbatim (sticky back header,
// search input, scope line + chips, the white divided list of the REAL
// TransactionRow component), adding only the one new thing this whole
// preview round is about: a collapsed tips line under the chips, above the
// payments, when the single active category filter carries open tips (see
// TipsLine in components/TipsLine.tsx for each tip's own expand-in-place —
// this route now renders the SAME live component the real page does, not a
// local fork).
//
// Rendered INSTEAD of the category list by SpendTipsClient.tsx whenever
// ?open=<category> is set. Its Back control is a plain <a href> rather
// than a callback + router.back(), so it round-trips through a real
// navigation exactly like VariantSwitch's own variant/mode links — the
// same technique already used everywhere on this preview route — dropping
// `open`/`tip` from the query string while keeping variant/mode.
//
// No pager: every fixture category fits on one screen, so the real page's
// prev/next controls (only rendered when totalPages > 1) are never
// reachable here and are left out rather than faked into always-disabled
// buttons.
import { ArrowLeft, Search, X } from "lucide-react";
import TransactionRow from "@/components/TransactionRow";
import { TipsLine } from "@/components/TipsLine";
import { type Variant, type Mode } from "./shared";
import { tipsFor, transactionsFor, TRANSACTIONS_PERIOD_FROM, TRANSACTIONS_PERIOD_TO } from "./fixtures";

// Copied verbatim from TransactionsPage.tsx's own local formatPeriodChip —
// it isn't exported there, so this reproduces its exact output (en-GB,
// day + short month, no year) rather than forking the whole page.
function formatPeriodChip(from: string, to: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  return `${fmt(from)} → ${fmt(to)}`;
}

export default function TransactionsMock({
  category,
  variant,
  mode,
  initialTipId,
}: {
  category: string;
  variant: Variant;
  mode: Mode;
  /** Preview-only `?tip=<insightId>` deep link (see SpendTipsClient.tsx) —
   *  opens both the tips line and that one strip on load. */
  initialTipId?: string;
}) {
  const items = transactionsFor(category);
  const tips = tipsFor(category);
  const backHref = `?variant=${variant}&mode=${mode}`;

  return (
    <>
      {/* Sticky back header — identical convention to TransactionsPage.tsx
          and ReceiptsPage.tsx: `sticky top-0 z-10` with a translucent
          page-background fill + backdrop-blur so scrolled content passes
          beneath it, not through it. */}
      <div className="sticky top-0 z-10 bg-[#f0f2f7]/90 dark:bg-[#0f172a]/90 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/60">
        <div className="px-4 pt-6 pb-3 flex items-center gap-3">
          <a
            href={backHref}
            aria-label="Back"
            className="w-11 h-11 flex items-center justify-center rounded-full glass-tile flex-shrink-0 active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} className="text-slate-500 dark:text-slate-400" />
          </a>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium uppercase tracking-wide">
              Every payment
            </p>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Search</h1>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 pb-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <input
            type="search"
            placeholder="Search transactions…"
            readOnly
            className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 min-h-[28px] flex-wrap">
          <p className="text-[11px] text-slate-600 dark:text-slate-400">Searching all accounts</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Category chip — non-functional in this preview (no removal:
                there is only ever the one fixture category open), same
                slate pill + X as TransactionsPage.tsx's real chip. */}
            <span className="flex-shrink-0 inline-flex items-center gap-1 min-h-[28px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-[11px] font-semibold">
              {category}
              <X size={10} aria-hidden="true" />
            </span>
            {/* Period chip — text via the copied formatPeriodChip above. */}
            <span className="flex-shrink-0 inline-flex items-center gap-1 min-h-[28px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-[11px] font-semibold">
              {formatPeriodChip(TRANSACTIONS_PERIOD_FROM, TRANSACTIONS_PERIOD_TO)}
              <X size={10} aria-hidden="true" />
            </span>
          </div>
        </div>

        {/* Placement matches the real page exactly (Step 4 of the
            promotion): inside the same px-4 block as the chips, mt-1. The
            live TipsLine carries no chrome/padding of its own. */}
        {tips.length > 0 && (
          <div className="mt-1">
            <TipsLine category={category} tips={tips} initialOpenTipId={initialTipId} />
          </div>
        )}
      </div>

      <div className="px-4 pt-2">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="divide-y divide-slate-50 dark:divide-slate-700">
            {items.map((tx) => (
              <TransactionRow key={tx.id} transaction={tx} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
