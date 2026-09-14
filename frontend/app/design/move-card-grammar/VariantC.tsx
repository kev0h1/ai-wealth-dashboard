"use client";

import { MoveCard, UnfundedMoveCard } from "@/components/HomeBrief";
import type { CompanionItem, PlanMove, UnfundedMoveEntry } from "@/lib/api";
import type { MoveScenario } from "./fixtures";
import { PreviewHeading } from "./shared";

const NUMBER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function coverPlanItem(scenario: MoveScenario): CompanionItem {
  const destination = scenario.destination;
  const planBills = scenario.payments.map((payment, index) => ({
    label: payment.name,
    amount: payment.amount,
    expected_date: payment.expectedDate,
    ...(scenario.id === "three-payments" && index === 0
      ? {
          key: "american-express-planned-move",
          days_past_due: 3,
          can_skip: true,
        }
      : {}),
  }));
  const moves: PlanMove[] = scenario.sources.map((source, index) => ({
    headline: `Move ${NUMBER.format(source.amount)} from ${source.name}`,
    amount: source.amount,
    move_map: {
      from: {
        account_id: `source-${scenario.id}-${index}`,
        name: source.name,
        provider: source.provider,
        balance: source.amount + 100,
        safe_note: "Still covers its own bills",
      },
      to: {
        account_id: `destination-${scenario.id}`,
        name: destination.name,
        provider: destination.provider,
        balance: destination.held,
        incoming: NUMBER.format(scenario.moving),
      },
    },
  }));

  return {
    id: `preview-${scenario.id}`,
    type: "move",
    headline: `Move ${NUMBER.format(scenario.moving)} to ${destination.name}`,
    body: scenario.assurance,
    action: { label: scenario.primaryAction, route: "/upcoming" },
    estimated: false,
    brief_lead: { value: NUMBER.format(scenario.moving), companion: `to ${destination.name}` },
    moves,
    move_map: moves.length === 1 ? moves[0].move_map : undefined,
    plan_dest: {
      account_id: `destination-${scenario.id}`,
      name: destination.name,
      provider: destination.provider,
      balance: destination.held,
      needs_total: destination.needed,
      // The backend's account-wide field describes the first event. In a
      // mixed state that is the rolled-forward overdue occurrence, while
      // each current payment keeps its own later date below.
      needs_by: planBills.some(bill => bill.can_skip) ? "today" : destination.due,
      bills: planBills,
    },
    covered: true,
    sources_safe: true,
    amount: scenario.moving,
  };
}

function overdueItem(scenario: MoveScenario): CompanionItem {
  const payment = scenario.payments[0];
  const move: UnfundedMoveEntry = {
    key: payment.name,
    label: payment.name,
    amount: payment.amount,
    expected_date: "2026-09-09",
    days_past_due: 2,
    source_account_id: `destination-${scenario.id}`,
    source_name: scenario.destination.name,
    source_bank: scenario.destination.provider,
    suggested_amount: scenario.moving,
    suggested_from_name: scenario.sources.length === 1 ? scenario.sources[0].name : null,
    suggested_from_count: scenario.sources.length,
    suggested_covers_all: true,
    suggested_sources: scenario.sources.map((source, index) => ({
      account_id: `source-${scenario.id}-${index}`,
      name: source.name,
      provider: source.provider,
      amount: source.amount,
    })),
  };

  return {
    id: `preview-${scenario.id}`,
    type: "unfunded_move",
    headline: "A planned move may not have the funds.",
    body: scenario.assurance,
    action: { label: scenario.primaryAction, route: "/upcoming" },
    estimated: false,
    brief_lead: {
      value: NUMBER.format(scenario.moving),
      companion: scenario.sources.length === 1 ? `suggested from ${scenario.sources[0].name}` : `suggested from ${scenario.sources.length} accounts`,
    },
    moves: [move] as unknown as PlanMove[],
  };
}

export default function VariantC({ scenarios }: { scenarios: readonly MoveScenario[] }) {
  const maskAmounts = (text: string) => text;

  return (
    <section aria-label="Variant C, compact handoff">
      <PreviewHeading title="C · Compact handoff" copy="The production move card. Up to three account icons stack in reading order; larger sets show two real accounts with the +N tile in the rear position. Full source and payment details stay one tap away." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {scenarios.map(scenario => (
          <div key={scenario.id} data-move-scenario={scenario.id}>
            {scenario.overdue ? (
              <UnfundedMoveCard
                item={overdueItem(scenario)}
                hideNetWorth={false}
                maskAmounts={maskAmounts}
                previewMode
              />
            ) : (
              <MoveCard
                item={coverPlanItem(scenario)}
                hideNetWorth={false}
                maskAmounts={maskAmounts}
                previewMode
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
