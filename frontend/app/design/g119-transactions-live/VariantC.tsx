"use client";

// Variant C — the heaviest treatment: tapping a row doesn't open a sheet or
// expand in place, it swaps the whole screen to a dedicated full-bleed
// detail (DetailPanel layout="full", with the "Apply to" scope control and
// its one real read call). Pagination is manual "Load more" chunks only —
// no auto-scroll trigger — presented in the cadence a cursor-paginated feed
// would have (append-only, no page-number UI). Under the hood this still
// calls GET /transactions/search with page/page_size (the only pagination
// contract that endpoint actually offers today); see this route's
// pagination recommendation for why a true cursor belongs on the backend
// before this UX ships for real, and app/mcp-activity/McpActivityPage.tsx
// for what that already looks like elsewhere in this app (GET /mcp/audit's
// real `cursor`/`next_cursor`).

import { useEffect, useState } from "react";
import type { Account, Transaction } from "@/lib/api";
import { getCategoryColour } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import { formatCurrency } from "@/lib/currency";
import { fetchTransactionsPage, type Source } from "./dataSource";
import { groupByDay } from "./grouping";
import DetailPanel from "./DetailPanel";

const PAGE_SIZE = 20;
const MINUS = "−";

function Row({ tx, colours, onClick }: { tx: Transaction; colours: Record<string, string>; onClick: () => void }) {
  const colour = getCategoryColour(tx.category, colours);
  const isCredit = tx.transaction_type === "credit";
  const name = tx.merchant_name || tx.description || "Unknown";
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-[64px] flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50 dark:active:bg-slate-700/40 transition-colors"
    >
      <span className="h-8 w-1 rounded-full flex-shrink-0" style={{ background: colour }} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{name}</span>
        <span className="block truncate text-xs text-slate-500 dark:text-slate-300">{tx.category || "Other"}</span>
      </span>
      <span className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100 flex-shrink-0">
        {isCredit ? "+" : MINUS}
        {formatCurrency(tx.amount, tx.currency)}
      </span>
    </button>
  );
}

export default function VariantC({
  forcedFixture,
  accounts,
}: {
  forcedFixture: Transaction[] | null;
  accounts: Account[];
}) {
  const { colours } = useColours();
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [source, setSource] = useState<Source>("fixture");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<Transaction | null>(null);

  useEffect(() => {
    setItems([]); setPage(1); setLoading(true); setOpen(null);
    fetchTransactionsPage(1, PAGE_SIZE, forcedFixture).then(({ result, source: src }) => {
      setItems(result.items);
      setTotal(result.total);
      setPages(result.pages);
      setSource(src);
      setLoading(false);
    });
  }, [forcedFixture]);

  function loadMore() {
    if (loadingMore || page >= pages) return;
    setLoadingMore(true);
    const next = page + 1;
    fetchTransactionsPage(next, PAGE_SIZE, forcedFixture).then(({ result }) => {
      setItems((prev) => [...prev, ...result.items]);
      setPage(next);
      setLoadingMore(false);
    });
  }

  if (open) {
    return (
      <DetailPanel
        transaction={open}
        account={accounts.find((a) => a.id === open.account_id)}
        layout="full"
        isLive={source === "live"}
        onClose={() => setOpen(null)}
      />
    );
  }

  const groups = groupByDay(items);

  return (
    <div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
        {source === "live" ? "Showing your data" : "Showing example data · sign in to see yours"} · {items.length} of {total} loaded
      </p>

      {loading ? (
        <div className="space-y-3" aria-label="Loading transactions">
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-40 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 py-10 text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No payments yet</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Once you connect an account, they'll show up here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.key} className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <h2 className="px-4 pt-4 pb-1 text-sm font-bold text-slate-950 dark:text-slate-50">{g.heading}</h2>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {g.rows.map((tx) => (
                  <Row key={tx.id} tx={tx} colours={colours} onClick={() => setOpen(tx)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {!loading && page < pages && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="min-h-[44px] px-5 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-slate-600 dark:text-slate-300 active:scale-95 transition-transform disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
      {!loading && page >= pages && items.length > 0 && (
        <p className="mt-4 text-center text-[11px] text-slate-500 dark:text-slate-400">That's every payment in range.</p>
      )}
    </div>
  );
}
