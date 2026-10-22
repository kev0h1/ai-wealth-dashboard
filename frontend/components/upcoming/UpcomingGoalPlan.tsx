"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CommitmentSheet, { type CommitmentSheetOperations } from "@/components/CommitmentSheet";
import type { Account, Commitment } from "@/lib/api";
import { api } from "@/lib/api";
import { UpcomingFlowFooter, useFlowSubmission, type UpcomingFlowNavigation } from "@/components/UpcomingFlowSheet";
import type { UpcomingDetailView } from "./UpcomingDetailFlow";

export type UpcomingGoalServices = CommitmentSheetOperations & {
  /** The detail route deliberately reads the full goal record. Account-plan
   * rows are a forecast projection and must never be used to reconstruct a
   * source, rule, or savings pot. */
  getCommitment?: (id: string) => Promise<Commitment>;
};

type Props = {
  id?: string;
  planId: string;
  mode: "view" | "edit" | "contribution";
  editStep?: "details";
  accounts: Account[];
  commitment?: Commitment;
  services?: UpcomingGoalServices;
  navigation: UpcomingFlowNavigation<UpcomingDetailView>;
  onLoaded(commitment: Commitment): void;
  onRefresh(): Promise<void>;
};

const isAccount = (view: UpcomingDetailView) => view.kind === "account";

/**
 * Adapter between an Upcoming forecast row and the canonical goal sheet.
 * It fetches a complete goal record before rendering it, so the forecast
 * projection can never silently become an edit payload.
 */
export default function UpcomingGoalPlan({
  id,
  planId,
  mode,
  editStep,
  accounts,
  commitment: cachedCommitment,
  services,
  navigation,
  onLoaded,
  onRefresh,
}: Props) {
  const setFlowSubmission = useFlowSubmission();
  const [commitment, setCommitment] = useState<Commitment | undefined>(cachedCommitment);
  const [state, setState] = useState<"loading" | "error" | "ready">(cachedCommitment ? "ready" : "loading");
  const deletedRef = useRef(false);
  const deletionExitedRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => { if (!disposed && cachedCommitment) { setCommitment(cachedCommitment); setState("ready"); } });
    return () => { disposed = true; };
  }, [cachedCommitment]);

  const getCommitment = services?.getCommitment ?? api.getCommitment;
  const load = useCallback(async () => {
    if (!id) {
      setState("error");
      return;
    }
    setState("loading");
    try {
      const loaded = await getCommitment(id);
      setCommitment(loaded);
      onLoaded(loaded);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [id, onLoaded, getCommitment]);

  useEffect(() => { let disposed = false; queueMicrotask(() => { if (!disposed && !cachedCommitment) void load(); }); return () => { disposed = true; }; }, [cachedCommitment, load]);

  if (!id) return <GoalProblem onRetry={() => { void onRefresh().catch(() => {}); }} missing />;
  if (state === "loading") return <p role="status" className="text-sm leading-6 text-slate-600 dark:text-slate-300">Loading this goal…</p>;
  if (state === "error" || !commitment) return <GoalProblem onRetry={load} />;

  async function saved(item: Commitment) {
    setCommitment(item);
    onLoaded(item);
    await onRefresh();
  }

  async function cancelled() {
    deletedRef.current = true;
    await onRefresh();
    // Refresh removes the goal from Upcoming's rows and may unmount this
    // adapter before the editor can run its completion callback.
    leaveDeletedGoal();
  }

  function leaveDeletedGoal() {
    if (deletionExitedRef.current) return;
    deletionExitedRef.current = true;
    // The write and refresh have both finished. Release the parent flow's
    // navigation fence even if the removed editor has already unmounted.
    setFlowSubmission(false);
    if (!navigation.returnTo(isAccount)) navigation.close();
  }

  function backToGoal() {
    // Date editing may have been opened from the contribution draft. An
    // explicit Back to plan or a completed edit returns to the saved View.
    if (!navigation.returnTo(view => view.kind === "plan" && view.id === planId)) navigation.back();
  }

  function close() {
    if (deletedRef.current) { leaveDeletedGoal(); return; }
    if (mode === "view") {
      if (!navigation.returnTo(isAccount)) navigation.close();
      return;
    }
    backToGoal();
  }

  return <CommitmentSheet
    accounts={accounts}
    commitment={commitment}
    initialMode={mode}
    initialStep={editStep}
    operations={services}
    onSaved={saved}
    onCancelled={cancelled}
    onClose={close}
    embedded={{
      renderActions: (actions) => <UpcomingFlowFooter>{actions}</UpcomingFlowFooter>,
      onEdit: (step) => navigation.goTo({ kind: "edit-plan", id: planId, ...(step ? { step } : {}) }),
      onChangeContribution: () => navigation.goTo({ kind: "goal-contribution", id: planId }),
      onCancel: backToGoal,
      onBusyChange: setFlowSubmission,
    }}
  />;
}

function GoalProblem({ onRetry, missing = false }: { onRetry(): void; missing?: boolean }) {
  return <div className="space-y-4">
    <p role="alert" className="text-sm leading-6 text-slate-700 dark:text-slate-200">{missing ? "This goal is no longer available." : "We could not load this goal. Your plan has not been changed."}</p>
    <button type="button" onClick={onRetry} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800">Try again</button>
  </div>;
}
