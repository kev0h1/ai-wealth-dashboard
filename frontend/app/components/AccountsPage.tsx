"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Landmark, RefreshCw, Upload, Trash2, AlertTriangle } from "lucide-react";
import { api, Account, Transaction } from "@/lib/api";
import AccountMiniCard from "@/components/AccountMiniCard";
import TransactionRow from "@/components/TransactionRow";
import TransactionSheet from "@/components/TransactionSheet";
import CategoryRow, { CategoryData } from "@/components/CategoryRow";
import SegmentedControl from "@/components/SegmentedControl";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import MonoConnectWidget from "@/components/MonoConnect";
import StatementUpload from "@/components/StatementUpload";
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
  const isSyncing = searchParams.get("syncing") === "1";

  const loadAccounts = useCallback(async () => {
    try {
      const accs = await api.accounts().catch(() => [] as Account[]);
      setAccounts(accs);

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
          className="px-4 pt-6 pb-5 text-white"
          style={{
            background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
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
              {accounts.length} account{accounts.length !== 1 ? "s" : ""} connected
            </p>
          </div>
          {region === "UK" ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowBankPicker(true)}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 active:scale-95 transition-all px-3 py-2 rounded-xl text-xs font-semibold text-white"
              >
                <Plus size={14} />
                Add Bank
              </button>
              <button
                onClick={() => setShowMpesaUpload(true)}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 active:scale-95 transition-all px-3 py-2 rounded-xl text-xs font-semibold text-white"
              >
                <Upload size={14} />
                Statement
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

      {showMpesaUpload && (
        <StatementUpload
          onSuccess={handleStatementSuccess}
          onClose={() => setShowMpesaUpload(false)}
        />
      )}

      {showBankPicker && (
        <BankPickerSheet onClose={() => setShowBankPicker(false)} />
      )}

      <BottomNav />
    </div>
  );
}
