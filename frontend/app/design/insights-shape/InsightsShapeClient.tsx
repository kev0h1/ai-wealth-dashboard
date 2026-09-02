"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Insights tab redesign wireframe (2026-09-02). Philosophy: money has a
// few jobs, and the proportion between them matters more than any line
// item — describe the user's own shape, never grade it (BEHAVIOURS.md's
// "The Mirror Is Not A Score" named rule, same discipline applied here: no
// health score, no comparison to a rubric, ink not grading colour).
//
// Proposed page order: 1) hero "Your money shape" (the 3 variants differ
// HERE) — 2) "What works for you" evidence card (shared) — 3) reference
// shapes quiet link row (shared) — 4) low-fidelity placeholders for the
// rest of the page order (existing Fixed-costs/Ways-to-save research cards,
// Tax efficiency, unchanged).
//
// Deep-linkable: /design/insights-shape?variant=a|b|c&state=full|thin&mode=light|dark

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import { WhatWorksCard, ReferenceShapesRow, PlaceholdersSection, type ShapeState } from "./shared";
import { PAY_PERIOD_LABEL } from "./fixtures";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";
const VARIANTS: Variant[] = ["a", "b", "c"];
const STATES: ShapeState[] = ["full", "thin"];

const HERO_BY_VARIANT: Record<Variant, () => React.ReactElement> = {
  a: VariantA,
  b: VariantB,
  c: VariantC,
};

const VARIANT_LABEL: Record<Variant, string> = {
  a: "A · One bar",
  b: "B · Four tiles",
  c: "C · Sentence-led",
};

function href(variant: Variant, state: ShapeState, mode: Mode): string {
  return `?variant=${variant}&state=${state}&mode=${mode}`;
}

function ControlBar({ variant, state, mode }: { variant: Variant; state: ShapeState; mode: Mode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 rounded-full border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 p-1 w-full">
        {VARIANTS.map((v) => (
          <a
            key={v}
            href={href(v, state, mode)}
            className={`flex-1 min-h-[40px] flex items-center justify-center rounded-full px-2 text-[11px] font-semibold text-center active:scale-95 transition-colors ${
              v === variant ? "bg-indigo-600 text-white" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {v.toUpperCase()}
          </a>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 p-1">
          {STATES.map((s) => (
            <a
              key={s}
              href={href(variant, s, mode)}
              className={`min-h-[40px] flex items-center justify-center rounded-full px-3 text-[11px] font-semibold active:scale-95 transition-colors ${
                s === state ? "bg-indigo-600 text-white" : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {s === "full" ? "Full" : "Thin history"}
            </a>
          ))}
        </div>

        <a
          href={href(variant, state, mode === "dark" ? "light" : "dark")}
          className="min-h-[40px] flex items-center justify-center rounded-full border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 px-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400 active:scale-95 transition-colors"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </div>
  );
}

function Inner() {
  const params = useSearchParams();

  const rawVariant = params.get("variant");
  const variant: Variant = (VARIANTS as string[]).includes(rawVariant ?? "") ? (rawVariant as Variant) : "a";

  const rawState = params.get("state");
  const state: ShapeState = (STATES as string[]).includes(rawState ?? "") ? (rawState as ShapeState) : "full";

  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const Hero = HERO_BY_VARIANT[variant];

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-slate-50 dark:bg-slate-950 pb-16">
        <div className="mx-auto w-full max-w-md px-4 pt-6 space-y-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              TEMPORARY PREVIEW &middot; Insights shape &middot; {VARIANT_LABEL[variant]} &middot; {mode}
            </p>
            <h1 className="mt-1 text-[20px] font-bold text-slate-900 dark:text-white">Your money shape</h1>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
              Insights redesign wireframe, pay period {PAY_PERIOD_LABEL}. Money has a few jobs, and the proportion
              between them matters more than any line item.
            </p>
          </div>

          <ControlBar variant={variant} state={state} mode={mode} />

          <Hero />

          <WhatWorksCard state={state} />

          <ReferenceShapesRow />

          <PlaceholdersSection />
        </div>
      </div>
    </div>
  );
}

export default function InsightsShapeClient() {
  return <Inner />;
}
