"use client";

import { useCallback, type MouseEvent } from "react";
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
  const signedShort = variant === "d" && cashShort;
  // Temporary copy adapter for this design round. The real card still owns
  // every calculation, caveat and action. Update actual text nodes before
  // paint, so the visible and accessible copy agree without a CSS pseudo-sign.
  // React 19 cleans up the ref on scenario/variant changes and unmount.
  const previewCopy = useCallback((node: HTMLDivElement | null) => {
    if (!node || !signedShort || node.dataset.g287Scenario !== scenario) return;
    const eyebrow = node.querySelector<HTMLElement>(".sts-card > div:first-child > p");
    const figure = node.querySelector<HTMLElement>("#safe-to-spend-heading > span:first-child");
    if (!eyebrow || !figure) return;
    const originalEyebrow = eyebrow.textContent;
    const originalFigure = figure.textContent;
    eyebrow.textContent = "Shortfall before payday";
    figure.textContent = `−${originalFigure}`;
    return () => { eyebrow.textContent = originalEyebrow; figure.textContent = originalFigure; };
  }, [signedShort, scenario]);
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
  return <div ref={previewCopy} data-g287-card={variant} data-g287-scenario={scenario} data-g287-signed-short={signedShort || undefined} onClickCapture={captureNavigation}
    className={`${styles.cardFrame} ${variant === "a" || variant === "d" ? styles.calm : ""} ${(variant === "a" || variant === "b") && cashShort ? styles.cashShort : ""} ${variant === "c" ? styles.sharedRisk : ""} ${variant === "d" ? styles.calmUrgency : ""} ${signedShort ? styles.signedShort : ""} ${variant !== "current" ? styles.proposal : ""}`}>
    <SafeToSpendCard key={`${variant}-${scenario}`} {...props} onRetry={onRetry} onSyncRetry={onRetry} previewBalancesVisible />
  </div>;
}
