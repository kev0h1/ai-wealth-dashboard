"use client";

// Variant C, Folded brief. A stable synopsis row keeps a long Home stack
// compact; disclosure reveals the same body, evidence and settled actions.
// Dense movement cards open by default, while quieter cards begin folded.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CardFixture } from "./fixtures";
import { FAMILY_FIXTURES, STACK_FIXTURE_IDS } from "./fixtures";
import { DismissButton } from "./primitives";
import {
  FixtureActions,
  FixtureBody,
  FixtureEvidence,
  FixtureIcon,
  FixtureLead,
  FixtureSignifier,
  PreviewHeading,
  fixturesFor,
} from "./shared";

function startsOpen(fixture: CardFixture): boolean {
  return fixture.kind === "unfunded_move" || fixture.kind === "cover_plan" || fixture.kind === "ask_payday" || fixture.kind === "rhythm";
}

function FoldedBriefCard({ fixture }: { fixture: CardFixture }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <details open={startsOpen(fixture)} className="group">
        <summary className="flex min-h-[76px] touch-manipulation cursor-pointer list-none items-start gap-3 px-4 py-3.5 pr-14 [-webkit-tap-highlight-color:transparent] [@media(hover:hover)]:hover:bg-slate-50/70 dark:[@media(hover:hover)]:hover:bg-slate-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden">
          <FixtureIcon fixture={fixture} size="small" />
          <div className="min-w-0 flex-1">
            <FixtureSignifier fixture={fixture} />
            <h3 className="mt-1.5 break-words text-pretty text-[14px] font-bold leading-5 text-slate-950 dark:text-white">
              {fixture.headline}
            </h3>
            <FixtureLead fixture={fixture} compact />
          </div>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="mt-2 shrink-0 text-slate-400 group-open:rotate-180 dark:text-slate-500"
          />
        </summary>

        <div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-700/70">
          <FixtureBody fixture={fixture} />
          <div className={fixture.body ? "mt-3" : ""}>
            <FixtureEvidence fixture={fixture} condensed />
          </div>
          {fixture.actions?.length ? (
            <div className="mt-3">
              <FixtureActions actions={fixture.actions} layout="fill" />
            </div>
          ) : null}
        </div>
      </details>

      {fixture.dismissible ? (
        <DismissButton
          label="Hide on Home"
          onClick={() => setHidden(true)}
          className="absolute right-1.5 top-1.5 z-10"
        />
      ) : null}
    </section>
  );
}

export default function VariantC({ state }: { state: "stack" | "family" }) {
  const fixtures = fixturesFor(state, FAMILY_FIXTURES, STACK_FIXTURE_IDS);
  return (
    <section aria-label="Variant C, Folded brief">
      <PreviewHeading
        state={state}
        title="All 8 cards as folded briefs"
        copy="The synopsis stays visible. Dense moves open with their evidence; quieter context folds until it is wanted, reducing a long Home feed without deleting facts."
      />
      <div className={state === "family" ? "grid items-start gap-4 lg:grid-cols-2" : "mx-auto flex max-w-[430px] flex-col gap-3"}>
        {fixtures.map((fixture) => <FoldedBriefCard key={fixture.id} fixture={fixture} />)}
      </div>
    </section>
  );
}
