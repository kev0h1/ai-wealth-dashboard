"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Moon, ReceiptText, Sun } from "lucide-react";
import type { Account, CashflowData, UpcomingBill } from "@/lib/api";
import { walkUpcomingAccounts } from "@/lib/upcomingAccountWalk";
import type { PaymentDetail, UpcomingDetailServices, UpcomingDetailView } from "@/components/upcoming/UpcomingDetailFlow";
import UpcomingDetailFlow from "@/components/upcoming/UpcomingDetailFlow";
import type { UpcomingEditServices } from "@/components/UpcomingEditForm";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";

// G216 · invented data only. The production UpcomingDetailFlow is mounted with
// fixture payments whose `source` is the same cashflow item the account walk
// reads, so a row in the account sheet opens its payment detail and an edit
// re-walks the account (live figures), exactly as Upcoming does after refresh.
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
const muted = "text-slate-600 dark:text-slate-400";
const PERIOD = "Through Thu 29 Oct";
const END = Date.parse("2026-10-29T23:59:59Z");
const accounts: Account[] = [{ id: "monzo", provider: "Monzo", bank: "Monzo", name: "Everyday account", type: "bank", subtype: "current", currency: "GBP", balance: 480, manual: false, status: "active" } as Account];

type Row = { key: string; name: string; amount: number; date: string; type: "bill" | "income"; dismissed?: boolean };
const START_ROWS: Row[] = [
  { key: "salary", name: "Acme Ltd salary", amount: 200, date: "2026-10-14", type: "income" },
  { key: "ee", name: "EE LIMITED", amount: 38.5, date: "2026-10-09", type: "bill" },
  { key: "nw", name: "NW WORLD MASTERCAR", amount: 112.4, date: "2026-10-16", type: "bill" },
  { key: "gym", name: "Pulse gym", amount: 29, date: "2026-10-21", type: "bill" },
];

function Preview({ mode, initial }: { mode: "light" | "dark"; initial: UpcomingDetailView | null }) {
  const [rows, setRows] = useState(START_ROWS);
  const [flowView, setFlowView] = useState<UpcomingDetailView | null>(initial);
  useEffect(() => { const root = document.documentElement; const wasDark = root.classList.contains("dark"); const prior = root.style.colorScheme; root.classList.toggle("dark", mode === "dark"); root.style.colorScheme = mode; return () => { root.classList.toggle("dark", wasDark); root.style.colorScheme = prior; }; }, [mode]);
  const live = rows.filter((row) => !row.dismissed);
  const items = useMemo(() => live.map((row) => ({ row, item: { name: row.name, amount: row.amount, expected_date: row.date, days_away: 5, account_id: "monzo", account_name: "Everyday account", account_bank: "Monzo", account_balance: 480, kind: "commitment" } as UpcomingBill })), [live]);
  const cashflow = useMemo<Pick<CashflowData, "upcoming_bills" | "upcoming_income" | "internal_inflows">>(() => ({ upcoming_bills: items.filter(({ row }) => row.type === "bill").map(({ item }) => item), upcoming_income: items.filter(({ row }) => row.type === "income").map(({ item }) => item), internal_inflows: [{ name: "Transfer in", amount: 50, expected_date: "2026-10-12", days_away: 7, account_id: "monzo", source_account_name: "Savings" } as never] }), [items]);
  const walk = useMemo(() => walkUpcomingAccounts(cashflow, END), [cashflow]);
  const payments = useMemo<PaymentDetail[]>(() => items.map(({ row, item }) => ({
    id: row.key, source: item,
    model: { rowKey: row.key, identity: row.key, name: row.name, amount: row.amount, expectedDate: row.date, originalDate: row.date, type: row.type, category: row.type === "income" ? "Income" : "Bills", accountLabel: "Monzo", isCreditCard: false, pending: false, daysPastDue: 0, assessment: "unverified", after: { kind: "balance", value: 300 }, categoryColour: "#22d3ee", CategoryIcon: ReceiptText },
    editor: { name: row.name, amount: row.amount, expected_date: row.date, original_date: row.date, type: row.type, edited: false, rule_label: "Monthly" },
    skip: async () => setRows((current) => current.map((r) => r.key === row.key ? { ...r, dismissed: true } : r)),
  })), [items]);
  const refresh = useCallback(async () => {}, []);
  const services = useMemo<UpcomingDetailServices>(() => ({
    upcoming: {
      editUpcoming: async (change) => { setRows((current) => current.map((r) => r.name === change.key ? { ...r, amount: change.new_amount ?? r.amount, date: change.new_date ?? r.date } : r)); return { ok: true }; },
      clearUpcomingOverride: async () => ({ ok: true }),
      skipUpcomingOccurrence: async (name: string) => { setRows((current) => current.map((r) => r.name === name ? { ...r, dismissed: true } : r)); return { ok: true }; },
      previewUpcomingRule: async ({ text }) => ({ ok: Boolean(text.trim()), schedule: { text }, label: "Monthly", next_dates: ["2026-11-09", "2026-12-09"] }),
      applyUpcomingRule: async () => ({ ok: true }), clearUpcomingRule: async () => ({ ok: true }),
    } satisfies UpcomingEditServices,
  }), []);
  const query = (change: { mode?: "light" | "dark" }) => `?mode=${change.mode ?? mode}`;
  return <><div inert={flowView !== null} aria-hidden={flowView ? true : undefined} className="min-h-dvh bg-[#f0f2f7] text-slate-950 dark:bg-slate-950 dark:text-slate-50"><header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="mx-auto flex max-w-xl items-center justify-between gap-4 px-4 py-3"><Link href="/design" className={`flex min-h-11 items-center gap-2 rounded-lg text-sm ${muted} ${focus}`}><ArrowLeft size={16} aria-hidden="true" />Design rounds</Link><Link href={query({ mode: mode === "dark" ? "light" : "dark" })} aria-label={`Use ${mode === "dark" ? "light" : "dark"} theme`} className={`flex size-11 items-center justify-center rounded-xl ${focus}`}>{mode === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</Link></div></header>
    <main className="mx-auto max-w-xl space-y-5 px-4 py-7 pb-28"><div><p className={`text-xs font-semibold ${muted}`}>G216 · Edit a payment from its account</p><h1 className="mt-2 text-2xl font-bold tracking-tight">Fix a payment where you found it.</h1><p className={`mt-3 text-sm leading-6 ${muted}`}>Open the account, tap a payment or income row, change it, then Back. The production flow, invented data only. Transfers in stay read-only.</p></div>
      <UpcomingAccountsCard plansStatus="ready" plans={[]} accounts={walk.accounts} periodLabel={`Payments ${PERIOD.toLowerCase()}`} onOpen={(account) => setFlowView({ kind: "account", id: account.id })} />
      <button type="button" onClick={() => setFlowView({ kind: "account", id: "monzo" })} className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white ${focus}`}>Open Monzo’s account plan<ChevronRight size={16} aria-hidden="true" /></button>
    </main></div>{flowView && <UpcomingDetailFlow initialView={flowView} onClose={() => setFlowView(null)} accounts={accounts} summaries={walk.accounts} periodLabel={PERIOD} periodStart={new Date("2026-10-01T12:00:00Z")} plans={[]} plansStatus="ready" allocations={[]} payments={payments} onRefresh={refresh} onDismiss={(payment) => setRows((current) => current.map((r) => r.key === payment.id ? { ...r, dismissed: true } : r))} onDeletePlanned={() => {}} services={services} />}</>;
}

export default function PreviewClient() { const params = useSearchParams(); const mode = params.get("mode") === "dark" ? "dark" : "light"; const initial = params.get("view") === "account" ? { kind: "account", id: "monzo" } as const : null; return <Preview key={`${mode}-${params.get("view")}`} mode={mode} initial={initial} />; }
