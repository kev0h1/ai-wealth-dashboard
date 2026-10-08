"use client";

// TEMPORARY PREVIEW. G228 (Kevin picked A, 2026-10-07): easing a goal plan for
// one pay period. This page renders the PRODUCTION PlanEasingCard and
// PlanEasingSheet (and the production MoveCard above them) through real props.
// Fixtures stand in for the server: a `services` object answers the sheet's
// ease-preview and ease calls, so nothing is fetched or saved.
//
// /design/plan-deferral?state=eligible|capped|deferred&mode=light|dark[&sheet=open]

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MoveCard, PlanEasingCard } from "@/components/HomeBrief";
import { paymentItem } from "../allocation-shortfall/fixtures";
import { planEasingItem, previewServices, type EaseState } from "./fixtures";

type Mode = "light" | "dark";
const STATES: { key: EaseState; label: string }[] = [
  { key: "eligible", label: "Eligible" }, { key: "capped", label: "Capped" }, { key: "deferred", label: "Deferred" },
];
const chip = (active: boolean) => `flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-semibold [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${active ? "bg-white text-slate-950" : "text-white/80 hover:bg-white/10"}`;

export default function PlanDeferralClient() {
  const params = useSearchParams();
  const rawState = params.get("state");
  const state: EaseState = rawState === "capped" || rawState === "deferred" ? rawState : "eligible";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const sheetOpen = params.get("sheet") === "open";
  const [eased, setEased] = useState<{ contribution: number; mode: "keep_date" | "keep_amount" } | null>(null);
  const href = (s: EaseState, m: Mode) => `?state=${s}&mode=${m}`;

  useEffect(() => { setEased(null); }, [state]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  const services = useMemo(() => previewServices(state, setEased), [state]);
  const item = useMemo(() => (eased ? planEasingItem("deferred", eased) : planEasingItem(state)), [state, eased]);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <main className="min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
        <div className="mx-auto w-full max-w-[430px] px-4 pb-40 pt-7">
          <header>
            <h1 className="text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white">Easing a goal plan for one period</h1>
            <p className="mt-2 text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">
              The shipped Goal plan card and easing sheet, rendered through real props with fixture figures. Nothing is saved. There is no undo: putting a plan back is an ordinary edit on Planning. Set-asides and plans never trade cash.
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
              State: {eased ? "deferred (just saved)" : state}. Figures are worked as the engine works them, on the first day of a pay period, rounding slices up to £5.
            </p>
          </header>
          <section aria-label="Home brief" className="mt-6 space-y-3">
            <MoveCard item={paymentItem()} hideNetWorth={false} maskAmounts={(t) => t} previewMode />
            <PlanEasingCard key={`${state}-${eased ? "saved" : "fresh"}-${sheetOpen}`} item={item} services={services} initialSheetOpen={sheetOpen && !eased} onRefresh={() => undefined} />
          </section>
        </div>
      </main>
      <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
        <nav aria-label="Design preview controls" className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 shadow-xl">
          <div className="flex flex-wrap items-center justify-center gap-0.5">
            {STATES.map((s) => <a key={s.key} href={href(s.key, mode)} aria-current={s.key === state ? "page" : undefined} className={chip(s.key === state)}>{s.label}</a>)}
            <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
            <a href={href(state, mode === "dark" ? "light" : "dark")} className={chip(false)}>{mode === "dark" ? "Light" : "Dark"}</a>
          </div>
        </nav>
      </div>
    </div>
  );
}
