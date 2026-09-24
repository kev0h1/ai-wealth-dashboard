"use client";

// Variant B — day-group cards stay (same grammar as A), but pagination
// accumulates (infinite scroll, auto-triggered via an IntersectionObserver
// sentinel, with a manual "Load more" fallback for anyone who never
// triggers it, e.g. reduced-motion/keyboard-only) instead of replacing the
// page wholesale, so groupByDay merges correctly across loads (see
// lib/transactionGrouping.ts). Tapping a row does not open an overlay: the row itself
// expands in place (an accordion) to show DetailPanel with layout="inline"
// directly beneath it, pushing the rest of the list down rather than
// covering it — a lighter-weight, more "in the list" feeling than A's
// sheet. A "Back to top" pill appears once scrolled past the fold, since a
// long accumulated list is exactly the kind Kevin's own brief flagged as
// something people scroll deep into and want to return to (interacts with
// the scroll-restoration work in G108, not solved by this preview).

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown } from "lucide-react";
import type { Account, Transaction } from "@/lib/api";
import { getCategoryColour } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import { formatCurrency } from "@/lib/currency";
import { fetchTransactionsPage, type Source, type SearchFilters, EMPTY_FILTERS } from "./dataSource";
import { groupByDay } from "@/lib/transactionGrouping";
import DetailPanel from "./DetailPanel";

const PAGE_SIZE = 20;
const MINUS = "−";

function Row({
  tx, colours, isOpen, onToggle,
}: {
  tx: Transaction; colours: Record<string, string>; isOpen: boolean; onToggle: () => void;
}) {
  const colour = getCategoryColour(tx.category, colours);
  const isCredit = tx.transaction_type === "credit";
  const name = tx.merchant_name || tx.description || "Unknown";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className={`w-full min-h-[64px] flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50 dark:active:bg-slate-700/40 transition-colors ${
        isOpen ? "bg-indigo-50/60 dark:bg-indigo-500/5" : ""
      }`}
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
      <ChevronDown
        size={16}
        className={`flex-shrink-0 text-slate-400 dark:text-slate-300 transition-transform ${isOpen ? "rotate-180" : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}

export default function VariantB({
  forcedFixture,
  accounts,
  filters = EMPTY_FILTERS,
}: {
  forcedFixture: Transaction[] | null;
  accounts: Account[];
  filters?: SearchFilters;
}) {
  const { colours } = useColours();
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [source, setSource] = useState<Source>("fixture");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showTop, setShowTop] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // A changed filter (deep-linked or user-applied via the sheet) restarts
  // the accumulated list from page 1, same as forcedFixture already does.
  useEffect(() => {
    setItems([]); setPage(1); setLoading(true);
    fetchTransactionsPage(1, PAGE_SIZE, forcedFixture, filters).then(({ result, source: src }) => {
      setItems(result.items);
      setTotal(result.total);
      setPages(result.pages);
      setSource(src);
      setLoading(false);
    });
  }, [forcedFixture, filters]);

  function loadMore() {
    if (loadingMore || page >= pages) return;
    setLoadingMore(true);
    const next = page + 1;
    fetchTransactionsPage(next, PAGE_SIZE, forcedFixture, filters).then(({ result }) => {
      setItems((prev) => [...prev, ...result.items]);
      setPage(next);
      setLoadingMore(false);
    });
  }

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || loading) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, page, pages, forcedFixture, filters]);

  useEffect(() => {
    function onScroll() { setShowTop(window.scrollY > 800); }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const groups = groupByDay(items);
  const openTx = items.find((t) => t.id === openId) ?? null;

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
            <section key={g.key} className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 overflow-hidden">
              <h2 className="px-4 pt-4 pb-1 text-sm font-bold text-slate-950 dark:text-slate-50">{g.heading}</h2>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {g.rows.map((tx) => (
                  <div key={tx.id}>
                    <Row
                      tx={tx}
                      colours={colours}
                      isOpen={openId === tx.id}
                      onToggle={() => setOpenId(openId === tx.id ? null : tx.id)}
                    />
                    {openId === tx.id && openTx && (
                      <DetailPanel
                        transaction={openTx}
                        account={accounts.find((a) => a.id === openTx.account_id)}
                        layout="inline"
                        isLive={source === "live"}
                        onClose={() => setOpenId(null)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {!loading && page < pages && (
        <div ref={sentinelRef} className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="min-h-[44px] px-5 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-slate-600 dark:text-slate-300 active:scale-95 transition-transform disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load 20 more"}
          </button>
        </div>
      )}
      {!loading && page >= pages && items.length > 0 && (
        <p className="mt-4 text-center text-[11px] text-slate-500 dark:text-slate-400">That's every payment in range.</p>
      )}

      {showTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Back to top"
          className="fixed bottom-24 right-4 z-40 w-12 h-12 rounded-full bg-slate-900/90 dark:bg-slate-100/90 text-white dark:text-slate-900 shadow-xl flex items-center justify-center active:scale-95 transition-transform"
        >
          <ArrowUp size={18} />
        </button>
      )}
    </div>
  );
}
