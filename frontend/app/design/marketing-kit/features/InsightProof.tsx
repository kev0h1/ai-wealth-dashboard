"use client";

import { SpendingSlide, TitleSlide, WhereItWentSlide } from "@/app/month/story/StoryPlayer";
import SpendPaceHero from "@/components/SpendPaceHero";
import SpendShapeCard from "@/components/SpendShapeCard";
import MoneyShapeHero from "@/app/spend/shape/MoneyShapeHero";
import PaySplitComparison from "@/components/PaySplitComparison";
import { INSIGHT_STORY, MONEY_SHAPE, OCT_SHAPE, SPEND_VERDICT } from "./insight-fixtures";

export type InsightProofKind = "month-title" | "month-spending" | "month-categories" | "spend" | "spend-detail" | "shape" | "split" | "split-card";

const noFocal = () => {};
const formatMonthMoney = (value: number) => `£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;
const monthShell = "min-h-[344px] rounded-[26px] bg-[#0f172a] px-6 py-9 text-slate-100";

/** Production component capture plate. The canvas owner supplies the 390px
 * frame and theme class, while this component supplies only shipped UI. */
export default function InsightProof({ kind, theme: _theme }: { kind: InsightProofKind; theme: "light" | "dark" }) {
  void _theme;
  if (kind === "month-title") {
    return <section data-feature-proof="month-title" className={`${monthShell} flex items-center`}><TitleSlide slide={{ kind: "title", story: INSIGHT_STORY, preview: false, persona: null }} focalRef={noFocal} /></section>;
  }
  if (kind === "month-spending") {
    return <section data-feature-proof="month-spending" className={`${monthShell} flex items-center`}><SpendingSlide slide={{ kind: "spending", story: INSIGHT_STORY }} fmt={formatMonthMoney} focalRef={noFocal} /></section>;
  }
  if (kind === "month-categories") {
    return <section data-feature-proof="month-categories" className={`${monthShell} flex items-center`}><WhereItWentSlide slide={{ kind: "whereItWent", story: INSIGHT_STORY }} fmt={formatMonthMoney} focalRef={noFocal} /></section>;
  }
  if (kind === "spend") {
    return <section data-feature-proof="spend" className="p-4"><SpendPaceHero verdict={SPEND_VERDICT} incomeTxns={[]} onTransactionClick={() => {}} onOutTap={() => {}} onMovedTap={() => {}} /></section>;
  }
  if (kind === "spend-detail") {
    return <section data-feature-proof="spend-detail" className="p-4"><SpendShapeCard shape={OCT_SHAPE} hideValues={false} onOpen={() => {}} reference="50-30-20" onReferenceChange={() => {}} /></section>;
  }
  if (kind === "shape") {
    return <section data-feature-proof="shape" className="p-4"><MoneyShapeHero shape={MONEY_SHAPE} hideValues={false} /></section>;
  }
  if (kind === "split-card") {
    return <section data-feature-proof="split-card" className="p-4"><PaySplitComparison shape={MONEY_SHAPE} view="card" reference="50-30-20" hideValues={false} /></section>;
  }
  return <section data-feature-proof="split" className="p-4"><PaySplitComparison shape={MONEY_SHAPE} view="detail" reference="50-30-20" hideValues={false} /></section>;
}
