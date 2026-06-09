"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Landmark, RefreshCw, Upload, Trash2, AlertTriangle, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { api, Account, Transaction, InvestmentAccount, InvestmentHolding } from "@/lib/api";
import AccountMiniCard from "@/components/AccountMiniCard";
import TransactionRow from "@/components/TransactionRow";
import TransactionSheet from "@/components/TransactionSheet";
import CategoryRow, { CategoryData } from "@/components/CategoryRow";
import SegmentedControl from "@/components/SegmentedControl";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import MonoConnectWidget from "@/components/MonoConnect";
import StatementUpload from "@/components/StatementUpload";
import InvestmentUpload from "@/components/InvestmentUpload";
import BankPickerSheet from "@/components/BankPickerSheet";
import { usePreferences } from "@/components/PreferencesContext";

function typeLabel(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("credit")) return "Credit Card";
  if (t.includes("saving")) return "Savings";
  if (t.includes("current") || t.includes("checking")) return "Current";
  return "Bank";
}

function typeChipStyle(type: string): { bg: string; text: string } {
  const t = type.toLowerCase();
  if (t.includes("credit")) return { bg: "bg-pink-100", text: "text-pink-700" };
  if (t.includes("saving")) return { bg: "bg-emerald-100", text: "text-emerald-700" };
  return { bg: "bg-indigo-100", text: "text-indigo-700" };
}

const PAGE_SIZE = 20;

export default function AccountsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { hideNetWorth, region } = usePreferences();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txnMap, setTxnMap] = useState<Record<string, Transaction[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [segment, setSegment] = useState<"Transactions" | "Categories">("Transactions");
  const [page, setPage] = useState(1);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [loadingTxns, setLoadingTxns] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showMpesaUpload, setShowMpesaUpload] = useState(false);
  const [showBankPicker, setShowBankPicker] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [reconnectWarning, setReconnectWarning] = useState<string | null>(null);
  const [investmentAccounts, setInvestmentAccounts] = useState<InvestmentAccount[]>([]);
  const [showInvestmentUpload, setShowInvestmentUpload] = useState(false);
  const [expandedInvestment, setExpandedInvestment] = useState<string | null>(null);
  const [investmentHoldings, setInvestmentHoldings] = useState<Record<string, InvestmentHolding[]>>({});
  const [loadingHoldings, setLoadingHoldings] = useState<string | null>(null);
  const [refreshingInvestment, setRefreshingInvestment] = useState<string | null>(null);
  const [deletingInvestment, setDeletingInvestment] = useState<string | null>(null);
  const isSyncing = searchParams.get("syncing") === "1";

  const loadAccounts = useCallback(async () => {
    try {
      const [accs, invAccs] = await Promise.all([
        api.accounts().catch(() => [] as Account[]),
        api.getInvestmentAccounts().catch(() => [] as InvestmentAccount[]),
      ]);
      setAccounts(accs);
      setInvestmentAccounts(invAccs);

      // Validate reconnect: check if the newly connected account matches what was expected
      const raw = localStorage.getItem("reconnect_expected");
      if (raw) {
        try {
          const expected = JSON.parse(raw) as { provider: string; account_number: string; sort_code: string | null };
          localStorage.removeItem("reconnect_expected");
          const match = accs.find(a =>
            a.provider.toUpperCase() === expected.provider.toUpperCase() &&
            a.status === "connected" &&
            a.account_number
          );
          if (match && match.account_number !== expected.account_number) {
            const masked = (n: string) => `••••${n.slice(-4)}`;
            const gotNum = match.account_number ?? "";
            setReconnectWarning(
              `Different ${expected.provider} account connected. Expected ${masked(expected.account_number)}, got ${masked(gotNum)}. If this is wrong, remove it and reconnect again.`
            );
          }
        } catch { /* ignore parse errors */ }
      }
      const deepId = searchParams.get("id");
      if (deepId) {
        setSelectedAccountId(deepId);
        setSegment("Transactions");
        setPage(1);
        const txns = await api.transactions(deepId).catch(() => [] as Transaction[]);
        const sorted = txns.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setTxnMap(prev => ({ ...prev, [deepId]: sorted }));
      }
    } catch {}
    finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // When redirected back from TrueLayer, poll until accounts appear then clear the flag
  useEffect(() => {
    if (!isSyncing) return;
    const interval = setInterval(async () => {
      const accs = await api.accounts().catch(() => [] as Account[]);
      if (accs.length > 0) {
        setAccounts(accs);
        clearInterval(interval);
        router.replace("/accounts");
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isSyncing, router]);

  async function loadAccountTxns(accountId: string) {
    if (txnMap[accountId]) return;
    setLoadingTxns(accountId);
    try {
      const txns = await api.transactions(accountId);
      const sorted = txns.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      setTxnMap((prev) => ({ ...prev, [accountId]: sorted }));
    } catch {}
    finally {
      setLoadingTxns(null);
    }
  }

  async function handleSelectAccount(acc: Account) {
    setSelectedAccountId(acc.id);
    setSegment("Transactions");
    setPage(1);
    setExpandedCat(null);
    await loadAccountTxns(acc.id);
  }

  function handleBack() {
    setSelectedAccountId(null);
    setSelectedTx(null);
  }

  async function handleConnectBank() {
    setConnecting(true);
    try {
      const { auth_url } = await api.connectLink();
      window.location.href = auth_url;
    } catch {
      setConnecting(false);
    }
  }

  function handleMonoSuccess() {
    loadAccounts();
  }

  function handleStatementSuccess() {
    loadAccounts();
    setShowMpesaUpload(false);
  }

  async function handleReconnect(providerId?: string, account?: Account) {
    try {
      // Save expected account details so we can validate after OAuth return
      if (account?.account_number) {
        localStorage.setItem("reconnect_expected", JSON.stringify({
          provider: account.provider,
          account_number: account.account_number,
          sort_code: account.sort_code ?? null,
        }));
      }
      const { auth_url } = await api.connectLink(providerId);
      window.location.href = auth_url;
    } catch {
      alert("Failed to start reconnection. Please try again.");
    }
  }

  async function handleDeleteAccount() {
    if (!selectedAccountId) return;
    const confirmed = window.confirm("Remove this account and all its transactions?");
    if (!confirmed) return;
    setDeletingAccount(true);
    try {
      await api.deleteAccount(selectedAccountId);
      setAccounts(prev => prev.filter(a => a.id !== selectedAccountId));
      setTxnMap(prev => { const n = { ...prev }; delete n[selectedAccountId]; return n; });
      handleBack();
    } catch {
      alert("Failed to remove account. Please try again.");
    } finally {
      setDeletingAccount(false);
    }
  }

  async function handleToggleInvestment(id: string) {
    if (expandedInvestment === id) {
      setExpandedInvestment(null);
      return;
    }
    setExpandedInvestment(id);
    if (!investmentHoldings[id]) {
      setLoadingHoldings(id);
      try {
        const h = await api.getInvestmentHoldings(id);
        setInvestmentHoldings(prev => ({ ...prev, [id]: h }));
      } catch { /* ignore */ }
      finally { setLoadingHoldings(null); }
    }
  }

  async function handleRefreshInvestment(id: string) {
    setRefreshingInvestment(id);
    try {
      const res = await api.refreshInvestmentPrices(id);
      setInvestmentAccounts(prev =>
        prev.map(a => a.id === id ? { ...a, total_value: res.new_total, last_refreshed: new Date().toISOString() } : a)
      );
      // Reload holdings to reflect updated prices
      const h = await api.getInvestmentHoldings(id);
      setInvestmentHoldings(prev => ({ ...prev, [id]: h }));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshingInvestment(null);
    }
  }

  async function handleDeleteInvestment(id: string) {
    if (!confirm("Remove this investment account and all its holdings?")) return;
    setDeletingInvestment(id);
    try {
      await api.deleteInvestmentAccount(id);
      setInvestmentAccounts(prev => prev.filter(a => a.id !== id));
      setInvestmentHoldings(prev => { const n = { ...prev }; delete n[id]; return n; });
      if (expandedInvestment === id) setExpandedInvestment(null);
    } catch { alert("Failed to remove investment account."); }
    finally { setDeletingInvestment(null); }
  }

  // Backend already filters by region — accounts contains only the right source
  const allAccounts = accounts;

  // Unique providers with expired connections
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

  function handleTxUpdated(updated: Transaction, additionalIds?: string[]) {
    setTxnMap((prev) => {
      const next = { ...prev };
      for (const [accId, list] of Object.entries(next)) {
        next[accId] = list.map((t) => {
          if (t.id === updated.id) return { ...t, category: updated.category };
          if (additionalIds?.includes(t.id)) return { ...t, category: updated.category };
          return t;
        });
      }
      return next;
    });
  }

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const accountTxns = selectedAccountId ? (txnMap[selectedAccountId] ?? []) : [];

  // Pagination
  const totalPages = Math.ceil(accountTxns.length / PAGE_SIZE);
  const pagedTxns = accountTxns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Categories for selected account
  const categories = useMemo((): CategoryData[] => {
    const map: Record<string, { total: number; count: number; transactions: Transaction[] }> = {};
    for (const tx of accountTxns) {
      if (tx.transaction_type === "credit") continue;
      const cat = tx.category || "Other";
      if (!map[cat]) map[cat] = { total: 0, count: 0, transactions: [] };
      map[cat].total += Math.abs(tx.amount);
      map[cat].count += 1;
      map[cat].transactions.push(tx);
    }
    const totalSpend = Object.values(map).reduce((s, v) => s + v.total, 0);
    return Object.entries(map)
      .map(([name, { total, count, transactions }]) => ({
        name,
        total,
        count,
        transactions: transactions.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
        pct: totalSpend > 0 ? (total / totalSpend) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [accountTxns]);

  // --- Account detail view ---
  if (selectedAccount) {
    const isCredit = selectedAccount.type.toLowerCase().includes("credit");
    const balance = selectedAccount.balance;

    return (
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-20 lg:pb-8 lg:max-w-6xl lg:mx-auto">
        {/* Header */}
        <div
          className="px-4 pb-5 text-white"
          style={{
            background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.5rem)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 text-white/80 hover:text-white transition-colors"
            >
              <ArrowLeft size={18} />
              <span className="text-sm font-medium">Accounts</span>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleReconnect(selectedAccount?.provider_id, selectedAccount)}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-xl text-xs font-semibold text-white/90 transition-colors"
              >
                <RefreshCw size={13} />
                Reconnect
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deletingAccount}
                className="flex items-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 px-3 py-1.5 rounded-xl text-xs font-semibold text-white/90 transition-colors disabled:opacity-50"
              >
                <Trash2 size={13} />
                {deletingAccount ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>

          <h1 className="text-xl font-bold mb-1">{selectedAccount.name}</h1>

          <div className="flex items-center gap-3 mt-2">
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                isCredit ? "bg-pink-400/30 text-pink-100" : "bg-indigo-400/30 text-indigo-100"
              }`}
            >
              {typeLabel(selectedAccount.type)}
            </span>
            <span
              className={`text-2xl font-bold ${
                balance < 0 ? "text-red-300" : "text-white"
              }`}
            >
              {hideNetWorth ? "••••" : `${balance < 0 ? "-" : ""}${selectedAccount.currency === "KES" ? "KES " : "£"}${Math.abs(balance).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </span>
          </div>
        </div>

        {/* Segmented control */}
        <div className="px-4 pt-4">
          <SegmentedControl
            options={["Transactions", "Categories"]}
            value={segment}
            onChange={(v) => setSegment(v as typeof segment)}
          />
        </div>

        <div className="px-4 pt-4 space-y-2">
          {loadingTxns === selectedAccountId ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={32} />
            </div>
          ) : segment === "Transactions" ? (
            <>
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
                {pagedTxns.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-slate-400 dark:text-slate-500">No transactions</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-50 dark:divide-slate-700">
                    {pagedTxns.map((tx) => (
                      <TransactionRow
                        key={tx.id}
                        transaction={tx}
                        onClick={() => setSelectedTx(tx)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 py-2">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="px-4 py-2 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 active:scale-95 transition-transform"
                  >
                    ← Prev
                  </button>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {page} / {totalPages}
                  </span>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-4 py-2 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 active:scale-95 transition-transform"
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          ) : (
            /* Categories view */
            categories.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
                <p className="text-sm text-slate-400 dark:text-slate-500">No spending data</p>
              </div>
            ) : (
              categories.map((cat) => (
                <CategoryRow
                  key={cat.name}
                  data={cat}
                  expanded={expandedCat === cat.name}
                  onToggle={() =>
                    setExpandedCat(expandedCat === cat.name ? null : cat.name)
                  }
                  onTransactionClick={(tx) => setSelectedTx(tx)}
                />
              ))
            )
          )}
        </div>

        {/* Transaction sheet */}
        {selectedTx && (
          <TransactionSheet
            transaction={selectedTx}
            onClose={() => setSelectedTx(null)}
            onUpdated={handleTxUpdated}
            account={selectedAccount ? { name: selectedAccount.name, provider: selectedAccount.provider } : undefined}
          />
        )}

        <BottomNav />
      </div>
    );
  }

  // --- Account list view ---
  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-20">
      {/* Header */}
      <div
        className="px-4 pt-6 pb-5 text-white"
        style={{
          background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Accounts</h1>
            <p className="text-sm opacity-70 mt-0.5">
              {accounts.length} bank · {investmentAccounts.length} investment
            </p>
          </div>
          {region === "UK" ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowBankPicker(true)}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 active:scale-95 transition-all px-3 py-2 rounded-xl text-xs font-semibold text-white"
              >
                <Plus size={14} />
                Bank
              </button>
              <button
                onClick={() => setShowMpesaUpload(true)}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 active:scale-95 transition-all px-3 py-2 rounded-xl text-xs font-semibold text-white"
              >
                <Upload size={14} />
                Statement
              </button>
              <button
                onClick={() => setShowInvestmentUpload(true)}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 active:scale-95 transition-all px-3 py-2 rounded-xl text-xs font-semibold text-white"
              >
                <TrendingUp size={14} />
                Invest
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <MonoConnectWidget onSuccess={handleMonoSuccess}>
                {(open, loading) => (
                  <button
                    onClick={open}
                    disabled={loading}
                    className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 active:scale-95 transition-all px-3 py-2 rounded-xl text-xs font-semibold text-white"
                  >
                    <Plus size={14} />
                    {loading ? "Opening…" : "Mono"}
                  </button>
                )}
              </MonoConnectWidget>
              <button
                onClick={() => setShowMpesaUpload(true)}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 active:scale-95 transition-all px-3 py-2 rounded-xl text-xs font-semibold text-white"
              >
                <Upload size={14} />
                Statement
              </button>
              <button
                onClick={() => setShowInvestmentUpload(true)}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 active:scale-95 transition-all px-3 py-2 rounded-xl text-xs font-semibold text-white"
              >
                <TrendingUp size={14} />
                Invest
              </button>
            </div>
          )}
        </div>
      </div>

      {isSyncing && (
        <div className="mx-4 mt-4 flex items-center gap-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-2xl px-4 py-3">
          <RefreshCw size={16} className="animate-spin text-indigo-500 flex-shrink-0" />
          <p className="text-sm text-indigo-700 dark:text-indigo-300 font-medium">Syncing your bank accounts…</p>
        </div>
      )}

      {reconnectWarning && (
        <div className="mx-4 mt-4 flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-3">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-800 dark:text-red-200">Wrong account connected</p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{reconnectWarning}</p>
          </div>
          <button onClick={() => setReconnectWarning(null)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
        </div>
      )}

      {expiredProviders.map(({ provider, provider_id }) => (
        <div key={provider} className="mx-4 mt-4 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3">
          <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{provider} needs to be reconnected</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">Your consent has expired — transactions are no longer syncing.</p>
          </div>
          <button
            onClick={() => handleReconnect(provider_id)}
            className="flex-shrink-0 text-xs font-semibold bg-amber-500 hover:bg-amber-600 active:scale-95 transition-all text-white px-3 py-1.5 rounded-lg"
          >
            Reconnect
          </button>
        </div>
      ))}

      <div className="px-4 pt-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={32} />
          </div>
        ) : accounts.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-10 text-center shadow-sm">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 mb-4">
              <Landmark size={26} color="#4f46e5" />
            </div>
            <p className="text-slate-800 dark:text-slate-100 font-semibold mb-1">No banks connected</p>
            <p className="text-slate-400 dark:text-slate-500 text-sm mb-5">
              {region === "UK"
                ? "Connect your bank via Open Banking, or upload a PDF/CSV statement."
                : "Connect via Mono or upload a bank statement (M-Pesa, Equity, KCB, NCBA…) to get started."}
            </p>
            {region === "UK" ? (
              <div className="flex flex-col gap-2 items-center">
                <button
                  onClick={() => setShowBankPicker(true)}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white font-semibold px-5 py-3 rounded-xl text-sm"
                >
                  <Plus size={16} />
                  Connect a Bank
                </button>
                <button
                  onClick={() => setShowMpesaUpload(true)}
                  className="inline-flex items-center gap-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 active:scale-95 transition-all text-slate-700 dark:text-slate-200 font-semibold px-5 py-3 rounded-xl text-sm"
                >
                  <Upload size={16} />
                  Upload Statement
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 items-center">
                <MonoConnectWidget onSuccess={handleMonoSuccess}>
                  {(open, loading) => (
                    <button
                      onClick={open}
                      disabled={loading}
                      className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white font-semibold px-5 py-3 rounded-xl text-sm"
                    >
                      <Plus size={16} />
                      {loading ? "Opening…" : "Connect via Mono"}
                    </button>
                  )}
                </MonoConnectWidget>
                <button
                  onClick={() => setShowMpesaUpload(true)}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white font-semibold px-5 py-3 rounded-xl text-sm"
                >
                  <Upload size={16} />
                  Upload Bank Statement
                </button>
              </div>
            )}
          </div>
        ) : (
          accounts.map((acc) => (
            <AccountMiniCard
              key={acc.id}
              account={acc}
              fullWidth
              hidden={hideNetWorth}
              onClick={() => handleSelectAccount(acc)}
              onReconnect={() => handleReconnect(acc.provider_id, acc)}
            />
          ))
        )}
      </div>

      {/* Investments section */}
      <div className="px-4 pt-5 pb-1">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Investments</p>
          <button
            onClick={() => setShowInvestmentUpload(true)}
            className="flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 active:scale-95 transition-all"
          >
            <Upload size={12} />
            Upload statement
          </button>
        </div>

        {investmentAccounts.length === 0 ? (
          <button
            onClick={() => setShowInvestmentUpload(true)}
            className="w-full border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-5 flex items-center gap-3 hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center flex-shrink-0">
              <TrendingUp size={20} className="text-indigo-400" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No investment accounts</p>
              <p className="text-xs text-slate-400 mt-0.5">Upload a Vanguard, Wealthify, or HL statement</p>
            </div>
          </button>
        ) : (
          <div className="space-y-2">
            {investmentAccounts.map(inv => {
              const isExpanded = expandedInvestment === inv.id;
              const holdings = investmentHoldings[inv.id] ?? [];
              const isRefreshing = refreshingInvestment === inv.id;
              const isDeleting = deletingInvestment === inv.id;
              const isLoadingH = loadingHoldings === inv.id;
              const refreshDate = inv.last_refreshed
                ? new Date(inv.last_refreshed).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                : null;

              return (
                <div key={inv.id} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
                  <button
                    onClick={() => handleToggleInvestment(inv.id)}
                    className="w-full flex items-center justify-between px-4 py-3.5 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center flex-shrink-0">
                        <TrendingUp size={16} className="text-indigo-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {inv.provider} {inv.account_type}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {inv.account_reference}
                          {refreshDate && <span className="ml-1.5">· updated {refreshDate}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        {hideNetWorth ? "••••" : `£${inv.total_value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </span>
                      {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-50 dark:border-slate-700">
                      {/* Action row */}
                      <div className="flex items-center gap-2 px-4 py-2.5">
                        <button
                          onClick={() => handleRefreshInvestment(inv.id)}
                          disabled={isRefreshing}
                          className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 disabled:opacity-50"
                        >
                          <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
                          {isRefreshing ? "Refreshing prices…" : "Refresh prices"}
                        </button>
                        <span className="text-slate-200 dark:text-slate-600">|</span>
                        <button
                          onClick={() => handleDeleteInvestment(inv.id)}
                          disabled={isDeleting}
                          className="flex items-center gap-1.5 text-xs font-semibold text-rose-500 disabled:opacity-50"
                        >
                          <Trash2 size={12} />
                          {isDeleting ? "Removing…" : "Remove"}
                        </button>
                      </div>

                      {/* Holdings list */}
                      {isLoadingH ? (
                        <div className="flex items-center justify-center py-6">
                          <Spinner size={24} />
                        </div>
                      ) : holdings.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-6">No holdings found</p>
                      ) : (
                        <div className="divide-y divide-slate-50 dark:divide-slate-700">
                          {holdings.map(h => {
                            const displayValue = h.current_value ?? h.statement_value;
                            const displayPrice = h.current_price ?? h.price_per_unit;
                            const hasLivePrice = h.current_price !== null;

                            return (
                              <div key={h.id} className="px-4 py-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-tight">{h.name}</p>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                      {h.isin && <span className="mr-1.5">{h.isin}</span>}
                                      <span className="capitalize">{h.type.toLowerCase()}</span>
                                      {h.units && <span className="ml-1.5">{h.units.toLocaleString("en-GB", { maximumFractionDigits: 4 })} units</span>}
                                    </p>
                                    {displayPrice && (
                                      <p className="text-xs mt-0.5">
                                        <span className={hasLivePrice ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-slate-400"}>
                                          {hasLivePrice ? "Live " : ""}£{displayPrice.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} / unit
                                        </span>
                                      </p>
                                    )}
                                  </div>
                                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100 flex-shrink-0">
                                    {hideNetWorth ? "••••" : `£${displayValue.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showMpesaUpload && (
        <StatementUpload
          onSuccess={handleStatementSuccess}
          onClose={() => setShowMpesaUpload(false)}
        />
      )}

      {showInvestmentUpload && (
        <InvestmentUpload
          onSuccess={() => {
            api.getInvestmentAccounts().then(setInvestmentAccounts).catch(() => {});
            setShowInvestmentUpload(false);
          }}
          onClose={() => setShowInvestmentUpload(false)}
        />
      )}

      {showBankPicker && (
        <BankPickerSheet onClose={() => setShowBankPicker(false)} />
      )}

      <BottomNav />
    </div>
  );
}
