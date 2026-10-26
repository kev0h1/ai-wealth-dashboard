"use client";

import MoneyText from "@/components/MoneyText";
import {type ComparisonRow,type Guide} from "@/lib/paySplitReference";
import {Actions,IncomeLine,NoFigures,ReferenceButton,captionFor,percent,valueFor,type VariantProps} from "./shared";
import s from "./VariantB.module.css";

const trackTone={fixed:"fixed",moved:"moved",free:"free"} as const;

function scaleFor(rows:ComparisonRow[],guide:Guide){
  const values=[100,...rows.map(row=>row.incomeShare)];
  if(guide.shares)values.push(...Object.values(guide.shares));
  if(guide.ranges)values.push(...Object.values(guide.ranges).flat());
  const highest=Math.max(...values.filter(Number.isFinite));
  return highest<=100?100:Math.ceil(highest/25)*25;
}

function Track({row,guide,scale}:{row:ComparisonRow;guide:Guide;scale:number}){
  const actual=row.incomeShare/scale*100;
  const rangeStart=row.guideShareMin===null?0:row.guideShareMin/scale*100;
  const rangeEnd=row.guideShareMax===null?0:row.guideShareMax/scale*100;
  const point=row.guideShare===null?0:row.guideShare/scale*100;
  const tone=trackTone[row.id];

  return <article className={s.row}>
    <div className={s.rowHeading}>
      <div className={s.name}><span className={`${s.dot} ${s[tone]}`} aria-hidden="true"/><strong>{row.label}</strong></div>
      <MoneyText className={s.difference} text={valueFor(row,guide)}/>
    </div>
    <div className={s.track} aria-hidden="true">
      <span className={s.baseline}/>
      {guide.ranges&&<span className={s.band} style={{left:`${rangeStart}%`,width:`${rangeEnd-rangeStart}%`}}/>}
      {guide.shares&&<span className={s.point} style={{left:`${point}%`}}/>}
      <span className={`${s.fill} ${s[tone]}`} style={{width:`${actual}%`}}/>
      <span className={`${s.marker} ${s[tone]}`} style={{left:`${actual}%`}}/>
    </div>
    <div className={s.reading}>
      <p>{percent(row.incomeShare)} of income</p>
      <p>{captionFor(row,guide)}</p>
    </div>
  </article>;
}

export default function VariantB({comparison,guide,hidden,loading,onOpenReference,onBreakdown}:VariantProps){
  const visible=!hidden&&!loading&&comparison.available;
  const scale=visible?scaleFor(comparison.rows,guide):100;
  const referenceNote=guide.ranges
    ?"Pale bands are independent reference ranges."
    :guide.shares
      ?"Pale ticks mark the reference share."
      :"These tracks show your recorded income shares.";

  return <section className={s.card} aria-label="Income share comparison">
    <header className={s.header}>
      <h2>Your income share</h2>
      <ReferenceButton guide={guide} onOpenReference={onOpenReference}/>
    </header>
    <IncomeLine comparison={comparison} hidden={hidden} loading={loading}/>
    {visible? <>
      <p className={s.legend}>{referenceNote}<span aria-hidden="true"> Same 0 to {scale}% scale.</span></p>
      <div className={s.rows}>
        {comparison.rows.map(row=><Track key={row.id} row={row} guide={guide} scale={scale}/>) }
      </div>
    </>:<NoFigures loading={loading} hidden={hidden} available={comparison.available}/>} 
    <Actions guide={guide} onBreakdown={onBreakdown} disabled={!visible}/>
  </section>;
}
