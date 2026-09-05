"use client";

// The one instrument card that ends Spend's period view (owner decisions
// 2026-09-05): four figures, no prose, matching the Instrument Header's own
// grammar. Ported from the approved preview's Card B
// (app/design/spend-shape/cards.tsx's ShapeCardB) — this IS the shipped
// design now, see that file's own note. Reuses MoneyShapeHero's JOB_COLOR
// for the bar segments so this card and the destination hero it opens can
// never disagree on what each colour means (DESIGN.md: colour is
// information).
//
// Opens /spend/shape, a drill-in page holding the shape hero (with its own
// period/average picker), what works for you, and the reference shapes —
// nothing else (tips live in category sublines and on the transactions
// page now, see DESIGN.md's 2026-09-05 note).

import { ChevronRight } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { JOB_COLOR } from "@/app/spend/shape/MoneyShapeHero";
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

// The trailing token off the period's own label, rather than a hardcoded
// month. money_shape.py's `_period_label` already sends this short (e.g.
// "Aug" for most rhythms, "w/c 3 Mar" for a weekly one) — splitting on
// " to " and taking the last word is a no-op for that real shape (no
// match, the whole string survives), it only trims a longer "DD Mon to DD
// Mon" label back to its trailing month, which no live payload sends today
// but this route's own design fixtures do (readability in a picker-sheet
// context). Falls back to the most recent `periods` entry when
// `shape.period` itself isn't set (mirrors MoneyShapeHero's own
// periods-vs-top-level fallback), then to a generic
// phrase if neither is present.
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

function Cell({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 truncate">{label}</p>
      {money ? (
        <MoneyText text={value} className="mt-0.5 block text-[13px] font-semibold tabular-nums text-slate-900 dark:text-slate-100 truncate" />
      ) : (
        <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-slate-900 dark:text-slate-100 truncate">{value}</p>
      )}
    </div>
  );
}

// Height pinned to the loaded card's own measured height (115px at 398px
// content width, border-box, p-4 — verified via a headless-Chrome
// getBoundingClientRect() check against /design/spend-shape?variant=b,
// 2026-09-05 review round), not a guess: a skeleton taller or shorter than
// its real content causes a layout jump the instant the fetch resolves.
function CardSkeleton() {
  return <div className="glass-card h-[115px] animate-pulse rounded-2xl" aria-hidden="true" />;
}

export default function SpendShapeCard({
  shape,
  hideValues,
  onOpen,
}: {
  shape: MoneyShape | null | undefined;
  hideValues: boolean;
  onOpen: () => void;
}) {
  if (shape === undefined) return <CardSkeleton />;
  if (shape === null || shape.status === "thin") return null;

  const jobs = orderedJobs(shape.jobs ?? []);
  const fixed = jobs.find((j) => j.id === "fixed");
  const moved = jobs.find((j) => j.id === "moved");
  const free = jobs.find((j) => j.id === "free");
  const left = jobs.find((j) => j.id === "left");
  const overspent = shape.overspent > 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-card rounded-2xl p-4 w-full min-h-11 text-left active:scale-[0.98] transition-transform"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <CardLabel shape={shape} />
          <ShapeBar jobs={shape.jobs ?? []} />
          <div className="mt-3 grid grid-cols-4 gap-2">
            {fixed && <Cell label="Fixed" value={`${Math.round(fixed.share)}%`} />}
            {moved && <Cell label="Moved" value={`${Math.round(moved.share)}%`} />}
            {free && <Cell label="Free" value={`${Math.round(free.share)}%`} />}
            {overspent ? (
              <Cell
                label="Beyond"
                value={hideValues ? "£••••" : `£${Math.round(shape.overspent).toLocaleString("en-GB")}`}
                money
              />
            ) : (
              left && <Cell label="Left" value={`${Math.round(left.share)}%`} />
            )}
          </div>
        </div>
        <ChevronRight size={16} className="flex-shrink-0 mt-0.5 text-slate-400 dark:text-slate-500" aria-hidden="true" />
      </div>
    </button>
  );
}
