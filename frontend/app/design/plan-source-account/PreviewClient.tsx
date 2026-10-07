"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import CommitmentSheet, { type CommitmentSheetOperations } from "@/components/CommitmentSheet";
import type { Account, Commitment } from "@/lib/api";

// G230 preview. Mounts the production CommitmentSheet (Edit plan) with
// invented accounts and a goal plan, so the "Paid from" field is the shipped
// markup. No API calls: every operation is a local fixture.

type State = "inferred" | "chosen" | "unset";

const ACCOUNTS: Account[] = [
  { id: "monzo", provider: "Monzo", name: "Monzo Current", balance: 1240.5, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false },
  { id: "premier", provider: "Barclays", name: "Premier Current", balance: 860, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false },
  { id: "joint", provider: "Halifax", name: "Joint bills", balance: 410, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false, include_in_safe_to_spend: false },
  { id: "amex", provider: "Amex", name: "Amex Gold", balance: -320, type: "credit_card", subtype: "CREDIT_CARD", currency: "GBP", status: "active", manual: false },
  { id: "japan-pot", provider: "Monzo", name: "Japan pot", balance: 640, type: "bank", subtype: "SAVINGS_ACCOUNT", currency: "GBP", status: "active", manual: false },
];

function goalFor(state: State): Commitment {
  const target = new Date();
  target.setMonth(target.getMonth() + 8);
  const targetDate = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-01`;
  return {
    id: "japan", name: "Japan trip", amount: 1500, target_date: targetDate,
    funding_pots: [{ account_id: "japan-pot", name: "Japan pot", kind: "connected", count_existing: false, contributing_balance: 640 }],
    funding_account_id: "japan-pot", funding_account_name: "Japan pot",
    source: "manual", status: "active", progress: 640, remaining: 860, periods_left: 8,
    per_period_slice: 110, on_track: true, shared_pot_goals: [],
    source_account_id: state === "unset" ? null : "monzo",
    source_inferred: state === "inferred",
    source_account_name: state === "unset" ? null : "Monzo Current",
  };
}

const OPERATIONS: CommitmentSheetOperations = {
  accounts: async () => ACCOUNTS,
  previewCommitment: async () => ({ per_period_slice: 110, periods_left: 8, feasibility: "surplus", feasibility_note: "Looks comfortable at this pace.", feasibility_tone: "info", pots_detail: [], consent: null }),
  createCommitment: async () => { throw new Error("Preview only"); },
  updateCommitment: async () => { throw new Error("Preview only"); },
  cancelCommitment: async () => {},
};

const STATES: { id: State; label: string }[] = [
  { id: "inferred", label: "Inferred" },
  { id: "chosen", label: "Chosen" },
  { id: "unset", label: "Not set" },
];

export default function PreviewClient() {
  const params = useSearchParams();
  const state = STATES.find((s) => s.id === params.get("state"))?.id ?? "inferred";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const [open, setOpen] = useState(true);
  const commitment = useMemo(() => goalFor(state), [state]);
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const prior = root.style.colorScheme;
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
    return () => { root.classList.toggle("dark", wasDark); root.style.colorScheme = prior; };
  }, [mode]);
  const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
  return (
    <div className="min-h-dvh bg-[#f0f2f7] text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-xl px-4 py-3">
          <Link href="/design" className={`flex min-h-11 items-center gap-2 rounded-lg text-sm text-slate-600 dark:text-slate-400 ${focus}`}><ArrowLeft size={16} aria-hidden="true" />Design rounds</Link>
          <nav aria-label="Example states" className="grid grid-cols-3 gap-2 pb-2">
            {STATES.map((s) => (
              <Link key={s.id} href={`?state=${s.id}&mode=${mode}`} aria-current={state === s.id ? "page" : undefined}
                className={`flex min-h-11 items-center justify-center rounded-lg border px-2 text-xs ${focus} ${state === s.id ? "border-indigo-500 text-indigo-700 dark:text-indigo-300" : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"}`}>{s.label}</Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">G230 · Edit plan, Paid from</p>
        <h1 className="mt-2 text-xl font-bold tracking-tight">Which account does this plan leave?</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">This mounts the production Edit plan sheet with invented accounts. The joint bills account is left out of Safe to Spend and the Amex card is never offered.</p>
        <button type="button" onClick={() => setOpen(true)} className={`mt-4 min-h-11 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white ${focus}`}>Open Edit plan</button>
      </main>
      {open && <CommitmentSheet key={state} accounts={ACCOUNTS} commitment={commitment} operations={OPERATIONS} onClose={() => setOpen(false)} />}
    </div>
  );
}
