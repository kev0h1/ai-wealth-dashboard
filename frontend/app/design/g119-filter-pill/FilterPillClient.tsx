"use client";

// G119 filter-pill round — the follow-up Kevin asked for after approving
// variant A's category icons on g119-transactions-live but rejecting how
// the active-filter pill looks there: bg-slate-100 (#f1f5f9) measures
// ~1.02:1 against the #f0f2f7 canvas token, so the pill reads as
// invisible, and the solid indigo-600 round trigger next to it borrows
// Penny's FAB silhouette.
//
// This is a genuine gate, not a copy: it imports g119-transactions-live's
// OWN VariantA (real category icons, real day-groups, real pagination),
// FilterSheet (the real filter form) and dataSource (the real read-only
// fetchTransactionsPage, GET-only, session-scoped, fixture fallback when
// signed out — see dataSource.ts's own docstring for the guarantee) and
// renders three different active-filter treatments through the SAME
// FilterChips.tsx / FilterBar this route shares with g119-transactions-
// live, on real rows at real density. g119-transactions-live itself keeps
// rendering treatment="legacy" (Kevin's flagged defect, unchanged) so the
// reference he's comparing against still shows what he rejected.
//
// Three genuinely different answers to "how does an active filter
// announce itself", not three shades of one pill:
//   A — selected-state tint: reuses Sidebar.tsx's own active-nav
//       vocabulary (indigo-50 fill + indigo text) for the chip, plus an
//       indigo-500/400 hairline (indigo-50 alone measures ~1.0:1 against
//       this canvas, no better than the bug — the hairline is what
//       actually supplies the boundary). Trigger demoted to a hairline
//       ghost control with a small active dot, never a solid puck.
//   B — surface + hairline: the chip becomes the app's real card
//       material, white / #1e293b fill with a hairline border and
//       shadow-sm, the same pattern every other "this is an object" on
//       this canvas already uses. Trigger demoted likewise.
//   C — a filter bar: trigger, chips and "Clear all" become one bounded
//       strip (FilterBar) instead of a loose chip cloud sitting under a
//       separate solid puck, so the "two places saying one thing"
//       problem is solved structurally. With no filters active there is
//       nothing for a strip to announce, so the header falls back to the
//       same idle ghost trigger A/B use.
//
// ?variant=a|b|c            which treatment
// ?state=zero|one|three      how many filters are pre-seeded (exercises
//                            wrapping at three, the idle trigger at zero)
// ?data=auto|fixture        auto (default) attempts the real signed-in
//                            fetch and falls back to fixtures on any
//                            failure, exactly like g119-transactions-live;
//                            fixture forces the synthetic set so a
//                            screenshot never depends on who is signed in
// ?mode=light|dark
//
// Read-only / session-scoped guarantee: identical to g119-transactions-
// live, inherited structurally by importing the same dataSource.ts and
// VariantA.tsx rather than building a new fetch path. This file adds no
// api.* call of its own beyond the same getAccountsCached() ready-only
// lookup G119Client.tsx already makes.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Account } from "@/lib/api";
import { getAccountsCached } from "@/lib/accountsCache";
import { FIXTURE_POPULATED } from "../g119-transactions-live/fixtures";
import type { SearchFilters } from "@/lib/transactionFilters";
import { EMPTY_FILTERS } from "@/lib/transactionFilters";
import VariantA from "../g119-transactions-live/VariantA";
// Every treatment/trigger this round compares now comes from the
// PRODUCTION components (folded in once Kevin approved treatment "tint" /
// the ghost trigger) rather than a preview-local copy, so a screenshot
// here is a screenshot of the real shipped markup, not a fork that could
// quietly drift from it.
import FilterSheet, { draftFromFilters, type FilterDraft } from "@/components/TransactionFilterSheet";
import { FilterChips, FilterTrigger, FilterBar } from "@/components/TransactionFilterChips";

type Treatment = "a" | "b" | "c";
type Mode = "light" | "dark";
type ReviewState = "zero" | "one" | "three";
type DataMode = "auto" | "fixture";

const TREATMENTS: { value: Treatment; label: string }[] = [
  { value: "a", label: "A · Tint" },
  { value: "b", label: "B · Surface" },
  { value: "c", label: "C · Bar" },
];
const STATES: { value: ReviewState; label: string }[] = [
  { value: "zero", label: "0 active" },
  { value: "one", label: "1 active" },
  { value: "three", label: "3 active" },
];

// Same isoDaysAgo shape FilterSheet.tsx's own date presets use, so the
// period chip's lower bound is always "N days before whenever this is
// screenshotted" rather than a calendar date that ages out of
// FIXTURE_POPULATED's own 6-day window (fixtures.ts builds its dates as
// isoDaysAgo(0..5) relative to today).
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// State filter combinations, keyed off real fixture category/merchant
// names (fixtures.ts's own MERCHANTS list) so "three active" produces
// real, readable chip text over real matching rows, not an empty result.
// "Eating Out" + "Deliveroo" both recur inside FIXTURE_POPULATED's 6-day
// span, so the combination always has at least one row to show under the
// chips, the same "real rows, real density" the brief asks for.
function buildStateFilters(): Record<ReviewState, SearchFilters> {
  return {
    zero: EMPTY_FILTERS,
    one: { ...EMPTY_FILTERS, category: "Eating Out" },
    three: { ...EMPTY_FILTERS, category: "Eating Out", merchants: ["Deliveroo"], from: isoDaysAgo(6), to: null },
  };
}

function Switcher({
  variant, state, mode,
}: { variant: Treatment; state: ReviewState; mode: Mode }) {
  const href = (v: Treatment, d: ReviewState, m: Mode) => `?variant=${v}&state=${d}&mode=${m}`;
  const base = "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full px-3.5 text-[11px] font-semibold transition-colors active:scale-95";
  return (
    <nav
      aria-label="Preview controls"
      className="fixed inset-x-0 bottom-3 z-50 mx-auto flex max-w-[calc(100vw-16px)] flex-nowrap gap-1 overflow-x-auto rounded-2xl bg-slate-900/95 p-1.5 shadow-xl"
    >
      {TREATMENTS.map((v) => (
        <Link key={v.value} href={href(v.value, state, mode)} className={`${base} ${v.value === variant ? "bg-indigo-600 text-white" : "text-slate-100 hover:bg-slate-800"}`}>
          {v.label}
        </Link>
      ))}
      {STATES.map((d) => (
        <Link key={d.value} href={href(variant, d.value, mode)} className={`${base} ${d.value === state ? "bg-slate-700 text-white" : "text-slate-100 hover:bg-slate-800"}`}>
          {d.label}
        </Link>
      ))}
      <Link href={href(variant, state, mode === "dark" ? "light" : "dark")} className={`${base} text-slate-100 hover:bg-slate-800`}>
        {mode === "dark" ? "Light" : "Dark"}
      </Link>
    </nav>
  );
}

export default function FilterPillClient() {
  const params = useSearchParams();
  const variant: Treatment = (["a", "b", "c"] as string[]).includes(params.get("variant") ?? "")
    ? (params.get("variant") as Treatment)
    : "a";
  const state: ReviewState = (["zero", "one", "three"] as string[]).includes(params.get("state") ?? "")
    ? (params.get("state") as ReviewState)
    : "one";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const dataMode: DataMode = params.get("data") === "fixture" ? "fixture" : "auto";

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>(buildStateFilters()[state]);
  const [categoryLabel, setCategoryLabel] = useState<string | null>(null);

  // Re-seed the state preset whenever the switcher changes it — the same
  // "params drive state" shape G119Client.tsx uses for its own deep-link
  // re-seed, so navigating the switcher always lands on a clean, known
  // filter combination rather than carrying over whatever FilterSheet left
  // behind.
  useEffect(() => {
    setFilters(buildStateFilters()[state]);
    setCategoryLabel(null);
  }, [state]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
  }, [mode]);

  useEffect(() => {
    // Read-only, tolerant of failure — identical pattern to
    // G119Client.tsx. Never fetched when the fixture data mode is forced.
    if (dataMode !== "auto") return;
    getAccountsCached().then(setAccounts).catch(() => {});
  }, [dataMode]);

  const forcedFixture = dataMode === "fixture" ? FIXTURE_POPULATED : null;
  const filtersActive = Boolean(
    filters.category || (filters.categories && filters.categories.length > 0) ||
    (filters.merchants && filters.merchants.length > 0) || filters.from || filters.to || filters.txnType,
  );

  function clearCategory() {
    setFilters((f) => ({ ...f, category: null, categories: null, txnType: null }));
    setCategoryLabel(null);
  }
  function clearDirection() {
    setFilters((f) => ({ ...f, txnType: null }));
  }
  function clearMerchants() {
    setFilters((f) => ({ ...f, merchants: null }));
  }
  function clearPeriod() {
    setFilters((f) => ({ ...f, from: null, to: null }));
  }
  function clearAll() {
    setFilters(EMPTY_FILTERS);
    setCategoryLabel(null);
    setFilterOpen(false);
  }
  function applyFilterDraft(draft: FilterDraft) {
    const merch = draft.merchant.split(",").map((s) => s.trim()).filter(Boolean);
    setFilters({
      category: draft.categories.length === 1 ? draft.categories[0] : null,
      categories: draft.categories.length > 1 ? draft.categories : null,
      merchants: merch.length > 0 ? merch : null,
      from: draft.from,
      to: draft.to,
      txnType: draft.txnType,
    });
    setCategoryLabel(null);
    setFilterOpen(false);
  }

  const chipHandlers = {
    filters,
    categoryLabel,
    onClearCategory: clearCategory,
    onClearDirection: clearDirection,
    onClearMerchants: clearMerchants,
    onClearPeriod: clearPeriod,
  };

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
            {variant !== "c" && (
              <FilterTrigger active={filtersActive} onOpen={() => setFilterOpen(true)} variant="ghost" />
            )}
            {variant === "c" && !filtersActive && (
              <FilterTrigger active={false} onOpen={() => setFilterOpen(true)} variant="ghost" />
            )}
          </header>

          {variant === "a" && (
            <FilterChips {...chipHandlers} onClearAll={clearAll} treatment="tint" className="mb-4" />
          )}
          {variant === "b" && (
            <FilterChips {...chipHandlers} onClearAll={clearAll} treatment="surface" className="mb-4" />
          )}
          {variant === "c" && filtersActive && (
            <FilterBar {...chipHandlers} onClearAll={clearAll} onOpenFilters={() => setFilterOpen(true)} className="mb-4" />
          )}

          <VariantA forcedFixture={forcedFixture} accounts={accounts} filters={filters} />
        </main>
        <Switcher variant={variant} state={state} mode={mode} />
        {filterOpen && (
          <FilterSheet
            initial={draftFromFilters(filters)}
            onApply={applyFilterDraft}
            onClearAll={clearAll}
            onClose={() => setFilterOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
