"use client";

// Fixture-only G149 placement round. This deliberately redraws only the
// chronology around the transfer-review guardrail: production's component is
// still untouched until a direction is approved. No requests or mutations.

import { useEffect } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleDollarSign, Landmark, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { TransferReviewGuardrail } from "@/components/SpendVerdictView";

type Variant = "a" | "b";
type State = "single" | "many" | "clear";
type Mode = "light" | "dark";

const variants: Record<Variant, { name: string; thesis: string }> = {
  a: {
    name: "A · Timeline event",
    thesis: "A transfer needing review is an event in this pay period, so it earns the same rail marker, text column and pause as every other event.",
  },
  b: {
    name: "B · Period affordance",
    thesis: "Transfer review is a period-level safeguard, not part of the spending story, so it sits before the rail as a quiet, available control.",
  },
};

const stateCopy: Record<State, { count: number; label: string; detail: string }> = {
  single: { count: 1, label: "1 transfer to review", detail: "A payment may be between your own accounts." },
  many: { count: 12, label: "12 transfers to review", detail: "A longer list waits for review, including transfers between current accounts and pots." },
  clear: { count: 0, label: "No transfers need review", detail: "" },
};

function href(variant: Variant, state: State, mode: Mode) {
  return `?variant=${variant}&state=${state}&mode=${mode}`;
}

function PreviewControls({ variant, state, mode }: { variant: Variant; state: State; mode: Mode }) {
  return (
    <nav aria-label="G149 preview controls" className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-700 bg-slate-950/95 px-3 py-2 text-white backdrop-blur sm:bottom-3 sm:mx-auto sm:max-w-max sm:rounded-2xl sm:border">
      <div className="mx-auto flex max-w-xl flex-wrap items-center justify-center gap-1">
        {(Object.keys(variants) as Variant[]).map((key) => (
          <a key={key} href={href(key, state, mode)} aria-current={key === variant ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-bold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${key === variant ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}>
            {key.toUpperCase()}
          </a>
        ))}
        <span className="h-6 w-px bg-white/15" aria-hidden="true" />
        {(Object.keys(stateCopy) as State[]).map((key) => (
          <a key={key} href={href(variant, key, mode)} aria-current={key === state ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-xl px-2.5 text-[11px] font-semibold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${key === state ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}>
            {key === "single" ? "One" : key === "many" ? "Many" : "Clear"}
          </a>
        ))}
        <a href={href(variant, state, mode === "light" ? "dark" : "light")} className="inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
          {mode === "light" ? "Dark" : "Light"}
        </a>
      </div>
    </nav>
  );
}

function TimelineMarker({ tone = "slate", icon }: { tone?: "slate" | "indigo" | "emerald"; icon: React.ReactNode }) {
  const colours = tone === "indigo"
    ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300"
    : tone === "emerald"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300"
      : "border-slate-300 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return <span aria-hidden="true" className={`absolute -left-10 top-0 grid size-6 place-items-center rounded-full border ring-4 ring-[#f0f2f7] dark:ring-[#0f172a] ${colours}`}>{icon}</span>;
}

function TransferReview({ placement, copy }: { placement: "timeline" | "period"; copy: (typeof stateCopy)[State] }) {
  if (!copy.count) return null;
  // Approved A imports the production guardrail with fixture props. B stays
  // a reference-only comparison for the historical design decision.
  if (placement === "timeline") {
    return <TransferReviewGuardrail reviewTotal={copy.count} journey onMiscategorisedTap={() => {}} />;
  }
  if (placement === "period") {
    return (
      <button type="button" className="group flex min-h-11 w-full items-center gap-2 rounded-xl px-1.5 py-2 text-left transition hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800/60">
        <ShieldCheck size={15} className="shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{copy.label}</span>
        <ChevronRight size={16} className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </button>
    );
  }
}

function SpendJourney({ variant, state }: { variant: Variant; state: State }) {
  const copy = stateCopy[state];
  return (
    <div className="relative border-l border-slate-300 pl-8 dark:border-slate-700 sm:pl-10">
      <section className="relative pb-10" aria-labelledby="pay-arrived">
        <TimelineMarker tone="emerald" icon={<ArrowUpRight size={12} />} />
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">31 August · day 1</p>
        <h2 id="pay-arrived" className="mt-2 text-xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Pay arrived</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">Your pay period began with <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">£2,640</span> in.</p>
      </section>
      {variant === "a" ? <TransferReview placement="timeline" copy={copy} /> : null}
      <section className="relative pb-10" aria-labelledby="today-heading">
        <TimelineMarker tone="slate" icon={<CircleDollarSign size={12} />} />
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">Today · day 26</p>
        <h2 id="today-heading" className="mt-2 text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">What put you ahead</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">You have spent <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">£1,904</span> by day 26, against a usual <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">£1,632</span>.</p>
        <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
          <div className="flex items-center gap-3 px-4 py-3"><span className="grid size-8 place-items-center rounded-lg bg-orange-100 text-orange-600"><Landmark size={15} aria-hidden="true" /></span><span className="min-w-0 flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">Bills</span><span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-white">£1,160</span></div>
          <div className="flex items-center gap-3 px-4 py-3"><span className="grid size-8 place-items-center rounded-lg bg-emerald-100 text-emerald-600"><Check size={15} aria-hidden="true" /></span><span className="min-w-0 flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">Groceries</span><span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-white">£302</span></div>
        </div>
      </section>
    </div>
  );
}

export default function G149TransferReviewPlacementClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const state: State = params.get("state") === "many" ? "many" : params.get("state") === "clear" ? "clear" : "single";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <a href="#journey" className="sr-only z-[60] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Skip to transfer placement preview</a>
      <main className="min-h-dvh bg-[#f0f2f7] pb-32 text-slate-900 selection:bg-slate-200 selection:text-slate-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-slate-600 dark:selection:text-white">
        <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
          <a href="/design" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={16} aria-hidden="true" />Design rounds</a>
          <header className="mt-5 max-w-2xl">
            <h1 className="text-balance text-[30px] font-bold tracking-[-0.04em] text-slate-950 dark:text-white">Where transfer review belongs</h1>
            <p className="mt-2 max-w-[65ch] text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">{variants[variant].thesis} The review behaviour is unchanged in both directions.</p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Fixture preview only. No bank data or review decisions are changed.</p>
          </header>
          <div className="mt-9 grid gap-10 lg:grid-cols-[minmax(210px,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
            <section aria-labelledby="period-summary-heading" className="lg:sticky lg:top-8 lg:self-start">
              <h2 id="period-summary-heading" className="text-lg font-bold text-slate-950 dark:text-white">This pay period</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Out is separate from money moved between your own accounts.</p>
              <dl className="mt-5 grid grid-cols-3 gap-3 lg:grid-cols-1 lg:gap-4">
                {[['In', '£2,640'], ['Out', '£1,904'], ['Moved', '£308']].map(([label, value]) => <div key={label}><dt className="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400">{label}</dt><dd className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-950 dark:text-white">{value}</dd></div>)}
              </dl>
            </section>
            <section id="journey" aria-label="Spend journey preview" className="max-w-2xl pt-1">
              {variant === "b" && stateCopy[state].count > 0 ? <div className="mb-8 border-b border-slate-200 pb-3 dark:border-slate-700"><TransferReview placement="period" copy={stateCopy[state]} /></div> : null}
              <SpendJourney variant={variant} state={state} />
            </section>
          </div>
        </div>
      </main>
      <PreviewControls variant={variant} state={state} mode={mode} />
    </div>
  );
}
