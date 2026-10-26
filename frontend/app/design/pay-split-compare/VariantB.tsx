"use client";

import MoneyText from "@/components/MoneyText";
import type { ComparisonRow } from "@/lib/paySplitReference";
import { Actions, axisFor, Basis, differenceCaption, differenceValue, exampleShare, labels, ReferenceChoice, share, type VariantProps } from "./shared";
import s from "./VariantB.module.css";

function valueWidth(value: number, axis: number) {
  return `${Math.min(100, Math.max(0, value / axis * 100))}%`;
}

function PairedBars({ row, axis, hasExample }: { row: ComparisonRow; axis: number; hasExample: boolean }) {
  const rangeStart = row.guideShareMin ?? 0;
  const rangeEnd = row.guideShareMax ?? 0;
  const example = row.guideShare ?? 0;
  return <article className={s.row}>
    <div className={s.rowHeading}>
      <h3>{labels[row.id]}</h3>
      <MoneyText className={s.difference} text={differenceValue(row)} />
    </div>
    <p className={s.caption}>{differenceCaption(row)}</p>
    <div className={s.bars} aria-label={`${labels[row.id]}: you ${share(row.incomeShare)}${hasExample ? `, example ${exampleShare(row)}` : ""}`}>
      <div className={s.barLine}>
        <span>You <strong>{share(row.incomeShare)}</strong></span>
        <i className={`${s.actual} ${s[row.id]}`} style={{ width: valueWidth(row.incomeShare, axis) }} aria-hidden="true" />
      </div>
      {hasExample && <div className={s.barLine}>
        <span>Example <strong>{exampleShare(row)}</strong></span>
        {row.guideShare !== null ? <i className={s.example} style={{ width: valueWidth(example, axis) }} aria-hidden="true" /> : <i className={s.range} style={{ marginLeft: valueWidth(rangeStart, axis), width: valueWidth(rangeEnd - rangeStart, axis) }} aria-hidden="true" />}
      </div>}
    </div>
  </article>;
}

export default function VariantB({ comparison, guide, visible, average, onChoose, onBreakdown }: VariantProps) {
  const axis = axisFor(comparison);
  const hasExample = !!(guide.shares || guide.ranges);
  return <section className={s.card} aria-label="Compare your pay">
    <header className={s.header}>
      <h2>Compare your pay</h2>
      <ReferenceChoice guide={guide} onChoose={onChoose} />
    </header>
    {visible && <>
      <Basis comparison={comparison} average={average} />
      <p className={s.axis}>You and the example use the same scale: 0 to {axis}% of income.</p>
      <div className={s.rows}>{comparison.rows.map(row => <PairedBars key={row.id} row={row} axis={axis} hasExample={hasExample} />)}</div>
    </>}
    <Actions guide={guide} visible={visible} onBreakdown={onBreakdown} />
  </section>;
}
