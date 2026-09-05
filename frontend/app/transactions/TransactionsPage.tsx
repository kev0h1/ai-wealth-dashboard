"use client";

// The global transactions hub (ENGINE.md "TEACHING SHEET + hub" — Task 2.2).
// Not a tab — a route reached from Spend's header search icon and from
// deep links (?category=X from an insight card etc). Lifts the proven
// search UI from AccountsPage.tsx (debounced input, server pagination,
// swipe, empty state) and points it at the global GET /transactions/search
// instead of one account's transactions — every source, every account, all
// time, unlike Spend's period-scoped view. Category correction goes through
// TeachingSheet, same as everywhere else in Spend.

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Search, X, ChevronLeft, ChevronRight } from "lucide-react";
import { api, Transaction, type SavingsInsight } from "@/lib/api";
import TransactionRow from "@/components/TransactionRow";
import TeachingSheet from "@/components/TeachingSheet";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import { TipsLine } from "@/components/TipsLine";
import { openTipsFor, tipsForMerchants } from "@/lib/spendTips";

const PAGE_SIZE = 20;

export default function TransactionsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [categoryFilter, setCategoryFilter] = useState<string | null>(() => searchParams.get("category"));
  // Multi-category deep-link (e.g. SpendVerdictView's "money you moved"
  // rows) — one `categories` query param per underlying category name, read
  // with getAll rather than splitting a comma-joined string (a custom
  // category name can legally contain a comma, which a delimiter can't
  // represent unambiguously; see backend/app/routers/transactions.py
  // `_search_query`). Mutually exclusive with `categoryFilter` in practice:
  // a link sets one or the other, never both.
  const [categoriesFilter, setCategoriesFilter] = useState<string[] | null>(() => {
    const all = searchParams.getAll("categories");
    return all.length > 0 ? all : null;
  });
  // Display label for the category chip/empty-state — set by a multi-
  // category deep-link (e.g. SpendVerdictView's "money you moved" rows).
  // Falls back to categoryFilter itself when absent, preserving every
  // existing "?category=X" link's behaviour untouched.
  const [categoryLabel, setCategoryLabel] = useState<string | null>(() => searchParams.get("label"));
  // Debit/credit scope from a deep-link (e.g. "money you moved" rows are
  // always debit) — cleared together with categoryFilter/categoryLabel
  // since it's the same filter unit, not an independently removable chip.
  const [txnType, setTxnType] = useState<"debit" | "credit" | null>(() => {
    const t = searchParams.get("txn_type");
    return t === "debit" || t === "credit" ? t : null;
  });
  // Merchant names from an insight deep-link ("?merchants=Ee Ltd,…") — up to
  // 3 display names, comma-separated. Shown as a removable chip alongside
  // the category filter so "see the payments behind this insight" lands on
  // the exact evidence, searched across all history (not the period-scoped
  // Spend view this used to open).
  const [merchantsFilter, setMerchantsFilter] = useState<string[] | null>(() => {
    const raw = searchParams.get("merchants");
    if (!raw) return null;
    const names = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return names.length > 0 ? names : null;
  });
  // The pay-period scope (?from=&to=) — a category tap from Spend arrives
  // with both dates, so the hub opens already narrowed to that period; the
  // frontend owns the period maths (periodStart/periodEnd), the backend
  // just accepts a plain range (backend/app/routers/transactions.py). Shown
  // as its own removable chip — clearing it widens to all history, same as
  // clearing category/merchants.
  const [periodFrom, setPeriodFrom] = useState<string | null>(() => searchParams.get("from"));
  const [periodTo, setPeriodTo] = useState<string | null>(() => searchParams.get("to"));
  // Deep link for an already-open tip (e.g. from the Insights hero or Home
  // spotlight) — re-seeded from searchParams below (same convention as the
  // filters above), so a second tip deep-link landing on a live page
  // instance pairs with its OWN tip rather than the previous one.
  const [tipParam, setTipParam] = useState<string | null>(() => searchParams.get("tip"));
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Transaction[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  // Savings insights for the collapsed tips line under the chips (Step 4,
  // spend-tips promotion) — the same api.getSavingsInsights() call
  // SpendPage.tsx uses for its own categoryInsights, fetched once here on
  // mount and tolerant of failure (no line at all rather than an error UI).
  const [insights, setInsights] = useState<SavingsInsight[]>([]);
  // Fetched once, the first time a category filter is actually active — a
  // ref (not state) so this never re-triggers itself; `categoryFilter` in
  // the deps means switching TO a category filter for the first time on
  // this page instance still fires the fetch, but flipping between two
  // categories, or losing/reapplying the same one, does not refetch (the
  // list is every insight, not scoped to one category — openTipsFor below
  // filters it per render). Tolerant of failure: a rejected fetch just
  // leaves the tips line absent, never an error UI.
  const insightsLoadedRef = useRef(false);

  const swipeTouchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    // Also fetches for a merchants-only deep link (no category filter) that
    // carries a `?tip=` — the merchant-scoped tips line below needs the same
    // insights list `openTipsFor` draws on, `tipsForMerchants` just filters
    // it down to the one matching insight instead of a whole category.
    const merchantsOnly = Boolean(merchantsFilter && merchantsFilter.length > 0 && tipParam);
    if (!categoryFilter && !merchantsOnly) return;
    if (insightsLoadedRef.current) return;
    let active = true;
    api.getSavingsInsights()
      .then((r) => { if (active) { insightsLoadedRef.current = true; setInsights(r); } })
      .catch(() => {});
    return () => { active = false; };
  }, [categoryFilter, merchantsFilter, tipParam]);

  // Re-seed every URL-driven filter whenever `searchParams` itself changes
  // (a fresh deep link from Spend's "money you moved" rows, or any other
  // ?category=/?categories=/?from=/?to= link) — not just on first mount.
  // The `useState(() => searchParams.get(...))` initialisers above only run
  // once; the App Router keeps this page component instance alive across
  // client-side navigations to the same /transactions route (only the
  // search params change), so without this effect a second deep link
  // landing here while the first one's state is still mounted showed the
  // FIRST link's filter (bug: tapping "To your investments" after visiting
  // "Between your accounts" landed on the stale "Between your accounts"
  // results, not a real routing/id mismatch).
  useEffect(() => {
    setCategoryFilter(searchParams.get("category"));
    const cats = searchParams.getAll("categories");
    setCategoriesFilter(cats.length > 0 ? cats : null);
    setCategoryLabel(searchParams.get("label"));
    const t = searchParams.get("txn_type");
    setTxnType(t === "debit" || t === "credit" ? t : null);
    const raw = searchParams.get("merchants");
    const names = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    setMerchantsFilter(names.length > 0 ? names : null);
    setPeriodFrom(searchParams.get("from"));
    setPeriodTo(searchParams.get("to"));
    setTipParam(searchParams.get("tip"));
  }, [searchParams]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // A new search or a cleared/changed category/merchants/period/txn-type filter always restarts at page 1.
  useEffect(() => { setPage(1); }, [debouncedQuery, categoryFilter, categoriesFilter, merchantsFilter, periodFrom, periodTo, txnType]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.transactionsSearch({
      q: debouncedQuery || undefined,
      // `categories` (repeated-param, exact-match list) wins when present —
      // mirrors the backend's own precedence in `_search_query`. Only fall
      // back to the scalar `category` when there's no multi-category deep
      // link, so the two never both hit the wire for one request.
      categories: categoriesFilter && categoriesFilter.length > 0 ? categoriesFilter : undefined,
      category: (!categoriesFilter || categoriesFilter.length === 0) ? (categoryFilter || undefined) : undefined,
      merchants: merchantsFilter && merchantsFilter.length > 0 ? merchantsFilter.join(",") : undefined,
      from: periodFrom || undefined,
      to: periodTo || undefined,
      txn_type: txnType || undefined,
      page,
      page_size: PAGE_SIZE,
    })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setTotalPages(r.pages);
        setTotal(r.total);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setTotalPages(1);
        setTotal(0);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQuery, categoryFilter, categoriesFilter, merchantsFilter, periodFrom, periodTo, txnType, page]);

  // Rebuilds the URL from whichever filters remain after one is cleared —
  // every clear*Filter below keeps the others (an insight deep-link, or a
  // category tap from Spend, can carry category+period together).
  function urlFor(overrides: {
    category?: string | null;
    categories?: string[] | null;
    merchants?: string[] | null;
    from?: string | null;
    to?: string | null;
    label?: string | null;
    txnType?: "debit" | "credit" | null;
  }) {
    const cat = overrides.category !== undefined ? overrides.category : categoryFilter;
    const cats = overrides.categories !== undefined ? overrides.categories : categoriesFilter;
    const merch = overrides.merchants !== undefined ? overrides.merchants : merchantsFilter;
    const from = overrides.from !== undefined ? overrides.from : periodFrom;
    const to = overrides.to !== undefined ? overrides.to : periodTo;
    const label = overrides.label !== undefined ? overrides.label : categoryLabel;
    const tt = overrides.txnType !== undefined ? overrides.txnType : txnType;
    const params = new URLSearchParams();
    // Repeated `categories` param, no delimiter — mirrors how the deep link
    // arrived (SpendPage's onOpenMoved) and how the backend reads it.
    if (cats && cats.length > 0) {
      for (const c of cats) params.append("categories", c);
    } else if (cat) {
      params.set("category", cat);
    }
    if (merch && merch.length > 0) params.set("merchants", merch.join(","));
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (label) params.set("label", label);
    if (tt) params.set("txn_type", tt);
    const qs = params.toString();
    return qs ? `/transactions?${qs}` : "/transactions";
  }

  // Category, label and txn_type are one filter unit (a multi-category deep-
  // link like "money you moved" always carries all three together) — clear
  // them together so the chip's X never leaves a stuck debit-only scope or a
  // stale label behind. Clearing wipes both the scalar and multi-category
  // state so a genuinely unfiltered list results either way.
  function clearCategoryFilter() {
    setCategoryFilter(null);
    setCategoriesFilter(null);
    setCategoryLabel(null);
    setTxnType(null);
    router.replace(urlFor({ category: null, categories: null, label: null, txnType: null }));
  }

  function clearMerchantsFilter() {
    setMerchantsFilter(null);
    router.replace(urlFor({ merchants: null }));
  }

  // The scope-transparency fix: widening to all history is always one tap,
  // and the result count updates visibly the moment the filter clears (the
  // fetch effect above already re-runs on periodFrom/periodTo).
  function clearPeriodFilter() {
    setPeriodFrom(null);
    setPeriodTo(null);
    router.replace(urlFor({ from: null, to: null }));
  }

  function handleTxUpdated(updated: Transaction, additionalIds?: string[]) {
    setItems((prev) => prev.map((t) => {
      if (t.id === updated.id) return { ...t, category: updated.category };
      if (additionalIds?.includes(t.id)) return { ...t, category: updated.category };
      return t;
    }));
  }

  function formatPeriodChip(from: string | null, to: string | null): string {
    const fmt = (iso: string) => {
      const d = new Date(iso + "T00:00:00");
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    };
    if (from && to) return `${fmt(from)} → ${fmt(to)}`;
    if (from) return `From ${fmt(from)}`;
    return `Until ${fmt(to!)}`;
  }

  const hasPeriodFilter = Boolean(periodFrom || periodTo);
  // With a period chip applied the line must not claim "all time" — the chip
  // itself states the exact range, this only states the account scope.
  const scopeLine = hasPeriodFilter
    ? "Searching all accounts"
    : "Searching everything · all accounts, all time";

  // The collapsed tips line's own data — computed here (not inline in the
  // JSX) so `!loading` and a `key={tipsLineCategory}` remount can both gate
  // on the same `tips` value. Three mutually exclusive paths:
  //   - a single category filter active with nothing else narrowing the
  //     scope (no multi-category deep link, no merchant filter, no
  //     free-text search) — the original "category tap from Spend" case,
  //     UNCHANGED from before: every open tip in the category.
  //   - category AND merchants both active (HomeInsightSpotlight's
  //     category+merchant-evidence deep link, e.g. `?category=Bills&
  //     merchants=Ee Ltd&tip=…`) — the merchants narrow the payment LIST,
  //     but the tips line still keys off the category; `?tip=` must match
  //     one of that category's own open tips, and when it does, `tips` is
  //     just that one insight (not every category tip — the merchants scope
  //     signals "this one tip's evidence", not "browse the whole category").
  //     No `tip` match (or no `tip` at all) suppresses the line entirely
  //     rather than guessing.
  //   - no category filter but a merchants filter IS active and `?tip=`
  //     names an insight whose own merchant evidence matches one of those
  //     merchants (HomeInsightSpotlight's merchants-only deep link) —
  //     `tips` is just that one insight, so TipsLine's single-tip path
  //     unfolds straight to its detail.
  // `insights` starts empty and resolves after mount (see the fetch effect
  // above); computing `tips`/`tipsLineCategory` fresh on every render
  // (rather than once at mount) is what makes them reflect that resolution
  // instead of freezing on the empty initial state.
  const { tips, tipsLineCategory } = ((): { tips: SavingsInsight[]; tipsLineCategory: string | null } => {
    if (categoriesFilter && categoriesFilter.length > 0) return { tips: [], tipsLineCategory: null };
    if (searchQuery) return { tips: [], tipsLineCategory: null };
    if (categoryFilter) {
      if (merchantsFilter && merchantsFilter.length > 0) {
        if (!tipParam) return { tips: [], tipsLineCategory: null };
        const matched = openTipsFor(categoryFilter, insights).filter((t) => t.id === tipParam);
        if (matched.length === 0) return { tips: [], tipsLineCategory: null };
        return { tips: matched, tipsLineCategory: categoryFilter };
      }
      return { tips: openTipsFor(categoryFilter, insights), tipsLineCategory: categoryFilter };
    }
    if (merchantsFilter && merchantsFilter.length > 0) {
      const matched = tipsForMerchants(merchantsFilter, insights, tipParam);
      if (matched.length === 0) return { tips: [], tipsLineCategory: null };
      return { tips: matched, tipsLineCategory: matched[0].triggered_by?.[0]?.display_name ?? merchantsFilter[0] };
    }
    return { tips: [], tipsLineCategory: null };
  })();

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8 lg:max-w-2xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Sticky back header — same convention as ReceiptsPage.tsx (the app's
          other single-column drill-in): pinned via `sticky top-0 z-10` with
          a translucent page-background fill + backdrop-blur so scrolled
          content passes beneath it, not through it. Previously part of the
          same scrolling block as the transaction list, so Back scrolled
          away with the content (owner's phone report, 2026-08-30). */}
      <div className="sticky top-0 z-10 bg-[#f0f2f7]/90 dark:bg-[#0f172a]/90 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/60">
        <div className="px-4 pt-6 pb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="w-11 h-11 flex items-center justify-center rounded-full glass-tile flex-shrink-0 active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} className="text-slate-500 dark:text-slate-400" />
          </button>
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
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search transactions…"
            className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 min-h-[28px] flex-wrap">
          <p className="text-[11px] text-slate-600 dark:text-slate-400">{scopeLine}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(categoryFilter || (categoriesFilter && categoriesFilter.length > 0)) && (
              <button
                type="button"
                onClick={clearCategoryFilter}
                aria-label={`Remove ${categoryLabel ?? categoryFilter ?? categoriesFilter!.join(", ")} filter`}
                className="flex-shrink-0 inline-flex items-center gap-1 min-h-[28px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-[11px] font-semibold active:opacity-70 transition-opacity"
              >
                {categoryLabel ?? categoryFilter ?? categoriesFilter!.join(", ")}
                <X size={10} />
              </button>
            )}
            {merchantsFilter && merchantsFilter.length > 0 && (
              <button
                type="button"
                onClick={clearMerchantsFilter}
                aria-label={`Remove ${merchantsFilter.join(", ")} filter`}
                className="flex-shrink-0 inline-flex items-center gap-1 min-h-[28px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 text-[11px] font-semibold active:opacity-70 transition-opacity"
              >
                {merchantsFilter[0]}
                {merchantsFilter.length > 1 && ` +${merchantsFilter.length - 1}`}
                <X size={10} />
              </button>
            )}
            {hasPeriodFilter && (
              <button
                type="button"
                onClick={clearPeriodFilter}
                aria-label="Remove period filter, widen to all history"
                className="flex-shrink-0 inline-flex items-center gap-1 min-h-[28px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-[11px] font-semibold active:opacity-70 transition-opacity"
              >
                {formatPeriodChip(periodFrom, periodTo)}
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        {/* Mounted only once `tips` is non-empty AND the list itself has
            settled (`!loading`) — never inserted above a payments list that
            has already painted, and never mounted against the pre-fetch
            empty `insights` array (that used to compute an empty `tips`
            once at mount and stay that way: `?tip=` deep links and the
            line's own initial-open state were decided before the fetch
            resolved and never re-evaluated). `key={categoryFilter}` forces
            a fresh instance on every category change, so a stale open/
            notified-tips strip from the PREVIOUS category can never carry
            over onto the new one. */}
        {tips.length > 0 && !loading && (
          <div className="mt-1">
            <TipsLine
              key={tipsLineCategory}
              category={tipsLineCategory!}
              tips={tips}
              initialOpenTipId={tipParam ?? undefined}
              onTipOpened={(id) => api.markInsightOpened(id).catch(() => {})}
            />
          </div>
        )}
      </div>

      <div className="px-4 pt-2 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={32} />
          </div>
        ) : (
          <>
            <div
              className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden"
              onTouchStart={(e) => {
                swipeTouchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              }}
              onTouchEnd={(e) => {
                if (!swipeTouchStart.current || totalPages <= 1) return;
                const dx = e.changedTouches[0].clientX - swipeTouchStart.current.x;
                const dy = e.changedTouches[0].clientY - swipeTouchStart.current.y;
                swipeTouchStart.current = null;
                if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
                if (dx < 0 && page < totalPages) setPage((p) => p + 1);
                if (dx > 0 && page > 1) setPage((p) => p - 1);
              }}
            >
              {items.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {searchQuery || categoryFilter || (categoriesFilter && categoriesFilter.length > 0) || merchantsFilter
                      ? `No payments matching ${searchQuery ? `"${searchQuery}"` : (categoryLabel ?? categoryFilter ?? (categoriesFilter && categoriesFilter.length > 0 ? categoriesFilter.join(", ") : merchantsFilter!.join(", ")))}`
                      : hasPeriodFilter
                        ? "No payments in this period"
                        : "No payments yet"}
                  </p>
                  {hasPeriodFilter && (
                    <button
                      type="button"
                      onClick={clearPeriodFilter}
                      className="mt-2 inline-flex items-center gap-0.5 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
                    >
                      Widen to all history
                      <ChevronRight size={14} className="flex-shrink-0" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-slate-50 dark:divide-slate-700">
                  {items.map((tx) => (
                    <TransactionRow key={tx.id} transaction={tx} onClick={() => setSelectedTx(tx)} />
                  ))}
                </div>
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 py-2">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 active:scale-95 transition-transform"
                >
                  <ChevronLeft size={16} className="flex-shrink-0" aria-hidden="true" />
                  Prev
                </button>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {page} / {totalPages} · {total} total
                </span>
                <button
                  type="button"
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 active:scale-95 transition-transform"
                >
                  Next
                  <ChevronRight size={16} className="flex-shrink-0" aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selectedTx && (
        <TeachingSheet
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
          onUpdated={handleTxUpdated}
        />
      )}

      <BottomNav />
    </div>
  );
}
