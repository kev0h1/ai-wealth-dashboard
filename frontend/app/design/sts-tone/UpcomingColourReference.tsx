"use client";

import UpcomingHeroCard, { type UpcomingHeroCardProps } from "@/components/upcoming/UpcomingHeroCard";
import { cardPropsFor, type Scenario } from "./fixtures";
import styles from "./sts-tone.module.css";

/** Synthetic inputs for the actual Upcoming card. Its end-of-period balance
 * deliberately does not reuse Home's date-ordered low point or buffer. */
export function upcomingPropsFor(scenario: Scenario): UpcomingHeroCardProps | null {
  const { data, syncing } = cardPropsFor(scenario);
  if (!data || data.status !== "ok" || data.calculation_status === "degraded" || syncing || typeof data.spendable_now !== "number") return null;
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

export default function UpcomingColourReference({ scenario, consolidated, onDestination }: { scenario: Scenario; consolidated: boolean; onDestination?: (label: string, href: string) => void }) {
  const props = upcomingPropsFor(scenario);
  return <section aria-label="Upcoming colour comparison" data-g287-upcoming className={consolidated ? styles.sharedRisk : undefined} onClickCapture={event => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor) return;
    event.preventDefault(); event.stopPropagation();
    onDestination?.(anchor.textContent?.trim() ?? "", anchor.getAttribute("href") ?? "");
  }}>
    <h2 className={styles.surfaceTitle}>Upcoming</h2>
    {props ? <UpcomingHeroCard {...props} /> : <p className={styles.unavailable}>No current Upcoming figure is proposed for this example. Choose a current cash shortfall to compare the colours.</p>}
  </section>;
}
