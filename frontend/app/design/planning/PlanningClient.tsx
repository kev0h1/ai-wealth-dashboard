"use client";

// TEMPORARY PREVIEW — delete after design review.
// /design/planning: three art-direction variants of the Planning page
// ("What's coming", frontend/app/planning/PlanningPage.tsx), a revamp
// pass through the taste + impeccable skills after the owner flagged red
// overload, repetition, and hierarchy on the live shortfall states.
//
// Deep-linkable, same pattern as /design/dismissed and /design/month-story:
//   /design/planning?variant=a|b|c&state=short|healthy&mode=light|dark

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { FIXTURES } from "./fixtures";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";

const VARIANTS = ["a", "b", "c"] as const;
type Variant = (typeof VARIANTS)[number];
const STATES = ["short", "healthy"] as const;
type StateKey = (typeof STATES)[number];

const VARIANT_LABEL: Record<Variant, string> = {
  a: "A · ledger",
  b: "B · timeline",
  c: "C · brief",
};
const STATE_LABEL: Record<StateKey, string> = {
  short: "Shortfall",
  healthy: "Healthy",
};

function ControlBar({ variant, state, mode }: { variant: Variant; state: StateKey; mode: "light" | "dark" }) {
  const hrefFor = (v: Variant, s: StateKey, m: "light" | "dark") => `?variant=${v}&state=${s}&mode=${m}`;
  return (
    <div
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex flex-col items-center gap-1.5 rounded-2xl border border-white/15 bg-slate-900/90 p-2 shadow-xl max-w-[92vw]">
        <div className="flex gap-1">
          {VARIANTS.map((v) => (
            <Link
              key={v}
              href={hrefFor(v, state, mode)}
              scroll={false}
              className={`flex min-h-[36px] items-center justify-center rounded-full px-2.5 text-[11px] font-semibold transition-colors active:scale-95 ${
                v === variant ? "bg-indigo-600 text-white" : "text-slate-300"
              }`}
            >
              {VARIANT_LABEL[v]}
            </Link>
          ))}
        </div>
        <div className="flex gap-1">
          {STATES.map((s) => (
            <Link
              key={s}
              href={hrefFor(variant, s, mode)}
              scroll={false}
              className={`flex min-h-[32px] items-center justify-center rounded-full px-2.5 text-[10px] font-medium transition-colors active:scale-95 ${
                s === state ? "bg-slate-700 text-white" : "text-slate-300"
              }`}
            >
              {STATE_LABEL[s]}
            </Link>
          ))}
          <Link
            href={hrefFor(variant, state, mode === "dark" ? "light" : "dark")}
            scroll={false}
            className="flex min-h-[32px] items-center justify-center rounded-full px-2.5 text-[10px] font-medium text-slate-300 active:scale-95 transition-colors"
          >
            {mode === "dark" ? "light" : "dark"}
          </Link>
        </div>
      </div>
    </div>
  );
}

function Inner() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = (VARIANTS as readonly string[]).includes(rawVariant ?? "") ? (rawVariant as Variant) : "a";
  const rawState = params.get("state");
  const state: StateKey = (STATES as readonly string[]).includes(rawState ?? "") ? (rawState as StateKey) : "short";
  const mode: "light" | "dark" = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
  }, [mode]);

  const data = FIXTURES[state];

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      {variant === "a" && <VariantA data={data} />}
      {variant === "b" && <VariantB data={data} />}
      {variant === "c" && <VariantC data={data} />}
      <ControlBar variant={variant} state={state} mode={mode} />
    </div>
  );
}

export default function PlanningClient() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
