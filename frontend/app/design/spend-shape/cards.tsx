"use client";

// TEMPORARY PREVIEW — A and C are reference forks, kept for comparison.
// B is the shipped design as of 2026-09-05 and renders the LIVE
// components/SpendShapeCard.tsx directly, not a redrawn fork — see
// SpendShapeClient.tsx for the full brief. Reuses MoneyShapeHero's own
// JOB_COLOR palette for the bar segments — this card and the destination
// hero it opens must never disagree on what each colour means (DESIGN.md:
// colour is information).

import { ChevronRight } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { JOB_COLOR } from "@/app/spend/shape/MoneyShapeHero";
import SpendShapeCard from "@/components/SpendShapeCard";
import type { MoneyShape, MoneyShapeJob } from "@/lib/api";

const JOB_ORDER: MoneyShapeJob["id"][] = ["fixed", "moved", "free", "left"];

function orderedJobs(jobs: MoneyShapeJob[]): MoneyShapeJob[] {
  return JOB_ORDER.map((id) => jobs.find((j) => j.id === id)).filter((j): j is MoneyShapeJob => !!j);
}

function ShapeBar({ jobs }: { jobs: MoneyShapeJob[] }) {
  return (
    <div className="mt-2 flex w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 h-2" aria-hidden="true">
      {orderedJobs(jobs).map((job) => (
        <div key={job.id} className={JOB_COLOR[job.id].bg} style={{ width: `${Math.max(0, job.share)}%` }} />
      ))}
    </div>
  );
}

// The trailing month token off the period's own label ("28 Jul to 27 Aug"
// -> "Aug") rather than a hardcoded month — the fixture is a specific pay
// period, not always August. Falls back to the most recent `periods` entry
// when `shape.period` itself isn't set (mirrors MoneyShapeHero's own
// periods-vs-top-level fallback), then to a generic phrase if neither is
// present.
function periodShortLabel(shape: MoneyShape): string {
  const label = shape.period?.label ?? shape.periods?.[0]?.label;
  if (!label) return "this period";
  const end = label.split(" to ").pop() ?? label;
  const tokens = end.trim().split(" ");
  return tokens[tokens.length - 1] || label;
}

function CardLabel({ shape }: { shape: MoneyShape }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      How your pay was split · {periodShortLabel(shape)}
    </p>
  );
}

function CardShell({ onOpen, children }: { onOpen: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-card rounded-2xl p-4 w-full min-h-11 text-left active:scale-[0.98] transition-transform"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <ChevronRight size={16} className="flex-shrink-0 mt-0.5 text-slate-400 dark:text-slate-500" aria-hidden="true" />
      </div>
    </button>
  );
}

// ── A, the sentence — bar, then the verdict sentence, nothing else. ───────
export function ShapeCardA({ shape, onOpen }: { shape: MoneyShape; onOpen: () => void }) {
  return (
    <CardShell onOpen={onOpen}>
      <CardLabel shape={shape} />
      <ShapeBar jobs={shape.jobs ?? []} />
      {shape.verdict && (
        <MoneyText
          text={shape.verdict}
          className="mt-3 block text-[14px] leading-relaxed text-slate-900 dark:text-slate-100 text-pretty"
        />
      )}
    </CardShell>
  );
}

// ── B, the instrument — the shipped design (2026-09-05). Renders the LIVE
// components/SpendShapeCard.tsx directly rather than a redrawn fork, so this
// preview can never drift from what actually ships. `hideValues` is fixed
// false here — this preview has no hide-values toggle of its own, and
// showing the real £ figure is the point of a design preview. ───────────
export function ShapeCardB({ shape, onOpen }: { shape: MoneyShape; onOpen: () => void }) {
  return <SpendShapeCard shape={shape} hideValues={false} onOpen={onOpen} />;
}

// ── C, the change — bar, then the trend line, then a quiet "tap for more"
// line. ─────────────────────────────────────────────────────────────────
export function ShapeCardC({ shape, onOpen }: { shape: MoneyShape; onOpen: () => void }) {
  return (
    <CardShell onOpen={onOpen}>
      <CardLabel shape={shape} />
      <ShapeBar jobs={shape.jobs ?? []} />
      {shape.trend_line && (
        <p className="mt-3 text-[13px] italic text-slate-500 dark:text-slate-400 text-pretty">{shape.trend_line}</p>
      )}
      <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        Tap for the full shape and what works for you
      </p>
    </CardShell>
  );
}
