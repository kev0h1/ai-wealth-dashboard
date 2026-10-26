"use client";

import MoneyText from "@/components/MoneyText";
import { type Comparison, type ComparisonRow, type Guide, type SectionId } from "@/lib/paySplitReference";
import {
  Actions,
  captionFor,
  IncomeLine,
  isNumeric,
  NoFigures,
  percent,
  ReferenceButton,
  type VariantProps,
  valueFor,
} from "./shared";
import styles from "./VariantC.module.css";

const sectionClass: Record<SectionId, string> = {
  fixed: styles.fixed,
  moved: styles.moved,
  free: styles.free,
};

function width(value: number, scale: number) {
  return `${Math.min(100, Math.max(0, value / scale * 100))}%`;
}

function IncomeTick({ income, scale }: { income: number; scale: number }) {
  return (
    <span className={styles.incomeTick} style={{ left: width(income, scale) }} aria-hidden="true">
      <span />
      <small>income</small>
    </span>
  );
}

function SplitBar({
  label,
  rows,
  scale,
  total,
  left,
  reference = false,
}: {
  label: string;
  rows: ComparisonRow[];
  scale: number;
  total: number;
  left?: number;
  reference?: boolean;
}) {
  return (
    <div className={styles.splitBlock}>
      <p className={styles.splitLabel}>{label}</p>
      <div className={styles.barTrack}>
        <div className={styles.stack} style={{ width: width(reference ? scale : total, scale) }}>
          {rows.map((row) => {
            const value = reference ? row.guide ?? 0 : row.actual;
            return value > 0 ? <span key={row.id} className={`${styles.segment} ${sectionClass[row.id]}`} style={{ width: width(value, reference ? scale : total) }} /> : null;
          })}
        </div>
        {!reference && left && left > 0 ? <span className={styles.leftover} style={{ width: width(left, scale) }} /> : null}
      </div>
    </div>
  );
}

function ExactOverview({ comparison }: { comparison: Comparison }) {
  const scale = Math.max(comparison.income, comparison.totalOut);
  return (
    <section className={styles.overview} aria-label="Your split compared with the reference">
      <div className={styles.overviewTitle}>
        <h3>Your split and reference</h3>
        <p>Both bars use the same income scale.</p>
      </div>
      <div className={styles.barArea}>
        <IncomeTick income={comparison.income} scale={scale} />
        <SplitBar label="Your split" rows={comparison.rows} scale={scale} total={comparison.totalOut} left={comparison.left} />
        <SplitBar label="50/30/20 reference" rows={comparison.rows} scale={scale} total={comparison.income} reference />
      </div>
      {comparison.left > 0 ? <p className={styles.leftNote}><span aria-hidden="true" />Left after this split</p> : null}
    </section>
  );
}

function ActualOverview({ comparison, title }: { comparison: Comparison; title: string }) {
  const scale = Math.max(comparison.income, comparison.totalOut);
  return (
    <section className={styles.overview} aria-label={title}>
      <div className={styles.overviewTitle}>
        <h3>{title}</h3>
        <p>Shown against your income for this period.</p>
      </div>
      <div className={styles.barArea}>
        <IncomeTick income={comparison.income} scale={scale} />
        <SplitBar label="Your split" rows={comparison.rows} scale={scale} total={comparison.totalOut} left={comparison.left} />
      </div>
      {comparison.left > 0 ? <p className={styles.leftNote}><span aria-hidden="true" />Left after this split</p> : null}
    </section>
  );
}

function RangeBand({ row, scale }: { row: ComparisonRow; scale: number }) {
  const min = row.guideShareMin ?? 0;
  const max = row.guideShareMax ?? 0;
  const actual = row.incomeShare;
  return (
    <div className={styles.rangeScale} aria-hidden="true">
      <span className={styles.rangeBand} style={{ left: `${min / scale * 100}%`, width: `${Math.max(0, max - min) / scale * 100}%` }} />
      <span className={styles.actualPin} style={{ left: `${actual / scale * 100}%` }} />
    </div>
  );
}

function ComparisonRows({ comparison, guide, ranges, principle }: { comparison: Comparison; guide: Guide; ranges: boolean; principle: boolean }) {
  const highestShare = Math.max(100, ...comparison.rows.map((row) => row.incomeShare));
  const rangeScale = Math.ceil(highestShare / 25) * 25;
  return (
    <section className={styles.rows} aria-label={ranges ? "Independent reference ranges" : "Split details"}>
      <div className={styles.rowsHeading}>
        <h3>{ranges ? "Independent reference ranges" : "Your groups"}</h3>
        {ranges ? <p>Each band is separate, not one split. Scale: 0 to {rangeScale}% of income.</p> : null}
      </div>
      {comparison.rows.map((row) => (
        <article className={styles.row} key={row.id}>
          <div className={styles.rowTop}>
            <div className={styles.rowIdentity}>
              <span className={`${styles.dot} ${sectionClass[row.id]}`} aria-hidden="true" />
              <h4>{row.label}</h4>
            </div>
            <strong><MoneyText text={valueFor(row, guide)} /></strong>
          </div>
          <p className={styles.rowCopy}>{percent(row.incomeShare)} of income</p>
          {!principle ? <p className={styles.rowCaption}>{captionFor(row, guide)}</p> : null}
          {ranges ? <RangeBand row={row} scale={rangeScale} /> : null}
        </article>
      ))}
    </section>
  );
}

export default function VariantC({ comparison, guide, hidden, loading, onOpenReference, onBreakdown }: VariantProps) {
  const hasFigures = !hidden && !loading && comparison.available;
  const ranges = Boolean(guide.ranges);
  const principle = !isNumeric(guide);

  return (
    <article className={styles.card} data-variant="c">
      <header className={styles.header}>
        <div>
          <h2 className={styles.heading}>Compare with</h2>
          <ReferenceButton guide={guide} onOpenReference={onOpenReference} />
        </div>
        <IncomeLine comparison={comparison} hidden={hidden} loading={loading} />
      </header>
      {hasFigures ? <>
        {guide.shares ? <ExactOverview comparison={comparison} /> : <ActualOverview comparison={comparison} title={ranges ? "Your split" : "Your split this period"} />}
        <ComparisonRows comparison={comparison} guide={guide} ranges={ranges} principle={principle} />
      </> : <NoFigures loading={loading} hidden={hidden} available={comparison.available} />}
      <Actions guide={guide} onBreakdown={onBreakdown} disabled={!hasFigures} />
    </article>
  );
}
