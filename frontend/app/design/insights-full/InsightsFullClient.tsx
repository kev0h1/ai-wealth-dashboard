"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Full-page Insights tab redesign wireframe, built on Variant A ("One bar",
// Kevin's pick 2026-09-02 from /design/insights-shape's three-variant
// comparison). /design/insights-shape is left untouched so that comparison
// still stands on its own; this route imports and extends its primitives
// and fixtures instead of forking them (see sections.tsx).
//
// Page order: 1) hero (Variant A, legend rows now tappable, wired to
// Planning/Penny/Spend/Home) — 2) "What works for you" extended with a
// Mirror trait citation and a consent-aware Penny proposal footer —
// 3) reference shapes row (unchanged, reused as-is) — 4) "Where the shape
// can move", the real InsightCard/CompactInsightRow components regrouped
// by job with a shape-anchor strip under costed cards — 5) Tax efficiency
// placeholder (unchanged, reused as-is) — 6) an appendix mocking where the
// same shape language shows up on Spend/Home/Planning.
//
// Deep-linkable: /design/insights-full?state=full|thin&consent=change|keep&mode=light|dark

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { PAY_PERIOD_LABEL } from "../insights-shape/fixtures";
import { ReferenceShapesRow, PlaceholderBlock, type ShapeState } from "../insights-shape/shared";
import { TappableHero, WhatWorksFull, ShapeMovesSection, ElsewhereAppendix, type Consent } from "./sections";

type Mode = "light" | "dark";
const STATES: ShapeState[] = ["full", "thin"];
const CONSENTS: Consent[] = ["change", "keep"];

function href(state: ShapeState, consent: Consent, mode: Mode): string {
  return `?state=${state}&consent=${consent}&mode=${mode}`;
}

function ControlBar({ state, consent, mode }: { state: ShapeState; consent: Consent; mode: Mode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 rounded-full border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 p-1 w-full">
        {STATES.map((s) => (
          <a
            key={s}
            href={href(s, consent, mode)}
            className={`flex-1 min-h-[40px] flex items-center justify-center rounded-full px-2 text-[11px] font-semibold text-center active:scale-95 transition-colors ${
              s === state ? "bg-indigo-600 text-white" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {s === "full" ? "Full" : "Thin history"}
          </a>
        ))}
      </div>

      <div className="flex items-center gap-1 rounded-full border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 p-1 w-full">
        {CONSENTS.map((c) => (
          <a
            key={c}
            href={href(state, c, mode)}
            className={`flex-1 min-h-[40px] flex items-center justify-center rounded-full px-2 text-[11px] font-semibold text-center active:scale-95 transition-colors ${
              c === consent ? "bg-indigo-600 text-white" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {c === "change" ? "Consent: change" : "Consent: keep"}
          </a>
        ))}
      </div>

      <a
        href={href(state, consent, mode === "dark" ? "light" : "dark")}
        className="min-h-[40px] flex items-center justify-center rounded-full border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 px-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400 active:scale-95 transition-colors self-start"
      >
        {mode === "dark" ? "Light" : "Dark"}
      </a>
    </div>
  );
}

function Inner() {
  const params = useSearchParams();

  const rawState = params.get("state");
  const state: ShapeState = (STATES as string[]).includes(rawState ?? "") ? (rawState as ShapeState) : "full";

  const rawConsent = params.get("consent");
  const consent: Consent = (CONSENTS as string[]).includes(rawConsent ?? "") ? (rawConsent as Consent) : "change";

  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-slate-50 dark:bg-slate-950 pb-16">
        <div className="mx-auto w-full max-w-md px-4 pt-6 space-y-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              TEMPORARY PREVIEW &middot; Insights full page &middot; Variant A &middot; {mode}
            </p>
            <h1 className="mt-1 text-[20px] font-bold text-slate-900 dark:text-white">Your money shape</h1>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
              Full-page Insights redesign wireframe, pay period {PAY_PERIOD_LABEL}, built on Variant A.
            </p>
          </div>

          <ControlBar state={state} consent={consent} mode={mode} />

          <TappableHero />

          <WhatWorksFull state={state} consent={consent} />

          <ReferenceShapesRow />

          <ShapeMovesSection />

          <PlaceholderBlock label="Tax efficiency" note="Placeholder. Unchanged." />

          <ElsewhereAppendix state={state} />
        </div>
      </div>
    </div>
  );
}

export default function InsightsFullClient() {
  return <Inner />;
}
