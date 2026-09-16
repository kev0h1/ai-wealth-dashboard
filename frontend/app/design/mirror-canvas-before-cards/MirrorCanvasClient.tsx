"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronRight, Eye, Target } from "lucide-react";
import FixtureBottomNav from "../_components/FixtureBottomNav";

type Variant = "a" | "b" | "c";
type State = "portrait" | "aim" | "empty";
type Choice = "keep" | "change";

const traits = [
  ["treats", "Your signature: thoughtful treats", "You tend to spend more on eating out after a quiet week.", "Eating out", "#fb923c"],
  ["saver", "Your signature: steady saver", "Money moved to savings has been consistent for 4 months.", "Savings", "#fbbf24"],
] as const;

function PreviewBar({ variant, state, dark }: { variant: Variant; state: State; dark: boolean }) {
  const query = (nextVariant = variant, nextState = state, nextDark = dark) => `?variant=${nextVariant}&state=${nextState}&mode=${nextDark ? "dark" : "light"}`;
  const control = "inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
  return <nav aria-label="Preview controls" className="fixed inset-x-2 bottom-3 z-50 flex gap-1 overflow-x-auto rounded-2xl bg-slate-900/95 p-1.5 shadow-lg">
    {(["a", "b", "c"] as Variant[]).map((value) => <Link key={value} href={query(value)} className={`${control} ${value === variant ? "bg-indigo-600 text-white" : "text-slate-200"}`}>{value.toUpperCase()}</Link>)}
    {(["portrait", "aim", "empty"] as State[]).map((value) => <Link key={value} href={query(variant, value)} className={`${control} ${value === state ? "bg-slate-700 text-white" : "text-slate-200"}`}>{value}</Link>)}
    <Link href={query(variant, state, !dark)} className={`${control} text-slate-200`}>{dark ? "Light" : "Dark"}</Link>
  </nav>;
}

function TraitAction({ id, category, choice, onChoice, onSetAim }: { id: string; category: string; choice?: Choice; onChoice: (id: string, choice: Choice) => void; onSetAim: (category: string) => void }) {
  return <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
    <div className="grid grid-cols-2 gap-2">
      <button type="button" aria-pressed={choice === "keep"} onClick={() => onChoice(id, "keep")} className={`min-h-11 rounded-xl border px-3 text-left text-xs font-semibold leading-snug transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${choice === "keep" ? "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200" : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
        This is me, keep it
      </button>
      <button type="button" aria-pressed={choice === "change"} onClick={() => onChoice(id, "change")} className={`min-h-11 rounded-xl border px-3 text-left text-xs font-semibold leading-snug transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${choice === "change" ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
        This isn&apos;t me, change it
      </button>
    </div>
    {choice === "keep" && <p className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400"><Check aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" />Noted, we&apos;ll never nag you about this.</p>}
    {choice === "change" && <p className="mt-3 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">Noted, an aim gives Penny something to track. {" "}<button type="button" onClick={() => onSetAim(category)} className="inline-flex min-h-11 items-center rounded-lg font-semibold text-indigo-700 underline decoration-indigo-300 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Set an aim</button></p>}
  </div>;
}

export default function MirrorCanvasClient() {
  const params = useSearchParams();
  const requestedVariant = params.get("variant");
  const variant: Variant = requestedVariant === "b" || requestedVariant === "c" ? requestedVariant : "a";
  const requestedState = params.get("state");
  const state: State = requestedState === "aim" || requestedState === "empty" ? requestedState : "portrait";
  const dark = params.get("mode") === "dark";
  const [open, setOpen] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [aimCategory, setAimCategory] = useState<string | null>(state === "aim" ? "Eating out" : null);

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => { setAimCategory(state === "aim" ? "Eating out" : null); setChoices({}); setOpen(null); }, [state, variant]);
  const revealSecond = variant !== "c" || open === "treats" || open === "saver";
  const choose = (id: string, choice: Choice) => setChoices((current) => ({ ...current, [id]: choice }));

  return <main className={`${dark ? "dark" : ""} min-h-dvh bg-[#f0f2f7] pb-56 text-slate-900 dark:bg-slate-900 dark:text-slate-100 lg:pb-24`} style={{ "--design-controls-clearance": "108px" } as React.CSSProperties}>
    <div className="mx-auto max-w-4xl px-5 py-8">
      <h1 className="text-balance text-3xl font-bold tracking-tight">How your money behaves</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">What pattern has emerged, and is it one you want to keep? This is a personal reading, not a score or a judgement.</p>
      {state !== "empty" && <p className="mt-3 max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-400">Reading 17 July to 15 September · 61 days connected · medium confidence. It will sharpen as more settled months arrive.</p>}
      {state === "empty" ? <section className="mt-12 max-w-2xl" aria-labelledby="not-enough-data"><h2 id="not-enough-data" className="text-lg font-bold">Not enough data yet</h2><p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">The Mirror starts after 60 days and becomes more reliable as more months arrive.</p></section> : <>
        <section aria-label="Behavioural reading" className={`mt-10 ${variant === "b" ? "grid gap-8 lg:grid-cols-2" : "max-w-2xl"}`}>
          {traits.filter((_, index) => index === 0 || revealSecond).map(([id, title, body, category, colour]) => <article key={id} className="border-b border-slate-200 pb-7 dark:border-slate-700">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colour }} />
            <h2 className="mt-3 text-lg font-bold">{title}</h2><p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{body}</p>
            <button type="button" aria-expanded={open === id} aria-controls={`evidence-${id}`} onClick={() => setOpen(open === id ? null : id)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-indigo-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"><Eye aria-hidden="true" size={16} /> See the evidence <ChevronRight aria-hidden="true" size={15} /></button>
            {open === id && <div id={`evidence-${id}`} className="mt-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{id === "treats" ? "Three eating-out payments followed a seven-day quiet stretch, between 21 August and 12 September." : "Four transfers into savings landed within two days of payday, every month from June to September."} The sample is still small. <Link href="/transactions" className="font-semibold text-indigo-700 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">View payments</Link></div>}
            <TraitAction id={id} category={category} choice={choices[id]} onChoice={choose} onSetAim={setAimCategory} />
          </article>)}
        </section>
        {aimCategory && <section className="mt-10 max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800" aria-labelledby="aim-title"><Target aria-hidden="true" size={18} className="text-indigo-600 dark:text-indigo-400" /><h2 id="aim-title" className="mt-2 font-bold">Your chosen aim</h2><p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300"><span className="font-mono tabular-nums">£74</span> of your <span className="font-mono tabular-nums">£120</span> {aimCategory} aim · 8 days left</p><Link href="/planning" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-indigo-700 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Take this aim to Planning <ChevronRight size={15} /></Link></section>}
      </>}
    </div>
    <FixtureBottomNav />
    <PreviewBar variant={variant} state={state} dark={dark} />
  </main>;
}
