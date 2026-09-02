"use client";

// Variant B, "Four tiles" — the verdict sentence leads as the hero line, a
// 2x2 grid of tiles carries the four jobs each with its own trend
// sparkline, the trend line closes it out underneath.

import MoneyText from "@/components/MoneyText";
import { JOBS, VERDICT_SENTENCE, TREND_LINE, HERO_LABEL } from "./fixtures";
import { HERO_CLASS, SectionLabel, Sparkline } from "./shared";

export default function VariantB() {
  return (
    <section className={HERO_CLASS}>
      <SectionLabel estimate>{HERO_LABEL}</SectionLabel>

      <MoneyText
        text={VERDICT_SENTENCE}
        className="mt-1.5 block text-[17px] font-bold leading-snug text-slate-900 dark:text-slate-100 text-pretty"
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        {JOBS.map((job) => (
          <div key={job.key} className="rounded-2xl border border-slate-200/70 dark:border-slate-800 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {job.shortLabel}
            </p>
            <div className="mt-1 flex items-baseline gap-1.5">
              <MoneyText
                text={`£${job.amount.toLocaleString("en-GB")}`}
                className="text-[16px] font-bold leading-tight text-slate-900 dark:text-slate-100"
              />
              <span className="text-[11px] text-slate-400 dark:text-slate-500">{job.pct}%</span>
            </div>
            <Sparkline trend={job.trend} className={`mt-1.5 ${job.textClass}`} />
          </div>
        ))}
      </div>

      <p className="mt-3 text-[12px] italic text-slate-500 dark:text-slate-400 text-pretty">{TREND_LINE}</p>
    </section>
  );
}
