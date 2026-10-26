"use client";

import MoneyText from "@/components/MoneyText";
import { money } from "@/lib/paySplitReference";
import {
  Actions,
  Basis,
  ReferenceChoice,
  differenceCaption,
  differenceValue,
  exampleShare,
  labels,
  share,
  type VariantProps,
} from "./shared";
import s from "./VariantC.module.css";
import { flowText } from "./model";

export default function VariantC({ comparison, guide, visible, average, onChoose, onBreakdown }: VariantProps) {
  return <section className={s.card} aria-label="Pay split comparison">
    <header className={s.header}>
      <h2>How your pay was used</h2>
      <ReferenceChoice guide={guide} onChoose={onChoose} />
    </header>
    {visible && <>
      <Basis comparison={comparison} average={average} />
      <div className={s.totals}>
        <p><span>{average ? "Income each pay period" : "Income"}</span><MoneyText text={money(comparison.income)} /></p>
        <p><span>{average ? "Spent or moved each pay period" : "Spent or moved"}</span><MoneyText text={money(comparison.totalOut)} /></p>
      </div>
      <p className={s.outgoing}><MoneyText text={flowText(comparison)} /></p>
      <div className={s.rows}>
        {comparison.rows.map(row => <article className={s.row} key={row.id}>
          <div className={s.rowTop}>
            <h3><i className={s[row.id]} aria-hidden="true" />{labels[row.id]}</h3>
            <MoneyText className={s.actual} text={money(row.actual)} />
          </div>
          <div className={s.rowFacts}>
            <p>About {share(row.incomeShare)} of income</p>
            {row.delta !== null && <p>Example: {exampleShare(row)}</p>}
          </div>
          {row.delta !== null && <p className={s.difference}><MoneyText className={s.delta} text={differenceValue(row)} /> <span>{differenceCaption(row)}</span></p>}
        </article>)}
      </div>
    </>}
    <Actions guide={guide} onBreakdown={onBreakdown} visible={visible} />
  </section>;
}
