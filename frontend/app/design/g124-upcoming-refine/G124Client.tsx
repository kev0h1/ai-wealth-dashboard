"use client";

// G124 — Upcoming refine. Kevin reviewed the G90 preview
// (app/design/upcoming-canvas-before-cards) against the LIVE /upcoming page
// on his phone: "the design is good and clean but it changes too much of
// the existing infrastructure in place." This round is NOT a rebuild —
// PlanningPage.tsx stays exactly as it is — it takes exactly three things
// from G90 and Kevin's own follow-up notes:
//   1. The hero adopts G90's bounded-panel styling; content unchanged.
//   2. Same-day payments group into one bounded day card (the G122
//      transactions-hub grammar), not a separate floating card per row.
//   3. Set-aside content density/polish — three different answers.
//
// FIXTURE-ONLY, disclosed prominently (see fixtures.ts's own header and the
// G124 report): PlanningPage.tsx's hero figure, risk flags and day-group
// walk are all computed inline inside one large authenticated page
// component with no importable boundary at the right granularity, so this
// preview hand-authors markup against representative fixtures rather than
// rendering PlanningPage.tsx. It does not prove PlanningPage.tsx's live
// behaviour; it proposes what the three requested pieces should look like.
import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EyeOff } from "lucide-react";
import HeroCard from "./HeroCard";
import DayGroups from "./DayGroups";
import { SetAsideA, SetAsideB, SetAsideC } from "./setAsideVariants";
import {
  ALLOCATIONS, HERO_POSITIVE, HERO_NEGATIVE, RUNWAY_POSITIVE, RUNWAY_NEGATIVE,
  BILLS_POSITIVE, BILLS_NEGATIVE,
} from "./fixtures";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";
type HeroState = "positive" | "negative";

const VARIANTS: { value: Variant; label: string }[] = [
  { value: "a", label: "A · Tightened" },
  { value: "b", label: "B · Chip" },
  { value: "c", label: "C · Disclosure" },
];

// The index page (app/design/page.tsx, PreviewCard) always links here as
// `?mode=dark&state=<value>&variant=<value>` — `state` is a fixed param
// name the index hard-codes for every preview, so this reads/writes
// `state` (not a bespoke `hero` key) to stay wired to that index.
function Switcher({ variant, state, mode }: { variant: Variant; state: HeroState; mode: Mode }) {
  const href = (v: Variant, s: HeroState, m: Mode) => `?variant=${v}&state=${s}&mode=${m}`;
  const base = "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full px-3.5 text-[11px] font-semibold transition-colors active:scale-95";
  return (
    <nav aria-label="Preview controls" className="fixed inset-x-0 bottom-3 z-50 mx-auto flex max-w-[calc(100vw-16px)] flex-nowrap gap-1 overflow-x-auto rounded-2xl bg-slate-900/95 p-1.5 shadow-xl">
      {VARIANTS.map((v) => (
        <Link key={v.value} href={href(v.value, state, mode)} className={`${base} ${v.value === variant ? "bg-indigo-600 text-white" : "text-slate-200 hover:bg-slate-800"}`}>
          {v.label}
        </Link>
      ))}
      <Link href={href(variant, state === "positive" ? "negative" : "positive", mode)} className={`${base} text-slate-200 hover:bg-slate-800`}>
        {state === "positive" ? "Show short" : "Show left"}
      </Link>
      <Link href={href(variant, state, mode === "dark" ? "light" : "dark")} className={`${base} text-slate-200 hover:bg-slate-800`}>
        {mode === "dark" ? "Light" : "Dark"}
      </Link>
    </nav>
  );
}

export default function G124Client() {
  const params = useSearchParams();
  const variant: Variant = (["a", "b", "c"] as string[]).includes(params.get("variant") ?? "") ? (params.get("variant") as Variant) : "a";
  const state: HeroState = params.get("state") === "negative" ? "negative" : "positive";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
  }, [mode]);

  const scenario = state === "negative" ? HERO_NEGATIVE : HERO_POSITIVE;
  const runway = state === "negative" ? RUNWAY_NEGATIVE : RUNWAY_POSITIVE;
  const bills = state === "negative" ? BILLS_NEGATIVE : BILLS_POSITIVE;
  const SetAsideComponent = variant === "a" ? SetAsideA : variant === "b" ? SetAsideB : SetAsideC;

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-[#f0f2f7] pb-56 dark:bg-[#0f172a]">
        <main className="mx-auto max-w-xl px-4 py-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">UPCOMING</p>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Before payday</h1>
              <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">What will enter or leave, and whether every payment is covered.</p>
            </div>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl" aria-hidden="true">
              <EyeOff size={20} strokeWidth={1.75} className="text-slate-300 dark:text-slate-600" />
            </span>
          </div>

          <div className="space-y-4">
            <HeroCard scenario={scenario} runway={runway} />

            <section aria-labelledby="set-aside-heading">
              <div className="mb-2 flex min-h-11 items-center justify-between gap-3 px-1">
                <h2 id="set-aside-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Set aside this period</h2>
                <span className="min-h-11 rounded-lg px-2 py-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">+ Add</span>
              </div>
              <SetAsideComponent allocations={ALLOCATIONS} />
              <p className="mt-2 px-1 text-xs text-slate-500 dark:text-slate-400">Only the amount still to reserve reduces the forecast above.</p>
            </section>

            <section aria-labelledby="upcoming-ledger-heading" className="space-y-3">
              <div className="flex items-end justify-between gap-3 px-1">
                <h2 id="upcoming-ledger-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Upcoming</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">&ldquo;After&rdquo; is your projected cash</p>
              </div>
              <DayGroups items={bills} paydayLabel={scenario.paydayLabel} />
            </section>
          </div>
        </main>
        <Switcher variant={variant} state={state} mode={mode} />
      </div>
    </div>
  );
}
