"use client";
import MoneyText from "@/components/MoneyText";
import { Actions, Basis, ReferenceChoice, differenceCaption, differenceValue, exampleShare, labels, share, type VariantProps } from "./shared";
import s from "./VariantA.module.css";

export default function VariantA(props: VariantProps) {
  const { comparison, guide, visible, onChoose } = props;
  return <section className={s.card} aria-label="Numbers first comparison">
    <header className={s.header}><h2>Compare your pay</h2><ReferenceChoice guide={guide} onChoose={onChoose} /></header>
    {visible && <>
      <Basis comparison={comparison} average={props.average} />
      <div className={s.rows}>{comparison.rows.map(row => <article className={s.row} key={row.id}>
        <div className={s.heading}><h3><i className={s[row.id]} aria-hidden="true" />{labels[row.id]}</h3><strong>About {share(row.incomeShare)}</strong></div>
        <div className={s.example}><span>Your share of income</span><span>{row.delta === null ? "No set example" : "Example " + exampleShare(row)}</span></div>
        <div className={s.difference}><MoneyText className={s.value} text={differenceValue(row)} /><span>{differenceCaption(row)}</span></div>
      </article>)}</div>
    </>}
    <Actions {...props} />
  </section>;
}
