"use client";

// Variant B, Action dock. This approved preview renders the production card
// components against typed fixtures so it remains a genuine regression gate.

import { useRouter } from "next/navigation";
import {
  AskGenericCard,
  AskPaydayCard,
  CelebrationCard,
  CliffCard,
  IntentPaceCard,
  MoveCard,
  RhythmCard,
  UnfundedMoveCard,
} from "@/components/HomeBrief";
import type { ProductionCardFixture } from "./productionFixtures";
import { PRODUCTION_CARD_FIXTURES, PRODUCTION_STACK_IDS } from "./productionFixtures";
import { PreviewHeading } from "./shared";

const maskAmounts = (text: string) => text;
const noopDismiss = () => {};

function ProductionCard({ fixture }: { fixture: ProductionCardFixture }) {
  const router = useRouter();
  const common = { item: fixture.item, maskAmounts, dismissible: true, onHomeDismiss: noopDismiss };

  let card: React.ReactNode;
  switch (fixture.kind) {
    case "ask_payday": card = <AskPaydayCard {...common} router={router} previewMode />; break;
    case "ask_generic": card = <AskGenericCard {...common} router={router} />; break;
    case "celebration": card = <CelebrationCard {...common} router={router} />; break;
    case "cliff": card = <CliffCard {...common} />; break;
    case "unfunded_move": card = <UnfundedMoveCard {...common} hideNetWorth={false} previewMode />; break;
    case "intent_pace": card = <IntentPaceCard {...common} />; break;
    case "cover_plan": card = <MoveCard {...common} hideNetWorth={false} />; break;
    case "rhythm": card = <RhythmCard {...common} router={router} previewMode />; break;
  }

  return <div className="contents" data-production-card-kind={fixture.kind}>{card}</div>;
}

export default function VariantB({ state }: { state: "stack" | "family" }) {
  const fixtures = state === "family"
    ? PRODUCTION_CARD_FIXTURES
    : PRODUCTION_CARD_FIXTURES.filter((fixture) => PRODUCTION_STACK_IDS.includes(fixture.item.id as typeof PRODUCTION_STACK_IDS[number]));
  return (
    <section aria-label="Variant B, Action dock">
      <PreviewHeading
        state={state}
        title="Production cards with one action dock"
        copy="These are the live components. Actions occupy the final band, keeping evidence distinct from each decision."
      />
      <div className={state === "family" ? "grid items-start gap-4 lg:grid-cols-2" : "mx-auto flex max-w-[430px] flex-col gap-3"}>
        {fixtures.map((fixture) => <ProductionCard key={fixture.item.id} fixture={fixture} />)}
      </div>
    </section>
  );
}
