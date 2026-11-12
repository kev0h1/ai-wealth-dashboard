"use client";

import { PennyChartPlot } from "@/components/PennyChart";
import type { PennyChartSpec } from "@/lib/pennyChart";
import { EATING_OUT_CHART } from "../marketing-kit/capabilities/penny-fixtures";
import styles from "./promotional.module.css";

export const PROMOTION_IDS = ["launch", "charts", "plans"] as const;
export type PromotionId = typeof PROMOTION_IDS[number];
export type Theme = "light" | "dark";

// These are frozen art-direction templates, not submitted bank events or
// customer plans. They deliberately use the exact typed shapes Penny's
// production chart renders, while keeping all readable chart chrome outside
// the export crop.
const LAUNCH_DONUT: PennyChartSpec = {
  type: "donut",
  title: "Spending by category",
  summary: "A fictional category breakdown for promotional artwork.",
  x: { label: "Category", kind: "category" },
  y: { label: "Spent", unit: "money", currency: "GBP" },
  series: [{ name: "Category spend", points: [
    { x: "Groceries", y: 320 },
    { x: "Eating Out", y: 240 },
    { x: "Transport", y: 180 },
    { x: "Entertainment", y: 140 },
    { x: "Shopping", y: 120 },
  ] }],
};

const PLANNED_CONTRIBUTIONS: PennyChartSpec = {
  type: "line",
  title: "Planned contributions",
  summary: "A fictional plan with three £200 contributions, accumulating to £600.",
  x: { label: "Payday", kind: "text" },
  y: { label: "Planned total", unit: "money", currency: "GBP" },
  series: [{ name: "Planned contributions", points: [
    { x: "First payday", y: 200 },
    { x: "Second payday", y: 400 },
    { x: "Third payday", y: 600 },
  ] }],
};

type Props = {
  id: PromotionId;
  theme: Theme;
  /** Visible only to production tooling while framing the Google safe area. */
  safeArea?: boolean;
};

function DonutVisual({ dark }: { dark: boolean }) {
  return (
    <div className={styles.donutViewport} aria-hidden="true">
      <div className={styles.donutPlot}>
        <PennyChartPlot spec={LAUNCH_DONUT} dark={dark} overrides={{}} size={{ width: 240, height: 240 }} />
      </div>
    </div>
  );
}

function PlotCrop({ spec, dark }: { spec: PennyChartSpec; dark: boolean }) {
  return (
    <div className={styles.plotCrop} aria-hidden="true">
      <div className={styles.plotInner}>
        <PennyChartPlot spec={spec} dark={dark} overrides={{}} size={{ width: 1000, height: 450 }} />
      </div>
    </div>
  );
}

/**
 * A text-free, 1920 × 1080 Google Play primary-image artboard. The product
 * charts are deliberately rendered by PennyChartPlot: only its plotting
 * region is exposed, never re-drawn chart marks or chart labels.
 */
export default function PromotionalCanvas({ id, theme, safeArea = false }: Props) {
  const dark = theme === "dark";
  return (
    <section
      className={`${styles.artboard} ${styles[theme]} ${styles[id]}`}
      data-promotional-artboard
      data-promotion={id}
      data-theme={theme}
      aria-label={`${id} promotional artwork`}
    >
      {id === "launch" && <div className={styles.launchSurface}><DonutVisual dark={dark} /></div>}
      {id === "charts" && <div className={styles.chartSurface}><PlotCrop spec={EATING_OUT_CHART} dark={dark} /></div>}
      {id === "plans" && <div className={styles.planSurface}><PlotCrop spec={PLANNED_CONTRIBUTIONS} dark={dark} /></div>}
      {safeArea && (
        <div className={styles.safeArea}>
          <span className={styles.safeAreaLabel}>Google Play safe area</span>
        </div>
      )}
    </section>
  );
}
