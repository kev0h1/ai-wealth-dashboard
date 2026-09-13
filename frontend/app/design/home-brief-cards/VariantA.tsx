"use client";

// Variant A, Calm spine. Every card follows the same reading order:
// semantic signifier, verdict, lead figure, evidence, then actions. The
// dismiss control occupies one fixed corner and never steals body width.

import { useState } from "react";
import type { CardFixture } from "./fixtures";
import { FAMILY_FIXTURES, STACK_FIXTURE_IDS } from "./fixtures";
import { DismissButton, PreviewCard } from "./primitives";
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

function CalmSpineCard({ fixture }: { fixture: CardFixture }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <PreviewCard className="relative">
      <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-3 pr-9">
        <FixtureIcon fixture={fixture} />
        <div className="min-w-0">
          <FixtureSignifier fixture={fixture} />
          <h3 className="mt-2 break-words text-pretty text-[15px] font-bold leading-5 text-slate-950 dark:text-white">
            {fixture.headline}
          </h3>
          <FixtureLead fixture={fixture} />
        </div>
      </div>

      <div className="mt-3 sm:pl-12">
        <FixtureBody fixture={fixture} />
        <div className={fixture.body ? "mt-3" : ""}>
          <FixtureEvidence fixture={fixture} />
        </div>
        {fixture.actions?.length ? (
          <div className="mt-3">
            <FixtureActions actions={fixture.actions} />
          </div>
        ) : null}
      </div>

      {fixture.dismissible ? (
        <DismissButton
          label="Hide on Home"
          onClick={() => setHidden(true)}
          className="absolute right-1.5 top-1.5"
        />
      ) : null}
    </PreviewCard>
  );
}

export default function VariantA({ state }: { state: "stack" | "family" }) {
  const fixtures = fixturesFor(state, FAMILY_FIXTURES, STACK_FIXTURE_IDS);
  return (
    <section aria-label="Variant A, Calm spine">
      <PreviewHeading
        state={state}
        title="All 8 cards, one calm spine"
        copy="Recommended. Each card answers what happened, how much, why, and what to do in the same order. Amber stays in the small attention mark."
      />
      <div className={state === "family" ? "grid items-start gap-4 lg:grid-cols-2" : "mx-auto flex max-w-[430px] flex-col gap-3"}>
        {fixtures.map((fixture) => <CalmSpineCard key={fixture.id} fixture={fixture} />)}
      </div>
    </section>
  );
}
