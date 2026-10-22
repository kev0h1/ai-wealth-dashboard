"use client";

// Synthetic QA host for the production allocation contribution surfaces.
// Mount only from a temporary local route; every service is injected here.
import { useEffect, useMemo, useRef, useState } from "react";
import AllocationSheet from "@/components/AllocationSheet";
import { type AllocationEditServices } from "@/components/AllocationPlanEditor";
import UpcomingDetailFlow from "@/components/upcoming/UpcomingDetailFlow";
import { type Account, type Allocation, type AllocationContributionPreview } from "@/lib/api";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { type Plan } from "@/lib/upcomingPlans";

const accounts = [
  { id: "current", name: "Everyday account", provider: "Monzo", balance: 1_600, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false },
  { id: "pot", name: "Rainy day pot", provider: "Monzo", balance: 400, type: "bank", subtype: "SAVINGS_ACCOUNT", currency: "GBP", status: "active", manual: false },
] as Account[];

const base: Allocation = {
  id: "rainy-day", name: "Rainy day", amount_per_period: 79.24, period_amount: 79.24,
  fill_account_id: "pot", destination_account_id: "pot", source_account_id: "current",
  match_type: "description_contains", match_value: "rainy day", fill_display_name: "Rainy day transfer",
  effective_from: "2026-01-01", recurrence: "every_period", completed: false, pending: false,
  active: true, filled_this_period: 0, remaining: 79.24, period_start: "2026-11-01", period_end: "2026-11-30",
  tracking_mode: "manual", current_period_contribution: null,
};

type Host = "home" | "upcoming";
type Failures = { preview: boolean; save: boolean; refresh: boolean };

const currentContribution = (preview: AllocationContributionPreview): Omit<AllocationContributionPreview, "preview_token"> => {
  const { preview_token: previewToken, ...contribution } = preview;
  void previewToken;
  return contribution;
};

export default function PeriodContributionFixture() {
  const [host, setHost] = useState<Host | null>(null);
  const [record, setRecord] = useState<Allocation>(base);
  const [writes, setWrites] = useState<object[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);
  const [matched, setMatched] = useState(false);
  const [pending, setPending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [once, setOnce] = useState(false);
  const failures = useRef<Failures>({ preview: false, save: false, refresh: false });
  const recordRef = useRef(record);
  useEffect(() => { recordRef.current = record; }, [record]);
  const matchedRef = useRef(matched);
  useEffect(() => { matchedRef.current = matched; }, [matched]);

  useEffect(() => {
    document.documentElement.dataset.g318Ready = "true";
    return () => { delete document.documentElement.dataset.g318Ready; };
  }, []);

  const services = useMemo(() => {
    function preview(pence: number): AllocationContributionPreview {
      const contribution = pence / 100;
      const matchedThisPeriod = matchedRef.current ? 20.10 : 0;
      return {
        period_start: recordRef.current.period_start,
        period_end: recordRef.current.period_end,
        requested_contribution: contribution,
        contribution,
        reserved: Math.max(0, contribution - matchedThisPeriod),
        matched_this_period: matchedThisPeriod,
        next_contribution: 79.24,
        unchanged: pence === Math.round((recordRef.current.current_period_contribution?.contribution ?? recordRef.current.period_amount ?? recordRef.current.amount_per_period) * 100),
        preview_token: `fixture-${pence}`,
      };
    }
    return {
      updateAllocation: async (_id, changes) => ({ ...recordRef.current, ...changes }),
      deleteAllocation: async () => ({ ok: true }),
      allocationFillCandidates: async () => [],
      previewAllocationContribution: async (_id, pence) => {
        if (failures.current.preview) {
          failures.current.preview = false;
          setErrors(previous => [...previous, "preview"]);
          throw new Error("Example preview failed");
        }
        return preview(pence);
      },
      setAllocationContribution: async (_id, input) => {
        if (failures.current.save) {
          failures.current.save = false;
          setErrors(previous => [...previous, "save"]);
          throw new Error("Example save failed");
        }
        const checked = preview(input.contribution_pence);
        const next: Allocation = {
          ...recordRef.current,
          current_period_contribution: currentContribution(checked),
          // The saved period total is this explicit choice. The recurring
          // amount stays at £79.24 and is exposed as next_contribution.
          period_amount: checked.contribution,
          remaining: checked.reserved,
        };
        setWrites(previous => [...previous, input]);
        setRecord(next);
        return next;
      },
    } satisfies AllocationEditServices;
  }, []);

  async function refresh() {
    if (failures.current.refresh) {
      failures.current.refresh = false;
      setErrors(previous => [...previous, "refresh"]);
      throw new Error("Example refresh failed");
    }
  }

  function open(nextHost: Host) {
    const next = { ...base, active: !paused, pending, recurrence: once ? "once" : "every_period" } as Allocation;
    setRecord(next); recordRef.current = next;
    setWrites([]); setErrors([]); setHost(nextHost);
  }

  const plan: Plan = {
    id: "rainy-day-row", recordId: "rainy-day", kind: "allocation", name: "Rainy day", sourceId: "current",
    destinationIds: ["pot"], destination: "Rainy day pot", evidence: "chosen", filledPence: 0,
    periodPence: 7924, remainingPence: 7924, active: true,
  };

  return <main className="min-h-dvh space-y-4 bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <h1>Period contribution test host</h1>
    <div className="flex flex-wrap gap-3"><button type="button" onClick={() => open("home")}>Home</button><button type="button" onClick={() => open("upcoming")}>Upcoming</button></div>
    <div className="grid gap-2 text-sm">
      <label><input id="fail-preview" type="checkbox" onChange={event => { failures.current.preview = event.target.checked; }} /> Fail next preview</label>
      <label><input id="fail-save" type="checkbox" onChange={event => { failures.current.save = event.target.checked; }} /> Fail next save</label>
      <label><input id="fail-refresh" type="checkbox" onChange={event => { failures.current.refresh = event.target.checked; }} /> Fail next refresh</label>
      <label><input id="matched" type="checkbox" checked={matched} onChange={event => setMatched(event.target.checked)} /> Matched £20.10</label>
      <label><input id="paused" type="checkbox" checked={paused} onChange={event => setPaused(event.target.checked)} /> Paused</label>
      <label><input id="pending" type="checkbox" checked={pending} onChange={event => setPending(event.target.checked)} /> Pending</label>
      <label><input id="once" type="checkbox" checked={once} onChange={event => setOnce(event.target.checked)} /> Once</label>
      <label><input id="hide" type="checkbox" checked={hidden} onChange={event => setHidden(event.target.checked)} /> Hide amounts</label>
    </div>
    <output id="writes">{JSON.stringify(writes)}</output><output id="errors">{JSON.stringify(errors)}</output><output id="record">{JSON.stringify(record)}</output>
    <BalancesHiddenContext.Provider value={hidden}>
      {host === "home" && <AllocationSheet allocation={record} accounts={accounts} periodStart={new Date("2026-11-01T12:00:00Z")} services={services} onClose={() => setHost(null)} onSaved={async item => { setRecord(item); await refresh(); }} />}
      {host === "upcoming" && <UpcomingDetailFlow initialView={{ kind: "plan", id: plan.id }} onClose={() => setHost(null)} accounts={accounts} summaries={[]} periodLabel="November" periodStart={new Date("2026-11-01T12:00:00Z")} plans={[plan]} plansStatus="ready" allocations={[record]} payments={[]} onRefresh={refresh} onDismiss={() => {}} onDeletePlanned={() => {}} services={{ allocation: services }} />}
    </BalancesHiddenContext.Provider>
  </main>;
}
