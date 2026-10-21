"use client";

// Test-only host for the production components. Not a shipped design preview.
import { useEffect, useState } from "react";
import CommitmentSheet from "@/components/CommitmentSheet";
import SetAsideSheet from "@/components/SetAsideSheet";
import AllocationSheet from "@/components/AllocationSheet";
import PlanOneOffSheet from "@/components/PlanOneOffSheet";
import { api, type Account, type Commitment, type Allocation, type CommitmentPreview } from "@/lib/api";

const accounts = [
  { id: "current", name: "Everyday account", provider: "MONZO", balance: 600, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false },
  { id: "pot", name: "Holiday pot", provider: "MONZO", balance: 300, type: "bank", subtype: "SAVINGS_ACCOUNT", currency: "GBP", status: "active", manual: false },
] as Account[];
const goal = { id: "goal", name: "Holiday", amount: 1200, target_date: "2028-12-01", funding_pots: [{ account_id: "pot", name: "Holiday pot", kind: "connected", count_existing: false, contributing_balance: 300 }], funding_account_id: "pot", source_account_id: "current", source: "manual", status: "active", progress: 300, remaining: 900, periods_left: 9, per_period_slice: 100, on_track: true, shared_pot_goals: [], fill_rule: null } as unknown as Commitment;
const aside = { id: "aside", name: "Groceries", amount_per_period: 300, period_amount: 300, filled_this_period: 0, remaining: 300, source_account_id: "current", fill_account_id: "", match_type: "description_contains", match_value: "", fill_display_name: "", tracking_mode: "manual", recurrence: "every_period", active: true, period_start: "2026-10-01", period_end: "2026-10-31", effective_from: "2026-10-01", pending: false, completed: false } as Allocation;
const preview: CommitmentPreview = { starting_progress: 300, periods_left: 9, per_period_slice: 100, feasibility: null, feasibility_note: "This fits the example forecast.", feasibility_tone: "info", pots_detail: [{ account_id: "pot", free: 300, also_funding: [] }], consent: null };
const mergeGoal = (base: Commitment, body: Parameters<typeof api.updateCommitment>[1]): Commitment => ({ ...base, ...body, funding_pots: body.funding_pots?.map(pot => ({ ...goal.funding_pots![0], ...pot })) ?? base.funding_pots });

export default function PlanJourneyFixture() {
  const [open, setOpen] = useState<"goal" | "view-goal" | "aside" | "view-aside" | "single" | null>(null);
  const [savedGoal, setGoal] = useState(goal), [savedAside, setAside] = useState(aside);
  const [result, setResult] = useState("");
  const [fail, setFail] = useState(false);
  useEffect(() => {
    const original = api.planCategoryActivity;
    api.planCategoryActivity = async body => ({ category: body.category, mode: body.destination_account_ids?.length ? "transfers" : "spending", period_start: "2026-10-01", period_end: "2026-10-31", count: 4, gross: 105, refunds: 5, amount: 100, items: [] });
    document.documentElement.dataset.planFixtureReady = "true";
    return () => { api.planCategoryActivity = original; delete document.documentElement.dataset.planFixtureReady; };
  }, []);
  const close = () => setOpen(null);
  const check = () => { if (fail) { setFail(false); throw Error("Fixture save failure"); } };
  return <main className="min-h-dvh space-y-4 bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100"><h1>Production plan journey test host</h1><div className="flex flex-wrap gap-4">{(["goal", "view-goal", "aside", "view-aside"] as const).map(kind => <button type="button" key={kind} onClick={() => setOpen(kind)} className="min-h-11 rounded border px-4">{kind}</button>)}</div><label className="flex gap-3"><input type="checkbox" checked={fail} onChange={event => setFail(event.target.checked)} />Fail next save</label><output data-fixture-result>{result}</output>
    {(open === "goal" || open === "view-goal") && <CommitmentSheet key={open} accounts={accounts} commitment={open === "view-goal" ? savedGoal : null} initialMode={open === "view-goal" ? "view" : "edit"} onClose={close} onSaved={item => { setGoal(item); setResult("Goal saved"); }} onCancelled={() => setResult("Goal deleted")} operations={{ accounts: async () => accounts, previewCommitment: async (_amount, targetDate) => ({ ...preview, per_period_slice: targetDate.startsWith("2028") ? 100 : 150 }), planFillCandidates: async () => ({ items: [], suggestion: null }), createCommitment: async body => { check(); const item = mergeGoal(goal, body); setGoal(item); return item; }, updateCommitment: async (_id, body) => { check(); const item = mergeGoal(savedGoal, body); setGoal(item); return item; }, cancelCommitment: async () => { check(); setResult("Goal deleted"); } }} />}
    {open === "aside" && <SetAsideSheet accounts={accounts} scope="upcoming" periodStart={new Date("2026-10-01T12:00:00Z")} onClose={close} onSelectSingle={() => { setResult("One-off selected"); setOpen("single"); }} onSavedAllocation={item => { setAside(item); setResult("Set-aside saved"); }} operations={{ createAllocation: async body => { check(); return { ...aside, ...body }; }, allocationFillCandidates: async () => [] }} />}
    {open === "single" && <PlanOneOffSheet accounts={accounts} onClose={close} onSaved={() => setResult("One-off saved")} />}
    {open === "view-aside" && <AllocationSheet allocation={savedAside} accounts={accounts} periodStart={new Date("2026-10-01T12:00:00Z")} onClose={close} onSaved={item => { setAside(item); setResult("Set-aside updated"); }} onDeleted={() => setResult("Set-aside deleted")} services={{ updateAllocation: async (_id, body) => { check(); return { ...savedAside, ...body }; }, deleteAllocation: async () => { check(); return { ok: true }; }, allocationFillCandidates: async () => [] }} />}
  </main>;
}
