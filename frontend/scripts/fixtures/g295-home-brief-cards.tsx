// Permanent SSR harness for G295's Home brief anatomy. It composes the
// shipped cards only: no preview route, scoped preview CSS or copied markup.
import type { ReactElement } from "react";
import type { useRouter } from "next/navigation";
import type { CompanionItem, SavingsInsight } from "@/lib/api";
import {
  AllocationShortfallCard,
  AskGenericCard,
  AskPaydayCard,
  BriefBody,
  CelebrationCard,
  CliffCard,
  IntentPaceCard,
  MoveCard,
  PlanEasingCard,
  RhythmCard,
  UnfundedMoveCard,
} from "@/components/HomeBrief";
import PaydayPlanCard from "@/components/PaydayPlanCard";
import HomeInsightSpotlight from "@/components/HomeInsightSpotlight";
import * as F from "@/scripts/fixtures/g295-home-brief-anatomy";

export type HomeBriefView = "focus" | "family" | "edges" | "hidden" | "empty";
export type HomeBriefKind = "fact" | "ask" | "ask-payday" | "covered" | "move" | "unfunded" | "rhythm" | "pace" | "allocation" | "goal" | "payday" | "tip" | "month";

export type HomeBriefExample = {
  key: string;
  label: string;
  kind: HomeBriefKind;
  item?: CompanionItem;
  tip?: SavingsInsight;
};

const EXAMPLES: readonly HomeBriefExample[] = [
  { key: "debt", label: "Debt trajectory", kind: "fact", item: F.TRAJECTORY_ITEM },
  { key: "card-detail", label: "Card detail", kind: "ask", item: F.ASK_CARD_ITEM },
  { key: "covered", label: "Covered reference", kind: "covered", item: F.COVERED_ITEM },
  { key: "payday-check", label: "Payday check", kind: "ask-payday", item: F.ASK_PAYDAY_ITEM },
  { key: "rate-change", label: "Rate change", kind: "fact", item: F.RATE_CHANGE_ITEM },
  { key: "rhythm-info", label: "Spending pattern", kind: "fact", item: F.RHYTHM_INFO_ITEM },
  { key: "rhythm", label: "Pattern with answers", kind: "rhythm", item: F.RHYTHM_ITEM },
  { key: "pace", label: "Pace note", kind: "pace", item: F.INTENT_PACE_ITEM },
  { key: "cover-plan", label: "Cover plan", kind: "move", item: F.COVER_MOVE_ITEM },
  { key: "overdue", label: "Move overdue", kind: "unfunded", item: F.UNFUNDED_MOVE_ITEM },
  { key: "allocation", label: "Set-aside", kind: "allocation", item: F.ALLOCATION_ITEM },
  { key: "goal", label: "Goal plan", kind: "goal", item: F.PLAN_EASING_ITEM },
  { key: "payday", label: "Payday allocation ledger", kind: "payday", item: F.PAYDAY_PLAN_ITEM },
  { key: "tip", label: "Tip", kind: "tip", tip: F.SPOTLIGHT_TIP },
  { key: "month", label: "Month closed", kind: "month", item: F.MONTH_CLOSED_ITEM },
];

const EDGES: readonly HomeBriefExample[] = [
  { key: "long", label: "Long account and evidence", kind: "covered", item: F.LONG_COVERED_ITEM },
  { key: "no-body", label: "No optional body", kind: "covered", item: F.MISSING_BODY_COVERED_ITEM },
  { key: "falling", label: "Debt coming down", kind: "fact", item: F.TRAJECTORY_FALLING_ITEM },
  { key: "flat", label: "Debt holding steady", kind: "fact", item: F.TRAJECTORY_FLAT_ITEM },
  { key: "unknown", label: "History unavailable", kind: "fact", item: F.TRAJECTORY_UNKNOWN_ITEM },
  { key: "ask-no-action", label: "No primary action", kind: "ask", item: { ...F.ASK_CARD_ITEM, id: "g295-no-action", action: null } },
  { key: "fallback-move", label: "Legacy cover-plan path", kind: "move", item: F.FALLBACK_MOVE_ITEM },
  { key: "fallback-overdue", label: "No safe funding source", kind: "unfunded", item: F.FALLBACK_UNFUNDED_ITEM },
  { key: "capped", label: "Goal easing held back", kind: "goal", item: F.PLAN_EASING_CAPPED_ITEM },
  { key: "deferred", label: "Existing eased-plan note", kind: "goal", item: F.PLAN_EASING_DEFERRED_ITEM },
  { key: "settled", label: "Payday already settled", kind: "payday", item: F.PAYDAY_PLAN_SETTLED_ITEM },
];

export function examplesFor(view: HomeBriefView): readonly HomeBriefExample[] {
  if (view === "empty") return [];
  if (view === "edges") return EDGES;
  if (view === "focus") return EXAMPLES.slice(0, 3);
  // Only production cards with native masking props are represented here.
  if (view === "hidden") return EXAMPLES.filter(({ key }) => ["debt", "card-detail", "covered", "cover-plan", "overdue", "allocation", "payday"].includes(key));
  return EXAMPLES;
}

const noop = () => {};
const testRouter = {
  bfcacheId: "g295-home-brief-ssr",
  push: noop,
  replace: noop,
  refresh: noop,
  back: noop,
  forward: noop,
  prefetch: async () => {},
} satisfies ReturnType<typeof useRouter>;

const maskAmounts = (hidden: boolean) => (text: string) => hidden
  ? text.replace(/£[\d,]+(?:\.\d+)?/g, "£••••")
  : text;

/** Renders the real production card with local inert callbacks for SSR only. */
export function ProductionCard({ example, hidden = false }: { example: HomeBriefExample; hidden?: boolean }): ReactElement | null {
  const item = example.item;
  const common = item ? {
    item,
    router: testRouter,
    hideNetWorth: hidden,
    maskAmounts: maskAmounts(hidden),
    dismissible: true,
    onHomeDismiss: noop,
    onRefresh: noop,
    previewMode: true,
  } : null;

  switch (example.kind) {
    case "fact": return <CliffCard item={item!} maskAmounts={maskAmounts(hidden)} dismissible onHomeDismiss={noop} />;
    case "ask": return <AskGenericCard item={item!} router={testRouter} maskAmounts={maskAmounts(hidden)} dismissible onHomeDismiss={noop} />;
    case "ask-payday": return <AskPaydayCard item={item!} router={testRouter} maskAmounts={maskAmounts(hidden)} previewMode />;
    case "covered": return <CelebrationCard item={item!} router={testRouter} maskAmounts={maskAmounts(hidden)} dismissible onHomeDismiss={noop} />;
    case "move": return <MoveCard {...common!} />;
    case "unfunded": return <UnfundedMoveCard {...common!} />;
    case "rhythm": return <RhythmCard item={item!} router={testRouter} maskAmounts={maskAmounts(hidden)} previewMode dismissible onHomeDismiss={noop} />;
    case "pace": return <IntentPaceCard item={item!} maskAmounts={maskAmounts(hidden)} dismissible onHomeDismiss={noop} />;
    case "allocation": return <AllocationShortfallCard item={item!} hideNetWorth={hidden} dismissible onHomeDismiss={noop} onRefresh={noop} />;
    case "goal": return <PlanEasingCard item={item!} hideNetWorth={hidden} dismissible onHomeDismiss={noop} onRefresh={noop} />;
    case "payday": return <PaydayPlanCard item={item!} router={testRouter} hideNetWorth={hidden} maskAmounts={maskAmounts(hidden)} dismissible />;
    case "tip": return <HomeInsightSpotlight previewInsight={example.tip} />;
    case "month": return <BriefBody items={[item!]} safeToSpend={null} router={testRouter} />;
  }
}

/**
 * A permanent, production-only page shape for server-rendered regressions.
 * Ordinary cards own a 16px outer gutter. The tip already owns that gutter.
 */
export function renderHomeBrief(view: HomeBriefView): ReactElement {
  const grouped = view === "family" || view === "edges" || view === "hidden";
  return (
    <section data-g295-home-brief data-g295-layout data-view={view} className={`mx-auto max-w-[430px] ${grouped ? "lg:max-w-6xl lg:px-8" : ""}`}>
      <div data-g295-card-grid className={grouped ? "grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2" : "space-y-3"}>
        {examplesFor(view).map(example => (
          <div
            key={example.key}
            data-example={example.key}
            data-kind={example.kind}
            data-hidden={view === "hidden" || undefined}
            className={example.kind === "tip" ? "min-w-0" : "min-w-0 px-4 lg:px-0"}
          >
            <ProductionCard example={example} hidden={view === "hidden"} />
          </div>
        ))}
        {view === "empty" && <div className="px-4 lg:px-0"><BriefBody items={[]} safeToSpend={null} router={testRouter} /></div>}
      </div>
    </section>
  );
}
