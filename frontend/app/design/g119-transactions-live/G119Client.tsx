"use client";

// G119 — Transactions round, take two, on real data with real pagination.
//
// Replaces G92 (app/design/transactions-canvas-before-cards), which failed
// its own brief: every row was a <button> toggling one GROUP-level panel
// with a fixed teaching sentence (a false affordance), A/B/C were barely
// distinguishable at 390px, and the preview never exercised real depth or
// pagination. This round fixes all three:
//   - date groupings kept (Kevin's own feedback on G92)
//   - tapping a row opens THAT transaction's real detail with the ability
//     to change it (DetailPanel.tsx — a faithful, non-mutating port of the
//     real TeachingSheet.tsx fork logic, never a popup/group toggle)
//   - driven by the real backend (dataSource.ts calls the exact
//     api.transactionsSearch TransactionsPage.tsx already uses), read-only,
//     session-scoped, with a synthetic fixture fallback when signed out
//
//   /design/g119-transactions-live?variant=a|b|c&mode=light|dark
//   /design/g119-transactions-live?variant=a&state=long&mode=dark  (forced
//     fixture states for deterministic review — never touches the network)
//
// Variant summary (each genuinely different AT 390px, not just desktop):
//   A — day-group cards + page-based Prev/Next pager, row tap opens a
//       bottom sheet. Closest to today's production shape.
//   B — day-group cards + infinite scroll (auto + manual "Load more"), row
//       tap expands that row in place (accordion), no overlay. A "Back to
//       top" pill appears once scrolled past the fold.
//   C — day-group cards + manual "Load more" only (cursor cadence, see
//       dataSource.ts/VariantC.tsx), row tap replaces the whole screen with
//       a dedicated full-bleed detail screen carrying an "Apply to" scope
//       control (ported from TransactionSheet.tsx) that makes one real
//       read call (GET /transactions/{id}/similar) against live data.
//
// Read-only / session-scoped guarantee: see dataSource.ts's own docstring.
// This file and every file it imports contain zero calls to
// api.patchTransaction / api.resolveMovement / api.addRule / any other
// mutating api.* function — grep app/design/g119-transactions-live for
// "patchTransaction|resolveMovement|addRule|deleteRule" to verify.
//
// UAT-review revision (Kevin, after seeing the merged preview):
//   1. Variant A's row now shows the real category icon instead of the
//      colour bar (VariantA.tsx) — B/C keep the bar for comparison.
//   2. The filter control ("that three-line thing") is back — a
//      SlidersHorizontal button opening FilterSheet.tsx — and it now
//      genuinely filters (the old G92 preview's version never did; see
//      FilterSheet.tsx's own docstring for why account-scope isn't one of
//      its dimensions).
//   3. Deep-linked filters (?category=/?categories=/?label=/?merchants=/
//      ?from=/?to=/?txn_type=, the same params TransactionsPage.tsx reads)
//      now seed this same filter state and render as the same removable
//      chips a user-applied filter renders as — one code path, so a filter
//      that arrived from another page is indistinguishable from one set
//      here. Chip grouping is ported verbatim from TransactionsPage.tsx:
//      category + categoryLabel + txnType clear together as ONE unit (a
//      multi-category deep link always carries a direction with it),
//      merchants and the date window are each independently removable.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Account } from "@/lib/api";
import { getAccountsCached } from "@/lib/accountsCache";
import { FIXTURE_EMPTY, FIXTURE_LONG, FIXTURE_POPULATED } from "./fixtures";
import type { SearchFilters } from "./dataSource";
import { hasActiveFilters } from "./dataSource";
import { FilterChips, FilterTrigger } from "./FilterChips";
import FilterSheet, { draftFromFilters, type FilterDraft } from "./FilterSheet";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";
type ReviewState = "auto" | "populated" | "long" | "empty" | "loading";

const VARIANTS: { value: Variant; label: string }[] = [
  { value: "a", label: "A · Sheet" },
  { value: "b", label: "B · Inline" },
  { value: "c", label: "C · Full screen" },
];
const STATES: { value: ReviewState; label: string }[] = [
  { value: "auto", label: "Live/fixture" },
  { value: "populated", label: "Populated" },
  { value: "long", label: "Long list" },
  { value: "empty", label: "Empty" },
  { value: "loading", label: "Loading" },
];

function Switcher({
  variant, state, mode, filterQuery,
}: {
  variant: Variant; state: ReviewState; mode: Mode;
  // Every non-switcher param (category/categories/label/merchants/from/to/
  // txn_type) as an already-encoded querystring fragment (no leading `?`
  // or `&`) — carried through every switcher link so changing variant/
  // state/mode never silently drops an active filter, deep-linked or
  // user-applied.
  filterQuery: string;
}) {
  const href = (v: Variant, s: ReviewState, m: Mode) =>
    `?variant=${v}&state=${s}&mode=${m}${filterQuery ? `&${filterQuery}` : ""}`;
  const base = "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full px-3.5 text-[11px] font-semibold transition-colors active:scale-95";
  return (
    <nav
      aria-label="Preview controls"
      className="fixed inset-x-0 bottom-3 z-50 mx-auto flex max-w-[calc(100vw-16px)] flex-nowrap gap-1 overflow-x-auto rounded-2xl bg-slate-900/95 p-1.5 shadow-xl"
    >
      {VARIANTS.map((v) => (
        <Link
          key={v.value}
          href={href(v.value, state, mode)}
          className={`${base} ${v.value === variant ? "bg-indigo-600 text-white" : "text-slate-200 hover:bg-slate-800"}`}
        >
          {v.label}
        </Link>
      ))}
      {STATES.map((s) => (
        <Link
          key={s.value}
          href={href(variant, s.value, mode)}
          className={`${base} ${s.value === state ? "bg-slate-700 text-white" : "text-slate-200 hover:bg-slate-800"}`}
        >
          {s.label}
        </Link>
      ))}
      <Link href={href(variant, state, mode === "dark" ? "light" : "dark")} className={`${base} text-slate-200 hover:bg-slate-800`}>
        {mode === "dark" ? "Light" : "Dark"}
      </Link>
    </nav>
  );
}

export default function G119Client() {
  const params = useSearchParams();
  const router = useRouter();
  const variant: Variant = (["a", "b", "c"] as string[]).includes(params.get("variant") ?? "")
    ? (params.get("variant") as Variant)
    : "a";
  const state: ReviewState = (["auto", "populated", "long", "empty", "loading"] as string[]).includes(params.get("state") ?? "")
    ? (params.get("state") as ReviewState)
    : "auto";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);

  // Deep-linked filter state — the exact same param names and shapes
  // TransactionsPage.tsx reads (?category=/?categories=/?label=/
  // ?merchants=/?from=/?to=/?txn_type=), re-seeded whenever `params`
  // changes (App Router keeps this component instance alive across
  // client-side param-only navigations, same reasoning as
  // TransactionsPage.tsx's own re-seed effect below). A filter applied
  // through FilterSheet writes into this SAME state via the URL, so a
  // deep-linked filter and a user-applied one are one code path, not two.
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [categoriesFilter, setCategoriesFilter] = useState<string[] | null>(null);
  const [categoryLabel, setCategoryLabel] = useState<string | null>(null);
  const [merchantsFilter, setMerchantsFilter] = useState<string[] | null>(null);
  const [periodFrom, setPeriodFrom] = useState<string | null>(null);
  const [periodTo, setPeriodTo] = useState<string | null>(null);
  const [txnType, setTxnType] = useState<"debit" | "credit" | null>(null);

  useEffect(() => {
    setCategoryFilter(params.get("category"));
    const cats = params.getAll("categories");
    setCategoriesFilter(cats.length > 0 ? cats : null);
    setCategoryLabel(params.get("label"));
    const raw = params.get("merchants");
    const names = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    setMerchantsFilter(names.length > 0 ? names : null);
    setPeriodFrom(params.get("from"));
    setPeriodTo(params.get("to"));
    const t = params.get("txn_type");
    setTxnType(t === "debit" || t === "credit" ? t : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
  }, [mode]);

  useEffect(() => {
    // Read-only, tolerant of failure — same pattern
    // app/transactions/TransactionsPage.tsx uses to resolve the bank badge
    // in the detail sheet. Never fetched when a forced fixture state is
    // active (accounts stay empty; DetailPanel already renders fine
    // without an `account` prop, same as TeachingSheet does today).
    if (state !== "auto") return;
    getAccountsCached().then(setAccounts).catch(() => {});
  }, [state]);

  // `null` here means "attempt the real backend"; any non-null array forces
  // that fixture and skips the network entirely (dataSource.ts).
  const forcedFixture =
    state === "populated" ? FIXTURE_POPULATED
    : state === "long" ? FIXTURE_LONG
    : state === "empty" ? FIXTURE_EMPTY
    : state === "loading" ? FIXTURE_LONG // never actually reaches a resolved fetch below
    : null;

  const VariantComponent = variant === "a" ? VariantA : variant === "b" ? VariantB : VariantC;

  const filters: SearchFilters = {
    category: categoryFilter,
    categories: categoriesFilter,
    merchants: merchantsFilter,
    from: periodFrom,
    to: periodTo,
    txnType,
  };

  // Rebuilds the URL from whichever filter state remains, always keeping
  // variant/state/mode — the same "rebuild from overrides, keep everything
  // else" shape as TransactionsPage.tsx's own urlFor, extended with this
  // preview's own switcher params so applying/clearing a filter never
  // knocks the reviewer back to variant A / light mode.
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
    const qs = new URLSearchParams();
    qs.set("variant", variant);
    qs.set("state", state);
    qs.set("mode", mode);
    if (cats && cats.length > 0) {
      for (const c of cats) qs.append("categories", c);
    } else if (cat) {
      qs.set("category", cat);
    }
    if (merch && merch.length > 0) qs.set("merchants", merch.join(","));
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (label) qs.set("label", label);
    if (tt) qs.set("txn_type", tt);
    return `?${qs.toString()}`;
  }

  // Category + label + txn_type are one filter unit — mirrors
  // TransactionsPage.tsx's clearCategoryFilter exactly: a multi-category
  // deep link always carries a direction alongside it, so the chip's X
  // clears all three together rather than leaving a stuck scope behind.
  function clearCategoryFilter() {
    router.replace(urlFor({ category: null, categories: null, label: null, txnType: null }));
  }
  function clearMerchantsFilter() {
    router.replace(urlFor({ merchants: null }));
  }
  function clearPeriodFilter() {
    router.replace(urlFor({ from: null, to: null }));
  }
  function clearAllFilters() {
    router.replace(urlFor({ category: null, categories: null, label: null, txnType: null, merchants: null, from: null, to: null }));
    setFilterOpen(false);
  }

  // FilterSheet applies one merged draft (category/merchant/date/direction
  // all at once, "Show results") rather than one param at a time — still
  // funnelled through the same urlFor/router.replace path, so the result
  // is indistinguishable from a deep link carrying the same combination.
  function applyFilterDraft(draft: FilterDraft) {
    const cats = draft.categories;
    const merch = draft.merchant.split(",").map((s) => s.trim()).filter(Boolean);
    router.replace(urlFor({
      category: cats.length === 1 ? cats[0] : null,
      categories: cats.length > 1 ? cats : null,
      label: null,
      merchants: merch.length > 0 ? merch : null,
      from: draft.from,
      to: draft.to,
      txnType: draft.txnType,
    }));
    setFilterOpen(false);
  }

  const filtersActive = hasActiveFilters(filters);

  // The active filter, as a querystring fragment WITHOUT variant/state/
  // mode — handed to Switcher so its variant/state/mode links carry the
  // filter forward instead of silently dropping it (urlFor always sets
  // variant/state/mode itself, so this strips just those three keys back
  // out rather than duplicating the field list a second time).
  const filterQueryParams = new URLSearchParams(urlFor({}).slice(1));
  filterQueryParams.delete("variant");
  filterQueryParams.delete("state");
  filterQueryParams.delete("mode");
  const filterQuery = filterQueryParams.toString();

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-56">
        <main className="mx-auto max-w-2xl px-4 py-8">
          <header className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">
                Every payment
              </p>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50">Transactions</h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-snug">
                Grouped by day. Tap a payment to see it, and change it.
              </p>
            </div>
            <FilterTrigger active={filtersActive} onOpen={() => setFilterOpen(true)} variant="solid" />
          </header>

          {/* Active-filter chips — one code path for deep-linked and
              user-applied filters (both just write into the same state via
              the URL), so a filter that arrived from another page renders
              exactly like one set here. Grouping matches
              TransactionsPage.tsx: category+label+txn_type clear together,
              merchants and the date window are each independently
              removable. Rendered via the shared FilterChips
              (treatment="legacy") extracted for the G119 filter-pill round
              — same markup and classes as before this extraction, byte for
              byte, since this is the reference Kevin is comparing his pick
              against and must keep showing the defect he flagged. */}
          <FilterChips
            filters={filters}
            categoryLabel={categoryLabel}
            onClearCategory={clearCategoryFilter}
            onClearDirection={() => router.replace(urlFor({ txnType: null }))}
            onClearMerchants={clearMerchantsFilter}
            onClearPeriod={clearPeriodFilter}
            treatment="legacy"
            className="mb-4"
          />

          {state === "loading" ? (
            <div className="space-y-3" aria-label="Loading transactions">
              <div className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
              <div className="h-40 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
              <div className="h-32 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
            </div>
          ) : (
            <VariantComponent key={`${variant}-${state}`} forcedFixture={forcedFixture} accounts={accounts} filters={filters} />
          )}
        </main>
        <Switcher variant={variant} state={state} mode={mode} filterQuery={filterQuery} />
        {filterOpen && (
          <FilterSheet
            initial={draftFromFilters(filters)}
            onApply={applyFilterDraft}
            onClearAll={clearAllFilters}
            onClose={() => setFilterOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
