"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, ChevronRight, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import type { GrowLadderStep } from "@wealth/shared";
import { formatCurrency } from "@/lib/currency";
import type { CheckpointFigures } from "@/lib/planningCheckpointFigures";
import MoneyText from "@/components/MoneyText";

type ExpandGroup = "done" | "later" | "all" | null;

function maskMoney(text: string, hidden: boolean): string {
  return hidden ? text.replace(/[~−+-]?£[\d,]+(?:\.\d+)?[km]?/gi, "£••••") : text;
}

function names(steps: GrowLadderStep[]) {
  const titles = steps.map((step) => step.title);
  return titles.length <= 3 ? titles.join(", ") : `${titles[0]}, ${titles[1]} and ${titles.length - 2} more`;
}

function node(kind: "done" | "active" | "attention" | "locked") {
  const common = "flex size-6 items-center justify-center rounded-full ring-4 ring-[#f0f2f7] dark:ring-[#0f172a]";
  if (kind === "done") return <span className={`${common} bg-emerald-500 text-white`}><Check size={13} strokeWidth={2.75} aria-hidden="true" /></span>;
  if (kind === "attention") return <span className={`${common} bg-amber-500 text-white`}><TriangleAlert size={13} strokeWidth={2.25} aria-hidden="true" /></span>;
  if (kind === "active") return <span className={`${common} bg-indigo-600 text-white`}><ShieldCheck size={13} strokeWidth={2.25} aria-hidden="true" /></span>;
  return <span className={`${common} border border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400`}><Lock size={12} strokeWidth={2.1} aria-hidden="true" /></span>;
}

function figureText(amount: number) {
  const hasNegativePennies = amount < 0 && Math.round(Math.abs(amount) * 100) > 0;
  return `${hasNegativePennies ? "−" : ""}${formatCurrency(Math.abs(amount))}`;
}

function Figure({ step, figures, hideValues, active = false }: { step: GrowLadderStep; figures?: CheckpointFigures; hideValues: boolean; active?: boolean }) {
  const figure = figures?.[step.key];
  if (!figure) return null;
  return <span className={`min-w-0 text-right ${active ? "text-sm" : "text-xs"} tabular-nums text-slate-900 dark:text-slate-100`}>
    <span className="block whitespace-nowrap font-semibold"><MoneyText text={maskMoney(figureText(figure.amount), hideValues)} /></span>
    <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{figure.label}</span>
  </span>;
}

function Detail({ step, figures, hideValues, active = false }: { step: GrowLadderStep; figures?: CheckpointFigures; hideValues: boolean; active?: boolean }) {
  const hasFigure = Boolean(figures?.[step.key]);
  return <div>
    {active ? <><div className={hasFigure ? "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3" : ""}>
      <div className="min-w-0"><h3 className="break-words text-base font-bold leading-5 text-slate-950 dark:text-white">{step.title}</h3><span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${step.state === "attention" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" : "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200"}`}>{step.state === "attention" ? "Needs a look" : "Current"}</span></div>
      {hasFigure && <Figure step={step} figures={figures} hideValues={hideValues} active />}
    </div><p className="mt-3 min-w-0 text-sm leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={maskMoney(step.detail, hideValues)} /></p></> : <div className={hasFigure ? "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1" : ""}>
      <h3 className="min-w-0 break-words text-sm font-semibold leading-5 text-slate-950 dark:text-white">{step.title}</h3>
      {hasFigure && <Figure step={step} figures={figures} hideValues={hideValues} />}
      <p className={`${hasFigure ? "col-span-2" : "mt-1"} min-w-0 text-sm leading-5 text-slate-600 dark:text-slate-300`}><MoneyText text={maskMoney(step.detail, hideValues)} /></p>
    </div>}
    {step.link && <a href={step.link.route} className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold text-indigo-700 transition-[transform,opacity] hover:opacity-80 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">{step.link.label}<ChevronRight size={15} aria-hidden="true" /></a>}
    {active && step.state === "active" && step.options.length > 0 && <ul className="mt-4 space-y-2 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
      {step.options.map((option) => <li key={option} className="flex gap-2"><span className="text-indigo-500" aria-hidden="true">·</span><span><MoneyText text={maskMoney(option, hideValues)} /></span></li>)}
    </ul>}
  </div>;
}

function Fold({ kind, steps, figures, hideValues, last, initiallyOpen }: { kind: "done" | "locked"; steps: GrowLadderStep[]; figures?: CheckpointFigures; hideValues: boolean; last: boolean; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  if (!steps.length) return null;
  const label = kind === "done" ? `${steps.length} done · ${names(steps)}` : `${steps.length} more after this · ${names(steps)}`;
  return <div className="relative">
    <div className="absolute -left-8 top-2 z-10 sm:-left-10">{node(kind === "done" ? "done" : "locked")}</div>
    {!last && <span className="absolute -left-5 top-8 bottom-[-1rem] w-px bg-slate-200 dark:bg-slate-700 sm:-left-7" aria-hidden="true" />}
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={id} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-sm font-semibold text-slate-700 transition-[transform,background-color] active:scale-[0.99] hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:text-slate-200 dark:hover:bg-white/[0.04]">
      <span className="min-w-0 flex-1 truncate">{label}</span><ChevronDown size={16} aria-hidden="true" className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
    </button>
    <div id={id} inert={!open} className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
      <div className="overflow-hidden"><section data-g187-expanded-group="shared" className="glass-card rounded-3xl p-5">
        {steps.map((step, index) => <div key={step.key} className={index === 0 ? "" : "mt-4 border-t border-slate-200 pt-4 dark:border-slate-700"}><Detail step={step} figures={figures} hideValues={hideValues} /></div>)}
      </section></div>
    </div>
  </div>;
}

function Active({ step, figures, hideValues, last }: { step: GrowLadderStep; figures?: CheckpointFigures; hideValues: boolean; last: boolean }) {
  return <div className="relative">
    <div className="absolute -left-8 top-5 z-10 sm:-left-10">{node(step.state === "attention" ? "attention" : "active")}</div>
    {!last && <span className="absolute -left-5 top-11 bottom-[-1rem] w-px bg-slate-200 dark:bg-slate-700 sm:-left-7" aria-hidden="true" />}
    <article data-g187-active-card className="glass-card rounded-3xl p-5"><Detail step={step} figures={figures} hideValues={hideValues} active /></article>
  </div>;
}

export default function PlanningCheckpointTimeline({ steps, hideValues, figures, initialExpand = null }: { steps: GrowLadderStep[]; hideValues: boolean; figures?: CheckpointFigures; initialExpand?: ExpandGroup }) {
  const attention = steps.filter((step) => step.state === "attention");
  const done = steps.filter((step) => step.state === "done");
  const active = steps.filter((step) => step.state === "active");
  const locked = steps.filter((step) => step.state === "locked");
  if (!steps.length) return <section className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300"><h2 className="font-bold text-slate-900 dark:text-white">No checkpoints yet</h2><p className="mt-1">Planning needs a live reading to order your next steps.</p><a href="/accounts" className="mt-3 inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-indigo-700 transition-[transform,opacity] hover:opacity-80 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Add an account <ChevronRight className="ml-1" size={15} aria-hidden="true" /></a></section>;
  return <section data-g187-timeline="b" data-tutorial-id="tutorial-planning-ladder" aria-labelledby="planning-checkpoints-heading">
    <div className="mb-4"><h2 id="planning-checkpoints-heading" className="text-base font-bold text-slate-950 dark:text-white">Priority checkpoints</h2></div>
    <div className="relative ml-8 space-y-4 sm:ml-10">
      {attention.map((step, index) => <Active key={step.key} step={step} figures={figures} hideValues={hideValues} last={index === attention.length - 1 && !done.length && !active.length && !locked.length} />)}
      {done.length > 0 && <Fold kind="done" steps={done} figures={figures} hideValues={hideValues} initiallyOpen={initialExpand === "done" || initialExpand === "all"} last={!active.length && !locked.length} />}
      {active.map((step, index) => <Active key={step.key} step={step} figures={figures} hideValues={hideValues} last={index === active.length - 1 && !locked.length} />)}
      {locked.length > 0 && <Fold kind="locked" steps={locked} figures={figures} hideValues={hideValues} initiallyOpen={initialExpand === "later" || initialExpand === "all"} last />}
    </div>
  </section>;
}
