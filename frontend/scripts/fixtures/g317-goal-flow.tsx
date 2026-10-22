"use client";

// Synthetic host for production components. Mount only in a temporary QA route.
import { useEffect, useMemo, useRef, useState } from "react";
import CommitmentSheet, { type CommitmentSheetOperations } from "@/components/CommitmentSheet";
import UpcomingDetailFlow from "@/components/upcoming/UpcomingDetailFlow";
import { type Account, type Commitment, type GoalContributionPreview } from "@/lib/api";
import { type Plan } from "@/lib/upcomingPlans";
import { BalancesHiddenContext } from "@/lib/balancesHidden";

const accounts = [
  { id: "current", name: "Everyday account", provider: "Monzo", balance: 1600, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false },
  { id: "other", name: "Joint current account", provider: "Barclays", balance: 500, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false },
  { id: "pot", name: "Japan savings pot", provider: "Monzo", balance: 400, type: "bank", subtype: "SAVINGS_ACCOUNT", currency: "GBP", status: "active", manual: false },
] as Account[];
const base: Commitment = { id: "goal", name: "Japan", amount: 300, target_date: "2027-01-01", funding_pots: [{ account_id: "pot", name: "Japan savings pot", kind: "connected", count_existing: false, contributing_balance: 0 }], funding_account_id: "pot", funding_account_name: "Japan savings pot", source_account_id: "current", source_inferred: true, source: "manual", status: "active", progress: 0, remaining: 300, periods_left: 3, per_period_slice: 100, planned_per_period_slice: 100, usual_slice: 100, on_track: true, shared_pot_goals: [] };

export default function GoalFlowFixture() {
  const [host, setHost] = useState<"planning" | "upcoming" | null>(null);
  const [goalVisible, setGoalVisible] = useState(true);
  const [record, setRecord] = useState(base), [writes, setWrites] = useState<object[]>([]);
  const [hidden, setHidden] = useState(false);
  const [blockLater, setBlockLater] = useState(false);
  const failures = useRef({ refresh: false, lookup: false, save: false });
  const recordRef = useRef(record);
  useEffect(() => { recordRef.current = record; }, [record]);
  const blockedRef = useRef(blockLater);
  useEffect(() => { blockedRef.current = blockLater; }, [blockLater]);
  useEffect(() => { document.documentElement.dataset.g317Ready = "true"; return () => { delete document.documentElement.dataset.g317Ready; }; }, []);
  const services = useMemo(() => {
    function preview(pence: number): GoalContributionPreview {
      const c = recordRef.current, contribution = Math.min(c.remaining, pence / 100), after = c.remaining - contribution;
      return { period_start: "2026-11-01", period_end: "2026-11-30", target_date: c.target_date, requested_contribution: pence / 100, unchanged: pence === Math.round((c.current_period_contribution?.contribution ?? c.planned_per_period_slice ?? c.per_period_slice) * 100), contribution, reserved: contribution, matched_this_period: 0, remaining: c.remaining, remaining_after: after, later_periods: blockedRef.current ? 0 : 2, later_contribution: blockedRef.current && after > 0 ? null : Math.ceil(after / 10) * 5, covers_remaining: after === 0, capped: contribution !== pence / 100, large_increase: after > 250, blocked_reason: blockedRef.current && after > 0 ? "There are no later pay periods before this target date. Choose enough for the remaining target or change the target date separately." : null, preview_token: `fixture-${pence}`, replaces_easing: false };
    }
    async function write(body: object): Promise<Commitment> {
      if (failures.current.save) { failures.current.save = false; throw Error("Example save failed"); }
      setWrites(previous => [...previous, body]);
      const next = { ...recordRef.current, ...body }; setRecord(next); return next;
    }
    return {
      accounts: async () => accounts,
      previewCommitment: async () => ({ starting_progress: 0, periods_left: 3, per_period_slice: 100, feasibility: null, pots_detail: [], consent: null }),
      planFillCandidates: async () => ({ items: [], suggestion: null }),
      createCommitment: write,
      updateCommitment: async (_id, body) => write(body),
      cancelCommitment: async () => { await write({ status: "cancelled" }); },
      getCommitment: async () => { await new Promise(resolve => setTimeout(resolve, 350)); if (failures.current.lookup) { failures.current.lookup = false; throw Error("Example lookup failed"); } return recordRef.current; },
      previewGoalContribution: async (_id, pence) => preview(pence),
      setGoalContribution: async (_id, body) => {
        const checked = preview(body.contribution_pence);
        return write({ current_period_contribution: checked, per_period_slice: checked.reserved, planned_per_period_slice: checked.contribution });
      },
    } satisfies CommitmentSheetOperations & { getCommitment(): Promise<Commitment> };
  }, []);
  async function refresh() { if (failures.current.refresh) { failures.current.refresh = false; throw Error("Example refresh failed"); } if (recordRef.current.status === "cancelled") setGoalVisible(false); }
  function open(next: "planning" | "upcoming") { setRecord(base); setWrites([]); setGoalVisible(true); setHost(next); }
  const plan = { id: "goal-row", recordId: "goal", kind: "goal", name: "Japan", sourceId: "other", destinationIds: ["pot"], destination: "Japan savings pot", evidence: "chosen", filledPence: 0, periodPence: 10000, remainingPence: 10000, active: true } as Plan;
  return <main className="min-h-dvh space-y-4 bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <h1>Goal flow test host</h1><button type="button" onClick={() => open("planning")}>Planning</button><button type="button" onClick={() => open("upcoming")}>Upcoming</button>
    <label className="block"><input id="fail-refresh" type="checkbox" onChange={e => { failures.current.refresh = e.target.checked; }} />Fail next refresh</label>
    <label className="block"><input id="fail-lookup" type="checkbox" onChange={e => { failures.current.lookup = e.target.checked; }} />Fail next lookup</label>
    <label className="block"><input id="fail-save" type="checkbox" onChange={e => { failures.current.save = e.target.checked; }} />Fail next save</label>
    <label className="block"><input id="hide" type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} />Hide amounts</label>
    <label className="block"><input id="no-later" type="checkbox" checked={blockLater} onChange={e => setBlockLater(e.target.checked)} />No later periods</label>
    <output id="writes">{JSON.stringify(writes)}</output><output id="record">{JSON.stringify(record)}</output>
    <BalancesHiddenContext.Provider value={hidden}>
      {host === "planning" && <CommitmentSheet accounts={accounts} commitment={record} initialMode="view" operations={services} onClose={() => setHost(null)} onSaved={async item => { setRecord(item); await refresh(); }} onCancelled={refresh} />}
      {host === "upcoming" && <UpcomingDetailFlow initialView={{ kind: "plan", id: "goal-row" }} onClose={() => setHost(null)} accounts={accounts} summaries={[]} periodLabel="November" periodStart={new Date("2026-11-01T12:00:00Z")} plans={goalVisible ? [plan] : []} plansStatus="ready" allocations={[]} payments={[]} onRefresh={refresh} onDismiss={() => {}} onDeletePlanned={() => {}} services={{ goal: services }} />}
    </BalancesHiddenContext.Provider>
  </main>;
}
