"use client";

// TEMPORARY PREVIEW. G228: three proposals for easing a goal plan for one pay
// period. Production MoveCard, AllocationShortfallCard and Planning GoalRow
// render through real props; the deferral card, remedy row, Planning control
// and sheet are hand-authored PROPOSALS (no production component exists yet).
//
// /design/plan-deferral?variant=a|b|c&state=eligible|capped|deferred|covered&mode=light|dark[&sheet=open]

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AllocationShortfallCard, MoveCard } from "@/components/HomeBrief";
import { GoalRow } from "@/app/planning/LongTermPlanningPage";
import { allocationItem, paymentItem, previewServices } from "../allocation-shortfall/fixtures";
import DeferSheet from "./DeferSheet";
import { COPY } from "./copy";
import { DeferCardA, DeferredLine, GoalEaseControl, HomePointerC, RemedyCardB } from "./PlanDeferral";
import { GOAL, goalCommitment, type DeferState, type DeferVariant } from "./fixtures";

type Mode = "light" | "dark";
const VARIANTS: { key: DeferVariant; label: string }[] = [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }];
const STATES: { key: DeferState; label: string }[] = [
  { key: "eligible", label: "Eligible" }, { key: "capped", label: "Capped" }, { key: "deferred", label: "Deferred" }, { key: "covered", label: "Covered" },
];
const chip = (active: boolean) => `flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-semibold [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${active ? "bg-white text-slate-950" : "text-white/80 hover:bg-white/10"}`;

export default function PlanDeferralClient() {
  const params = useSearchParams();
  const variant: DeferVariant = params.get("variant") === "b" ? "b" : params.get("variant") === "c" ? "c" : "a";
  const rawState = params.get("state");
  const state: DeferState = rawState === "capped" || rawState === "deferred" || rawState === "covered" ? rawState : "eligible";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const [local, setLocal] = useState<DeferState | null>(null);
  const [sheet, setSheet] = useState(params.get("sheet") === "open");
  const shown = local ?? state;
  const href = (v: DeferVariant, s: DeferState, m: Mode) => `?variant=${v}&state=${s}&mode=${m}`;

  useEffect(() => { setLocal(null); }, [state, variant]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  const open = () => setSheet(true);
  const capped = shown === "capped";
  const covered = shown === "covered";
  const deferred = shown === "deferred";
  const undo = () => setLocal("eligible");

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <main className="min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
        <div className="mx-auto w-full max-w-[430px] px-4 pb-40 pt-7">
          <header>
            <h1 className="text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white">{COPY.introTitle}</h1>
            <p className="mt-2 text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">{COPY.introBody}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Variant {variant.toUpperCase()}: {variant === "a" ? "its own card below the set-aside card" : variant === "b" ? "a third remedy row inside the set-aside card" : "a control on Planning's goal row, Home only points"}.{variant === "b" ? ` ${COPY.bBreaks}` : ""} State: {shown}. Preview only, nothing is saved.
            </p>
          </header>

          {variant !== "c" ? (
            <section aria-label="Home brief" className="mt-6 space-y-3">
              <MoveCard item={paymentItem()} hideNetWorth={false} maskAmounts={(t) => t} previewMode />
              {variant === "a" ? (
                <>
                  <AllocationShortfallCard item={allocationItem("known")} services={previewServices("known")} />
                  {deferred ? <DeferredLine onUndo={undo} />
                    : covered ? <p data-defer="not-offered" className="px-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{COPY.coveredAnnotation}</p>
                    : <DeferCardA capped={capped} onOpen={open} />}
                </>
              ) : (
                <>
                  <RemedyCardB capped={capped} covered={covered} onOpen={open} />
                  {deferred && <DeferredLine onUndo={undo} />}
                </>
              )}
            </section>
          ) : (
            <>
              <section aria-label="Home brief" className="mt-6 space-y-3">
                <MoveCard item={paymentItem()} hideNetWorth={false} maskAmounts={(t) => t} previewMode />
                <AllocationShortfallCard item={allocationItem("known")} services={previewServices("known")} />
                {!capped && !covered && !deferred && <HomePointerC onOpen={() => {}} />}
              </section>
              <section aria-label="Planning" className="mt-8">
                <h2 className="flex min-h-11 items-center px-1 text-base font-bold text-slate-800 dark:text-slate-100">Long-term goals</h2>
                <div className="glass-card overflow-hidden rounded-2xl">
                  <GoalRow goal={goalCommitment} hideValues={false} onOpen={() => {}} />
                  {deferred ? <div className="border-t border-slate-200/70 px-3.5 py-2 dark:border-white/10"><DeferredLine onUndo={undo} /></div> : <GoalEaseControl capped={capped} onOpen={open} />}
                </div>
                {covered && <p className="mt-2 px-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{COPY.coveredAnnotation} The control stays on the goal for anyone who wants it.</p>}
              </section>
            </>
          )}
        </div>
      </main>
      {sheet && <DeferSheet covered={covered} eased={capped ? GOAL.easedUsedCapped : GOAL.easedUsed} onClose={() => setSheet(false)} onSaved={() => setLocal("deferred")} />}
      <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
        <nav aria-label="Design preview controls" className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 shadow-xl">
          <div className="flex flex-wrap items-center justify-center gap-0.5">
            {VARIANTS.map((v) => <a key={v.key} href={href(v.key, state, mode)} aria-current={v.key === variant ? "page" : undefined} className={chip(v.key === variant)}>{v.label}</a>)}
            <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
            {STATES.map((s) => <a key={s.key} href={href(variant, s.key, mode)} aria-current={s.key === state ? "page" : undefined} className={chip(s.key === state)}>{s.label}</a>)}
            <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
            <a href={href(variant, state, mode === "dark" ? "light" : "dark")} className={chip(false)}>{mode === "dark" ? "Light" : "Dark"}</a>
          </div>
        </nav>
      </div>
    </div>
  );
}
