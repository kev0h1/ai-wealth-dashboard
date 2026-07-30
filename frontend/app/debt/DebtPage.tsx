"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { TrendingDown, Trash2, SlidersHorizontal, ChevronDown, ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, DebtPlan } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { usePreferences } from "@/components/PreferencesContext";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import TransactionRow from "@/components/TransactionRow";
import { useAllTransactions } from "@/lib/useAllTransactions";
import { filterPeriod, getPayPeriodWithConfig } from "@/lib/payPeriod";
import MoneyAdvisorChat, { MoneyAdvisorChatHandle } from "@/components/MoneyAdvisorChat";
import DebtPlanCard from "@/components/DebtPlanCard";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  Tooltip, ReferenceLine, ReferenceDot,
} from "recharts";

export interface CCAccount {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  apr: number | null;
  monthly_interest: number;
}

export interface DebtInsights {
  total_debt: number;
  accounts: CCAccount[];
  monthly_income: number;
  monthly_spending: number;
  monthly_surplus: number;
  monthly_debt_payment: number;
  payment_needed_12mo: number;
  gap_to_12mo: number;
  months_at_current_rate: number;
  weighted_apr: number;
  category_spending: Record<string, number>;
  recommendations: { category: string; monthly_spend: number; cut_25pct_saves: number; cut_50pct_saves: number }[];
  recent_discretionary: { id: string; description: string; amount: number; date: string; category: string }[];
}

export function fmt(n: number, sym = "£") {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function fmt2(n: number, sym = "£") {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


export function debtFreeDate(months: number): string {
  if (!isFinite(months) || months > 600) return "a very long time";
  const d = new Date();
  d.setMonth(d.getMonth() + Math.ceil(months));
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}



export function DebtGrowingCard({ insights, hideNetWorth, sym, targetMonths }: { insights: DebtInsights; hideNetWorth: boolean; sym: string; targetMonths: number }) {
  const deficit = Math.abs(insights.monthly_surplus);
  const paymentNeeded = insights.total_debt > 0 ? insights.total_debt / targetMonths : 0;
  const maxBar = Math.max(insights.monthly_income, insights.monthly_spending);

  return (
    <div className="glass-card rounded-2xl p-4 space-y-4">
      <div className="rounded-2xl p-4 text-white" style={{ background: "#b91c1c", boxShadow: "0 2px 12px rgba(185,28,28,0.35)" }}>
        <p className="text-base font-bold leading-tight mb-1">⚠️ Debt is Growing</p>
        <p className="text-sm opacity-85">
          Spending exceeds income by{" "}
          <span className="font-semibold">{hideNetWorth ? "••••" : fmt2(deficit, sym)}/month</span>
          {" "}— your balance will keep rising.
        </p>
      </div>
      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>Monthly income</span>
            <span className="font-semibold text-sky-600">{hideNetWorth ? "••••" : fmt(insights.monthly_income, sym)}</span>
          </div>
          <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round((insights.monthly_income / maxBar) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Monthly income vs spending">
            <div className="h-full bg-sky-400 rounded-full bar-sweep" style={{ width: `${(insights.monthly_income / maxBar) * 100}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>Monthly spending</span>
            <span className="font-semibold text-orange-500">{hideNetWorth ? "••••" : fmt(insights.monthly_spending, sym)}</span>
          </div>
          <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round((insights.monthly_spending / maxBar) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Monthly spending vs income">
            <div className="h-full bg-orange-400 rounded-full bar-sweep" style={{ width: `${(insights.monthly_spending / maxBar) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1.5">Stop debt growing</p>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Cut spending <span className="font-semibold text-amber-700 dark:text-amber-400">{hideNetWorth ? "••••" : fmt2(deficit, sym)}/mo</span>
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">or earn that much more</p>
        </div>
        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-400 mb-1.5">Debt-free in {targetMonths}mo</p>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Need <span className="font-semibold text-indigo-700 dark:text-indigo-400">{hideNetWorth ? "••••" : fmt2(deficit + paymentNeeded, sym)}/mo</span> extra
          </p>
        </div>
      </div>
    </div>
  );
}

export type BurndownData = {
  burndown: { month: string; actual: number | null; target: number | null; projected: number | null }[];
  current_debt: number;
  target_months: number;
  target_date: string;
  monthly_payment_needed: number;
  currency: string;
  total_interest_target: number;
  total_interest_projected: number;
  weighted_apr: number;
  strategy: string;
  has_rates: boolean;
};

export default function DebtPage() {
  const { user } = useAuth();
  const { hideNetWorth, region, debtTargetMonths, setDebtTargetMonths, debtTrackingStart, setDebtTrackingStart, payPeriodConfig } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";
  const [insights, setInsights] = useState<DebtInsights | null>(null);
  const [burndown, setBurndown] = useState<BurndownData | null>(null);
  const [strategy, setStrategy] = useState<"avalanche" | "snowball" | "costliest">("avalanche");
  const [burndownMode, setBurndownMode] = useState<"time" | "amount">("time");
  const [monthlyPaymentInput, setMonthlyPaymentInput] = useState<number>(0);
  const [progressOpen, setProgressOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<DebtPlan | null>(null);

  const chatRef = useRef<MoneyAdvisorChatHandle>(null);
  const router = useRouter();
  const goBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/spend");
  }, [router]);
  const burndownMounted = useRef(false);
  const burndownRef = useRef<BurndownData | null>(null);

  const { transactions: allTransactions } = useAllTransactions();
  const debtPayments = useMemo(() => {
    const [s, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    return filterPeriod(allTransactions, s, e)
      .filter(tx => tx.category === "Debt" && tx.transaction_type === "debit")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [allTransactions, payPeriodConfig]);
  const [debtPaymentsOpen, setDebtPaymentsOpen] = useState(false);

  const firstName = user?.name?.split(" ")[0] || "there";

  const refreshPlan = useCallback(() => {
    api.getDebtPlan().then(({ plan }) => setPlan(plan)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const [data, bdata] = await Promise.all([
        api.debtInsights(), api.debtBurndown(debtTargetMonths, strategy),
      ]);
      setInsights(data);
      setBurndown(bdata);
      if (!monthlyPaymentInput) setMonthlyPaymentInput(Math.ceil(bdata.monthly_payment_needed));
      api.getDebtPlan().then(({ plan }) => setPlan(plan)).catch(() => {});
    } catch {
      // leave as null
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => { burndownRef.current = burndown; }, [burndown]);

  // Derived: effective months based on mode
  const effectiveTargetMonths = burndownMode === "amount" && burndown && monthlyPaymentInput > 0
    ? calcMonthsFromPayment(burndown.current_debt, monthlyPaymentInput, burndown.weighted_apr)
    : debtTargetMonths;

  // Reload burndown when anything changes — skip initial mount
  useEffect(() => {
    if (!burndownMounted.current) { burndownMounted.current = true; return; }
    const months = burndownMode === "amount" && burndown && monthlyPaymentInput > 0
      ? calcMonthsFromPayment(burndown.current_debt, monthlyPaymentInput, burndown.weighted_apr)
      : debtTargetMonths;
    api.debtBurndown(months, strategy, debtTrackingStart).then(setBurndown).catch(() => {});
  }, [debtTargetMonths, burndownMode, monthlyPaymentInput, strategy, debtTrackingStart]); // eslint-disable-line react-hooks/exhaustive-deps

  async function togglePlanStep(id: string, done: boolean) {
    try {
      const { plan } = await api.toggleDebtPlanStep(id, done);
      setPlan(plan);
    } catch {}
  }

  async function deletePlanStep(id: string) {
    try {
      const { plan } = await api.deleteDebtPlanStep(id);
      setPlan(plan);
    } catch {}
  }

  async function deletePlan() {
    try {
      await api.deleteDebtPlan();
      setPlan(null);
    } catch {}
  }

  const hasDebt = (insights?.total_debt ?? 0) > 0;
  const onTrack = insights ? insights.months_at_current_rate <= effectiveTargetMonths : false;
  const paymentNeededForTarget = burndownMode === "amount" && monthlyPaymentInput > 0
    ? monthlyPaymentInput
    : (insights && insights.total_debt > 0 ? insights.total_debt / effectiveTargetMonths : 0);

  return (
    <div className="min-h-dvh pb-24 lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Header */}
      <div className="mx-4 mt-4 rounded-3xl px-4 pt-5 pb-5 glass-hero" data-tutorial-id="tutorial-debt-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={goBack}
              aria-label="Back"
              className="w-9 h-9 -ml-2 flex items-center justify-center rounded-full text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600 transition-colors flex-shrink-0"
            >
              <ChevronLeft size={22} strokeWidth={2.5} />
            </button>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Debt Tracker</h1>
          </div>
          <TrendingDown className="w-7 h-7 text-indigo-500 flex-shrink-0" />
        </div>
        {loading ? (
          <div className="mt-4 h-12 w-40 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />
        ) : insights ? (
          <div className="mt-3">
            {hasDebt ? (
              <>
                <p className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {hideNetWorth ? "••••" : fmt(insights.total_debt, sym)}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                  <span>debt-free {debtFreeDate(insights.months_at_current_rate)} at this rate</span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  {onTrack ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">On track</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      {hideNetWorth ? "••••" : `${fmt(Math.max(0, paymentNeededForTarget - (insights.monthly_surplus ?? 0)), sym)}/mo behind`}
                    </span>
                  )}
                </p>
                {paymentNeededForTarget > 0 && (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {hideNetWorth ? "Pay ••••/mo" : `Pay ${fmt2(paymentNeededForTarget, sym)}/mo`} to clear in {effectiveTargetMonths} months
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Monthly {insights.monthly_surplus >= 0 ? "Surplus" : "Deficit"}</p>
                <p className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{hideNetWorth ? "••••" : fmt(Math.abs(insights.monthly_surplus), sym)}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {insights.monthly_surplus >= 0 ? "No credit card debt" : "Spending exceeds income"}
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="px-4 pt-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>
        ) : !insights ? (
          <div className="glass-card rounded-2xl p-8 text-center">
            <p className="text-slate-400 dark:text-slate-500 text-sm">Could not load debt data</p>
          </div>
        ) : (
          <>
            {/* Payoff progress disclosure */}
            {hasDebt && burndown && burndown.burndown.length > 0 && (
              <div className="glass-card rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setProgressOpen(v => !v)}
                  className="w-full px-4 py-3 flex items-center justify-between text-left"
                >
                  <span className="text-base font-bold text-slate-700 dark:text-slate-200">Payoff progress</span>
                  <ChevronDown size={16} className={`text-slate-500 dark:text-slate-400 transition-transform duration-200 ${progressOpen ? "rotate-180" : ""}`} />
                </button>
                {progressOpen && (
                  <div className="border-t border-slate-50 dark:border-slate-700">
                    <DebtBurndownCard
                      data={burndown}
                      mode={burndownMode}
                      onModeChange={setBurndownMode}
                      targetMonths={debtTargetMonths}
                      onTargetChange={setDebtTargetMonths}
                      monthlyPayment={monthlyPaymentInput}
                      onMonthlyPaymentChange={setMonthlyPaymentInput}
                      effectiveTargetMonths={effectiveTargetMonths}
                      trackingStart={debtTrackingStart}
                      onTrackingStartChange={setDebtTrackingStart}
                      strategy={strategy}
                      onStrategyChange={setStrategy}
                      hideValues={hideNetWorth}
                      sym={sym}
                      collapsibleSettings={true}
                      monthlySurplus={insights?.monthly_surplus}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Debt plan card — always shown when there's debt */}
            {hasDebt && (
              <DebtPlanCard
                plan={plan}
                sym={sym}
                accent="#4f46e5"
                hideValues={hideNetWorth}
                onToggleStep={togglePlanStep}
                onDeleteStep={deletePlanStep}
                onDelete={deletePlan}
                onOpenChat={(p) => chatRef.current?.open(p)}
              />
            )}

            {/* Story card */}
            {!hasDebt ? (
              <div className="glass-card rounded-2xl p-4 space-y-4">
                {insights.monthly_surplus >= 0 ? (
                  <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-3 py-2.5">
                    <span className="text-lg">✅</span>
                    <div>
                      <p className="text-base font-bold text-emerald-700 dark:text-emerald-400">Finances look healthy</p>
                      <p className="text-sm text-emerald-600 dark:text-emerald-500">No credit card debt and a positive monthly surplus</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2.5">
                    <span className="text-lg">⚠️</span>
                    <div>
                      <p className="text-base font-bold text-amber-700 dark:text-amber-400">Spending exceeds income</p>
                      <p className="text-sm text-amber-600 dark:text-amber-500">
                        You spend {hideNetWorth ? "••••" : fmt2(Math.abs(insights.monthly_surplus), sym)} more than you earn each month
                      </p>
                    </div>
                  </div>
                )}
                {insights.monthly_surplus >= 0 && (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Monthly surplus: <span className="font-semibold text-emerald-600">{hideNetWorth ? "••••" : fmt2(insights.monthly_surplus, sym)}</span>
                  </p>
                )}
              </div>
            ) : insights.monthly_surplus < 0 ? (
              <DebtGrowingCard insights={insights} hideNetWorth={hideNetWorth} sym={sym} targetMonths={effectiveTargetMonths} />
            ) : null}

            {/* Cards breakdown */}
            {hasDebt && insights.accounts.length > 0 && (
              <CreditCardsCard
                accounts={insights.accounts}
                totalDebt={insights.total_debt}
                hideNetWorth={hideNetWorth}
                sym={sym}
                strategy={strategy}
                collapsible={true}
                onRateChange={() => {
                  api.debtInsights().then(setInsights).catch(() => {});
                  const bdn = burndownRef.current;
                  const months = burndownMode === "amount" && bdn && monthlyPaymentInput > 0
                    ? calcMonthsFromPayment(bdn.current_debt, monthlyPaymentInput, bdn.weighted_apr)
                    : debtTargetMonths;
                  api.debtBurndown(months, strategy, debtTrackingStart).then(setBurndown).catch(() => {});
                }}
              />
            )}

            {/* Debt payments this period */}
            {debtPayments.length > 0 && (
              <div className="glass-card rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDebtPaymentsOpen(v => !v)}
                  className="w-full px-4 py-3 flex items-center justify-between text-left"
                >
                  <span className="text-base font-bold text-slate-700 dark:text-slate-200">Debt payments this period</span>
                  <ChevronDown size={16} className={`text-slate-500 dark:text-slate-400 transition-transform duration-200 ${debtPaymentsOpen ? "rotate-180" : ""}`} />
                </button>
                {debtPaymentsOpen && (
                  <div className="border-t border-slate-50 dark:border-slate-700 divide-y divide-slate-50 dark:divide-slate-700">
                    {debtPayments.map(tx => (
                      <TransactionRow key={tx.id} transaction={tx} />
                    ))}
                  </div>
                )}
              </div>
            )}

          </>
        )}
      </div>

      <MoneyAdvisorChat
        ref={chatRef}
        insights={insights}
        sym={sym}
        firstName={firstName}
        onPlanSaved={refreshPlan}
        page="debt"
      />

      <BottomNav />
    </div>
  );
}

// ── Credit Cards Card (with APR editing) ─────────────────────────────────────

function AprInput({ accountId, initialApr, onSaved }: { accountId: string; initialApr: number | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialApr !== null ? String(initialApr) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const apr = value.trim() === "" ? null : parseFloat(value);
    if (apr !== null && (isNaN(apr) || apr < 0 || apr > 100)) { setSaving(false); return; }
    await api.setAccountRate(accountId, apr).catch(() => {});
    setSaving(false);
    setEditing(false);
    onSaved();
  }

  async function remove() {
    setSaving(true);
    await api.setAccountRate(accountId, null).catch(() => {});
    setValue("");
    setSaving(false);
    setEditing(false);
    onSaved();
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs font-semibold">
          {initialApr !== null ? (
            <span className="text-amber-600 dark:text-amber-400">{initialApr}% APR</span>
          ) : (
            <span className="text-slate-400 dark:text-slate-500 underline decoration-dashed">Add APR</span>
          )}
        </button>
        {initialApr !== null && (
          <button onClick={remove} disabled={saving} aria-label="Remove APR" className="text-slate-300 dark:text-slate-600 hover:text-red-400 dark:hover:text-red-400 transition-colors">
            <Trash2 size={11} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type="number"
        min="0"
        max="100"
        step="0.01"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        className="w-20 text-xs px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-amber-400"
        placeholder="e.g. 21.9"
      />
      <span className="text-xs text-slate-400">%</span>
      <button onClick={save} disabled={saving} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70">
        {saving ? "…" : "Save"}
      </button>
      <button onClick={() => setEditing(false)} className="text-xs text-slate-400">✕</button>
    </div>
  );
}

export function CreditCardsCard({ accounts, totalDebt, hideNetWorth, sym, onRateChange, collapsible = false, strategy }: {
  accounts: CCAccount[];
  totalDebt: number;
  hideNetWorth: boolean;
  sym: string;
  onRateChange: () => void;
  collapsible?: boolean;
  /** When set, cards are listed in payoff order for that strategy */
  strategy?: "avalanche" | "snowball" | "costliest";
}) {
  const [open, setOpen] = useState(!collapsible);
  const totalMonthlyInterest = accounts.reduce((s, a) => s + (a.monthly_interest ?? 0), 0);

  const ordered = strategy
    ? [...accounts].sort((a, b) => {
        if (strategy === "snowball") return Math.abs(a.balance) - Math.abs(b.balance);
        if (strategy === "costliest") return (b.monthly_interest ?? 0) - (a.monthly_interest ?? 0);
        return (b.apr ?? 0) - (a.apr ?? 0); // avalanche
      })
    : accounts;

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => collapsible && setOpen(v => !v)}
        className={`w-full px-4 pt-3 pb-2 flex items-center justify-between ${collapsible ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Credit Cards</span>
          {collapsible && (
            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
              {accounts.length} card{accounts.length !== 1 ? "s" : ""}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {totalMonthlyInterest > 0 && (
            <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              ~{sym}{totalMonthlyInterest.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo interest
            </span>
          )}
          {collapsible && (
            <ChevronDown size={14} className={`text-slate-500 dark:text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          )}
        </span>
      </button>
      {open && strategy && ordered.length > 1 && (
        <p className="px-4 pb-1 text-[10px] text-slate-400 dark:text-slate-500">
          Listed in payoff order for {strategy === "avalanche" ? "Avalanche" : strategy === "snowball" ? "Snowball" : "Costliest"}
        </p>
      )}
      {open && ordered.map((acc, idx) => {
        const owed = Math.abs(acc.balance);
        const pct = totalDebt > 0 ? (owed / totalDebt) * 100 : 0;
        return (
          <div key={acc.account_id} className="px-4 py-3 border-t border-slate-50 dark:border-slate-700">
            <div className="flex items-center justify-between mb-1">
              <div className="min-w-0 flex-1 flex items-center gap-2">
                {strategy && ordered.length > 1 && (
                  <span className="min-w-[18px] h-[18px] rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {idx + 1}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{acc.name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{acc.provider}</p>
                </div>
              </div>
              <div className="flex flex-col items-end ml-3 gap-0.5">
                <p className="text-sm font-bold text-rose-500">{hideNetWorth ? "••••" : fmt2(owed, sym)}</p>
                <AprInput accountId={acc.account_id} initialApr={acc.apr} onSaved={onRateChange} />
              </div>
            </div>
            <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${acc.name ?? "Debt"}: ${Math.round(pct)}% of total debt`}>
              <div className="h-full bg-rose-400 rounded-full bar-sweep" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[10px] text-slate-400">{Math.round(pct)}% of total</span>
              {acc.monthly_interest > 0 && (
                <span className="text-[10px] text-amber-500 font-medium">
                  {hideNetWorth ? "••" : `+${sym}${acc.monthly_interest.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo interest`}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Debt Burndown Chart ───────────────────────────────────────────────────────

function TargetMonthsSlider({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  // Local until explicitly applied — a stray tap on the track must never
  // silently change the plan target
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  const dirty = local !== value;

  const target = new Date();
  target.setMonth(target.getMonth() + local);
  const dateLabel = target.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
          {local < 12 ? `${local} months` : `${Math.floor(local / 12)}y ${local % 12 ? `${local % 12}m` : ""}`.trim()}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">debt-free {dateLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setLocal(v => Math.max(3, v - 1))}
          className="w-8 h-8 flex-shrink-0 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-base font-bold active:scale-95 transition-transform"
          aria-label="One month sooner"
        >−</button>
        <input
          type="range"
          min={3}
          max={60}
          step={1}
          value={local}
          onChange={e => setLocal(Number(e.target.value))}
          className="w-full accent-indigo-600"
          style={{ touchAction: "pan-y" }}
        />
        <button
          onClick={() => setLocal(v => Math.min(60, v + 1))}
          className="w-8 h-8 flex-shrink-0 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-base font-bold active:scale-95 transition-transform"
          aria-label="One month later"
        >+</button>
      </div>
      {dirty && (
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => setLocal(value)}
            className="flex-1 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
          >
            Cancel
          </button>
          <button
            onClick={() => onCommit(local)}
            className="flex-1 py-1.5 rounded-xl text-xs font-semibold text-white bg-indigo-600 active:scale-[0.98] transition-transform"
          >
            Set target
          </button>
        </div>
      )}
    </div>
  );
}

export function calcMonthsFromPayment(debt: number, payment: number, weightedAprPct: number): number {
  if (!payment || payment <= 0 || debt <= 0) return 120;
  const r = weightedAprPct / 12 / 100;
  if (r > 0 && payment > r * debt) {
    const n = -Math.log(1 - (r * debt) / payment) / Math.log(1 + r);
    return Math.min(120, Math.ceil(n));
  }
  return Math.min(120, Math.ceil(debt / payment));
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function DebtBurndownCard({
  data, mode, onModeChange, targetMonths, onTargetChange, monthlyPayment, onMonthlyPaymentChange,
  effectiveTargetMonths, trackingStart, onTrackingStartChange, strategy, onStrategyChange, hideValues, sym,
  collapsibleSettings = false, settingsExtra, monthlySurplus,
}: {
  data: BurndownData;
  mode: "time" | "amount";
  onModeChange: (m: "time" | "amount") => void;
  targetMonths: number;
  onTargetChange: (n: number) => void;
  monthlyPayment: number;
  onMonthlyPaymentChange: (n: number) => void;
  effectiveTargetMonths: number;
  trackingStart: string;
  onTrackingStartChange: (s: string) => void;
  strategy: "avalanche" | "snowball" | "costliest";
  onStrategyChange: (s: "avalanche" | "snowball" | "costliest") => void;
  hideValues: boolean;
  sym: string;
  collapsibleSettings?: boolean;
  settingsExtra?: React.ReactNode;
  monthlySurplus?: number;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isDark = useIsDark();
  const tickFill = isDark ? "#94a3b8" : "#64748b";
  const today = new Date().toISOString().slice(0, 7);
  const todayIdx = data.burndown.findIndex(p => p.month === today);

  const chartData = data.burndown.map(p => ({
    month: fmtMonth(p.month),
    actual:    p.actual    !== null ? p.actual    : undefined,
    target:    p.target    !== null ? p.target    : undefined,
    projected: p.projected !== null ? p.projected : undefined,
  }));

  const yFmt = (v: number) =>
    hideValues ? "••" : (v >= 1000 ? `${sym}${(v / 1000).toFixed(0)}k` : `${sym}${v}`);

  const todayActual = todayIdx >= 0 ? chartData[todayIdx]?.actual : undefined;
  const todayTarget = todayIdx >= 0 ? chartData[todayIdx]?.target : undefined;
  const firstActualIdx = chartData.findIndex(d => d.actual !== undefined);
  const startActual = firstActualIdx >= 0 ? chartData[firstActualIdx]?.actual : undefined;
  const startTarget = firstActualIdx >= 0 ? chartData[firstActualIdx]?.target : undefined;
  const actualPaydown  = startActual !== undefined && todayActual !== undefined ? startActual - todayActual : null;
  const requiredPaydown = startTarget !== undefined && todayTarget !== undefined ? startTarget - todayTarget : null;
  const isOnTrack = actualPaydown !== null && requiredPaydown !== null && actualPaydown >= requiredPaydown;
  const annotationGap = actualPaydown !== null && requiredPaydown !== null
    ? Math.abs(actualPaydown - requiredPaydown) : null;

  return (
    <div className="debt-burndown-frosted rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700/60">
      {/* Card header */}
      <div className="px-4 pt-4 pb-2">
        <p className="text-base font-bold text-slate-800 dark:text-slate-100">Payoff progress</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          Your goal · <span className="font-medium text-slate-600 dark:text-slate-300">{fmtMonth(data.target_date)}</span>
          {" · "}
          <span className="text-indigo-500 font-medium">{hideValues ? "••••" : `${sym}${data.monthly_payment_needed.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo`}</span>
        </p>
        {monthlySurplus !== undefined && monthlySurplus > 0 && data.monthly_payment_needed > monthlySurplus && !hideValues && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 leading-snug">
            This needs {sym}{Math.round(data.monthly_payment_needed - monthlySurplus).toLocaleString("en-GB")}/mo more than
            your current {sym}{Math.round(monthlySurplus).toLocaleString("en-GB")} surplus — fund it with spending cuts, or pick a later date.
          </p>
        )}
      </div>

      {/* Legend row */}
      <div className="px-4 pb-2 flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-[2px] bg-indigo-500 rounded inline-block" />
          <span className="text-[10px] text-slate-500 dark:text-slate-400">What you&apos;ve paid</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 inline-block" style={{ borderTop: "2px dashed #14b8a6", display: "inline-block" }} />
          <span className="text-[10px] text-teal-600 dark:text-teal-400">Your goal pace</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 inline-block" style={{ borderTop: "2px dotted #f59e0b", display: "inline-block" }} />
          <span className="text-[10px] text-amber-500 dark:text-amber-400">At this rate</span>
        </span>
      </div>

      {/* Interest summary — only when rates are set */}
      {data.has_rates && (
        <div className="mx-4 mb-3 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2">
          <div className="flex-1">
            <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Interest cost</p>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              {hideValues ? "••••" : `${sym}${data.total_interest_target.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}{" "}
              <span className="text-amber-600 dark:text-amber-400">on target · </span>
              {hideValues ? "••••" : `${sym}${data.total_interest_projected.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}{" "}
              <span className="text-amber-600 dark:text-amber-400">projected</span>
            </p>
          </div>
          <span className="text-xs font-bold text-amber-700 dark:text-amber-400">{data.weighted_apr.toFixed(1)}% avg APR</span>
        </div>
      )}

      {/* Chart + annotation */}
      <div className="relative px-1 pb-2">

        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 36, right: 8, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: tickFill, fontWeight: 300 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={yFmt}
                tick={{ fontSize: 10, fill: tickFill, fontWeight: 300 }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                content={(props: any) => {
                  const { active, payload, label } = props;
                  if (!active || !payload?.length) return null;
                  const actual    = payload.find((p: any) => p.dataKey === "actual")?.value;
                  const target    = payload.find((p: any) => p.dataKey === "target")?.value;
                  const projected = payload.find((p: any) => p.dataKey === "projected")?.value;
                  const fmtVal = (v: number | undefined) =>
                    v === undefined ? null : hideValues ? "••••" : `${sym}${Math.round(v).toLocaleString("en-GB")}`;
                  return (
                    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl shadow-lg px-3 py-2 text-xs space-y-0.5">
                      <p className="font-semibold text-slate-700 dark:text-slate-200 mb-1">{label}</p>
                      {actual    !== undefined && <p className="text-indigo-600">Actual: {fmtVal(actual)}</p>}
                      {target    !== undefined && <p className="text-teal-600">Target: {fmtVal(target)}</p>}
                      {projected !== undefined && <p className="text-amber-500">Projected: {fmtVal(projected)}</p>}
                    </div>
                  );
                }}
              />
              {/* Today reference line */}
              {todayIdx >= 0 && (
                <ReferenceLine
                  x={chartData[todayIdx]?.month}
                  stroke={tickFill}
                  strokeDasharray="4 4"
                  label={{ value: "Today", position: "insideBottomRight", fontSize: 9, fill: tickFill }}
                />
              )}
              <defs>
                <linearGradient id="burndownActualGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.16} />
                  <stop offset="60%" stopColor="#6366f1" stopOpacity={0.06} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              {/* Actual — gradient area with natural smooth curve */}
              <Area
                type="natural"
                dataKey="actual"
                name="Actual"
                stroke="#6366f1"
                strokeWidth={2.5}
                fill="url(#burndownActualGradient)"
                dot={false}
                connectNulls={false}
              />
              {/* Target — dashed teal line */}
              <Line
                type="natural"
                dataKey="target"
                name="Target"
                stroke="#14b8a6"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                connectNulls={false}
              />
              {/* Projected — dotted amber line */}
              <Line
                type="natural"
                dataKey="projected"
                name="Projected"
                stroke="#f59e0b"
                strokeWidth={1.5}
                strokeDasharray="2 4"
                dot={false}
                connectNulls={false}
              />
              {/* Today dot on actual */}
              {todayIdx >= 0 && todayActual !== undefined && (
                <ReferenceDot
                  x={chartData[todayIdx]?.month}
                  y={todayActual}
                  r={4}
                  fill="#6366f1"
                  stroke="#fff"
                  strokeWidth={2}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* When the plan has drifted well off target, shaming isn't a strategy —
            offer a one-tap restart from today's balance */}
        {!isOnTrack && annotationGap !== null && annotationGap > 500 && (
          <button
            onClick={() => onTrackingStartChange(new Date().toISOString().slice(0, 7))}
            className="mx-3 mb-2 mt-1 w-[calc(100%-24px)] py-2 rounded-xl text-xs font-semibold bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 active:scale-[0.98] transition-transform"
          >
            Reset the plan to today&apos;s balance
          </button>
        )}
      </div>

      {collapsibleSettings && (
        <button
          onClick={() => setSettingsOpen(v => !v)}
          className="w-full px-4 py-2.5 flex items-center justify-between border-t border-slate-50 dark:border-slate-700 text-left"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <SlidersHorizontal size={13} /> Adjust plan
          </span>
          <ChevronDown size={14} className={`text-slate-500 dark:text-slate-400 transition-transform duration-200 ${settingsOpen ? "rotate-180" : ""}`} />
        </button>
      )}

      {/* Settings */}
      <div className={`px-4 pb-4 pt-2 border-t border-slate-50 dark:border-slate-700 space-y-4 ${collapsibleSettings ? (settingsOpen ? "border-t-0 pt-0" : "hidden") : ""}`}>

        {/* Tracking start */}
        <div>
          <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">Tracking start</p>
          <div className="flex items-center gap-2">
            <input
              type="month" value={trackingStart} max={today}
              onChange={e => { if (e.target.value) onTrackingStartChange(e.target.value); }}
              className="text-xs bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-400"
            />
            {trackingStart !== today && (
              <button onClick={() => onTrackingStartChange(today)} className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 underline">
                Reset to today
              </button>
            )}
          </div>
        </div>

        {/* Goal type toggle */}
        <div>
          <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">Goal type</p>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => onModeChange("time")}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all text-left px-3 ${mode === "time" ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}
            >
              <span className="block font-bold">By date</span>
              <span className="text-[10px] opacity-70">Choose a timeline</span>
            </button>
            <button
              onClick={() => onModeChange("amount")}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all text-left px-3 ${mode === "amount" ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}
            >
              <span className="block font-bold">By amount</span>
              <span className="text-[10px] opacity-70">Set a monthly payment</span>
            </button>
          </div>

          {mode === "time" ? (
            <TargetMonthsSlider value={targetMonths} onCommit={onTargetChange} />
          ) : (
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">{sym.trim()}</span>
                <input
                  type="number" min="1" placeholder="e.g. 500"
                  value={monthlyPayment || ""}
                  onChange={e => onMonthlyPaymentChange(Number(e.target.value))}
                  className={`w-full text-xs bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl py-2 outline-none focus:ring-2 focus:ring-indigo-400 ${sym.length > 2 ? "pl-11 pr-3" : "pl-7 pr-3"}`}
                />
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                /month → <span className="font-semibold text-slate-700 dark:text-slate-200">{effectiveTargetMonths}mo</span>
              </span>
            </div>
          )}
        </div>

        {/* Strategy */}
        <div>
          <div className="flex items-baseline gap-2 mb-1.5">
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Projected strategy</p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">affects projected line only — target is fixed</p>
          </div>
          <div className="flex gap-1.5">
            {([
              { key: "avalanche" as const, label: "Avalanche", desc: "Highest APR first" },
              { key: "snowball" as const, label: "Snowball", desc: "Smallest balance first" },
              { key: "costliest" as const, label: "Costliest", desc: `Biggest ${sym}/mo interest first` },
            ]).map(s => (
              <button
                key={s.key}
                onClick={() => onStrategyChange(s.key)}
                className={`flex-1 px-2 py-2 rounded-xl text-xs font-semibold transition-all text-left ${strategy === s.key ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"}`}
              >
                <span className="block font-bold">{s.label}</span>
                <span className="text-[10px] opacity-70 leading-tight block">{s.desc}</span>
              </button>
            ))}
          </div>
          {!data.has_rates && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 leading-snug">
              Strategies only differ through interest — add APRs to your cards below and the
              projections (and interest costs) will diverge.
            </p>
          )}
          {data.has_rates && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5 leading-snug">
              Projected interest with this strategy:{" "}
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                {hideValues ? "••••" : `${sym}${data.total_interest_projected.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}
              </span>
              {" "}— switch to compare.
            </p>
          )}
        </div>

        {settingsExtra}
      </div>
    </div>
  );
}
