"use client";

// Variant B, Action dock. Facts stay in a calm card body while every choice
// lands in a stable footer. This makes mixed stacks easy to scan for cards
// that need action without colouring whole surfaces.

import { useState } from "react";
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

function ActionDockCard({ fixture }: { fixture: CardFixture }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="p-4">
        <div className="flex items-start gap-3 pr-9">
          <FixtureIcon fixture={fixture} />
          <div className="min-w-0 flex-1">
            <div className="flex min-h-6 items-center">
              <FixtureSignifier fixture={fixture} />
            </div>
            <h3 className="mt-1.5 break-words text-pretty text-[15px] font-bold leading-5 text-slate-950 dark:text-white">
              {fixture.headline}
            </h3>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          <FixtureLead fixture={fixture} />
          <FixtureBody fixture={fixture} />
          <FixtureEvidence fixture={fixture} />
        </div>
      </div>

      {fixture.actions?.length ? (
        <footer className="border-t border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-700/70 dark:bg-slate-900/25">
          <FixtureActions actions={fixture.actions} layout="fill" />
        </footer>
      ) : null}

      {fixture.dismissible ? (
        <DismissButton
          label="Hide on Home"
          onClick={() => setHidden(true)}
          className="absolute right-1.5 top-1.5"
        />
      ) : null}
    </section>
  );
}

export default function VariantB({ state }: { state: "stack" | "family" }) {
  const fixtures = fixturesFor(state, FAMILY_FIXTURES, STACK_FIXTURE_IDS);
  return (
    <section aria-label="Variant B, Action dock">
      <PreviewHeading
        state={state}
        title="All 8 cards with one action dock"
        copy="Actions always occupy the final band, so the eye can distinguish evidence from a decision before reading the button labels."
      />
      <div className={state === "family" ? "grid items-start gap-4 lg:grid-cols-2" : "mx-auto flex max-w-[430px] flex-col gap-3"}>
        {fixtures.map((fixture) => <ActionDockCard key={fixture.id} fixture={fixture} />)}
      </div>
    </section>
  );
}
