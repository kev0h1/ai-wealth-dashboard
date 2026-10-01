"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SheetFrame, type SheetFrameVariant } from "@/components/SheetFrame";
import { useSavingsGoalEditor, type SavingsGoalOperations } from "@/components/SavingsGoalSheet";
import { TransactionFilterSheetContent, type FilterDraft } from "@/components/TransactionFilterSheet";
import type { SavingsInsights } from "@/lib/api";
import { fmt } from "@/lib/format";
import FixtureBottomNav from "../_components/FixtureBottomNav";

const BASE_GOAL: SavingsInsights = {
  configured: false, target_type: "months", target_months: 3, target_amount: 5550,
  monthly_spending: 1850, current_savings: 2310, pct_funded: 42, months_funded: 1.25,
  monthly_income: 3200, monthly_surplus: 430, months_to_target: 8,
  funded_date: null, has_data: true,
  accounts: [
    { account_id: "monzo", name: "Monzo savings pot", provider: "Monzo", balance: 1420, selected: true, manual: false },
    { account_id: "barclays", name: "Rainy day saver", provider: "Barclays", balance: 890, selected: true, manual: false },
    { account_id: "isa", name: "Cash ISA", provider: "Nationwide", balance: 670, selected: false, manual: false },
    { account_id: "cash", name: "Emergency cash", provider: "Offline", balance: 120, selected: false, manual: true },
  ],
};
const EMPTY_FILTER: FilterDraft = { categories: [], merchant: "", from: null, to: null, txnType: null };
const CATEGORIES = ["Groceries", "Bills", "Eating out", "Travel", "Shopping", "Transport", "Health", "Subscriptions", "Other"];
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

function fixtureGoal(state: string): SavingsInsights {
  if (state === "empty") return { ...BASE_GOAL, accounts: [], current_savings: 0, pct_funded: 0, months_funded: 0 };
  if (state !== "long") return BASE_GOAL;
  return { ...BASE_GOAL, accounts: [...BASE_GOAL.accounts, ...Array.from({ length: 12 }, (_, index) => ({
    account_id: `fixture-reserve-${index}`, name: `Household reserve account ${index + 1}`,
    provider: "Example bank", balance: (index + 1) * 125, selected: false, manual: false,
  }))] };
}

function GoalPreview({ variant, data, onChange, onClose, onResult, failFirstSave }: {
  variant: SheetFrameVariant; data: SavingsInsights; onChange: (data: SavingsInsights) => void;
  onClose: () => void; onResult: (text: string) => void; failFirstSave: boolean;
}) {
  const sequence = useRef(0);
  const hasFailed = useRef(false);
  const [error, setError] = useState("");
  const update = (next: SavingsInsights) => { setError(""); onChange(next); return next; };
  const operations: SavingsGoalOperations = {
    saveSavingsGoal: async input => {
      setError("");
      await new Promise(resolve => setTimeout(resolve, 450));
      if (failFirstSave && !hasFailed.current) {
        hasFailed.current = true;
        throw new Error("Deliberate fixture failure");
      }
      const accounts = data.accounts.map(account => ({ ...account, selected: input.account_ids.includes(account.account_id) }));
      const target = input.target_type === "amount" ? input.target_amount ?? 0 : (input.target_months ?? 3) * data.monthly_spending;
      const savings = accounts.filter(account => account.selected).reduce((sum, account) => sum + account.balance, 0);
      onResult(`Example target saved: ${input.target_type === "amount" ? fmt(target, "£") : `${input.target_months} months`}, using ${input.account_ids.length} accounts.`);
      return update({ ...data, configured: true, target_type: input.target_type,
        target_months: input.target_months ?? null, target_amount: target, accounts,
        current_savings: savings, pct_funded: target ? savings / target * 100 : 0,
        months_funded: savings / data.monthly_spending });
    },
    addSavingsManualAccount: async input => update({ ...data, accounts: [...data.accounts, {
      account_id: `fixture-manual-${Date.now()}-${++sequence.current}`, name: input.name,
      provider: "Offline", balance: input.balance, selected: false, manual: true,
    }] }),
    updateSavingsManualAccount: async (id, input) => update({ ...data,
      accounts: data.accounts.map(account => account.account_id === id ? { ...account, ...input } : account) }),
    deleteSavingsManualAccount: async id => update({ ...data, accounts: data.accounts.filter(account => account.account_id !== id) }),
  };
  const editor = useSavingsGoalEditor({ data, sym: "£", hideValues: false, operations, onSaved: () => {}, onError: setError, appearance: "sheet" });
  return <SheetFrame variant={variant} title="Safety net goal" onClose={onClose}
    footer={({ close }) => editor.footer(close, true)}>
    {error && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{error}</p>}
    {editor.body}
  </SheetFrame>;
}

function FilterPreview({ variant, initial, onApply, onClear, onClose, empty }: {
  variant: SheetFrameVariant; initial: FilterDraft; onApply: (draft: FilterDraft) => void;
  onClear: () => void; onClose: () => void; empty: boolean;
}) {
  const [resetKey, setResetKey] = useState(0);
  const [draft, setDraft] = useState(initial);
  return <SheetFrame variant={variant} title="Filter payments" description="Applies to every group in the list." onClose={onClose}
    footer={<div className="flex gap-3">
      <button type="button" className={`${button} text-slate-600 dark:text-slate-300`} onClick={() => {
        setDraft(EMPTY_FILTER); setResetKey(value => value + 1); onClear();
      }}>Clear all</button>
      <button type="submit" form="g192-filter" className={`${button} flex-1 bg-indigo-600 text-white`}>Show results</button>
    </div>}>
    {({ close }) => <TransactionFilterSheetContent key={resetKey} formId="g192-filter" initial={draft}
      categories={empty ? [] : CATEGORIES} includeIntroduction={false} showActions={false}
      onApply={value => { onApply(value); close(); }} onClearAll={onClear} />}
  </SheetFrame>;
}

export default function SheetAnatomyClient() {
  const search = useSearchParams();
  const variant = search.get("variant") === "b" ? "b" : "a";
  const frameVariant = variant === "b" ? "focused" : "compact";
  const state = search.get("state") ?? "goal";
  const mode = search.get("mode") === "dark" ? "dark" : "light";
  const [sheet, setSheet] = useState<"goal" | "filter" | null>(null);
  const [goal, setGoal] = useState(() => fixtureGoal(state));
  const [filters, setFilters] = useState<FilterDraft>(EMPTY_FILTER);
  const [result, setResult] = useState("No example changes applied yet.");
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const scheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    return () => { document.documentElement.classList.toggle("dark", wasDark); document.documentElement.style.colorScheme = scheme; };
  }, [mode]);
  const href = (v = variant, s = state, m = mode) => `?variant=${v}&state=${s}&mode=${m}`;
  return <main className="min-h-dvh bg-[#f0f2f7] px-4 pb-36 pt-6 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100 sm:px-6">
    <div className="mx-auto max-w-xl">
      <a href="/design" className={`${button} -ml-3 text-indigo-700 dark:text-indigo-300`}><ArrowLeft size={16} aria-hidden="true" />Design previews</a>
      <h1 className="mt-3 text-xl font-bold">A consistent sheet</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">The title, close control and actions stay in place. Only the content scrolls, with the navigation safely behind the sheet.</p>
      <nav aria-label="Sheet variants" className="mt-4 flex flex-wrap gap-2">
        {([['a', 'A · Compact'], ['b', 'B · Focused task']] as const).map(([value, label]) => <a key={value}
          href={href(value)} aria-current={variant === value ? "page" : undefined}
          className={`${button} ${variant === value ? "bg-indigo-600 text-white" : "border border-slate-300 dark:border-slate-600"}`}>{label}</a>)}
        <a href={href(variant, state, mode === "dark" ? "light" : "dark")} className={button}>{mode === "dark" ? "Light" : "Dark"} theme</a>
      </nav>
      <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">{variant === "a"
        ? "A fits the content, growing up to most of the screen for longer tasks."
        : "B opens near full height on a phone, keeping the same space as the task grows."} Both use a centred dialog on desktop. Close with the cross, the backdrop, Escape or Back. No swipe gesture is implied.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={() => setSheet("goal")} className={`${button} bg-indigo-600 text-white`}>Open safety net goal</button>
        <button type="button" onClick={() => setSheet("filter")} className={`${button} border border-slate-300 dark:border-slate-600`}>Open payment filters</button>
      </div>
      <nav aria-label="Form examples" className="mt-6 flex flex-wrap gap-2">
        {([['goal', 'Usual content'], ['long', 'Long account list'], ['empty', 'Empty lists'], ['error', 'Save error']] as const).map(([value, label]) => <a key={value}
          href={href(variant, value)} aria-current={state === value ? "page" : undefined}
          className={`${button} ${state === value ? "bg-white dark:bg-slate-800" : "text-slate-600 dark:text-slate-300"}`}>{label}</a>)}
      </nav>
      <p role="status" className="mt-5 text-sm leading-6 text-slate-600 dark:text-slate-300">{result}</p>
      <p className="mt-6 border-t border-slate-300 pt-4 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">The real goal editor and filter fields run on invented local data. Save, add, edit, remove and clear only change this preview. The live sheets keep their current layout until a direction is approved.</p>
    </div>
    <FixtureBottomNav active="Planning" onPennyClick={() => setResult("Penny stays behind the sheet. Its keyboard layout is covered by G191.")} />
    {sheet === "goal" && <GoalPreview variant={frameVariant} data={goal} onChange={setGoal} onClose={() => setSheet(null)}
      onResult={setResult} failFirstSave={state === "error"} />}
    {sheet === "filter" && <FilterPreview variant={frameVariant} initial={filters} empty={state === "empty"} onClose={() => setSheet(null)}
      onApply={draft => { setFilters(draft); setResult(`Example filters applied: ${draft.txnType === "debit" ? "money out" : draft.txnType === "credit" ? "money in" : "all directions"}; ${draft.categories.join(", ") || "all categories"}; ${draft.merchant || "any merchant"}; ${draft.from || "any start date"} to ${draft.to || "today"}.`); }}
      onClear={() => { setFilters(EMPTY_FILTER); setResult("Example filters cleared."); }} />}
  </main>;
}
