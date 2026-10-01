"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import type { GrowLadderStep } from "@wealth/shared";
import PlanningCheckpointTimeline from "@/components/PlanningCheckpointTimeline";
import type { CheckpointFigures } from "@/lib/planningCheckpointFigures";
import MoneyText from "@/components/MoneyText";
import { maskMoney } from "@/app/planning/GrowPanel";
import type { CheckpointMeta } from "./fixtures";

export type TimelineVariant = "a" | "b";
export type TimelineExpand = "done" | "later" | "all" | null;

function names(steps: GrowLadderStep[]) { const values = steps.map((step) => step.title); return values.length <= 3 ? values.join(", ") : `${values[0]}, ${values[1]} and ${values.length - 2} more`; }
function node(kind: "done" | "active" | "locked" | "watch" | "risk") {
  const common = "flex size-6 items-center justify-center rounded-full ring-4 ring-[#f0f2f7] dark:ring-[#0f172a]";
  if (kind === "done") return <span className={`${common} bg-emerald-500 text-white`}><Check size={13} strokeWidth={2.75} aria-hidden="true" /></span>;
  if (kind === "watch") return <span className={`${common} bg-amber-500 text-white`}><TriangleAlert size={13} strokeWidth={2.25} aria-hidden="true" /></span>;
  if (kind === "risk") return <span className={`${common} bg-red-500 text-white`}><TriangleAlert size={13} strokeWidth={2.25} aria-hidden="true" /></span>;
  if (kind === "active") return <span className={`${common} bg-indigo-600 text-white`}><ShieldCheck size={13} strokeWidth={2.25} aria-hidden="true" /></span>;
  return <span className={`${common} border border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400`}><Lock size={12} strokeWidth={2.1} aria-hidden="true" /></span>;
}
function stepFigure(step: GrowLadderStep, metadata: CheckpointMeta, hideValues: boolean) { const value = metadata[step.key]?.figure; return value ? maskMoney(value, hideValues) : null; }
function Figure({ step, metadata, hideValues, className = "" }: { step: GrowLadderStep; metadata: CheckpointMeta; hideValues: boolean; className?: string }) { const value = stepFigure(step, metadata, hideValues); const label = metadata[step.key]?.figureLabel; if (!value) return null; return <span className={`text-right ${className}`}><MoneyText text={value} className="block font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100" />{label && <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>}</span>; }

function CheckpointDetail({ step, metadata, hideValues, variant }: { step: GrowLadderStep; metadata: CheckpointMeta; hideValues: boolean; variant: TimelineVariant }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1"><p className="min-w-0 text-sm font-semibold text-slate-800 dark:text-slate-100">{step.title}</p>{variant === "b" && stepFigure(step, metadata, hideValues) && <Figure step={step} metadata={metadata} hideValues={hideValues} className="self-start whitespace-nowrap text-xs" />}<p className="col-span-2 text-sm leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={maskMoney(step.detail, hideValues)} /></p></div>;
}

function Fold({ kind, steps, metadata, hideValues, variant, last, initiallyOpen }: { kind: "done" | "locked"; steps: GrowLadderStep[]; metadata: CheckpointMeta; hideValues: boolean; variant: TimelineVariant; last: boolean; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen); const id = useId(); if (!steps.length) return null;
  const label = kind === "done" ? `${steps.length} done · ${names(steps)}` : `${steps.length} more after this · ${names(steps)}`;
  const expanded = variant === "a"
    ? <div data-g187-expanded-group="individual" className="space-y-3 pb-3 pt-2">{steps.map((step) => <article key={step.key} data-g187-expanded-card className="glass-card rounded-3xl p-5"><CheckpointDetail step={step} metadata={metadata} hideValues={hideValues} variant={variant} /></article>)}</div>
    : <section data-g187-expanded-group="shared" className="glass-card rounded-3xl p-5"><div className="space-y-4 divide-y divide-slate-200 dark:divide-slate-700">{steps.map((step, index) => <div key={step.key} className={index === 0 ? "" : "pt-4"}><CheckpointDetail step={step} metadata={metadata} hideValues={hideValues} variant={variant} /></div>)}</div></section>;
  return <div className="relative"><div className="absolute -left-8 top-2 z-10 sm:-left-10">{node(kind)}</div>{!last && <span className="absolute -left-5 top-8 bottom-[-1rem] w-px bg-slate-200 dark:bg-slate-700 sm:-left-7" />}<button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={id} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-sm font-semibold text-slate-700 transition-transform active:scale-[0.99] hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:text-slate-200 dark:hover:bg-white/[0.04]"><span className="min-w-0 flex-1 truncate">{label}</span><ChevronDown aria-hidden="true" size={16} className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} /></button><div id={id} inert={!open} className={`grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}><div className="overflow-hidden">{expanded}</div></div></div>;
}

function Active({ step, metadata, hideValues, variant, last }: { step: GrowLadderStep; metadata: CheckpointMeta; hideValues: boolean; variant: TimelineVariant; last: boolean }) {
  const meta = metadata[step.key]; const signal = meta?.attention === "risk" ? "risk" : meta?.attention === "watch" ? "watch" : "active"; const amount = stepFigure(step, metadata, hideValues);
  return <div className="relative"><div className="absolute -left-8 top-5 z-10 sm:-left-10">{node(signal)}</div>{!last && <span className="absolute -left-5 top-11 bottom-[-1rem] w-px bg-slate-200 dark:bg-slate-700 sm:-left-7" />}<article data-g187-active-card className="glass-card rounded-3xl p-5"><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"><div><h3 className="text-base font-bold text-slate-950 dark:text-white">{step.title}</h3><span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${meta?.attention ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" : "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200"}`}>{meta?.attention ? "Needs a look" : "Current"}</span></div>{variant === "b" && amount && <Figure step={step} metadata={metadata} hideValues={hideValues} className="self-start whitespace-nowrap text-sm" />}</div><p className="mt-3 text-sm leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={variant === "b" && meta?.summary ? maskMoney(meta.summary, hideValues) : maskMoney(step.detail, hideValues)} /></p>{step.options.length > 0 && <ul className="mt-4 space-y-1 border-t border-slate-200 pt-4 text-xs leading-4 text-slate-600 dark:border-slate-700 dark:text-slate-300">{step.options.slice(0, 2).map((option) => <li key={option} className="flex gap-2"><span className="text-indigo-500">·</span><span><MoneyText text={maskMoney(option, hideValues)} /></span></li>)}</ul>}</article></div>;
}

export default function Timeline({ steps, metadata, hideValues, variant, initialExpand, figures }: { steps: GrowLadderStep[]; metadata: CheckpointMeta; hideValues: boolean; variant: TimelineVariant; initialExpand: TimelineExpand; figures?: CheckpointFigures }) {
  // Variant B is the approved, shipped component. Variant A remains only as
  // an unselected record of the alternative Kevin considered.
  if (variant === "b") return <PlanningCheckpointTimeline steps={steps} hideValues={hideValues} figures={figures} initialExpand={initialExpand} />;
  const done = steps.filter((step) => step.state === "done"); const current = steps.filter((step) => step.state === "active" || step.state === "attention"); const locked = steps.filter((step) => step.state === "locked");
  if (!steps.length) return <section data-g187-timeline={variant} className="border-y border-dashed border-slate-300 py-5 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300"><h2 className="font-bold text-slate-900 dark:text-white">No checkpoints yet</h2><p className="mt-1">Your priorities will appear here once Planning has enough information.</p></section>;
  return <section data-g187-timeline={variant} aria-labelledby={`timeline-${variant}`}><div className="mb-4"><h2 id={`timeline-${variant}`} className="text-base font-bold text-slate-950 dark:text-white">Priority checkpoints</h2></div><div className="relative ml-8 space-y-4 sm:ml-10"><Fold kind="done" steps={done} metadata={metadata} hideValues={hideValues} variant={variant} last={!current.length && !locked.length} initiallyOpen={initialExpand === "done" || initialExpand === "all"} />{current.map((step, index) => <Active key={step.key} step={step} metadata={metadata} hideValues={hideValues} variant={variant} last={index === current.length - 1 && !locked.length} />)}<Fold kind="locked" steps={locked} metadata={metadata} hideValues={hideValues} variant={variant} last initiallyOpen={initialExpand === "later" || initialExpand === "all"} /></div><p className="ml-8 pt-1 text-xs text-slate-500 dark:text-slate-400 sm:ml-10">Completed and later checkpoints stay folded until you need their detail.</p></section>;
}
