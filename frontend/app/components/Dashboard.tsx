"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw, Building2, AlertCircle, LogOut } from "lucide-react";
import { api, Account, Transaction, KPIs, Insight } from "@/lib/api";
import { getToken, setToken } from "@/lib/auth";
import KPICards from "./KPICards";
import AccountList from "./AccountList";
import TransactionList from "./TransactionList";
import InsightList from "./InsightList";
import ConnectBankButton from "./ConnectBankButton";
import SpendingChart from "./SpendingChart";

export default function Dashboard() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

  async function ensureToken() {
    const existing = getToken();
    if (existing) {
      const ok = await fetch("/api/auth/session/validate", {
        method: "POST",
        headers: { Authorization: `Bearer ${existing}` },
      }).then(r => r.ok).catch(() => false);
      if (ok) return;
    }
    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "8048" }),
      });
      if (res.ok) {
        const { session_token } = await res.json();
        setToken(session_token);
      }
    } catch {}
  }

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [accs, kpiData, insightData] = await Promise.allSettled([
        api.accounts(),
        api.kpis(),
        api.insights(),
      ]);

      const loadedAccounts = accs.status === "fulfilled" ? accs.value : [];
      setAccounts(loadedAccounts);

      if (kpiData.status === "fulfilled") setKpis(kpiData.value);
      if (insightData.status === "fulfilled") setInsights(insightData.value);

      if (loadedAccounts.length > 0) {
        const allTxns: Transaction[] = [];
        for (const acc of loadedAccounts) {
          try {
            const txns = await api.transactions(acc.id);
            allTxns.push(...txns);
          } catch {}
        }
        setTransactions(allTxns.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      await ensureToken();
      await loadData();
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (searchParams.get("connected") === "true") {
      setJustConnected(true);
      const t = setTimeout(() => setJustConnected(false), 5000);
      return () => clearTimeout(t);
    }
  }, [searchParams]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.syncAccounts();
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleLoadMock = async () => {
    setSyncing(true);
    try {
      await api.mockData();
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mock data");
    } finally {
      setSyncing(false);
    }
  };

  const filteredTransactions = selectedAccount
    ? transactions.filter((t) => t.account_id === selectedAccount)
    : transactions;

  const handleLogout = () => {
    localStorage.removeItem("wealth_auth");
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-semibold text-white">Wealth Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLoadMock}
              disabled={syncing}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-md border border-slate-700 hover:border-slate-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
              Load demo data
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white px-3 py-1.5 rounded-md border border-slate-700 hover:border-slate-500 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              Sync
            </button>
            <ConnectBankButton />
            <button
              onClick={handleLogout}
              title="Lock dashboard"
              className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {justConnected && (
          <div className="bg-emerald-900/40 border border-emerald-700 rounded-lg px-4 py-3 text-emerald-300 text-sm">
            Bank connected successfully! Your accounts are now syncing.
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 flex items-center gap-2 text-red-300 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <KPICards kpis={kpis} loading={loading} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <AccountList
              accounts={accounts}
              loading={loading}
              selectedAccount={selectedAccount}
              onSelectAccount={setSelectedAccount}
            />
            {transactions.length > 0 && <SpendingChart transactions={transactions} />}
          </div>

          <div className="lg:col-span-2">
            <TransactionList
              transactions={filteredTransactions}
              loading={loading}
              selectedAccount={selectedAccount}
              onClearFilter={() => setSelectedAccount(null)}
            />
          </div>
        </div>

        {insights.length > 0 && <InsightList insights={insights} />}

        {!loading && accounts.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-8 h-8 text-slate-500" />
            </div>
            <h2 className="text-lg font-medium text-slate-300 mb-2">No accounts connected</h2>
            <p className="text-sm text-slate-500 mb-6 max-w-sm mx-auto">
              Connect your bank via TrueLayer or load demo data to get started.
            </p>
            <div className="flex items-center justify-center gap-3">
              <ConnectBankButton />
              <button
                onClick={handleLoadMock}
                className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors"
              >
                Load demo data
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
