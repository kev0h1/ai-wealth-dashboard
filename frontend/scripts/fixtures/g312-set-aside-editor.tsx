"use client";

// Auth-free test host only. A temporary local route mounts these real components.
import { useEffect, useRef, useState } from "react";
import AllocationSheet from "@/components/AllocationSheet";
import UpcomingDetailFlow from "@/components/upcoming/UpcomingDetailFlow";
import { api, type Account, type Allocation } from "@/lib/api";
import type { Plan } from "@/lib/upcomingPlans";

const accounts = [
  { id: "current", name: "Everyday account", provider: "Monzo", balance: 1600, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false },
  { id: "joint", name: "JOINT CURRENT ACCOUNT", provider: "NatWest", balance: 800, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false },
  { id: "pot", name: "Saving Challenge", provider: "Monzo", balance: 400, type: "bank", subtype: "SAVINGS_ACCOUNT", currency: "GBP", status: "active", manual: false },
] as Account[];
const base: Allocation = { id: "aside", name: "Saving Challenge", amount_per_period: 376.6, period_amount: 376.6, filled_this_period: 50, remaining: 326.6, source_account_id: "current", fill_account_id: "pot", match_type: "description_contains", match_value: "CHALLENGE", fill_display_name: "Challenge transfer", tracking_mode: "existing_payment", recurrence: "every_period", active: true, period_start: "2026-10-01", period_end: "2026-10-31", effective_from: "2026-08-28", pending: false, completed: false };
type Scenario = "payment" | "manual" | "suggested" | "category" | "unavailable";
type Host = "upcoming" | "allocation";
export default function SetAsideEditorFixture() {
  const [host, setHost] = useState<Host | null>(null);
  const [item, setItem] = useState(base);
  const [suggested, setSuggested] = useState(false);
  const [failSave, setFailSave] = useState(false), [failRefresh, setFailRefresh] = useState(false), [slow, setSlow] = useState(false);
  const refreshFailure = useRef(false);
  useEffect(() => { refreshFailure.current = failRefresh; }, [failRefresh]);
  const [writes, setWrites] = useState<object[]>([]), [refreshes, setRefreshes] = useState(0), [deletes, setDeletes] = useState(0);
  useEffect(() => {
    const original = api.planCategoryActivity;
    api.planCategoryActivity = async body => ({ category: body.category, mode: body.destination_account_ids?.length ? "transfers" : "spending", period_start: "2026-10-01", period_end: "2026-10-31", count: 2, gross: 25, refunds: 5, amount: 20, items: [] });
    document.documentElement.dataset.g312Ready = "true";
    return () => { api.planCategoryActivity = original; delete document.documentElement.dataset.g312Ready; };
  }, []);
  function open(next: Host, scenario: Scenario) {
    const record = { ...base };
    if (scenario === "manual") Object.assign(record, { tracking_mode: "manual", fill_account_id: "", match_value: "", fill_display_name: "", filled_this_period: 0, remaining: 376.6 });
    if (scenario === "suggested") record.source_account_id = null;
    if (scenario === "category") Object.assign(record, { tracking_mode: "manual", fill_account_id: "", match_value: "", fill_display_name: "", category_tracking: { category: "Groceries" } });
    if (scenario === "unavailable") record.destination_account_id = "disconnected";
    setSuggested(scenario === "suggested"); setItem(record); setWrites([]); setRefreshes(0); setDeletes(0); setHost(next);
  }
  const close = () => setHost(null);
  const refresh = async () => { setRefreshes(n => n + 1); if (refreshFailure.current) { refreshFailure.current = false; setFailRefresh(false); throw Error("Fixture refresh failed"); } };
  const services = {
    updateAllocation: async (_id: string, body: Parameters<typeof api.updateAllocation>[1]) => {
      setWrites(previous => [...previous, body]);
      if (slow) await new Promise(resolve => setTimeout(resolve, 600));
      if (failSave) { setFailSave(false); throw Error("Fixture save failed"); }
      const updated = { ...item, ...body }; setItem(updated); return updated;
    },
    deleteAllocation: async () => { setDeletes(n => n + 1); return { ok: true }; },
    allocationFillCandidates: async () => [{ series_key: "challenge", display_name: "Challenge transfer", occurrences_90d: 4, last_amount: 25, last_date: "2026-10-01" }],
  };
  const plan: Plan = { id: "plan", recordId: item.id, kind: "allocation", name: item.name, destination: "Saving Challenge", sourceId: suggested ? "current" : item.source_account_id ?? null, evidence: suggested ? "recent-transfers" : "chosen", periodPence: 37660, filledPence: 5000, active: item.active };
  return <main className="min-h-dvh space-y-4 bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100"><h1>Set-aside editor test host</h1><div className="flex flex-wrap gap-2">{(["upcoming", "allocation"] as const).flatMap(next => (["payment", "manual", "suggested", "category", "unavailable"] as const).map(scenario => <button type="button" key={`${next}-${scenario}`} onClick={() => open(next, scenario)} className="min-h-11 rounded border px-3">{next}-{scenario}</button>))}</div><div className="space-y-3">{[["fail-save", failSave, setFailSave], ["fail-refresh", failRefresh, setFailRefresh], ["slow", slow, setSlow]] .map(([id, checked, change]) => <label key={String(id)} className="flex min-h-11 gap-2"><input id={String(id)} type="checkbox" checked={Boolean(checked)} onChange={event => (change as (value: boolean) => void)(event.target.checked)} />{String(id)}</label>)}</div><output id="fixture-writes">{JSON.stringify(writes)}</output><output id="fixture-refreshes">{refreshes}</output><output id="fixture-deletes">{deletes}</output>
    {host === "allocation" && <AllocationSheet allocation={item} accounts={accounts} periodStart={new Date("2026-09-25T12:00:00Z")} suggestedSourceId={suggested ? "current" : null} onClose={close} onSaved={refresh} onDeleted={refresh} services={services} />}
    {host === "upcoming" && <UpcomingDetailFlow initialView={{ kind: "plan", id: "plan" }} onClose={close} accounts={accounts} summaries={[]} periodLabel="October" periodStart={new Date("2026-09-25T12:00:00Z")} plans={[plan]} plansStatus="ready" allocations={[item]} payments={[]} onRefresh={refresh} onDismiss={() => {}} onDeletePlanned={() => {}} services={{ allocation: services }} />}
  </main>;
}
