"use client";

// Variant A, "One bar" — a single segmented track leads, a four-row legend
// underneath spells out the £ figures, the verdict sentence and trend line
// sit below the legend. The most literal, chart-first reading of the four
// jobs.

import MoneyText from "@/components/MoneyText";
import { JOBS, VERDICT_SENTENCE, TREND_LINE, HERO_LABEL } from "./fixtures";
import { HERO_CLASS, SectionLabel, SegmentedBar, JobDot } from "./shared";

export default function VariantA() {
  return (
    <section className={HERO_CLASS}>
      <SectionLabel estimate>{HERO_LABEL}</SectionLabel>

      <div className="mt-3">
        <SegmentedBar heightClass="h-2" />
      </div>

      <div className="mt-3 space-y-2">
        {JOBS.map((job) => (
          <div key={job.key} className="flex items-center gap-2.5">
            <JobDot job={job} />
            <span className="flex-1 min-w-0 text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate">
              {job.label}
            </span>
            <MoneyText
              text={`£${job.amount.toLocaleString("en-GB")}`}
              className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0"
            />
            <span className="w-9 flex-shrink-0 text-right text-[12px] text-slate-400 dark:text-slate-500">{job.pct}%</span>
          </div>
        ))}
      </div>

      <MoneyText
        text={VERDICT_SENTENCE}
        className="mt-3 block text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 text-pretty"
      />
      <p className="mt-2 text-[12px] italic text-slate-500 dark:text-slate-400 text-pretty">{TREND_LINE}</p>
    </section>
  );
}
