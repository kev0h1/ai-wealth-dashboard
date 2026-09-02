"use client";

// Variant C, "Sentence-led" — the verdict sentence itself is the hero, a
// thin 4px ribbon with no legend sits under it, and four whisper labels
// aligned to the ribbon's segments name the shares. Calmest, least
// chart-like of the three.

import MoneyText from "@/components/MoneyText";
import { JOBS, VERDICT_SENTENCE, TREND_LINE, HERO_LABEL } from "./fixtures";
import { HERO_CLASS, SectionLabel, SegmentedBar } from "./shared";

export default function VariantC() {
  return (
    <section className={HERO_CLASS}>
      <SectionLabel estimate>{HERO_LABEL}</SectionLabel>

      <MoneyText
        text={VERDICT_SENTENCE}
        className="mt-1.5 block text-[19px] font-bold leading-snug text-slate-900 dark:text-slate-100 text-pretty"
      />

      <div className="mt-4">
        <SegmentedBar heightClass="h-1" />
      </div>

      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
        {JOBS.map((job, i) => (
          <span key={job.key} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">·</span>}
            {job.shortLabel} {job.pct}%
          </span>
        ))}
      </div>

      <p className="mt-3 text-[12px] italic text-slate-500 dark:text-slate-400 text-pretty">{TREND_LINE}</p>
    </section>
  );
}
