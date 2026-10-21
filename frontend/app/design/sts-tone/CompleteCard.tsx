"use client";

import { useCallback, type MouseEvent } from "react";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { deriveSafeToSpendHeadline } from "@/lib/pennyScreenViews";
import { cardPropsFor, previewRouteFor, type Scenario, type Variant } from "./fixtures";
import { statePresentationFor } from "./state-presentation";
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
  const stateSystem = variant === "e" || variant === "f";
  const presentation = statePresentationFor(scenario);
  const signedShort = stateSystem ? presentation.signedHome : variant === "d" && cashShort;
  // Temporary copy adapter for this design round. The real card still owns
  // every calculation, caveat and action. Update actual text nodes before
  // paint, so the visible and accessible copy agree without a CSS pseudo-sign.
  // React 19 cleans up the ref on scenario/variant changes and unmount.
  const previewCopy = useCallback((node: HTMLDivElement | null) => {
    if (!node || (!signedShort && !stateSystem) || node.dataset.g287Scenario !== scenario) return;
    const eyebrow = node.querySelector<HTMLElement>(".sts-card > div:first-child > p");
    const figure = node.querySelector<HTMLElement>("#safe-to-spend-heading > span:first-child");
    if (!eyebrow || !figure) return;
    const restore: (() => void)[] = [];
    const replace = (target: Node | null | undefined, text: string | undefined) => {
      if (!target || text === undefined) return;
      const original = target.textContent;
      target.textContent = text;
      restore.push(() => { target.textContent = original; });
    };
    if (signedShort) {
      replace(eyebrow, stateSystem ? presentation.homeEyebrow : "Shortfall before payday");
      replace(figure, `−${figure.textContent}`);
    }
    if (stateSystem && presentation.home.tone !== "neutral") {
      const chip = node.querySelector<HTMLElement>(".sts-card > div:first-child > span");
      if (chip) {
        replace([...chip.childNodes].find(child => child.nodeType === 3 && child.textContent?.trim()), presentation.home.label);
        chip.dataset.g287Tone = presentation.home.tone;
        chip.classList.add(styles.stateBadge);
        restore.push(() => { delete chip.dataset.g287Tone; chip.classList.remove(styles.stateBadge); });
      }
      replace(node.querySelector("#safe-to-spend-heading > span:nth-child(2)")?.firstChild, presentation.homeCaption);
    }
    return () => { restore.reverse().forEach(restoreText => restoreText()); };
  }, [signedShort, stateSystem, scenario, presentation.homeEyebrow, presentation.homeCaption, presentation.home.tone, presentation.home.label]);
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
  return <div ref={previewCopy} data-g287-card={variant} data-g287-scenario={scenario} data-g287-signed-short={signedShort || undefined} data-g287-home-tone={stateSystem ? presentation.home.tone : undefined} onClickCapture={captureNavigation}
    className={`${styles.cardFrame} ${variant === "a" || variant === "d" || stateSystem ? styles.calm : ""} ${(variant === "a" || variant === "b") && cashShort ? styles.cashShort : ""} ${variant === "c" ? styles.sharedRisk : ""} ${variant === "d" ? styles.calmUrgency : ""} ${signedShort && !stateSystem ? styles.signedShort : ""} ${stateSystem ? styles.stateSystem : ""} ${variant === "f" ? styles.iconLed : ""} ${variant !== "current" ? styles.proposal : ""}`}>
    <SafeToSpendCard key={`${variant}-${scenario}`} {...props} onRetry={onRetry} onSyncRetry={onRetry} previewBalancesVisible />
  </div>;
}
