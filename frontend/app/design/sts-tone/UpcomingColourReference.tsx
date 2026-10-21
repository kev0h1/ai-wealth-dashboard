"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import UpcomingHeroCard, { type UpcomingHeroCardProps } from "@/components/upcoming/UpcomingHeroCard";
import { cardPropsFor, type Scenario, type Variant } from "./fixtures";
import { statePresentationFor } from "./state-presentation";
import StateIndicator from "./StateIndicator";
import styles from "./sts-tone.module.css";

/** Synthetic inputs for the actual Upcoming card. Its end-of-period balance
 * deliberately does not reuse Home's date-ordered low point or buffer. */
export function upcomingPropsFor(scenario: Scenario): UpcomingHeroCardProps | null {
  const { data, syncing } = cardPropsFor(scenario);
  if (!data || data.status !== "ok" || data.calculation_status === "degraded" || data.calculation_status === "syncing" || syncing || typeof data.spendable_now !== "number") return null;
  const runway = data.spendable_now + data.income_before_payday - data.bills_total
    - (data.allocations_reserved ?? 0) - (data.commitments_reserved ?? 0);
  return {
    isCalendarMonth: false,
    daysToPayday: data.days_until_payday,
    paydayLabel: new Date(data.next_payday).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    spendableNow: data.spendable_now,
    runwayIncomeTotal: data.income_before_payday,
    runwayBillsTotal: data.bills_total,
    allocationsRemainingTotal: data.allocations_reserved ?? 0,
    allocationsCount: data.allocations_count,
    plansReservedTotal: data.commitments_reserved ?? 0,
    plansCount: data.commitments_count,
    savingsNow: 1400,
    runway,
    runwayStatus: runway < 0 ? "short" : runway > 0 ? "left" : "even",
    balancesHidden: false,
  };
}

export default function UpcomingColourReference({ scenario, consolidated, calmUrgency = false, variant, onDestination }: { scenario: Scenario; consolidated: boolean; calmUrgency?: boolean; variant?: Variant; onDestination?: (label: string, href: string) => void }) {
  const props = upcomingPropsFor(scenario);
  const stateSystem = variant === "e" || variant === "f";
  const presentation = statePresentationFor(scenario);
  const [heading, setHeading] = useState<HTMLElement | null>(null);
  // Add the preview-only status to the actual heading, without copying the
  // Upcoming card or changing its financial props. React owns this badge.
  const attachHeading = useCallback((node: HTMLElement | null) => {
    setHeading(stateSystem && node?.dataset.g287UpcomingScenario === scenario ? node.querySelector<HTMLElement>("#runway-heading") : null);
  }, [stateSystem, scenario]);
  return <section ref={attachHeading} aria-label="Upcoming colour comparison" data-g287-upcoming data-g287-upcoming-scenario={scenario} data-g287-upcoming-tone={stateSystem ? presentation.upcoming.tone : undefined} data-g287-qualifier-tone={stateSystem ? presentation.upcomingQualifierTone : undefined} className={stateSystem ? `${styles.stateSystem} ${styles.stateUpcoming} ${variant === "f" ? styles.iconLed : ""}` : calmUrgency ? styles.calmUpcoming : consolidated ? styles.sharedRisk : undefined} onClickCapture={event => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor) return;
    event.preventDefault(); event.stopPropagation();
    onDestination?.(anchor.textContent?.trim() ?? "", anchor.getAttribute("href") ?? "");
  }}>
    <h2 className={styles.surfaceTitle}>Upcoming</h2>
    {props ? <UpcomingHeroCard key={`${variant}-${scenario}`} {...props} /> : <p className={styles.unavailable}>No current Upcoming figure is available in this example. A fresh forecast is needed before showing a status.</p>}
    {heading && stateSystem && createPortal(<StateIndicator status={presentation.upcoming} />, heading)}
  </section>;
}
