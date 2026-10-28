"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AccountRadioPicker } from "@/components/AccountRadioPicker";
import GoalScheduleEditor from "@/components/plans/GoalScheduleEditor";
import { GoalScheduleDetails } from "@/components/plans/GoalScheduleDetails";
import { api, type Account, type GoalSchedule, type GoalSchedulePreview, type PennyProposal } from "@/lib/api";
import { useBalancesHidden } from "@/lib/balancesHidden";
import { isPlanSourceAccount } from "@/lib/upcomingPlans";

type Props = { proposal: PennyProposal; busy: boolean; onConfirm: () => void; onCancel: () => void; onRevise: (schedule: GoalSchedule, sourceId: string) => Promise<void> };
type ScheduleParams = { schedule: GoalSchedule; schedule_preview: GoalSchedulePreview; source_account_id: string; source_account_name?: string; destination_names?: string[]; funding_pots?: { account_id: string }[]; deactivate_allocation_name?: string };

export function scheduledGoalParams(params: Record<string, unknown>): ScheduleParams | null {
  const schedule = params.schedule as GoalSchedule | undefined;
  const preview = params.schedule_preview as GoalSchedulePreview | undefined;
  const source = typeof params.source_account_id === "string" ? params.source_account_id : "";
  return schedule && preview && source ? { schedule, schedule_preview: preview, source_account_id: source, source_account_name: typeof params.source_account_name === "string" ? params.source_account_name : undefined, destination_names: Array.isArray(params.destination_names) ? params.destination_names.filter((name): name is string => typeof name === "string") : [], funding_pots: Array.isArray(params.funding_pots) ? params.funding_pots.filter((pot): pot is { account_id: string } => Boolean(pot && typeof pot === "object" && typeof (pot as { account_id?: unknown }).account_id === "string")) : [], deactivate_allocation_name: typeof params.deactivate_allocation_name === "string" ? params.deactivate_allocation_name : undefined } : null;
}

/** Narrow card routing guard: proposals from older chat history may not carry a usable preview. */
export function isScheduledGoalProposal(proposal: PennyProposal): boolean {
  if (proposal.kind !== "create_commitment") return false;
  const parsed = scheduledGoalParams(proposal.params);
  const preview = parsed?.schedule_preview;
  return Boolean(parsed && preview && typeof preview.label === "string" && typeof preview.start_date === "string" && typeof preview.end_date === "string" && Number.isFinite(preview.total) && Number.isFinite(preview.planned_to_date) && preview.current_period && typeof preview.current_period.start === "string" && typeof preview.current_period.end === "string" && Number.isFinite(preview.current_period.amount) && Array.isArray(preview.periods) && preview.periods.every(period => period && typeof period.start === "string" && typeof period.end === "string" && Number.isFinite(period.amount)));
}

export default function ScheduledGoalProposalCard({ proposal, busy, onConfirm, onCancel, onRevise }: Props) {
  const hidden = useBalancesHidden();
  const revisionLock = useRef(false);
  const parsed = useMemo(() => scheduledGoalParams(proposal.params), [proposal.params]);
  const [mode, setMode] = useState<"view" | "edit" | "source">("view");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sourceId, setSourceId] = useState(parsed?.source_account_id ?? "");
  const [revising, setRevising] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setMode("view"); setSourceId(parsed?.source_account_id ?? ""); setError(null); }, [proposal.proposal_id, parsed?.source_account_id]);
  const loadAccounts = () => { setLoadError(false); api.accounts().then(setAccounts).catch(() => setLoadError(true)); };
  useEffect(() => { if (mode === "source" && accounts === null && !loadError) loadAccounts(); }, [mode, accounts, loadError]);
  if (!parsed || !isScheduledGoalProposal(proposal)) return <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-800/90"><p className="text-sm text-slate-700 dark:text-slate-200">This goal proposal is no longer available. Ask Penny to make it again.</p></section>;
  const blockedIds = new Set(parsed.funding_pots?.map(pot => pot.account_id));
  const sourceAccounts = (accounts ?? []).filter(account => isPlanSourceAccount(account) && !blockedIds.has(account.id));
  const revise = async (schedule: GoalSchedule, source = sourceId) => { if (busy || revisionLock.current) return; revisionLock.current = true; setRevising(true); setError(null); try { await onRevise(schedule, source); } catch { setError("The proposal could not be updated. Ask Penny to make it again."); } finally { revisionLock.current = false; setRevising(false); } };
  const actions = <div className="mt-4 flex gap-2"><button type="button" disabled={busy || revising} onClick={onConfirm} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-11 flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 text-sm font-semibold text-white disabled:opacity-50">Create goal</button><button type="button" disabled={busy || revising} onClick={onCancel} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700">Cancel</button></div>;
  if (mode === "edit") return <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"><GoalScheduleEditor schedule={parsed.schedule} busy={busy || revising} draftProposal submitLabel="Update proposal" onCancel={() => setMode("view")} onSave={schedule => revise(schedule)} />{error && <p role="alert" className="mt-3 text-sm text-slate-700 dark:text-slate-200">{error}</p>}</section>;
  if (mode === "source") return <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-800/90"><h3 className="text-base font-bold">Change source</h3>{loadError ? <div className="mt-3 text-sm text-slate-700 dark:text-slate-200">Accounts could not be loaded. <button type="button" onClick={loadAccounts} className="min-h-11 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 font-semibold text-indigo-600 dark:text-indigo-300">Retry</button></div> : accounts === null ? <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Loading accounts…</p> : sourceAccounts.length === 0 ? <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">No eligible account is available for this goal.</p> : <><div className="mt-3"><AccountRadioPicker accounts={sourceAccounts} value={sourceId} onChange={setSourceId} label="Pay from" helperText="The destination account is not available as the source." /></div><button type="button" disabled={!sourceId || busy || revising} onClick={() => void revise(parsed.schedule)} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 mt-4 min-h-11 w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 text-sm font-semibold text-white disabled:opacity-50">Update proposal</button></>}<button type="button" disabled={busy || revising} onClick={() => { setSourceId(parsed.source_account_id); setMode("view"); }} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 mt-3 min-h-11 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">Back</button>{error && <p role="alert" className="mt-3 text-sm text-slate-700 dark:text-slate-200">{error}</p>}</section>;
  return <section aria-label="Goal proposal" className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-800/90"><GoalScheduleDetails preview={parsed.schedule_preview} name={proposal.entity ?? undefined} onEdit={busy || revising ? undefined : () => setMode("edit")}><div className="space-y-2 text-sm text-slate-600 dark:text-slate-300"><p className="flex justify-between gap-3"><span>Money comes from <strong className="mt-1 block text-slate-900 dark:text-slate-100">{hidden ? "Selected account" : parsed.source_account_name ?? "your selected account"}</strong></span><button type="button" disabled={busy || revising} onClick={() => setMode("source")} className="min-h-11 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 shrink-0 font-semibold text-indigo-600 dark:text-indigo-300">Change</button></p>{parsed.destination_names?.length ? <p>Saved in {hidden ? "your selected destination" : parsed.destination_names.join(", ")}.</p> : null}{parsed.deactivate_allocation_name && <p>This replaces the {hidden ? "existing" : parsed.deactivate_allocation_name} set-aside. It will be paused when you create this goal, and past transfers stay with the set-aside. Goal progress starts today.</p>}<p>Nothing moves until you move it. Sorted tracks the plan; existing bank transfers carry on as usual.</p>{error && <p role="alert">{error}</p>}{actions}</div></GoalScheduleDetails></section>;
}
