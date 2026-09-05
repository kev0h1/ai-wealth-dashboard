"use client";

// TEMPORARY PREVIEW — delete after design review. See PlanningLadderClient.tsx.

import { GrowHero, SplitGauge } from "@/app/planning/GrowPanel";
import { DebtPosition, GoalRow, SectionHeading } from "@/app/planning/LongTermPlanningPage";
import { DEBT_SUMMARY, GOALS, TODAY, growView } from "./fixtures";
import { BufferTile, CollapsedLadder, GrowNotes, NeedsYouCard, buildLadderSteps, resolveAttention } from "./shared";

export const VARIANT_B_NOTE = {
  title: "B — Needs-you card",
  thesis:
    "Everything the ladder buries gets one new, dedicated card right under the hero, before the ladder even renders: every live attention fact in one place, ranked risk-then-watch, each a tap away from where it's resolved. The ladder itself still folds (same collapse as A) but is no longer the only place these facts could have shown up.",
  risk:
    "A new card competes for the top of the screen with the hero itself, and if the resolver ever returns nothing, the tab needs to look intentional with the card simply absent rather than leaving a gap.",
};

export default function VariantB({ state }: { state: "short" | "calm" }) {
  const view = growView(state);
  const attentionItems = resolveAttention(view, DEBT_SUMMARY, GOALS, TODAY, false);

  return (
    <div className="space-y-4">
      <GrowHero view={view} hideValues={false} onSeeDue={() => {}} />

      <NeedsYouCard items={attentionItems} />

      <CollapsedLadder steps={buildLadderSteps(view)} hideValues={false} />

      <BufferTile view={view} hideValues={false} />

      <DebtPosition debt={DEBT_SUMMARY} hideValues={false} onOpen={() => {}} />

      <section aria-labelledby="goals-b-title">
        <SectionHeading id="goals-b-title" title="Long-term goals" />
        <div className="glass-card overflow-hidden rounded-2xl divide-y divide-slate-200/70 dark:divide-white/10">
          {GOALS.map((goal) => (
            <GoalRow key={goal.id} goal={goal} hideValues={false} onOpen={() => {}} />
          ))}
        </div>
      </section>

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
