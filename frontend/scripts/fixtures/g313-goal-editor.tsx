"use client";

// Synthetic test host for the real sheet. Mount only in a temporary local route.
import { useEffect, useState } from "react";
import CommitmentSheet from "@/components/CommitmentSheet";
import { api, type Account, type Commitment, type CommitmentPreview } from "@/lib/api";
import { BalancesHiddenContext } from "@/lib/balancesHidden";

const accounts = [
  { id: "current", name: "Everyday account", provider: "Monzo", balance: 1600, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false },
  { id: "joint", name: "JOINT CURRENT ACCOUNT", provider: "NatWest", balance: 800, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false },
  { id: "pot", name: "Japan pot", provider: "Monzo", balance: 400, type: "bank", subtype: "SAVINGS_ACCOUNT", currency: "GBP", status: "active", manual: false },
  { id: "second-pot", name: "Holiday pot", provider: "Monzo", balance: 200, type: "bank", subtype: "SAVINGS_ACCOUNT", currency: "GBP", status: "active", manual: false },
] as Account[];
const base = {
  id: "goal", name: "Japan", amount: 2500.75, target_date: "2028-12-01",
  funding_pots: [
    { account_id: "pot", name: "Japan pot", kind: "connected", count_existing: false, contributing_balance: 100.25 },
    { account_id: "second-pot", name: "Holiday pot", kind: "connected", count_existing: true, contributing_balance: 200 },
  ],
  funding_account_id: "pot", funding_account_name: "Japan pot", source_account_id: "current", source: "manual", status: "active",
  progress: 300.25, remaining: 2200.5, periods_left: 9, per_period_slice: 245,
  on_track: true, shared_pot_goals: [], fill_rule: { match_type: "description_contains", match_value: "Japan transfer" },
} as Commitment;
const preview: CommitmentPreview = { starting_progress: 300.25, periods_left: 9, per_period_slice: 245, feasibility: "stretch", feasibility_note: "An unactionable monthly shortfall warning", feasibility_tone: "caution", pots_detail: [{ account_id: "pot", free: 300, also_funding: [] }, { account_id: "second-pot", free: 200, also_funding: [] }], consent: null };
type Scenario = "payment" | "manual" | "suggested" | "historic" | "category" | "create-consent";
export default function GoalEditorFixture() {
  const [scenario, setScenario] = useState<Scenario | null>(null), [record, setRecord] = useState(base);
  const [writes, setWrites] = useState<object[]>([]), [deletes, setDeletes] = useState(0);
  const [fail, setFail] = useState(false), [slow, setSlow] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const original = api.planCategoryActivity;
    api.planCategoryActivity = async body => ({ category: body.category, mode: "transfers", period_start: "2026-10-01", period_end: "2026-10-31", count: 2, gross: 25, refunds: 5, amount: 20, items: [] });
    document.documentElement.dataset.g313Ready = "true";
    return () => { api.planCategoryActivity = original; delete document.documentElement.dataset.g313Ready; };
  }, []);
  function open(next: Scenario) {
    const item = { ...base };
    if (next === "manual") item.fill_rule = null;
    if (next === "suggested") Object.assign(item, { source_inferred: true, fill_rule: null });
    if (next === "historic") item.target_date = "2026-09-01";
    if (next === "category") Object.assign(item, { fill_rule: null, category_tracking: { category: "Savings" } });
    setRecord(item); setWrites([]); setDeletes(0); setScenario(next);
  }
  async function write(body: object) {
    setWrites(previous => [...previous, body]);
    if (slow) await new Promise(resolve => setTimeout(resolve, 650));
    if (fail) { setFail(false); throw Error("Fixture save failed"); }
    return { ...record, ...body } as Commitment;
  }
  return <main className="min-h-dvh space-y-4 bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <h1>Goal editor test host</h1><div className="flex flex-wrap gap-2">{(["payment", "manual", "suggested", "historic", "category", "create-consent"] as const).map(next => <button type="button" key={next} onClick={() => open(next)} className="min-h-11 rounded border px-3">{next}</button>)}</div>
    <label className="flex min-h-11 gap-2"><input id="fail-save" type="checkbox" checked={fail} onChange={event => setFail(event.target.checked)} />Fail next save</label>
    <label className="flex min-h-11 gap-2"><input id="slow" type="checkbox" checked={slow} onChange={event => setSlow(event.target.checked)} />Slow save</label>
    <label className="flex min-h-11 gap-2"><input id="hidden" type="checkbox" checked={hidden} onChange={event => setHidden(event.target.checked)} />Hide amounts</label>
    <output id="fixture-writes">{JSON.stringify(writes)}</output><output id="fixture-deletes">{deletes}</output>
    <BalancesHiddenContext.Provider value={hidden}>{scenario && <CommitmentSheet accounts={accounts} commitment={scenario === "create-consent" ? null : record} initialMode="view" onClose={() => setScenario(null)} onSaved={setRecord} operations={{
      accounts: async () => accounts,
      previewCommitment: async () => ({ ...preview, ...(scenario === "create-consent" ? { consent: { required: true, title: "This needs a closer look", lines: ["This example needs £40 more each month."], actions: { anyway: "Save anyway", later_date: "Choose a later date", debt_first: "Review card plan" } } } : {}) }),
      planFillCandidates: async () => ({ items: [{ series_key: "japan", display_name: "Japan transfer", last_amount: 50, last_date: "2026-10-01", occurrences_90d: 3 }], suggestion: null }),
      createCommitment: write,
      updateCommitment: async (_id, body) => write(body),
      cancelCommitment: async () => { setDeletes(n => n + 1); },
    }} />}</BalancesHiddenContext.Provider>
  </main>;
}
