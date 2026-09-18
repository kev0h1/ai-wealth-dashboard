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

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Account } from "@/lib/api";
import { getAccountsCached } from "@/lib/accountsCache";
import { FIXTURE_EMPTY, FIXTURE_LONG, FIXTURE_POPULATED } from "./fixtures";
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

function Switcher({ variant, state, mode }: { variant: Variant; state: ReviewState; mode: Mode }) {
  const href = (v: Variant, s: ReviewState, m: Mode) => `?variant=${v}&state=${s}&mode=${m}`;
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
  const variant: Variant = (["a", "b", "c"] as string[]).includes(params.get("variant") ?? "")
    ? (params.get("variant") as Variant)
    : "a";
  const state: ReviewState = (["auto", "populated", "long", "empty", "loading"] as string[]).includes(params.get("state") ?? "")
    ? (params.get("state") as ReviewState)
    : "auto";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  const [accounts, setAccounts] = useState<Account[]>([]);

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

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-56">
        <main className="mx-auto max-w-2xl px-4 py-8">
          <header className="mb-5">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">
              Every payment
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50">Transactions</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-snug">
              Grouped by day. Tap a payment to see it, and change it.
            </p>
          </header>
          {state === "loading" ? (
            <div className="space-y-3" aria-label="Loading transactions">
              <div className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
              <div className="h-40 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
              <div className="h-32 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
            </div>
          ) : (
            <VariantComponent key={`${variant}-${state}`} forcedFixture={forcedFixture} accounts={accounts} />
          )}
        </main>
        <Switcher variant={variant} state={state} mode={mode} />
      </div>
    </div>
  );
}
