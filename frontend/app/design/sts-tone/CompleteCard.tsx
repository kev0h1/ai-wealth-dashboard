"use client";

import type { MouseEvent } from "react";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { deriveSafeToSpendHeadline } from "@/lib/pennyScreenViews";
import { cardPropsFor, previewRouteFor, type Scenario, type Variant } from "./fixtures";
import styles from "./sts-tone.module.css";

/** The actual production card, with preview-scoped presentation only.
 * No copied ledger, replaced caveats, invented action or production prop. */
export default function CompleteCard({ scenario, variant, onRetry, onDestination }: {
  scenario: Scenario;
  variant: Variant;
  onRetry: () => void;
  onDestination: (label: string, href: string) => void;
}) {
  const props = cardPropsFor(scenario);
  const headline = props.data?.status === "ok" ? deriveSafeToSpendHeadline(props.data) : null;
  const cashShort = headline?.state === "short" && !headline.plansOnly && !headline.isCardsUnconfirmedShort && !props.syncing;
  const captureNavigation = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest<HTMLAnchorElement>("a[href]");
    const action = target?.closest<HTMLButtonElement>("[data-g219-action-row] button");
    const label = (anchor ?? action)?.textContent?.trim() ?? "";
    const href = anchor?.getAttribute("href") ?? (action ? previewRouteFor(label) : null);
    if (!href) return;
    // These are the real controls and destinations. Stop their navigation in
    // this synthetic review only, and show where they lead instead.
    event.preventDefault();
    event.stopPropagation();
    onDestination(label, href);
  };
  return <div data-g287-card={variant} data-g287-scenario={scenario} onClickCapture={captureNavigation}
    className={`${styles.cardFrame} ${variant === "a" ? styles.calm : ""} ${(variant === "a" || variant === "b") && cashShort ? styles.cashShort : ""} ${variant === "c" ? styles.sharedRisk : ""} ${variant !== "current" ? styles.proposal : ""}`}>
    <SafeToSpendCard {...props} onRetry={onRetry} onSyncRetry={onRetry} previewBalancesVisible />
  </div>;
}
