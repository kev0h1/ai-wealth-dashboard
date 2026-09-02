"use client";

// Shared bits across all three insights-shape hero variants: the whisper
// section label, small chart primitives (segmented bar, ribbon, sparkline)
// the heroes assemble differently, and the three page sections that do NOT
// change per variant — "What works for you", the reference-shapes link row,
// and the low-fidelity placeholder blocks standing in for the rest of the
// tab. See VariantA/B/C.tsx for the one section that DOES differ, the hero.

import { Sparkles } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import {
  JOBS,
  type JobShare,
  WHAT_WORKS_LABEL,
  WHAT_WORKS_HEADLINE,
  WHAT_WORKS_THIN_HEADLINE,
  WHAT_WORKS_THIN_LINE,
  WHAT_WORKS_EVIDENCE,
  REFERENCE_SHAPES,
  formatCash,
} from "./fixtures";

export type ShapeState = "full" | "thin";

export const HERO_CLASS = "glass-hero rounded-3xl p-4";

/** Whisper section label. `estimate` appends the honest "· from your
 *  transactions" marker the brief calls for next to the hero's label —
 *  these are derived numbers, not a bank-confirmed total, and the label
 *  says so rather than letting the figures imply more certainty than they
 *  have. */
export function SectionLabel({ children, estimate }: { children: React.ReactNode; estimate?: boolean }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
      {estimate && <span className="normal-case font-normal italic"> · from your transactions</span>}
    </p>
  );
}

/** One flat, rounded track split into four proportional segments. Track
 *  height is a prop so Variant A's 8px "one bar" and Variant C's 4px
 *  "ribbon" can share the exact same segment logic. */
export function SegmentedBar({ heightClass = "h-2" }: { heightClass?: string }) {
  return (
    <div className={`flex w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 ${heightClass}`}>
      {JOBS.map((job) => (
        <div key={job.key} className={job.bgClass} style={{ width: `${job.pct}%` }} aria-hidden="true" />
      ))}
    </div>
  );
}

/** Six-point trend line, no axes — a texture, not a chart to read values
 *  off. Colour comes from `currentColor` via the job's own `textClass`, so
 *  there is exactly one source of truth for each job's hue (see
 *  fixtures.ts), never a second hex value to drift out of sync. */
export function Sparkline({ trend, className }: { trend: number[]; className?: string }) {
  const w = 48;
  const h = 16;
  const pad = 2;
  const min = Math.min(...trend);
  const max = Math.max(...trend);
  const range = max - min || 1;
  const points = trend
    .map((v, i) => {
      const x = (i / (trend.length - 1)) * (w - pad * 2) + pad;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Colour dot identity marker, shared by the Variant A legend and the
 *  evidence-row grammar elsewhere on the page. */
export function JobDot({ job, className }: { job: JobShare; className?: string }) {
  return <span className={`inline-block rounded-full flex-shrink-0 ${job.bgClass} ${className ?? "h-2.5 w-2.5"}`} aria-hidden="true" />;
}

/** "What works for you" — shared across all three hero variants and both
 *  states. `state=thin` keeps the same card frame and whisper label but
 *  swaps the headline for an honest "not enough history yet" and drops the
 *  evidence rows and the Penny link entirely, matching the fixtures. */
export function WhatWorksCard({ state }: { state: ShapeState }) {
  const thin = state === "thin";
  return (
    <div className="glass-card rounded-2xl p-4">
      <SectionLabel>{WHAT_WORKS_LABEL}</SectionLabel>

      {thin ? (
        <>
          <p className="mt-1.5 text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100 text-pretty">
            {WHAT_WORKS_THIN_HEADLINE}
          </p>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 text-pretty">{WHAT_WORKS_THIN_LINE}</p>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100 text-pretty">
            {WHAT_WORKS_HEADLINE}
          </p>

          <div className="mt-3 rounded-xl divide-y divide-slate-100 dark:divide-white/5 border border-slate-100 dark:border-white/5 overflow-hidden">
            {WHAT_WORKS_EVIDENCE.map((row) => (
              <div key={row.period} className="flex items-center gap-2.5 px-3 py-2">
                <span className="w-8 flex-shrink-0 text-[13px] font-medium text-slate-600 dark:text-slate-300">{row.period}</span>
                <span
                  className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    row.timing === "early"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300"
                  }`}
                >
                  {row.timing}
                </span>
                <span className="flex-1" />
                <MoneyText
                  text={formatCash(row.cash)}
                  className="text-[13px] font-semibold text-slate-900 dark:text-slate-100"
                />
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">Describes your own history. Not advice.</p>
        {!thin && (
          <a href="#" className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity">
            <Sparkles size={14} aria-hidden="true" />
            Ask Penny why
          </a>
        )}
      </div>
    </div>
  );
}

/** Reference-shapes row — plain text, no card frame, wireframe-only links. */
export function ReferenceShapesRow() {
  return (
    <div className="px-1">
      <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400 text-pretty">
        How do people usually think about this?{" "}
        {REFERENCE_SHAPES.map((name, i) => (
          <span key={name}>
            <a href="#" className="text-indigo-600 dark:text-indigo-400 underline underline-offset-4 active:opacity-70 transition-opacity">
              {name}
            </a>
            {i < REFERENCE_SHAPES.length - 1 ? ", " : ""}
          </span>
        ))}
      </p>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        Opens an explainer in Penny. Reference only, not a target.
      </p>
    </div>
  );
}

/** One dashed, obviously-wireframe placeholder block. Optional `nested` puts
 *  a second, smaller dashed block inside — used for "Ways to save" tucked
 *  under "Fixed costs, drifting". */
export function PlaceholderBlock({
  label,
  note,
  nested,
}: {
  label: string;
  note: string;
  nested?: { label: string; note: string };
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">{note}</p>
      {nested && (
        <div className="mt-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{nested.label}</p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">{nested.note}</p>
        </div>
      )}
    </div>
  );
}

/** The rest of the proposed page order, low-fidelity — everything below the
 *  hero and the evidence card that this wireframe is not redesigning. */
export function PlaceholdersSection() {
  return (
    <div className="space-y-3">
      <PlaceholderBlock
        label="Fixed costs, drifting"
        note="Placeholder. Bills and subscriptions that moved since last pay period."
        nested={{ label: "Ways to save", note: "Existing research cards move here." }}
      />
      <PlaceholderBlock label="Tax efficiency" note="Placeholder. Unchanged." />
    </div>
  );
}
