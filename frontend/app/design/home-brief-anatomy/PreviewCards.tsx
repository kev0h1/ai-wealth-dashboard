"use client";

// Real cards, unchanged props and markup. Only this round's scoped CSS
// changes their anatomy. Capture guards keep unsafe actions local.
import { useState, type MouseEvent } from "react";
import type { useRouter } from "next/navigation";
import type { CompanionItem, SavingsInsight } from "@/lib/api";
import {
  AllocationShortfallCard, AskGenericCard, AskPaydayCard, BriefBody,
  CelebrationCard, CliffCard, IntentPaceCard, MoveCard, PlanEasingCard,
  RhythmCard, UnfundedMoveCard,
} from "@/components/HomeBrief";
import PaydayPlanCard from "@/components/PaydayPlanCard";
import HomeInsightSpotlight from "@/components/HomeInsightSpotlight";
import * as F from "./fixtures";
import styles from "./anatomy.module.css";

export type Variant = "a" | "b" | "reference";
export type View = "focus" | "family" | "edges" | "hidden" | "empty";
export type Example = { key: string; label: string; kind: "fact" | "ask" | "ask-payday" | "covered" | "move" | "unfunded" | "rhythm" | "pace" | "allocation" | "goal" | "payday" | "tip" | "month"; item?: CompanionItem; tip?: SavingsInsight };

export const EXAMPLES: Example[] = [
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

const EDGES: Example[] = [
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

export function examplesFor(view: View): Example[] {
  if (view === "empty") return [];
  if (view === "edges") return EDGES;
  if (view === "focus") return EXAMPLES.slice(0, 3);
  // Only cards that expose masking through props are included here. Tips
  // and legacy masking gaps are not disguised with pre-masked fixtures.
  if (view === "hidden") return EXAMPLES.filter(e => ["debt", "card-detail", "covered", "cover-plan", "overdue", "allocation", "payday"].includes(e.key));
  return EXAMPLES;
}

export function ProductionCard({ example, hidden, tell, hide }: { example: Example; hidden: boolean; tell: (text: string) => void; hide: () => void }) {
  const item = example.item!;
  const maskAmounts = (text: string) => hidden ? text.replace(/£[\d,]+(?:\.\d+)?/g, "£••••") : text;
  const router = { bfcacheId: "g295-preview", push: (route: string) => tell(`Would open ${route}. Preview only.`), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: async () => {} } satisfies ReturnType<typeof useRouter>;
  const common = { item, router, hideNetWorth: hidden, maskAmounts, dismissible: true, onHomeDismiss: hide, previewMode: true };
  switch (example.kind) {
    case "fact": return <CliffCard {...common} />;
    case "ask": return <AskGenericCard {...common} />;
    case "ask-payday": return <AskPaydayCard {...common} />;
    case "covered": return <CelebrationCard {...common} />;
    case "move": return <MoveCard {...common} />;
    case "unfunded": return <UnfundedMoveCard {...common} />;
    case "rhythm": return <RhythmCard {...common} />;
    case "pace": return <IntentPaceCard {...common} />;
    case "allocation": return <AllocationShortfallCard {...common} />;
    case "goal": return <PlanEasingCard {...common} />;
    case "payday": return <PaydayPlanCard {...common} />;
    case "tip": return <HomeInsightSpotlight previewInsight={example.tip} />;
    case "month": return <BriefBody items={[item]} safeToSpend={null} router={router} />;
  }
}

export function PreviewCard({ example, variant, hidden = false, tell }: { example: Example; variant: Variant; hidden?: boolean; tell: (text: string) => void }) {
  const [removed, setRemoved] = useState(false);
  const dismiss = () => { setRemoved(true); tell("Hidden in this preview. Reset examples to bring it back."); };
  const hasTile = ["fact", "ask", "ask-payday", "rhythm", "pace", "allocation", "goal"].includes(example.kind) && example.key !== "deferred";
  const tone = example.item?.type === "cliff" ? "watch" : example.item?.tone ?? "neutral";

  function guard(event: MouseEvent<HTMLDivElement>) {
    const control = (event.target as HTMLElement).closest<HTMLElement>("a,button");
    if (!control) return;
    const label = control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "";
    const guardAction = control.tagName === "A" || example.kind === "payday" || example.kind === "tip" || example.kind === "allocation" || example.kind === "goal" || label === "See the payments";
    if (!guardAction) return;
    event.preventDefault(); event.stopPropagation();
    if (/^(Dismiss|Hide on Home)/.test(label)) dismiss();
    else tell(`${label || "Open details"}: local preview only. Nothing is saved or moved.`);
  }

  if (removed) return null;
  const classes = [variant !== "reference" ? styles.candidate : "", hasTile ? styles.tile : "", variant === "b" ? styles.inline : "", example.kind === "payday" ? styles.payday : "", example.kind === "tip" ? styles.tip : "", example.kind === "month" ? styles.month : "", example.kind !== "tip" ? "px-4 lg:px-0" : ""].join(" ");
  return <div data-example={example.key} data-kind={example.kind} data-tone={tone} data-header-dismiss={!["ask", "ask-payday", "month"].includes(example.kind)} className={classes} onClickCapture={guard} onAuxClickCapture={guard}>
    <ProductionCard example={example} hidden={hidden} tell={tell} hide={dismiss} />
  </div>;
}
