"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight, CircleDollarSign, Flag, Target } from "lucide-react";
import { GrowHero, CollapsedLadder } from "@/app/planning/GrowPanel";
import { DebtPosition, GoalRow } from "@/app/planning/LongTermPlanningPage";
import { DEBT_SUMMARY, GOALS, growView } from "@/app/design/planning-ladder/fixtures";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";
type Position = "short" | "calm";

const variants: Variant[] = ["a", "b", "c"];

const notes: Record<Variant, { name: string; thesis: string; tradeoff: string }> = {
  a: {
    name: "A · Clear reading",
    thesis: "One calm canvas leads from this month’s position to the priority order, then leaves debt and goals as separate evidence and decision groups.",
    tradeoff: "The clearest phone reading, with desktop deliberately kept focused rather than dashboard-like.",
  },
  b: {
    name: "B · Position rail",
    thesis: "On desktop, the monthly position stays in a calm sticky rail while the decision objects form a single work column beside it.",
    tradeoff: "It makes cross-checking quicker on a wide screen, but the split asks desktop users to scan across columns.",
  },
  c: {
    name: "C · Next decision",
    thesis: "Canvas landmarks frame each decision in sequence: protect the month, choose the live priority, then inspect the two long-horizon commitments.",
    tradeoff: "The sequence feels purposeful, but it is more editorial than the live page’s neutral inventory.",
  },
};

function CanvasHeading({ title, copy, icon: Icon }: { title: string; copy: string; icon?: typeof Target }) {
  return (
    <div className="max-w-[65ch] px-1">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={16} className="text-indigo-600 dark:text-indigo-400" aria-hidden="true" />}
        <h2 className="text-pretty text-base font-bold text-slate-900 dark:text-slate-100">{title}</h2>
      </div>
      <p className="mt-1 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">{copy}</p>
    </div>
  );
}

function Goals() {
  return (
    <section id="goals" className="scroll-mt-6" aria-labelledby="g89-goals-heading">
      <CanvasHeading title="Long-term goals" icon={Target} copy="Each goal keeps its own target, pace and edit decision together." />
      <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
        {GOALS.map((goal) => <GoalRow key={goal.id} goal={goal} hideValues={false} onOpen={() => {}} />)}
      </div>
    </section>
  );
}

function Work({ position }: { position: Position }) {
  const view = growView(position);
  return (
    <div className="space-y-9">
      <section id="priorities" className="scroll-mt-6" aria-labelledby="g89-priorities-heading">
        <CanvasHeading title="Your priority order" icon={Flag} copy="Completed and later steps fold away so the decision that is live now is the part that gets the space." />
        <div className="mt-3"><CollapsedLadder steps={view.ladder} hideValues={false} /></div>
      </section>
      <section id="debt" className="scroll-mt-6" aria-label="Debt evidence">
        <DebtPosition debt={DEBT_SUMMARY} hideValues={false} onOpen={() => {}} />
      </section>
      <Goals />
    </div>
  );
}

function VariantA({ position }: { position: Position }) {
  const view = growView(position);
  return <div className="space-y-8"><GrowHero view={view} hideValues={false} onSeeDue={() => {}} /><div className="border-b border-slate-300/80 pb-6 dark:border-slate-700"><CanvasHeading title="A plan with one job at a time" icon={CircleDollarSign} copy="This month’s position is the instrument. The sections below show the order, debt evidence and goals you can change without wrapping the explanation in extra surfaces." /></div><Work position={position} /></div>;
}

function VariantB({ position }: { position: Position }) {
  const view = growView(position);
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-start lg:gap-10">
      <div className="space-y-6 lg:sticky lg:top-6">
        <GrowHero view={view} hideValues={false} onSeeDue={() => {}} />
        <CanvasHeading title="Your long horizon" icon={CircleDollarSign} copy="Keep the month in view, then follow the live priority. Debt & goals stay as proof and choices, not decoration." />
        <nav aria-label="Planning sections" className="flex flex-wrap gap-x-4 gap-y-2 px-1 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
          <a href="#priorities" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Priority</a><a href="#debt" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Debt</a><a href="#goals" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Goals</a>
        </nav>
      </div>
      <div className="mt-9 border-t border-slate-300/80 pt-8 dark:border-slate-700 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0"><Work position={position} /></div>
    </div>
  );
}

function VariantC({ position }: { position: Position }) {
  const view = growView(position);
  return (
    <div className="space-y-8">
      <GrowHero view={view} hideValues={false} onSeeDue={() => {}} />
      <div className="grid gap-5 border-y border-slate-300/80 py-6 dark:border-slate-700 sm:grid-cols-3">
        <CanvasHeading title="1. Protect this month" copy="The position above tells you whether the current pay period needs attention." />
        <CanvasHeading title="2. Keep the order" copy="The live rung is the next long-term decision, not a checklist to work through." />
        <CanvasHeading title="3. Check the evidence" copy="Debt and goals remain separate because they answer different questions." />
      </div>
      <Work position={position} />
    </div>
  );
}

function Switcher({ variant, position, mode }: { variant: Variant; position: Position; mode: Mode }) {
  return <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+14px)] z-50 flex justify-center px-3"><div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/15 bg-slate-900/95 p-1 shadow-xl"><span className="sr-only">Preview controls</span>{variants.map((item) => <a key={item} href={`?variant=${item}&state=${position}&mode=${mode}`} className={`flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-semibold transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${item === variant ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"}`}>{item.toUpperCase()}</a>)}<span className="h-5 w-px shrink-0 bg-white/20" aria-hidden="true" /><a href={`?variant=${variant}&state=${position === "short" ? "calm" : "short"}&mode=${mode}`} className="flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-semibold text-slate-300 hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">{position === "short" ? "Calm" : "Short"}</a><a href={`?variant=${variant}&state=${position}&mode=${mode === "dark" ? "light" : "dark"}`} className="flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-semibold text-slate-300 hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">{mode === "dark" ? "Light" : "Dark"}</a></div></div>;
}

export default function G89PlanningCanvasClient() {
  const params = useSearchParams();
  const raw = params.get("variant");
  const variant: Variant = variants.includes(raw as Variant) ? raw as Variant : "a";
  const position: Position = params.get("state") === "calm" ? "calm" : "short";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  useEffect(() => { document.documentElement.classList.toggle("dark", mode === "dark"); document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode); }, [mode]);
  const note = notes[variant];
  return <div className={mode === "dark" ? "dark" : ""}><div className="min-h-dvh overflow-x-hidden bg-[#f0f2f7] pb-32 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100"><a href="#main-content" className="sr-only fixed left-4 top-3 z-[60] rounded-lg bg-white px-3 py-2 text-sm font-semibold text-indigo-700 shadow-sm focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-800 dark:text-indigo-300">Skip to planning</a><main id="main-content" className="mx-auto w-full max-w-6xl px-4 pb-10 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:px-6"><a href="/design" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-1 text-[13px] font-medium text-slate-600 hover:text-slate-950 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={17} aria-hidden="true" />Back to design</a><header className="mt-4 border-b border-slate-300/80 pb-6 dark:border-slate-700"><h1 className="text-balance text-[30px] font-bold leading-[1.08] tracking-[-0.035em] text-slate-950 dark:text-white">Planning, without the card pile</h1><p className="mt-2 max-w-[65ch] text-pretty text-[14px] leading-6 text-slate-600 dark:text-slate-400">G89 canvas-before-cards round. The monthly position remains the sole primary instrument; explanation and orientation belong to the page canvas.</p><div className="mt-4 max-w-[65ch] border-l border-indigo-300 pl-3 dark:border-indigo-500"><p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">{note.name}</p><p className="mt-1 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">{note.thesis}</p><p className="mt-1 text-pretty text-xs text-slate-500 dark:text-slate-500">Trade-off: {note.tradeoff}</p></div></header><div className="mt-8">{variant === "a" ? <VariantA position={position} /> : variant === "b" ? <VariantB position={position} /> : <VariantC position={position} />}</div><p className="mt-10 max-w-[65ch] border-t border-slate-300/80 pt-5 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:text-slate-400">One-off payments and this pay period’s envelopes live in <a href="/upcoming" className="font-semibold text-indigo-700 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Upcoming</a>.</p></main><Switcher variant={variant} position={position} mode={mode} /></div></div>;
}
