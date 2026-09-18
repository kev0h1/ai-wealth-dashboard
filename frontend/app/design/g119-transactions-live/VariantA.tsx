"use client";

// Variant A — closest to today's production /transactions hub: day-group
// cards (the grammar Kevin liked from G92), page-based Prev/Next pagination
// (the EXACT page/page_size contract TransactionsPage.tsx already uses via
// api.transactionsSearch), and a row tap opens a real bottom sheet carrying
// THIS transaction's own detail (DetailPanel, layout="sheet") — not a
// group-level toggle, not a fixed teaching sentence.
//
// Page-based paging means a calendar day that straddles a page boundary can
// legitimately reopen its heading on the next page (see
// lib/transactionGrouping.ts's own comment) — left visible on purpose so
// the pagination recommendation in this route's report has a working
// example to point at, not just a claim.
//
// Row treatment (Kevin's UAT-review request, now folded into production):
// the colour bar is replaced with the real category icon here — variant A
// only, B/C keep the bar so the three stay comparable side by side. This
// now renders the PRODUCTION components/TransactionRow.tsx directly with
// `iconVariant="category"` rather than a hand-authored copy of its markup,
// so this preview is a genuine gate — if the shipped row drifts from what
// Kevin approved, this preview drifts with it instead of silently staying
// pretty. TransactionRow resolves the chip itself (getCategoryIcon +
// useCategoryIcons, icon at full colour strength inside a `${colour}26`
// tint) at 28px/14px sized down for a row, unchanged from before this fold.
//
// G122: `showDate={false}` — the day is now in the group heading, so the
// row itself only needs merchant, category and amount; TransactionRow's
// own subtitle drops the date for any caller that passes this, the same
// prop the production hub now passes (app/transactions/TransactionsPage.tsx).

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Account, Transaction } from "@/lib/api";
import TransactionRow from "@/components/TransactionRow";
import { fetchTransactionsPage, type Source, type SearchFilters, EMPTY_FILTERS } from "./dataSource";
import { groupByDay } from "@/lib/transactionGrouping";
import DetailPanel from "./DetailPanel";

const PAGE_SIZE = 20;

export default function VariantA({
  forcedFixture,
  accounts,
  filters = EMPTY_FILTERS,
}: {
  forcedFixture: Transaction[] | null;
  accounts: Account[];
  filters?: SearchFilters;
}) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [source, setSource] = useState<Source>("fixture");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Transaction | null>(null);

  // A changed filter (deep-linked or user-applied via the sheet) restarts
  // paging at 1, same as TransactionsPage.tsx's own filter-change effect.
  useEffect(() => { setPage(1); }, [forcedFixture, filters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTransactionsPage(page, PAGE_SIZE, forcedFixture, filters).then(({ result, source: src }) => {
      if (cancelled) return;
      setItems(result.items);
      setTotal(result.total);
      setPages(result.pages);
      setSource(src);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [page, forcedFixture, filters]);

  const groups = groupByDay(items);

  return (
    <div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
        {source === "live" ? "Showing your data" : "Showing example data · sign in to see yours"} · {total} payment{total !== 1 ? "s" : ""} · page {page} of {pages}
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
                  <TransactionRow key={tx.id} transaction={tx} iconVariant="category" showDate={false} onClick={() => setOpen(tx)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {!loading && pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="min-h-[44px] inline-flex items-center gap-1 px-4 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 active:scale-95 transition-transform"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Prev
          </button>
          <span className="text-sm text-slate-600 dark:text-slate-400">{page} / {pages}</span>
          <button
            type="button"
            disabled={page === pages}
            onClick={() => setPage((p) => p + 1)}
            className="min-h-[44px] inline-flex items-center gap-1 px-4 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 active:scale-95 transition-transform"
          >
            Next
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {loading && (
        <div className="sr-only" aria-live="polite">Loading</div>
      )}

      {open && (
        <DetailPanel
          transaction={open}
          account={accounts.find((a) => a.id === open.account_id)}
          layout="sheet"
          isLive={source === "live"}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
