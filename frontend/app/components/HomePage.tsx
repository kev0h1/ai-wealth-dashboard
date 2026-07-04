"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo } from "react";
import { RefreshCw, ChevronRight, AlertTriangle, ArrowUp, ArrowDown, TrendingUp } from "lucide-react";
import { api, Account, Transaction, KPIs, InvestmentAccount } from "@/lib/api";
import { getToken, setToken } from "@/lib/auth";
import NetWorthCard from "@/components/NetWorthCard";
import AccountMiniCard from "@/components/AccountMiniCard";
import InvestmentMiniCard from "@/components/InvestmentMiniCard";
import TransactionRow from "@/components/TransactionRow";
import TransactionSheet from "@/components/TransactionSheet";
import BottomNav from "@/components/BottomNav";
import { usePreferences } from "@/components/PreferencesContext";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { getPayPeriodWithConfig } from "@/lib/payPeriod";
import TutorialTrigger from "@/components/TutorialTrigger";
import HomeInsightSpotlight from "@/components/HomeInsightSpotlight";
import ValueDeliveredStat from "@/components/ValueDeliveredStat";
import UpcomingBillsStrip from "@/components/UpcomingBillsStrip";

// Token is guaranteed by AuthProvider before this component mounts
async function ensureAuth() {}

export default function HomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0]?.trim();
  const { hideNetWorth } = usePreferences();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investmentAccounts, setInvestmentAccounts] = useState<InvestmentAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [incomeBracket, setIncomeBracket] = useState("");
  const [adjustedIncome, setAdjustedIncome] = useState<number | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    try {
      await ensureAuth();
      const [accs, kpiData, invAccs] = await Promise.allSettled([
        api.accounts(),
        api.kpis(),
        api.getInvestmentAccounts(),
      ]);

      const loadedAccounts = accs.status === "fulfilled" ? accs.value : [];
      setAccounts(loadedAccounts);
      if (kpiData.status === "fulfilled") setKpis(kpiData.value);
      if (invAccs.status === "fulfilled") setInvestmentAccounts(invAccs.value);

      if (loadedAccounts.length > 0) {
        const allTxns: Transaction[] = [];
        await Promise.all(
          loadedAccounts.map(async (acc) => {
            try {
              const txns = await api.transactions(acc.id);
              allTxns.push(...txns);
            } catch {}
          })
        );
        setTransactions(
          allTxns.sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          )
        );
      }
    } catch {}
    finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Last-known bracket from cache so the tax card doesn't pop in after paint
  useLayoutEffect(() => {
    try {
      const b = localStorage.getItem("wd_bracket");
      if (b !== null) setIncomeBracket(b);
    } catch {}
  }, []);

  useEffect(() => {
    api.getPreferences().then(p => {
      setIncomeBracket(p.income_bracket ?? "");
      setPinnedIds(p.home_pinned_accounts ?? []);
      try { localStorage.setItem("wd_bracket", p.income_bracket ?? ""); } catch {}
      // Mirror the Tax page's adjusted-income computation so the two never disagree
      let inc = 0;
      if (p.income_value && p.income_value > 0) inc = p.income_value;
      else if (p.income_bracket === "100k_125k") inc = 110_000;
      else if (p.income_bracket === "125k_plus") inc = 130_000;
      setAdjustedIncome(inc > 0 ? inc - (p.pension_annual ?? 0) : null);
    }).catch(() => {});
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      await api.syncAll();
      await loadData();
    } catch {} finally {
      setSyncing(false);
    }
  }

  function handleTxUpdated(updated: Transaction, additionalIds?: string[]) {
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id === updated.id) return { ...t, category: updated.category };
        if (additionalIds?.includes(t.id)) return { ...t, category: updated.category };
        return t;
      })
    );
  }

  // Micro pot-shuffles (round-ups, penny transfers) aren't "activity" worth
  // a slot on the home screen
  const recent = transactions
    .filter(t => !(t.category === "Transfer" && t.amount < 1))
    .slice(0, 6);

  // Top picks: expired connections first (action needed), then the user's
  // pins from the Accounts page, then autofill with the biggest balances
  const topPickAccounts = useMemo(() => {
    const picks: Account[] = [];
    const seen = new Set<string>();
    const add = (a?: Account) => { if (a && !seen.has(a.id)) { seen.add(a.id); picks.push(a); } };
    accounts.filter(a => a.status === "expired").forEach(add);
    pinnedIds.forEach(id => add(accounts.find(a => a.id === id)));
    const isSavings = (a: Account) => (a.subtype ?? "").toLowerCase().includes("saving");
    const isCredit  = (a: Account) => a.type.toLowerCase().includes("credit") || (a.subtype ?? "").toLowerCase().includes("credit");
    const current = accounts.filter(a => !isSavings(a) && !isCredit(a)).sort((x, y) => y.balance - x.balance);
    const savings = accounts.filter(isSavings).sort((x, y) => y.balance - x.balance);
    for (const a of [...current, ...savings]) { if (picks.length >= 3) break; add(a); }
    return picks.slice(0, 3);
  }, [accounts, pinnedIds]);

  const hiddenAccountCount =
    Math.max(0, accounts.length - topPickAccounts.length) +
    Math.max(0, investmentAccounts.length - 1);

  const expiredProviders = useMemo(() => {
    const seen = new Set<string>();
    const result: { provider: string; provider_id?: string }[] = [];
    for (const a of accounts) {
      if (a.status === "expired" && !seen.has(a.provider)) {
        seen.add(a.provider);
        result.push({ provider: a.provider, provider_id: a.provider_id });
      }
    }
    return result;
  }, [accounts]);

  async function handleReconnect(providerId?: string) {
    try {
      const { auth_url } = await api.connectLink(providerId);
      window.location.href = auth_url;
    } catch {}
  }

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-20 lg:pb-8">
      {/* Desktop 2-col grid wrapper */}
      <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6 lg:p-6 lg:max-w-7xl lg:mx-auto">

        {/* ── Left column: header, KPIs, accounts, donut ── */}
        <div>
          {/* Header */}
          <div className="px-4 pt-6 pb-4 lg:px-0 lg:pt-0">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">
                  Good {getGreeting()}
                </p>
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  {firstName ? `Hi, ${firstName}` : "Welcome back"}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <TutorialTrigger variant="dark-on-white" />
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform"
                >
                  <RefreshCw
                    size={16}
                    color="#64748b"
                    className={syncing ? "animate-spin" : ""}
                  />
                </button>
              </div>
            </div>
            <NetWorthCard kpis={kpis} loading={loading} />
            {!loading && <ValueDeliveredStat />}
          </div>

          {/* Reauth banners */}
          {expiredProviders.map(({ provider, provider_id }) => (
            <div key={provider} className="mx-4 mt-3 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 lg:mx-0">
              <AlertTriangle size={15} className="text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">{provider} needs reconnecting</p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-tight">Transactions have stopped syncing.</p>
              </div>
              <button
                onClick={() => handleReconnect(provider_id)}
                className="flex-shrink-0 text-xs font-semibold bg-amber-500 hover:bg-amber-600 active:scale-95 transition-all text-white px-3 py-1.5 rounded-lg"
              >
                Reconnect
              </button>
            </div>
          ))}

          {/* Spending pace — one-line "am I on track this period?" status */}
          {!loading && transactions.length > 0 && (
            <SpendingPace transactions={transactions} desktopFlat />
          )}

          {/* Upcoming bills — compact 4-item list, taps through to Spend */}
          {!loading && <UpcomingBillsStrip />}

          {/* AI savings spotlight — the single hero call-to-action */}
          {!loading && <HomeInsightSpotlight />}

          {/* Tax efficiency card — shown only for £100k+ earners */}
          {!loading && (incomeBracket === "100k_125k" || incomeBracket === "125k_plus") && (
            <TaxEfficiencyCard adjusted={adjustedIncome} router={router} />
          )}

          {/* Accounts — pinned/expired top picks in a grid, rest behind "+N more" */}
          <div className="px-4 mb-5 lg:px-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Accounts</p>
              <button
                data-tutorial-id="tutorial-manage-link"
                onClick={() => router.push("/accounts")}
                className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 flex items-center gap-1 active:opacity-70"
              >
                Manage <span className="text-base leading-none">+</span>
              </button>
            </div>
            {loading ? (
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-28 bg-white dark:bg-slate-800 rounded-2xl animate-pulse shadow-sm" />
                ))}
              </div>
            ) : accounts.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 text-center shadow-sm">
                <p className="text-sm text-slate-400 dark:text-slate-500">No accounts connected</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {topPickAccounts.map((acc) => (
                  <AccountMiniCard
                    key={acc.id}
                    account={acc}
                    grid
                    hidden={hideNetWorth}
                    onClick={() => router.push(`/accounts?id=${acc.id}`)}
                  />
                ))}
                {investmentAccounts.slice(0, 1).map(inv => (
                  <InvestmentMiniCard
                    key={inv.id}
                    account={inv}
                    grid
                    hidden={hideNetWorth}
                    onClick={() => router.push("/accounts?tab=Investments")}
                  />
                ))}
                {hiddenAccountCount > 0 && (
                  <button
                    onClick={() => router.push("/accounts")}
                    className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center gap-1 text-slate-400 dark:text-slate-500 active:scale-95 transition-transform min-h-[7rem]"
                  >
                    <span className="text-lg font-bold">+{hiddenAccountCount}</span>
                    <span className="text-xs font-medium">more accounts</span>
                  </button>
                )}
              </div>
            )}
          </div>

        </div>

        {/* ── Right column: recent transactions ── */}
        <div>
          <div className="mx-4 mb-4 lg:mx-0 lg:mt-0" data-tutorial-id="tutorial-recent-transactions">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300 lg:pt-0">Recent Transactions</p>
              <button
                onClick={() => router.push("/spend?view=list")}
                className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 flex items-center gap-1 active:opacity-70"
              >
                See all <ChevronRight size={13} />
              </button>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto">
              {loading ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
                      <div className="flex-1 space-y-1">
                        <div className="h-3.5 w-36 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                        <div className="h-2.5 w-20 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                      </div>
                      <div className="h-3.5 w-14 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : recent.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-slate-400 dark:text-slate-500">No transactions yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50 dark:divide-slate-700">
                  {recent.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      transaction={tx}
                      onClick={() => setSelectedTx(tx)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedTx && (
        <TransactionSheet
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
          onUpdated={handleTxUpdated}
          account={accounts.find(a => a.id === selectedTx.account_id) ? { name: accounts.find(a => a.id === selectedTx.account_id)!.name, provider: accounts.find(a => a.id === selectedTx.account_id)!.provider } : undefined}
        />
      )}

      <BottomNav />
    </div>
  );
}

const SKIP_CATS = new Set(["Transfer", "Savings", "Debt", "Income"]);

// Sum of debit spend (excluding transfers/savings/debt/income) with date in [start, end).
function spendBetween(txns: Transaction[], start: Date, end: Date): number {
  let sum = 0;
  for (const tx of txns) {
    if (tx.transaction_type === "credit") continue;
    if (SKIP_CATS.has(tx.category || "Other")) continue;
    const d = new Date(tx.date);
    if (d >= start && d < end) sum += Math.abs(tx.amount);
  }
  return sum;
}

// One-line "am I on track this period?" pace indicator.
// Compares spend-so-far against spend at the SAME day-offset in the previous
// pay period, so a partial period is never compared against a full one.
function SpendingPace({ transactions, desktopFlat }: { transactions: Transaction[]; desktopFlat?: boolean }) {
  const { payPeriodConfig, region } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";
  const fmtMoney = (v: number) => `${sym}${Math.round(v).toLocaleString("en-GB")}`;

  const { soFar, delta, hasComparison } = useMemo(() => {
    const now = new Date();
    const dayMs = 86_400_000;
    const [curStart] = getPayPeriodWithConfig(now, payPeriodConfig);
    const [prevStart] = getPayPeriodWithConfig(new Date(curStart.getTime() - dayMs), payPeriodConfig);
    const offsetMs = now.getTime() - curStart.getTime();
    const prevCutoff = new Date(prevStart.getTime() + offsetMs);

    const soFar = spendBetween(transactions, curStart, now);
    const prevSoFar = spendBetween(transactions, prevStart, prevCutoff);
    return { soFar, delta: soFar - prevSoFar, hasComparison: prevSoFar > 0 };
  }, [transactions, payPeriodConfig]);

  // Nothing meaningful to show yet
  if (soFar === 0 && !hasComparison) return null;

  const prevSoFar = soFar - delta;
  // "On track" = within ~10% of the same point last period (or a small £ buffer)
  const onTrack = !hasComparison || Math.abs(delta) < Math.max(prevSoFar * 0.1, 20);

  return (
    <div className={`mb-5 bg-white dark:bg-slate-800 rounded-2xl shadow-sm px-4 py-3 ${desktopFlat ? "mx-4 lg:mx-0" : "mx-4"}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
        Spending this period
      </p>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-xl font-bold text-slate-900 dark:text-slate-100">{fmtMoney(soFar)}</span>
        {hasComparison && (
          <>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            {onTrack ? (
              <span className="text-[13px] font-medium text-slate-500 dark:text-slate-400">on track</span>
            ) : delta > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-[13px] font-medium text-rose-500 dark:text-rose-400">
                <ArrowUp size={12} />
                {fmtMoney(Math.abs(delta))} ahead of usual
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
                <ArrowDown size={12} />
                {fmtMoney(Math.abs(delta))} under usual
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}

function TaxEfficiencyCard({ adjusted, router }: { adjusted: number | null; router: ReturnType<typeof useRouter> }) {
  // Same thresholds as the Tax page: taper starts at £100k, allowance gone at £125,140
  const is125k    = adjusted !== null && adjusted >= 125_140;
  const inTaper   = adjusted !== null && adjusted > 100_000 && adjusted < 125_140;
  const protectedAllowance = adjusted !== null && adjusted <= 100_000;
  // Plain card, not a gradient banner — permanent chrome shouldn't compete
  // with the rotating insight spotlight above it
  return (
    <div
      className="mx-4 mb-5 lg:mx-0 rounded-2xl overflow-hidden cursor-pointer active:scale-[0.98] transition-transform bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700"
      onClick={() => router.push("/insights?tab=tax")}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-400 mb-1">
              Tax efficiency
            </p>
            {is125k ? (
              <>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight">
                  You&apos;ve lost your personal allowance
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Pension contributions still save 45p in every £1 — see how much to put in
                </p>
              </>
            ) : protectedAllowance ? (
              <>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight">
                  Personal allowance protected
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Your pension contributions keep you under £100k — check your remaining levers
                </p>
              </>
            ) : inTaper ? (
              <>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight">
                  You&apos;re in the 60% rate band
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Pension contributions can restore your personal allowance and cut your tax bill
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight">
                  You may be in the 60% rate band
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Set your income in Settings for a precise picture
                </p>
              </>
            )}
          </div>
          <div className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
            <TrendingUp size={16} className="text-violet-600 dark:text-violet-400" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-violet-600 dark:text-violet-400">
          See your tax position <ChevronRight size={13} />
        </div>
      </div>
    </div>
  );
}
