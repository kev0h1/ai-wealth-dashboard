"use client";

// Section components for the full-page Insights redesign wireframe, built
// on Variant A (Kevin's pick, 2026-09-02). Reuses primitives and fixtures
// from ../insights-shape rather than copying them (SectionLabel,
// SegmentedBar, JobDot, HERO_CLASS, WHAT_WORKS_* copy/evidence, JOBS,
// VERDICT_SENTENCE, TREND_LINE) and the real Insights components/fixtures
// from ../insights-live and @/app/insights/InsightsPage. /design/insights-shape
// itself is left untouched — everything here is additive composition, not a
// fork of its files.

import { useState } from "react";
import { ChevronRight, Fingerprint, Sparkles, MoveRight } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { InsightCard, CompactInsightRow, isCompactPullInsight } from "@/app/insights/InsightsPage";
import { INSIGHT_FIXTURES, type FixtureKey } from "../insights-live/fixtures";
import {
  JOBS,
  VERDICT_SENTENCE,
  TREND_LINE,
  HERO_LABEL,
  WHAT_WORKS_LABEL,
  WHAT_WORKS_HEADLINE,
  WHAT_WORKS_THIN_HEADLINE,
  WHAT_WORKS_THIN_LINE,
  WHAT_WORKS_EVIDENCE,
  formatCash,
} from "../insights-shape/fixtures";
import { HERO_CLASS, SectionLabel, SegmentedBar, JobDot, type ShapeState } from "../insights-shape/shared";
import {
  TAP_HINT,
  JOB_HREF,
  MIRROR_CITATION,
  CONSENT_CHANGE_TITLE,
  CONSENT_CHANGE_BODY,
  CONSENT_CHANGE_BUTTON,
  CONSENT_CHANGE_WHISPER,
  CONSENT_KEEP_TITLE,
  CONSENT_KEEP_BODY,
  CONSENT_KEEP_CHIP,
  SHAPE_MOVES_LABEL,
  SHAPE_MOVES_FOOTER,
  FIXED_GROUP_KEYS,
  FREE_GROUP_KEYS,
  moveStripText,
  ELSEWHERE_LABEL,
  SPEND_MOCK_LINE,
  SPEND_MOCK_ANNOTATION,
  HOME_MOCK_WHISPER,
  HOME_MOCK_HEADLINE,
  HOME_MOCK_LINK,
  HOME_MOCK_ANNOTATION,
  PLANNING_MOCK_WHISPER,
  PLANNING_MOCK_HEADLINE,
  PLANNING_MOCK_BODY,
  PLANNING_MOCK_PRIMARY,
  PLANNING_MOCK_SECONDARY,
  PLANNING_MOCK_ANNOTATION,
  THIN_ELSEWHERE_NOTE,
} from "./fixtures";

export type Consent = "change" | "keep";

/* ─────────────────────── 1. Hero, Variant A + tappable legend ─────────── */

export function TappableHero() {
  return (
    <section className={HERO_CLASS}>
      <SectionLabel estimate>{HERO_LABEL}</SectionLabel>

      <div className="mt-3">
        <SegmentedBar heightClass="h-2" />
      </div>

      <div className="mt-3 space-y-1">
        {JOBS.map((job) => (
          <a
            key={job.key}
            href={JOB_HREF[job.key]}
            className="flex min-h-[40px] items-center gap-2.5 -mx-1 px-1 rounded-lg active:scale-[0.98] transition-transform"
          >
            <JobDot job={job} />
            <span className="flex-1 min-w-0 text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate">
              {job.label}
            </span>
            <MoneyText
              text={`£${job.amount.toLocaleString("en-GB")}`}
              className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0"
            />
            <span className="w-9 flex-shrink-0 text-right text-[12px] text-slate-500 dark:text-slate-400">{job.pct}%</span>
            <ChevronRight size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          </a>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{TAP_HINT}</p>

      <MoneyText
        text={VERDICT_SENTENCE}
        className="mt-3 block text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 text-pretty"
      />
      <p className="mt-2 text-[12px] italic text-slate-600 dark:text-slate-400 text-pretty">{TREND_LINE}</p>
    </section>
  );
}

/* ─────────────────────── 2. What works for you, extended ──────────────── */

function EvidenceRows() {
  return (
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
          <MoneyText text={formatCash(row.cash)} className="text-[13px] font-semibold text-slate-900 dark:text-slate-100" />
        </div>
      ))}
    </div>
  );
}

function ConsentFooter({ consent }: { consent: Consent }) {
  if (consent === "keep") {
    return (
      <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{CONSENT_KEEP_TITLE}</p>
          <span className="flex-shrink-0 rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            {CONSENT_KEEP_CHIP}
          </span>
        </div>
        <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">{CONSENT_KEEP_BODY}</p>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
      <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 text-pretty">{CONSENT_CHANGE_TITLE}</p>
      <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">{CONSENT_CHANGE_BODY}</p>
      <a
        href="/planning"
        className="mt-3 w-full min-h-[44px] rounded-xl border border-indigo-200 dark:border-indigo-500/40 flex items-center justify-center gap-2 text-[14px] font-semibold text-indigo-600 dark:text-indigo-400 active:scale-95 transition-transform"
      >
        <Sparkles size={14} aria-hidden="true" />
        {CONSENT_CHANGE_BUTTON}
      </a>
      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 text-center">{CONSENT_CHANGE_WHISPER}</p>
    </div>
  );
}

export function WhatWorksFull({ state, consent }: { state: ShapeState; consent: Consent }) {
  const thin = state === "thin";
  return (
    <div className="glass-card rounded-2xl p-4">
      <SectionLabel>{WHAT_WORKS_LABEL}</SectionLabel>

      {!thin && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400">
          <Fingerprint size={14} className="flex-shrink-0" aria-hidden="true" />
          <span>{MIRROR_CITATION}</span>
        </div>
      )}

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
          <EvidenceRows />
        </>
      )}

      <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">Describes your own history. Not advice.</p>

      {!thin && (
        <>
          <div className="mt-2 flex justify-end">
            <a
              href="#"
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
            >
              <Sparkles size={14} aria-hidden="true" />
              Ask Penny why
            </a>
          </div>
          <ConsentFooter consent={consent} />
        </>
      )}
    </div>
  );
}

/* ─────────────────────── 4. Where the shape can move ───────────────────── */

function ShapeAnchorStrip({ estimate, kind, colorClass }: { estimate: number; kind: "fixed share" | "free spending"; colorClass: string }) {
  return (
    <div className="-mt-1 flex items-center gap-1.5 px-1">
      <MoveRight size={14} className={`flex-shrink-0 ${colorClass}`} aria-hidden="true" />
      <p className="text-[12px] text-slate-600 dark:text-slate-300">
        {moveStripText(estimate, kind)}
        <span className="italic text-slate-600 dark:text-slate-400"> · estimated</span>
      </p>
    </div>
  );
}

// Eyebrow-stacking fix (impeccable critique): the section already carries
// one caps SectionLabel ("WHERE THE SHAPE CAN MOVE..."); the two group
// headers underneath read as content rows, not a second and third label, so
// they use the job's short group name ("Fixed" / "Free spending") rather
// than the hero legend's longer parenthetical form.
const GROUP_LABEL: Record<"fixed" | "free", string> = {
  fixed: "Fixed",
  free: "Free spending",
};

// Fold budget (matches the live tab's "Show N more ways to save" pattern,
// InsightsPage.tsx's VISIBLE_UNPINNED): the first 3 items in group order
// (Fixed's three, then Free's two) stay unfolded as rendered; any FULL card
// beyond that position folds behind the toggle. Compact rows are exempt —
// per the brief, they never fold, so a compact row past the cutoff (there
// isn't one in this fixture set, but the rule holds in general) still
// renders inline. In this fixture set the cutoff lands after car_finance
// (idx 2), so groceries (idx 3, compact) stays visible and Eating Out
// (idx 4, full) is the one card that folds.
const FOLD_CUTOFF = 3;

function computeFoldedIds(): Set<string> {
  const flat: FixtureKey[] = [...FIXED_GROUP_KEYS, ...FREE_GROUP_KEYS];
  const folded = new Set<string>();
  flat.forEach((key, idx) => {
    const insight = INSIGHT_FIXTURES[key];
    if (idx >= FOLD_CUTOFF && !isCompactPullInsight(insight)) {
      folded.add(insight.id);
    }
  });
  return folded;
}

function InsightGroup({
  jobKey,
  keys,
  stripKind,
  anyOpenHasEstimate,
  foldedIds,
  showAll,
}: {
  jobKey: "fixed" | "free";
  keys: FixtureKey[];
  stripKind: "fixed share" | "free spending";
  anyOpenHasEstimate: boolean;
  foldedIds: Set<string>;
  showAll: boolean;
}) {
  const job = JOBS.find((j) => j.key === jobKey)!;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <JobDot job={job} />
        <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{GROUP_LABEL[jobKey]}</span>
        <span className="flex-1" />
        <span className="text-[12px] text-slate-500 dark:text-slate-400">
          <MoneyText text={`£${job.amount.toLocaleString("en-GB")}`} /> · {job.pct}%
        </span>
      </div>

      {keys.map((key) => {
        const insight = INSIGHT_FIXTURES[key];
        const compact = isCompactPullInsight(insight);
        if (!compact && foldedIds.has(insight.id) && !showAll) return null;
        return (
          <div key={insight.id} className="space-y-1.5">
            {compact ? (
              <CompactInsightRow insight={insight} onExpand={() => {}} />
            ) : (
              <>
                <InsightCard
                  insight={insight}
                  workflow={null}
                  onPin={() => {}}
                  onContextSaved={() => {}}
                  anyOpenHasEstimate={anyOpenHasEstimate}
                />
                {insight.savings_estimate_monthly != null && (
                  <ShapeAnchorStrip estimate={insight.savings_estimate_monthly} kind={stripKind} colorClass={job.textClass} />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ShapeMovesSection() {
  const allKeys = [...FIXED_GROUP_KEYS, ...FREE_GROUP_KEYS];
  const anyOpenHasEstimate = allKeys.some((k) => INSIGHT_FIXTURES[k].savings_estimate_monthly != null);
  const foldedIds = computeFoldedIds();
  const [showAll, setShowAll] = useState(false);
  const hiddenCount = showAll ? 0 : foldedIds.size;

  return (
    <div>
      <SectionLabel>{SHAPE_MOVES_LABEL}</SectionLabel>
      <div className="mt-3 space-y-5">
        <InsightGroup
          jobKey="fixed"
          keys={FIXED_GROUP_KEYS}
          stripKind="fixed share"
          anyOpenHasEstimate={anyOpenHasEstimate}
          foldedIds={foldedIds}
          showAll={showAll}
        />
        <InsightGroup
          jobKey="free"
          keys={FREE_GROUP_KEYS}
          stripKind="free spending"
          anyOpenHasEstimate={anyOpenHasEstimate}
          foldedIds={foldedIds}
          showAll={showAll}
        />
      </div>

      {foldedIds.size > 0 && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="w-full mt-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 active:scale-[0.98] transition-all motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {showAll ? "Show fewer" : `Show ${hiddenCount} more way${hiddenCount === 1 ? "" : "s"} to save`}
        </button>
      )}

      <p className="mt-4 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">{SHAPE_MOVES_FOOTER}</p>
    </div>
  );
}

/* ─────────────────────── 6. Appendix ───────────────────────────────────── */

function ElsewhereItem({ children, annotation }: { children: React.ReactNode; annotation: string }) {
  return (
    <div className="space-y-1">
      {children}
      <p className="text-[11px] italic text-slate-500 dark:text-slate-400 text-pretty">{annotation}</p>
    </div>
  );
}

export function ElsewhereAppendix({ state }: { state: ShapeState }) {
  const thin = state === "thin";
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-4 space-y-4">
      <SectionLabel>{ELSEWHERE_LABEL}</SectionLabel>

      <ElsewhereItem annotation={SPEND_MOCK_ANNOTATION}>
        <a
          href="#"
          className="flex items-center gap-2 py-2 border-b border-slate-100 dark:border-white/5 active:opacity-70 transition-opacity"
        >
          <MoneyText text={SPEND_MOCK_LINE} className="flex-1 min-w-0 text-[13px] text-slate-700 dark:text-slate-300" />
          <ChevronRight size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        </a>
      </ElsewhereItem>

      {thin ? (
        // Both the Home change-moment and Planning proposal mocks cite a
        // six-period fact this fixture set's thin state doesn't have (only
        // two periods) — showing either would contradict the "Not enough
        // history yet" the What Works card already states. One whisper note
        // replaces both rather than mocking either.
        <p className="text-[12px] text-slate-500 dark:text-slate-400 text-pretty">{THIN_ELSEWHERE_NOTE}</p>
      ) : (
        <>
          <ElsewhereItem annotation={HOME_MOCK_ANNOTATION}>
            <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{HOME_MOCK_WHISPER}</p>
              <p className="mt-1 text-[15px] font-semibold text-slate-900 dark:text-slate-100 text-pretty">{HOME_MOCK_HEADLINE}</p>
              <a
                href="#"
                className="mt-1.5 inline-flex items-center text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
              >
                {HOME_MOCK_LINK} &rsaquo;
              </a>
            </div>
          </ElsewhereItem>

          <ElsewhereItem annotation={PLANNING_MOCK_ANNOTATION}>
            <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                <Sparkles size={12} aria-hidden="true" />
                {PLANNING_MOCK_WHISPER}
              </p>
              <p className="mt-1 text-[15px] font-semibold text-slate-900 dark:text-slate-100 text-pretty">{PLANNING_MOCK_HEADLINE}</p>
              <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">{PLANNING_MOCK_BODY}</p>
              <div className="mt-3 flex items-center gap-2">
                <a
                  href="#"
                  className="flex-1 min-h-[44px] rounded-xl bg-indigo-600 flex items-center justify-center text-[13px] font-semibold text-white active:scale-95 transition-transform"
                >
                  {PLANNING_MOCK_PRIMARY}
                </a>
                <a
                  href="#"
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-[13px] font-semibold text-slate-600 dark:text-slate-300 active:scale-95 transition-transform"
                >
                  {PLANNING_MOCK_SECONDARY}
                </a>
              </div>
            </div>
          </ElsewhereItem>
        </>
      )}
    </div>
  );
}
