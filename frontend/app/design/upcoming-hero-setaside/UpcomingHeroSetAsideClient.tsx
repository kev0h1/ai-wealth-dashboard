"use client";

// G162 — Upcoming hero, set-aside-only colour/wording round (impeccable
// skill). See page.tsx for the full brief and the production-boundary
// note; see fixtures.ts for the classify() logic and Kevin's own
// screenshot figures.
import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AS_AT_LABEL, SCENARIOS } from "./fixtures";
import HeroVariantA from "./HeroVariantA";
import HeroVariantB from "./HeroVariantB";
import HeroVariantC from "./HeroVariantC";

type Mode = "light" | "dark";
type Variant = "a" | "b" | "c";
type State = "setaside" | "billgap" | "healthy";

const VARIANT_LABEL: Record<Variant, string> = {
  a: "A · Set aside, not short",
  b: "B · Two-line verdict",
  c: "C · Ledger-led",
};
const STATE_LABEL: Record<State, string> = {
  setaside: "Set-aside only",
  billgap: "Bill gap",
  healthy: "Healthy",
};

function Switcher({ variant, state, mode }: { variant: Variant; state: State; mode: Mode }) {
  const href = (v: Variant, s: State, m: Mode) => `?variant=${v}&state=${s}&mode=${m}`;
  const base = "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full px-3 text-[11px] font-semibold transition-colors active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900";
  return (
    <nav aria-label="Preview controls" className="fixed inset-x-0 bottom-3 z-50 mx-auto flex max-w-[calc(100vw-16px)] flex-col items-center gap-1.5">
      <div className="flex flex-nowrap gap-1 overflow-x-auto rounded-2xl bg-slate-900/95 p-1.5 shadow-xl">
        {(Object.keys(VARIANT_LABEL) as Variant[]).map((v) => (
          <Link
            key={v}
            href={href(v, state, mode)}
            className={`${base} ${v === variant ? "bg-indigo-600 text-white" : "text-slate-200 hover:bg-slate-800"}`}
          >
            {VARIANT_LABEL[v]}
          </Link>
        ))}
      </div>
      <div className="flex flex-nowrap gap-1 overflow-x-auto rounded-2xl bg-slate-900/95 p-1.5 shadow-xl">
        {(Object.keys(STATE_LABEL) as State[]).map((s) => (
          <Link
            key={s}
            href={href(variant, s, mode)}
            className={`${base} ${s === state ? "bg-indigo-600 text-white" : "text-slate-200 hover:bg-slate-800"}`}
          >
            {STATE_LABEL[s]}
          </Link>
        ))}
        <Link href={href(variant, state, mode === "dark" ? "light" : "dark")} className={`${base} text-slate-200 hover:bg-slate-800`}>
          {mode === "dark" ? "Light" : "Dark"}
        </Link>
      </div>
    </nav>
  );
}

export default function UpcomingHeroSetAsideClient() {
  const params = useSearchParams();
  const variant: Variant = (["a", "b", "c"] as Variant[]).includes(params.get("variant") as Variant)
    ? (params.get("variant") as Variant)
    : "a";
  const state: State = (["setaside", "billgap", "healthy"] as State[]).includes(params.get("state") as State)
    ? (params.get("state") as State)
    : "setaside";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
  }, [mode]);

  const scenario = SCENARIOS[state];
  const Hero = variant === "a" ? HeroVariantA : variant === "b" ? HeroVariantB : HeroVariantC;

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-[#f0f2f7] pb-40 dark:bg-[#0f172a]">
        <main className="mx-auto max-w-xl px-4 py-6">
          <div className="mb-4">
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.035em] text-slate-950 dark:text-white">Before payday</h1>
            <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
              G162 &middot; an amber wording for the set-aside-only case, red reserved for a genuine bill gap.
            </p>
            <p className="mt-1 max-w-sm text-xs text-slate-400 dark:text-slate-500">
              Fixture dates are as at {AS_AT_LABEL}.
            </p>
          </div>
          <Hero scenario={scenario} />
        </main>
        <Switcher variant={variant} state={state} mode={mode} />
      </div>
    </div>
  );
}
