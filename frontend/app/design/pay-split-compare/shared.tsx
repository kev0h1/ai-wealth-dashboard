"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { money, signedMoney, type Comparison, type ComparisonRow, type Guide, type SectionId } from "@/lib/paySplitReference";
import s from "./shared.module.css";

export type VariantProps = {
  comparison: Comparison;
  guide: Guide;
  visible: boolean;
  average: boolean;
  onChoose: () => void;
  onBreakdown: () => void;
};
export const labels: Record<SectionId, string> = { fixed: "Bills and basics", moved: "Money moved", free: "Other spending" };
export const share = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value) + "%";
export const exampleShare = (row: ComparisonRow) => row.guideShare !== null ? row.guideShare + "%" : row.guideShareMin !== null ? row.guideShareMin + " to " + row.guideShareMax + "%" : "No set share";
export const differenceValue = (row: ComparisonRow) => row.delta === null ? money(row.actual) : row.delta === 0 ? row.guide === null ? "Within range" : "Matches" : signedMoney(row.delta);
export const differenceCaption = (row: ComparisonRow) => row.delta === null ? "Recorded amount" : row.delta === 0 ? "" : row.guide === null ? row.delta > 0 ? "above the range" : "below the range" : row.delta > 0 ? "more than the example" : "less than the example";
export function axisFor(comparison: Comparison) { return Math.ceil(Math.max(100, ...comparison.rows.map(row => row.incomeShare)) / 25) * 25; }

export function ReferenceChoice({ guide, onChoose }: Pick<VariantProps, "guide" | "onChoose">) {
  return <button type="button" className={s.reference} aria-haspopup="dialog" aria-label={"Choose an example, currently " + guide.shortName} onClick={onChoose}>{guide.shortName}<ChevronDown size={15} aria-hidden="true" /></button>;
}
export function Basis({ comparison, average }: Pick<VariantProps, "comparison" | "average">) {
  return <p className={s.basis}><MoneyText text={average ? "Each share is of your " + money(comparison.income) + " average income per pay period." : "Each share is of the " + money(comparison.income) + " that came in."} /> Percentages are rounded.</p>;
}
export function NoFigures({ loading, hidden, available }: { loading: boolean; hidden: boolean; available: boolean }) {
  return <p className={s.empty} role={loading ? "status" : undefined}>{loading ? "Loading your pay split…" : hidden ? "Your figures are hidden." : !available ? "We need a full pay period with income to show this." : "Your figures are not available."}</p>;
}
export function Actions({ guide, onBreakdown, visible }: Pick<VariantProps, "guide" | "onBreakdown" | "visible">) {
  return <footer className={s.actions}>
    <p className={s.transfers}>Money moved can include transfers between your accounts. It is not all new saving.</p>
    <button type="button" className={s.breakdown} disabled={!visible} onClick={onBreakdown}>View breakdown<ChevronRight size={16} aria-hidden="true" /></button>
    <details className={s.help}><summary>How it works<ChevronDown size={14} aria-hidden="true" /></summary>
      <p>{guide.shares ? "50/30/20 is a common rule of thumb: about half your income for needs, a fifth for saving or paying debt, and the rest for other spending." : guide.ranges ? "This example leaves room to vary: 50 to 60% for needs, 5 to 10% for cash saving, 5 to 10% for investing, and 20 to 35% for other spending." : "Pay yourself first means putting money aside before other spending. There are no set shares to compare with."}</p>
      <p>Bills and basics includes bills, groceries, transport and loan payments. Other spending includes things like shopping and meals out.</p>
      <p>Money moved can include saving, investing and transfers between your accounts. Moving money is not the same as saving more. That makes this a rough comparison.</p>
      {guide.ranges && <p>Saving and investing make up the 10 to 20% example for Money moved. Each range stands on its own. Their top and bottom values do not need to add up to 100%.</p>}
      <p>{guide.ranges ? "A difference shows how far your amount is below or above that range. Inside the range, there is no difference. " : ""}This example does not say what caused a gap or what you should spend.</p>
    </details>
    <p className={s.disclaimer}>No budget or target is set.</p>
  </footer>;
}
