"use client";

// TEMPORARY PREVIEW — delete after design review. See PlanningLadderClient.tsx.

import { GrowHero } from "@/app/planning/GrowPanel";
import { DebtPosition, GoalRow, SectionHeading } from "@/app/planning/LongTermPlanningPage";
import { DEBT_SUMMARY, GOALS, TODAY, growView } from "./fixtures";
import { CashAndInvestments, CollapsedLadder, GrowNotes, SectionJumpStrip } from "./shared";

export const VARIANT_A_NOTE = {
  title: "A, collapsed ladder + jump strip",
  thesis:
    "The hero is the only place the period truth is spoken. The ladder folds to what's live: cleared rungs fold into one line, locked rungs fold into another. A three-chip strip under the hero points at buffer, debt and goals, with a dot on whichever needs a look, so nothing below the fold is forgotten.",
  risk:
    "A chip strip is one more row under the hero, and dots only say \"look\", the reason still waits at the section.",
};

export default function VariantA({ state }: { state: "short" | "calm" }) {
  const view = growView(state);

  return (
    <div className="space-y-4">
      <GrowHero view={view} hideValues={false} onSeeDue={() => {}} />

      <SectionJumpStrip view={view} debt={DEBT_SUMMARY} goals={GOALS} today={TODAY} hideValues={false} />

      <CollapsedLadder steps={view.ladder} hideValues={false} />

      <CashAndInvestments view={view} hideValues={false} onEdit={undefined} />

      <div id="debt" className="scroll-mt-4">
        <DebtPosition debt={DEBT_SUMMARY} hideValues={false} onOpen={() => {}} />
      </div>

      <section id="commitments" className="scroll-mt-4" aria-labelledby="goals-a-title">
        <SectionHeading id="goals-a-title" title="Long-term goals" />
        <div className="glass-card overflow-hidden rounded-2xl divide-y divide-slate-200/70 dark:divide-white/10">
          {GOALS.map((goal) => (
            <GoalRow key={goal.id} goal={goal} hideValues={false} onOpen={() => {}} />
          ))}
        </div>
      </section>

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
