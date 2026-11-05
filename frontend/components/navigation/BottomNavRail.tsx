"use client";

import { Fragment } from "react";
import Link from "next/link";
import PennyLauncherButton from "@/components/PennyLauncherButton";
import { BOTTOM_NAV_TABS, type BottomNavTab } from "@/lib/navigation/bottomNav";
import type { PennyAppearance } from "@/lib/pennyAppearance";
import PhosphorNavIcon from "./PhosphorNavIcon";
import styles from "./BottomNav.module.css";

/** G423 A, Quiet rail. Data and adviser context stay with BottomNav. */
export default function BottomNavRail({
  appearance, resolved, activeTab, pennyActive, pennyOpen, pennyCurrent,
  paydayActive, atRiskCount, onPennyClick,
}: {
  appearance: PennyAppearance;
  resolved: boolean;
  activeTab?: BottomNavTab;
  pennyActive: boolean;
  pennyOpen: boolean;
  pennyCurrent: boolean;
  paydayActive: boolean;
  atRiskCount: number;
  onPennyClick: () => void;
}) {
  const currentAppearance = resolved ? appearance : "pending";
  return <>
    <div data-penny-navigation aria-hidden="true" className={`nav-scrim ${styles.scrim}`} />
    <nav data-penny-navigation data-tutorial-id="tutorial-bottom-nav" aria-label="Primary" className={styles.navigation}>
      <div className={styles.container}>
        <div className={styles.rail} data-bottom-nav-rail data-appearance={currentAppearance}>
          {BOTTOM_NAV_TABS.map(tab => <Fragment key={tab.id}>
            {tab.id === "upcoming" && <PennyLauncherButton
              appearance={appearance}
              resolved={resolved}
              active={pennyActive}
              open={pennyOpen}
              current={pennyCurrent}
              paydayActive={paydayActive}
              onClick={onPennyClick}
            />}
            <Link
              href={tab.href}
              aria-current={activeTab === tab.id ? "page" : undefined}
              aria-label={tab.id === "upcoming" && atRiskCount > 0
                ? `Upcoming, ${atRiskCount} ${atRiskCount === 1 ? "payment" : "payments"} may need funding`
                : undefined}
              className={styles.tab}
              style={{ gridColumnStart: tab.slot + 1 }}
              data-nav-tab={tab.id}
            >
              <span className={styles.tabGlyph}>
                <PhosphorNavIcon tab={tab.id} selected={activeTab === tab.id} appearance={currentAppearance} />
                {tab.id === "upcoming" && atRiskCount > 0 && <span aria-hidden="true" className={styles.attentionDot} data-upcoming-attention />}
              </span>
              <span className={styles.tabLabel}>{tab.label}</span>
            </Link>
          </Fragment>)}
        </div>
      </div>
    </nav>
  </>;
}
