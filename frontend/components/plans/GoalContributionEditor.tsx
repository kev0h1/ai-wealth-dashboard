"use client";

import { useMemo, type ReactNode } from "react";
import { api, type Commitment, type GoalContributionPreview } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import { editorQuiet } from "@/components/upcoming/editorSupport";
import { PeriodContributionEditor, periodMoney } from "@/components/plans/PeriodContributionEditor";

type Services = Pick<typeof api, "previewGoalContribution" | "setGoalContribution">;
export interface GoalContributionEditorProps { commitment: Commitment; services?: Services; onCancel(): void; onChangeDate(): void; onSaved(item: Commitment): void | Promise<void>; onComplete(): void; renderActions?: (actions: ReactNode) => ReactNode; onBusyChange?: (busy: boolean) => void; }

export function GoalContributionEditor({ commitment, services = api, onCancel, onChangeDate, onSaved, onComplete, renderActions, onBusyChange }: GoalContributionEditorProps) {
  const adapter = useMemo(() => ({
    initial: commitment.current_period_contribution?.contribution ?? commitment.planned_per_period_slice ?? commitment.usual_slice ?? commitment.per_period_slice,
    preview: (pence: number) => services.previewGoalContribution(commitment.id, pence),
    save: (input: { contribution_pence: number; period_end: string; preview_token: string }) => services.setGoalContribution(commitment.id, input),
    renderReview: (preview: GoalContributionPreview) => preview.blocked_reason ? <div className="space-y-2"><p role="alert" className="text-sm leading-6 text-slate-700 dark:text-slate-200">{preview.blocked_reason}</p><button type="button" onClick={onChangeDate} className={editorQuiet}>Change target date</button></div> : <>{preview.capped && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300"><MoneyText text={`${periodMoney(preview.requested_contribution)} was requested. This period’s total is capped at ${periodMoney(preview.contribution)}, the amount still needed including matched payments.`} /></p>}{preview.covers_remaining ? <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">This would cover the remaining target. <MoneyText text="Later periods would be £0." /> It is planned, not cash already saved.</p> : preview.later_contribution !== null && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300"><MoneyText text={`If you set aside ${periodMoney(preview.reserved)} this period, later periods would be about ${periodMoney(preview.later_contribution)} each to aim for your target in ${new Date(`${preview.target_date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}.`} /></p>}{preview.large_increase && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">Later periods would need a higher contribution to aim for this target date.</p>}{preview.large_increase && <button type="button" onClick={onChangeDate} className={editorQuiet}>Change target date</button>}{preview.replaces_easing && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">This replaces the eased contribution for this pay period.</p>}</>,
  }), [commitment, onChangeDate, services]);
  return <PeriodContributionEditor adapter={adapter} onCancel={onCancel} onSaved={onSaved} onComplete={onComplete} renderActions={renderActions} onBusyChange={onBusyChange} />;
}
export default GoalContributionEditor;
