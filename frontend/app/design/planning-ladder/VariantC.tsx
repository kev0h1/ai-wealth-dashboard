"use client";

// TEMPORARY PREVIEW — delete after design review. See PlanningLadderClient.tsx.

import { GrowHero, LadderRung, SplitGauge } from "@/app/planning/GrowPanel";
import { DebtPosition, GoalRow, SectionHeading } from "@/app/planning/LongTermPlanningPage";
import { DEBT_SUMMARY, GOALS, TODAY, growView } from "./fixtures";
import { AttentionLine, BufferTile, GrowNotes, buildLadderSteps, resolveAttention } from "./shared";

export const VARIANT_C_NOTE = {
  title: "C — Immediate first, ladder last",
  thesis:
    "Reorders the page instead of folding anything: the pay period, the card position and the goals move above the fold, the buffer readout follows, and the FULL 7-rung ladder (unchanged, every rung visible) sits last, for whoever wants to see the whole order once the live facts are dealt with.",
  risk:
    "The ladder was the page's whole premise (a single ordered plan); demoting it to the bottom risks it reading as an appendix nobody scrolls to, and the page now has two attention-shaped sections (hero line + Debt/Goals) that could feel repetitive.",
};

export default function VariantC({ state }: { state: "short" | "calm" }) {
  const view = growView(state);
  const attentionItems = resolveAttention(view, DEBT_SUMMARY, GOALS, TODAY, false);
  const heroItem = view.period_gate.short ? attentionItems.find((item) => item.tone === "watch") : attentionItems[0];
  const ladderSteps = buildLadderSteps(view);

  return (
    <div className="space-y-4">
      <GrowHero
        view={view}
        hideValues={false}
        onSeeDue={() => {}}
        attention={heroItem ? <AttentionLine item={heroItem} /> : undefined}
      />

      <DebtPosition debt={DEBT_SUMMARY} hideValues={false} onOpen={() => {}} />

      <section aria-labelledby="goals-c-title">
        <SectionHeading id="goals-c-title" title="Long-term goals" />
        <div className="glass-card overflow-hidden rounded-2xl divide-y divide-slate-200/70 dark:divide-white/10">
          {GOALS.map((goal) => (
            <GoalRow key={goal.id} goal={goal} hideValues={false} onOpen={() => {}} />
          ))}
        </div>
      </section>

      <BufferTile view={view} hideValues={false} />

      <div className="glass-card rounded-2xl p-4">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Priority ladder
        </p>
        <div>
          {ladderSteps.map((step, i) => (
            <LadderRung key={step.key} step={step} isLast={i === ladderSteps.length - 1} hideValues={false} />
          ))}
        </div>
      </div>

      <SplitGauge view={view} hideValues={false} />

      <GrowNotes notes={view.notes} hideValues={false} />

      <p className="px-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        One-off payments and this pay period&apos;s envelopes live in{" "}
        <a href="/upcoming" className="font-semibold text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400">
          Upcoming
        </a>
        .
      </p>
    </div>
  );
}
