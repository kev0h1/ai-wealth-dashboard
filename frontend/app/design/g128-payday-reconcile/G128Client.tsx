"use client";

// TEMPORARY PREVIEW. G128 fixes the Payday Plan card's arithmetic-looking
// confusion Kevin read against his real 2026-09-18 payload: the hero total
// and the payday-split line come from two disjoint datasets (internal
// account transfers vs bills that debit the salary account on payday
// itself) but both said "moves", and the settled accounts showed bare
// names with no amount. See CLAUDE.md's G128 brief for the full defect
// writeup. No API requests, no production data is mutated.
//
// /design/g128-payday-reconcile?view=baseline|a|b&state=kevin|covered|set|nosplit&mode=light|dark

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Baseline from "./Baseline";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import { FIXTURES } from "./fixtures";
import type { FixtureState } from "./fixtures";

type View = "baseline" | "a" | "b";
type Mode = "light" | "dark";

const VIEWS: { key: View; label: string }[] = [
  { key: "baseline", label: "Today" },
  { key: "a", label: "A · Grammar fix" },
  { key: "b", label: "B · Labelled blocks" },
];

const STATES: { key: FixtureState; label: string; disabled?: View[] }[] = [
  { key: "kevin", label: "Kevin's real payload" },
  { key: "covered", label: "Covered, not trimmed", disabled: ["baseline"] },
  { key: "set", label: "Nothing to move", disabled: ["baseline"] },
  { key: "nosplit", label: "No payday split", disabled: ["baseline"] },
];

function hrefFor(view: View, state: FixtureState, mode: Mode) {
  // Baseline only ever shows Kevin's real payload (the honest "today"
  // reference); switching to it always resets state to kevin.
  const effectiveState = view === "baseline" ? "kevin" : state;
  return `?view=${view}&state=${effectiveState}&mode=${mode}`;
}

function PreviewControls({ view, state, mode }: { view: View; state: FixtureState; mode: Mode }) {
  const linkClass =
    "touch-manipulation [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-reduce:transition-none";

  return (
    <nav aria-label="Design preview controls" className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 shadow-xl">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-center gap-1">
          {VIEWS.map((item) => (
            <a
              key={item.key}
              href={hrefFor(item.key, state, mode)}
              aria-current={item.key === view ? "page" : undefined}
              className={`grid min-h-11 place-items-center rounded-xl px-3 text-xs font-bold ${linkClass} ${item.key === view ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"}`}
            >
              {item.label}
            </a>
          ))}
          <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
          <a
            href={hrefFor(view, state, mode === "dark" ? "light" : "dark")}
            className={`flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold text-slate-300 hover:text-white ${linkClass}`}
          >
            {mode === "dark" ? "Light" : "Dark"}
          </a>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1 border-t border-white/10 pt-1">
          {STATES.map((item) => {
            const isDisabled = item.disabled?.includes(view);
            return (
              <a
                key={item.key}
                href={isDisabled ? undefined : hrefFor(view, item.key, mode)}
                aria-current={item.key === state && !isDisabled ? "page" : undefined}
                aria-disabled={isDisabled}
                className={`flex min-h-11 items-center rounded-xl px-2.5 text-[11px] font-semibold ${linkClass} ${
                  isDisabled
                    ? "pointer-events-none text-slate-600"
                    : item.key === state
                      ? "bg-white/15 text-white"
                      : "text-slate-300 hover:text-white"
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

export default function G128Client() {
  const params = useSearchParams();
  const rawView = params.get("view") ?? params.get("variant");
  const view: View = rawView === "a" || rawView === "b" ? rawView : "baseline";
  const rawState = params.get("state");
  const state: FixtureState =
    view === "baseline" ? "kevin" : rawState === "covered" || rawState === "set" || rawState === "nosplit" ? rawState : "kevin";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  const item = FIXTURES[state];

  return (
    <div data-g128-preview-root data-view={view} data-state={state} className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <a
        href="#g128-preview"
        className="sr-only z-[80] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Skip to payday plan previews
      </a>
      <main id="g128-preview" tabIndex={-1} className="min-h-dvh scroll-pb-40 bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 selection:text-slate-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40 dark:selection:text-white">
        <div className="mx-auto w-full max-w-[600px] px-4 pb-40 pt-7 sm:px-6 sm:pt-10">
          <header className="text-center">
            <h1 className="text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white sm:text-2xl">
              Payday plan: fixing the arithmetic-looking confusion
            </h1>
            <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">
              The hero total and the payday-split line come from two disjoint datasets. Both variants name them differently and never let
              them look like they add up to one sum.
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Preview only. No bank data or preferences are changed.</p>
          </header>
          <div className="mt-7 sm:mt-9">
            {view === "baseline" ? <Baseline item={item} /> : null}
            {view === "a" ? <VariantA item={item} /> : null}
            {view === "b" ? <VariantB item={item} /> : null}
          </div>
        </div>
      </main>
      <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
        <PreviewControls view={view} state={state} mode={mode} />
      </div>
    </div>
  );
}
