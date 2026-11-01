"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AskGenericCard, CelebrationCard, MoveCard } from "@/components/HomeBrief";
import PaydayPlanCard from "@/components/PaydayPlanCard";
import { BalancesHiddenContext, maskMoneyText } from "@/lib/balancesHidden";
import { PresenceNav } from "./PresenceChrome";
import { PRESENCE_ACTION_ROUTES, PRESENCE_FIXTURES, PRESENCE_STACK_ORDER, type PresenceState, type PresenceVariant } from "./fixtures";
import styles from "./presence.module.css";

export type PresenceGalleryProps = {
  variant: PresenceVariant;
  state: PresenceState;
  masked: boolean;
  onAction: (label: string, route: string) => void;
  onPennyOpen: () => void;
};

function actionFrom(target: Element): { label: string; route: string } | null {
  const control = target.closest("a, button");
  if (!control) return null;
  const label = control.textContent?.replace(/\s+/g, " ").trim() || "Open";
  const anchor = control.closest("a");
  return { label, route: anchor?.getAttribute("href") || PRESENCE_ACTION_ROUTES[label] || "/" };
}

function FixtureCard({ card, children, onAction }: { card: typeof PRESENCE_STACK_ORDER[number]; children: ReactNode; onAction: PresenceGalleryProps["onAction"] }) {
  function intercept(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("summary, [data-presence-native]")) return;
    const action = actionFrom(target) ?? (target.closest('[role="button"]') ? { label: "View in Upcoming", route: "/upcoming" } : null);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    onAction(action.label, action.route);
  }

  function interceptKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("summary, [data-presence-native]")) return;
    if ((event.key !== "Enter" && event.key !== " ") || !target.closest('[role="button"]')) return;
    event.preventDefault();
    event.stopPropagation();
    onAction("View in Upcoming", "/upcoming");
  }

  return <div data-g388-card={card.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)} className={styles.fixtureCard} onClickCapture={intercept} onKeyDownCapture={interceptKeyboard}>{children}</div>;
}

function CardByKey({ card, masked, onAction }: { card: typeof PRESENCE_STACK_ORDER[number]; masked: boolean; onAction: PresenceGalleryProps["onAction"] }) {
  const router = useRouter();
  const maskAmounts = (text: string) => maskMoneyText(text, masked);
  if (card === "cardDetail") {
    return <FixtureCard card={card} onAction={onAction}><AskGenericCard item={PRESENCE_FIXTURES.cardDetail} router={router} maskAmounts={maskAmounts} dismissible={false} /></FixtureCard>;
  }
  if (card === "coverPlan") {
    return <FixtureCard card={card} onAction={onAction}><MoveCard item={PRESENCE_FIXTURES.coverPlan} hideNetWorth={masked} maskAmounts={maskAmounts} dismissible={false} previewMode /></FixtureCard>;
  }
  if (card === "paydayPlan") {
    return <FixtureCard card={card} onAction={onAction}><PaydayPlanCard item={PRESENCE_FIXTURES.paydayPlan} router={router} hideNetWorth={masked} maskAmounts={maskAmounts} dismissible={false} onClose={() => undefined} /></FixtureCard>;
  }
  return <FixtureCard card={card} onAction={onAction}><CelebrationCard item={PRESENCE_FIXTURES.covered} router={router} maskAmounts={maskAmounts} dismissible={false} /></FixtureCard>;
}

/** Real Home card families in a safely intercepted, synthetic preview. */
export function PresenceGallery({ variant, state, masked, onAction, onPennyOpen }: PresenceGalleryProps) {
  const shown: readonly (typeof PRESENCE_STACK_ORDER)[number][] = state === "stack"
    ? PRESENCE_STACK_ORDER
    : [state === "card-detail" ? "cardDetail" : state === "cover-plan" ? "coverPlan" : state === "payday-plan" ? "paydayPlan" : "covered"];
  return (
    <BalancesHiddenContext.Provider value={masked}>
      <section className={`${styles.gallery} ${styles[`variant${variant === "current" ? "Current" : variant.toUpperCase()}`]}`} aria-label="Penny presence preview">
        <PresenceNav variant={variant} onAction={onAction} onPennyOpen={onPennyOpen} />
        <div className={styles.cardStack}>
          {shown.map((card) => <CardByKey key={card} card={card} masked={masked} onAction={onAction} />)}
        </div>
      </section>
    </BalancesHiddenContext.Provider>
  );
}

export default PresenceGallery;
