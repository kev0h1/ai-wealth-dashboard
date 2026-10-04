"use client";

// G204 bug-fix check, not a design round: renders the production
// UpcomingDetailFlow (and so the real GoalSourceForm and AccountRadioPicker)
// with invented, deliberately awkward fixtures: raw upper-case provider
// strings, very long account names, a long goal name and large balances.
// ?mode=light|dark&view=plan|edit-plan
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Account } from "@/lib/api";
import type { Plan } from "@/lib/upcomingPlans";
import UpcomingDetailFlow, { type UpcomingDetailView } from "@/components/upcoming/UpcomingDetailFlow";

const accounts: Account[] = [
  { id: "canary", provider: "PENTESTCANARYBANK", name: "CURRENT ACCOUNT", type: "bank", subtype: "current", currency: "GBP", balance: 988, manual: false, status: "active" },
  { id: "long", provider: "The Extraordinarily Long Named Building Society and Trust", name: "Joint household bills and everyday spending account with a very long name", type: "bank", subtype: "current", currency: "GBP", balance: 1234567.89, manual: false, status: "active" },
  { id: "monzo", provider: "Monzo", name: "Everyday account", type: "bank", subtype: "current", currency: "GBP", balance: 348, manual: false, status: "active" },
  { id: "pot", provider: "Monzo", name: "Holiday pot", type: "saving", subtype: "saving", currency: "GBP", balance: 60, manual: false, status: "active" },
] as Account[];

const plan: Plan = {
  id: "goal", recordId: "goal-record", kind: "goal", name: "Family holiday to the Outer Hebrides, including ferries and the cottage deposit",
  destination: "Holiday pot with an unreasonably long receiving name that must wrap", destinationIds: ["pot"], sourceId: null, evidence: "unknown",
  periodPence: 5000, filledPence: 0, remainingPence: 5000, active: true,
};

export default function PreviewClient() {
  const params = useSearchParams();
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const view: UpcomingDetailView = { kind: params.get("view") === "plan" ? "plan" : "edit-plan", id: "goal" };
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const root = document.documentElement; const wasDark = root.classList.contains("dark"); const prior = root.style.colorScheme;
    root.classList.toggle("dark", mode === "dark"); root.style.colorScheme = mode;
    return () => { root.classList.toggle("dark", wasDark); root.style.colorScheme = prior; };
  }, [mode]);
  return <div className="min-h-dvh bg-[#f0f2f7] p-4 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
    <h1 className="text-lg font-semibold">G204 · Link goal to an account</h1>
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Production flow with long invented names. Invented data only.</p>
    {!open && <button type="button" onClick={() => setOpen(true)} className="mt-4 min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white">Reopen sheet</button>}
    {open && <UpcomingDetailFlow initialView={view} onClose={() => setOpen(false)} accounts={accounts} summaries={[]} periodLabel="Through Thu 29 Oct" periodStart={new Date("2026-10-01T12:00:00Z")}
      plans={[plan]} plansStatus="ready" allocations={[]} payments={[]} onRefresh={async () => {}} onDismiss={() => {}} onDeletePlanned={() => {}}
      services={{ changeGoalSource: async () => {} }} />}
  </div>;
}
