"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Landmark, RefreshCw, Upload, Trash2, AlertTriangle, TrendingUp, ChevronDown, ChevronUp, ChevronRight, Pencil, PiggyBank, Wallet, CreditCard } from "lucide-react";
import { api, Account, Transaction, InvestmentAccount, InvestmentHolding, ManualAccount, ManualAccountType, ManualAccountRule, RuleMatchType, RuleSign } from "@/lib/api";
import AccountMiniCard, { BANK_META } from "@/components/AccountMiniCard";
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
import CustomSelect from "@/components/CustomSelect";

function typeLabel(type: string, subtype?: string): string {
  const t = type.toLowerCase();
  const s = (subtype ?? "").toLowerCase();
  if (t.includes("credit") || s.includes("credit")) return "Credit Card";
  if (t.includes("saving") || s.includes("saving")) return "Savings";
  if (t.includes("current") || t.includes("checking") || s.includes("transaction")) return "Current";
  return "Bank";
}

function typeChipStyle(type: string): { bg: string; text: string } {
  const t = type.toLowerCase();
  if (t.includes("credit")) return { bg: "bg-pink-100", text: "text-pink-700" };
  if (t.includes("saving")) return { bg: "bg-emerald-100", text: "text-emerald-700" };
  return { bg: "bg-indigo-100", text: "text-indigo-700" };
}

const PAGE_SIZE = 20;

const MANUAL_TYPES: { value: ManualAccountType; label: string; Icon: typeof Wallet }[] = [
  { value: "savings",     label: "Savings",     Icon: PiggyBank },
  { value: "current",     label: "Current",     Icon: Wallet },
  { value: "credit_card", label: "Credit card", Icon: CreditCard },
];

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
  const [tab, setTab] = useState<"Banks" | "Investments">(
    searchParams.get("tab") === "Investments" ? "Investments" : "Banks"
  );
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

  // Offline (manually-tracked) accounts
  const [manualAccounts, setManualAccounts] = useState<ManualAccount[]>([]);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualEditId, setManualEditId] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualBalance, setManualBalance] = useState("");
  const [manualType, setManualType] = useState<ManualAccountType>("savings");
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // Transaction-mirror rules
  const [rules, setRules] = useState<ManualAccountRule[]>([]);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleEditId, setRuleEditId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleTarget, setRuleTarget] = useState("");
  const [ruleMatchType, setRuleMatchType] = useState<RuleMatchType>("description_contains");
  const [ruleMatchValue, setRuleMatchValue] = useState("");
  const [ruleSign, setRuleSign] = useState<RuleSign>("opposite");
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);

  // Offline-account ledger entries (hand-added)
  const [manualTxModalOpen, setManualTxModalOpen] = useState(false);
  const [manualTxEditId, setManualTxEditId] = useState<string | null>(null);
  const [manualTxDesc, setManualTxDesc] = useState("");
  const [manualTxAmount, setManualTxAmount] = useState("");
  const [manualTxType, setManualTxType] = useState<"credit" | "debit">("debit");
  const [manualTxDate, setManualTxDate] = useState("");
  const [manualTxSaving, setManualTxSaving] = useState(false);
  const [manualTxError, setManualTxError] = useState<string | null>(null);
  const [detailSegment, setDetailSegment] = useState<"Transactions" | "Rules">("Transactions");

  const anyModalOpen = manualModalOpen || manualTxModalOpen || ruleModalOpen;
  useEffect(() => {
    if (anyModalOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [anyModalOpen]);

  const loadAccounts = useCallback(async () => {
    try {
      const [accs, invAccs, manuals, mrules] = await Promise.all([
        api.accounts().catch(() => [] as Account[]),
        api.getInvestmentAccounts().catch(() => [] as InvestmentAccount[]),
        api.manualAccounts().catch(() => [] as ManualAccount[]),
        api.manualAccountRules().catch(() => [] as ManualAccountRule[]),
      ]);
      setAccounts(accs);
      setInvestmentAccounts(invAccs);
      setManualAccounts(manuals);
      setRules(mrules);

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

  async function loadAccountTxns(accountId: string, force = false) {
    if (txnMap[accountId] && !force) return;
    setLoadingTxns(accountId);
    try {
      const isManual = accounts.find(a => a.id === accountId)?.manual;
      const txns = isManual ? await api.manualTransactions(accountId) : await api.transactions(accountId);
      const sorted = txns.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      setTxnMap((prev) => ({ ...prev, [accountId]: sorted }));
    } catch {}
    finally {
      setLoadingTxns(null);
    }
  }

  const listScrollY = useRef(0);

  // Home-screen pins — capped at the number of bank slots on the Home grid
  const MAX_PINS = 3;
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const pinMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    api.getPreferences().then(p => setPinnedIds(p.home_pinned_accounts ?? [])).catch(() => {});
  }, []);
  function togglePin(id: string) {
    if (!pinnedIds.includes(id) && pinnedIds.length >= MAX_PINS) {
      setPinMsg(`Home shows up to ${MAX_PINS} pinned accounts — unpin one first.`);
      if (pinMsgTimer.current) clearTimeout(pinMsgTimer.current);
      pinMsgTimer.current = setTimeout(() => setPinMsg(null), 3500);
      return;
    }
    setPinnedIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      api.updatePreferences({ home_pinned_accounts: next }).catch(() => {});
      return next;
    });
  }

  // Detail view is a state switch, not a navigation — so manage scroll and
  // history ourselves: open at the top, restore the list position on return,
  // and give the system back gesture a history entry to consume.
  useEffect(() => {
    if (selectedAccountId) {
      window.scrollTo(0, 0);
    } else {
      window.scrollTo(0, listScrollY.current);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    const onPop = () => {
      setSelectedAccountId(null);
      setSelectedTx(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  async function handleSelectAccount(acc: Account) {
    listScrollY.current = window.scrollY;
    window.history.pushState({ accountDetail: acc.id }, "");
    setSelectedAccountId(acc.id);
    setSegment("Transactions");
    setDetailSegment("Transactions");
    setPage(1);
    setExpandedCat(null);
    await loadAccountTxns(acc.id);
  }

  function handleBack() {
    if (window.history.state?.accountDetail) {
      // Consume the history entry pushed on open — popstate closes the view,
      // keeping the in-app arrow and the system back gesture in sync
      window.history.back();
    } else {
      // Deep-linked or post-delete: no pushed entry to consume
      setSelectedAccountId(null);
      setSelectedTx(null);
    }
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
    if (selectedAccountId) loadAccountTxns(selectedAccountId, true);
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

  function openAddManual() {
    setManualEditId(null);
    setManualName("");
    setManualBalance("");
    setManualType("savings");
    setManualError(null);
    setManualModalOpen(true);
  }

  function openEditManual(acc: ManualAccount) {
    setManualEditId(acc.id);
    setManualName(acc.name);
    setManualBalance(String(acc.balance));
    setManualType(acc.account_type);
    setManualError(null);
    setManualModalOpen(true);
  }

  async function saveManual() {
    const name = manualName.trim();
    if (!name) { setManualError("Give the account a name"); return; }
    const balance = parseFloat(manualBalance);
    if (!isFinite(balance) || balance < 0) { setManualError("Enter a balance of 0 or more"); return; }
    setManualSaving(true);
    setManualError(null);
    try {
      if (manualEditId) {
        const updated = await api.updateManualAccount(manualEditId, { name, balance, account_type: manualType });
        setManualAccounts(prev => prev.map(a => a.id === manualEditId ? updated : a));
      } else {
        const created = await api.createManualAccount({ name, balance, account_type: manualType });
        setManualAccounts(prev => [...prev, created]);
      }
      setManualModalOpen(false);
      loadAccounts();
    } catch {
      setManualError("Couldn't save. Please try again.");
    } finally {
      setManualSaving(false);
    }
  }

  async function removeManual(id: string) {
    if (!window.confirm("Remove this offline account?")) return;
    try {
      await api.deleteManualAccount(id);
      setManualAccounts(prev => prev.filter(a => a.id !== id));
      loadAccounts();
    } catch {
      alert("Failed to remove account. Please try again.");
    }
  }

  function openAddRule() {
    setRuleEditId(null);
    setRuleName("");
    setRuleTarget(selectedAccountId ?? manualAccounts[0]?.id ?? "");
    setRuleMatchType("description_contains");
    setRuleMatchValue("");
    setRuleSign("opposite");
    setRuleError(null);
    setRuleModalOpen(true);
  }

  function openAddManualTx() {
    setManualTxEditId(null);
    setManualTxDesc("");
    setManualTxAmount("");
    setManualTxType("debit");
    setManualTxDate(new Date().toISOString().slice(0, 10));
    setManualTxError(null);
    setManualTxModalOpen(true);
  }

  function openEditManualTx(tx: Transaction) {
    setManualTxEditId(tx.id);
    setManualTxDesc(tx.description);
    setManualTxAmount(String(tx.amount));
    setManualTxType(tx.transaction_type === "credit" ? "credit" : "debit");
    setManualTxDate(new Date(tx.date).toISOString().slice(0, 10));
    setManualTxError(null);
    setManualTxModalOpen(true);
  }

  async function saveManualTx() {
    if (!selectedAccountId) return;
    const description = manualTxDesc.trim();
    if (!description) { setManualTxError("Add a description"); return; }
    const amount = parseFloat(manualTxAmount);
    if (!isFinite(amount) || amount <= 0) { setManualTxError("Enter an amount greater than 0"); return; }
    setManualTxSaving(true);
    setManualTxError(null);
    try {
      const body = { description, amount, transaction_type: manualTxType, date: manualTxDate || undefined };
      if (manualTxEditId) {
        await api.updateManualTransaction(selectedAccountId, manualTxEditId, body);
      } else {
        await api.addManualTransaction(selectedAccountId, body);
      }
      setManualTxModalOpen(false);
      await loadAccountTxns(selectedAccountId, true);
      loadAccounts();
    } catch {
      setManualTxError("Couldn't save. Please try again.");
    } finally {
      setManualTxSaving(false);
    }
  }

  async function removeManualTx(txId: string) {
    if (!selectedAccountId) return;
    if (!window.confirm("Delete this entry?")) return;
    try {
      await api.deleteManualTransaction(selectedAccountId, txId);
      await loadAccountTxns(selectedAccountId, true);
      loadAccounts();
    } catch {
      alert("Failed to delete entry.");
    }
  }

  function openEditRule(rule: ManualAccountRule) {
    setRuleEditId(rule.id);
    setRuleName(rule.name);
    setRuleTarget(rule.target_account_id);
    setRuleMatchType(rule.match_type);
    setRuleMatchValue(rule.match_value);
    setRuleSign(rule.sign);
    setRuleError(null);
    setRuleModalOpen(true);
  }

  async function saveRule() {
    const name = ruleName.trim();
    const matchValue = ruleMatchValue.trim();
    if (!name) { setRuleError("Give the rule a name"); return; }
    if (!ruleTarget) { setRuleError("Pick an offline account"); return; }
    if (!matchValue) { setRuleError("Enter what to match on"); return; }
    setRuleSaving(true);
    setRuleError(null);
    try {
      if (ruleEditId) {
        await api.updateManualAccountRule(ruleEditId, {
          name, match_type: ruleMatchType, match_value: matchValue, sign: ruleSign,
        });
      } else {
        await api.createManualAccountRule({
          name, target_account_id: ruleTarget,
          match_type: ruleMatchType, match_value: matchValue, sign: ruleSign,
        });
      }
      setRuleModalOpen(false);
      loadAccounts(); // balances changed via backfill / reverse+reapply
      if (selectedAccountId) await loadAccountTxns(selectedAccountId, true);
    } catch {
      setRuleError("Couldn't save. Please try again.");
    } finally {
      setRuleSaving(false);
    }
  }

  async function toggleRule(rule: ManualAccountRule) {
    try {
      const updated = await api.updateManualAccountRule(rule.id, { active: !rule.active });
      setRules(prev => prev.map(r => r.id === rule.id ? updated : r));
      loadAccounts();
      if (selectedAccountId) await loadAccountTxns(selectedAccountId, true);
    } catch {
      alert("Failed to update rule.");
    }
  }

  async function removeRule(id: string) {
    if (!window.confirm("Delete this rule? Its mirrored amounts will be reversed.")) return;
    try {
      await api.deleteManualAccountRule(id);
      setRules(prev => prev.filter(r => r.id !== id));
      loadAccounts();
      if (selectedAccountId) await loadAccountTxns(selectedAccountId, true);
    } catch {
      alert("Failed to delete rule.");
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

  // Backend already filters by region — accounts contains only the right source.
  // Manual (offline) accounts come back in /accounts too; they're shown in their
  // own editable section, so keep them out of the connected-bank list.
  const bankAccounts = accounts.filter(a => !a.manual);

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

  // Rules added from within an offline account are scoped to it (no picker).
  const inManualDetail = !!accounts.find(a => a.id === selectedAccountId)?.manual;

  // Modals shared by both the list and detail views (same component scope).
  const modals = (
    <>
      {showMpesaUpload && (
        <StatementUpload
          onSuccess={handleStatementSuccess}
          onClose={() => setShowMpesaUpload(false)}
        />
      )}
      {manualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => !manualSaving && setManualModalOpen(false)}>
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">
              {manualEditId ? "Edit offline account" : "Add offline account"}
            </h2>

            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Name</label>
            <input
              value={manualName}
              onChange={e => setManualName(e.target.value)}
              maxLength={60}
              placeholder="e.g. Cash ISA, Wallet, Store card"
              className="w-full mb-4 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Type</label>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {MANUAL_TYPES.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  onClick={() => setManualType(value)}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-semibold transition-all ${
                    manualType === value
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>

            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              {manualType === "credit_card" ? "Amount owed" : "Balance"}
            </label>
            <input
              value={manualBalance}
              onChange={e => setManualBalance(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full mb-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {manualError && <p className="text-xs text-rose-500 mb-2">{manualError}</p>}

            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setManualModalOpen(false)}
                disabled={manualSaving}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveManual}
                disabled={manualSaving}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-sm font-semibold text-white disabled:opacity-50"
              >
                {manualSaving ? "Saving…" : manualEditId ? "Save" : "Add account"}
              </button>
            </div>
          </div>
        </div>
      )}

      {manualTxModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => !manualTxSaving && setManualTxModalOpen(false)}>
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">
              {manualTxEditId ? "Edit transaction" : "Add transaction"}
            </h2>

            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Description</label>
            <input
              value={manualTxDesc}
              onChange={e => setManualTxDesc(e.target.value)}
              maxLength={120}
              placeholder="e.g. Cash deposit, Interest"
              className="w-full mb-4 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Direction</label>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {([
                { value: "credit" as const, label: "Money in" },
                { value: "debit" as const, label: "Money out" },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setManualTxType(value)}
                  className={`py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                    manualTxType === value
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex gap-3 mb-2">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Amount</label>
                <input
                  value={manualTxAmount}
                  onChange={e => setManualTxAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Date</label>
                <input
                  type="date"
                  value={manualTxDate}
                  onChange={e => setManualTxDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {manualTxError && <p className="text-xs text-rose-500 mb-2">{manualTxError}</p>}

            <div className="flex gap-2 mt-3">
              {manualTxEditId && (
                <button
                  onClick={() => { const id = manualTxEditId; setManualTxModalOpen(false); removeManualTx(id); }}
                  disabled={manualTxSaving}
                  className="px-4 py-2.5 rounded-xl border border-rose-200 dark:border-rose-800 text-sm font-semibold text-rose-500 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
              <button
                onClick={() => setManualTxModalOpen(false)}
                disabled={manualTxSaving}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveManualTx}
                disabled={manualTxSaving}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-sm font-semibold text-white disabled:opacity-50"
              >
                {manualTxSaving ? "Saving…" : manualTxEditId ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      {ruleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => !ruleSaving && setRuleModalOpen(false)}>
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">
              {ruleEditId ? "Edit rule" : "Add rule"}
            </h2>

            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Name</label>
            <input
              value={ruleName}
              onChange={e => setRuleName(e.target.value)}
              maxLength={60}
              placeholder="e.g. Credit card repayments"
              className="w-full mb-4 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {!inManualDetail && (
              <>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Offline account</label>
                <CustomSelect
                  value={ruleTarget}
                  onChange={v => setRuleTarget(v)}
                  options={manualAccounts.map(a => ({ value: a.id, label: a.name }))}
                  className="w-full mb-4"
                />
              </>
            )}

            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Match transactions by</label>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {([
                { value: "description_contains" as RuleMatchType, label: "Description" },
                { value: "category" as RuleMatchType, label: "Category" },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setRuleMatchType(value)}
                  className={`py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                    ruleMatchType === value
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              value={ruleMatchValue}
              onChange={e => setRuleMatchValue(e.target.value)}
              maxLength={80}
              placeholder={ruleMatchType === "category" ? "e.g. Groceries" : "e.g. AMEX PAYMENT"}
              className="w-full mb-4 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Effect on offline account</label>
            <div className="grid grid-cols-2 gap-2 mb-1">
              {([
                { value: "opposite" as RuleSign, label: "Offset", hint: "Posts the opposite amount" },
                { value: "same" as RuleSign, label: "Shadow", hint: "Posts the same amount" },
              ]).map(({ value, label, hint }) => (
                <button
                  key={value}
                  onClick={() => setRuleSign(value)}
                  className={`flex flex-col items-center gap-0.5 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                    ruleSign === value
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {label}
                  <span className="text-[10px] font-normal opacity-80">{hint}</span>
                </button>
              ))}
            </div>

            {ruleError && <p className="text-xs text-rose-500 mt-2">{ruleError}</p>}

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setRuleModalOpen(false)}
                disabled={ruleSaving}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveRule}
                disabled={ruleSaving}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-sm font-semibold text-white disabled:opacity-50"
              >
                {ruleSaving ? "Saving…" : ruleEditId ? "Save" : "Add rule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // --- Account detail view ---
  if (selectedAccount) {
    const isCredit = selectedAccount.type.toLowerCase().includes("credit");
    const balance = selectedAccount.balance;
    const isManual = !!selectedAccount.manual;
    const isStatement = selectedAccount.id.startsWith("statement-");
    const manualAcc = manualAccounts.find(m => m.id === selectedAccount.id);
    const accountRules = rules.filter(r => r.target_account_id === selectedAccount.id);
    const showTransactions = isManual ? detailSegment === "Transactions" : segment === "Transactions";
    // Carry the provider's brand colour through from the card the user tapped
    // (same key normalization as AccountMiniCard)
    const providerBg = BANK_META[(selectedAccount.provider || "").toUpperCase().replace(/[\s-]+/g, "_")]?.bg
      ?? "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)";

    return (
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-20 lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        {/* Header */}
        <div
          className="mx-4 mt-4 rounded-3xl px-4 pt-5 pb-6 text-white"
          style={{ background: providerBg }}
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
              {isManual ? (
                <button
                  onClick={() => manualAcc && openEditManual(manualAcc)}
                  className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-xl text-xs font-semibold text-white/90 transition-colors"
                >
                  <Pencil size={13} />
                  Edit
                </button>
              ) : isStatement ? (
                <button
                  onClick={() => setShowMpesaUpload(true)}
                  className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-xl text-xs font-semibold text-white/90 transition-colors"
                >
                  <Upload size={13} />
                  Add statement
                </button>
              ) : (
                <button
                  onClick={() => handleReconnect(selectedAccount?.provider_id, selectedAccount)}
                  className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-xl text-xs font-semibold text-white/90 transition-colors"
                >
                  <RefreshCw size={13} />
                  Reconnect
                </button>
              )}
              <button
                onClick={async () => {
                  if (isManual) {
                    if (!window.confirm("Remove this offline account?")) return;
                    await api.deleteManualAccount(selectedAccount.id);
                    setManualAccounts(prev => prev.filter(a => a.id !== selectedAccount.id));
                    loadAccounts();
                    handleBack();
                  } else {
                    handleDeleteAccount();
                  }
                }}
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
              {typeLabel(selectedAccount.type, selectedAccount.subtype)}
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
          {isManual ? (
            <SegmentedControl
              options={["Transactions", "Rules"]}
              value={detailSegment}
              onChange={(v) => setDetailSegment(v as typeof detailSegment)}
            />
          ) : (
            <SegmentedControl
              options={["Transactions", "Categories"]}
              value={segment}
              onChange={(v) => setSegment(v as typeof segment)}
            />
          )}
        </div>

        <div className="px-4 pt-4 space-y-2">
          {loadingTxns === selectedAccountId ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={32} />
            </div>
          ) : showTransactions ? (
            <>
              {isManual && (
                <div className="flex justify-end pb-1">
                  <button
                    onClick={openAddManualTx}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white px-3 py-2 rounded-xl text-xs font-semibold"
                  >
                    <Plus size={14} />
                    Add transaction
                  </button>
                </div>
              )}
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
                {pagedTxns.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-slate-400 dark:text-slate-500">
                      {isManual ? "No transactions yet — add one or set up a rule." : "No transactions"}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-50 dark:divide-slate-700">
                    {pagedTxns.map((tx) => {
                      const isMirror = tx.id.startsWith("mirror:");
                      return (
                        <TransactionRow
                          key={tx.id}
                          transaction={tx}
                          onClick={() => {
                            if (!isManual) { setSelectedTx(tx); return; }
                            if (!isMirror) openEditManualTx(tx);
                          }}
                        />
                      );
                    })}
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
          ) : isManual ? (
            /* Rules view (offline accounts) */
            <>
              <div className="flex items-center justify-between pb-1">
                <p className="text-xs text-slate-400 dark:text-slate-500 pr-3">
                  Auto-post matching transactions to this account.
                </p>
                <button
                  onClick={openAddRule}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white px-3 py-2 rounded-xl text-xs font-semibold flex-shrink-0"
                >
                  <Plus size={14} />
                  Add rule
                </button>
              </div>
              {accountRules.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 text-center shadow-sm">
                  <p className="text-sm text-slate-400 dark:text-slate-500">No rules yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {accountRules.map((rule) => (
                    <div key={rule.id} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-semibold truncate ${rule.active ? "text-slate-800 dark:text-slate-100" : "text-slate-400 dark:text-slate-500 line-through"}`}>{rule.name}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
                          {rule.match_type === "category" ? "Category" : "Contains"} “{rule.match_value}” · {rule.sign === "opposite" ? "Offset" : "Shadow"}
                        </p>
                      </div>
                      <button
                        onClick={() => toggleRule(rule)}
                        title={rule.active ? "Pause rule" : "Resume rule"}
                        className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full flex-shrink-0 ${rule.active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-slate-100 text-slate-400 dark:bg-slate-700"}`}
                      >
                        {rule.active ? "On" : "Off"}
                      </button>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => openEditRule(rule)} className="p-1.5 text-slate-400 hover:text-indigo-500" title="Edit">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => removeRule(rule.id)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
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

        {modals}
        <BottomNav />
      </div>
    );
  }

  // --- Account list view ---
  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-20" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Header */}
      <div
        className="mx-4 mt-4 rounded-3xl px-4 pt-5 pb-6 bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700"
      >
        <div className="mb-4">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Accounts</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {bankAccounts.length} bank · {investmentAccounts.length} investment
            {manualAccounts.length > 0 && ` · ${manualAccounts.length} offline`}
          </p>
        </div>

        {/* Context-aware action buttons */}
        {tab === "Banks" ? (
          region === "UK" ? (
            <div className="grid grid-cols-3 gap-2 mb-4">
              <button
                data-tutorial-id="tutorial-add-account"
                onClick={() => setShowBankPicker(true)}
                className="flex items-center justify-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 active:scale-95 transition-all px-2 py-2.5 rounded-xl text-xs font-semibold text-indigo-700 dark:text-indigo-300"
              >
                <Plus size={14} />
                Add Bank
              </button>
              <button
                data-tutorial-id="tutorial-upload-statement"
                onClick={() => setShowMpesaUpload(true)}
                className="flex items-center justify-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 active:scale-95 transition-all px-2 py-2.5 rounded-xl text-xs font-semibold text-indigo-700 dark:text-indigo-300"
              >
                <Upload size={14} />
                Statement
              </button>
              <button
                onClick={openAddManual}
                className="flex items-center justify-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 active:scale-95 transition-all px-2 py-2.5 rounded-xl text-xs font-semibold text-indigo-700 dark:text-indigo-300"
              >
                <Plus size={14} />
                Offline
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 mb-4">
              <MonoConnectWidget onSuccess={handleMonoSuccess}>
                {(open, monoLoading) => (
                  <button
                    onClick={open}
                    disabled={monoLoading}
                    className="flex items-center justify-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 active:scale-95 transition-all px-2 py-2.5 rounded-xl text-xs font-semibold text-indigo-700 dark:text-indigo-300"
                  >
                    <Plus size={14} />
                    {monoLoading ? "Opening…" : "Mono"}
                  </button>
                )}
              </MonoConnectWidget>
              <button
                onClick={() => setShowMpesaUpload(true)}
                className="flex items-center justify-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 active:scale-95 transition-all px-2 py-2.5 rounded-xl text-xs font-semibold text-indigo-700 dark:text-indigo-300"
              >
                <Upload size={14} />
                Statement
              </button>
              <button
                onClick={openAddManual}
                className="flex items-center justify-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 active:scale-95 transition-all px-2 py-2.5 rounded-xl text-xs font-semibold text-indigo-700 dark:text-indigo-300"
              >
                <Plus size={14} />
                Offline
              </button>
            </div>
          )
        ) : (
          <button
            onClick={() => setShowInvestmentUpload(true)}
            className="flex w-full items-center justify-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 active:scale-95 transition-all px-2 py-2.5 rounded-xl text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-4"
          >
            <Upload size={14} />
            Upload Statement
          </button>
        )}

        {/* Tab bar */}
        <div className="flex bg-slate-100 dark:bg-slate-700 rounded-xl p-1 gap-1">
          {(["Banks", "Investments"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                tab === t
                  ? "bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {/* Spacer so the tab bar sits flush with the page edge */}
        <div className="h-4" />
      </div>

      {/* ── Banks tab ── */}
      {tab === "Banks" && (
        <>
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
            ) : bankAccounts.length === 0 ? (
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
                      {(open, monoLoading) => (
                        <button
                          onClick={open}
                          disabled={monoLoading}
                          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white font-semibold px-5 py-3 rounded-xl text-sm"
                        >
                          <Plus size={16} />
                          {monoLoading ? "Opening…" : "Connect via Mono"}
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
              <>
                {pinMsg && (
                  <div className="mb-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-xs font-medium text-amber-700 dark:text-amber-300">
                    {pinMsg}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {bankAccounts.map((acc) => (
                    <AccountMiniCard
                      key={acc.id}
                      account={acc}
                      grid
                      hidden={hideNetWorth}
                      pinned={pinnedIds.includes(acc.id)}
                      onTogglePin={() => togglePin(acc.id)}
                      onClick={() => handleSelectAccount(acc)}
                      onReconnect={() => handleReconnect(acc.provider_id, acc)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── Offline accounts ── */}
          <div className="px-4 pt-6">
            <div className="mb-2">
              <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">Offline accounts</h2>
              <p className="text-xs text-slate-400 dark:text-slate-500">Track balances we can&apos;t connect to — pots, cash, store cards. Tap to add transactions &amp; rules.</p>
            </div>

            {manualAccounts.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 text-center shadow-sm">
                <p className="text-sm text-slate-400 dark:text-slate-500">No offline accounts yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {manualAccounts.map((acc) => {
                  const meta = MANUAL_TYPES.find(t => t.value === acc.account_type) ?? MANUAL_TYPES[0];
                  const isCredit = acc.account_type === "credit_card";
                  const currency = region === "Kenya" ? "KES " : "£";
                  const accountForDetail = accounts.find(a => a.id === acc.id);
                  return (
                    <div
                      key={acc.id}
                      onClick={() => accountForDetail && handleSelectAccount(accountForDetail)}
                      className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm flex items-center gap-3 px-4 py-3 cursor-pointer active:scale-[0.99] transition-transform"
                    >
                      <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                        <meta.Icon size={16} className="text-slate-500 dark:text-slate-300" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{acc.name}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">{meta.label} · Offline</p>
                      </div>
                      <span className={`text-sm font-bold flex-shrink-0 ${isCredit ? "text-rose-500" : "text-slate-800 dark:text-slate-100"}`}>
                        {hideNetWorth ? "••••" : `${isCredit ? "-" : ""}${currency}${acc.balance.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </span>
                      <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Investments tab ── */}
      {tab === "Investments" && (
        <div className="px-4 pt-4 space-y-3">
          {investmentAccounts.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-10 text-center shadow-sm">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 mb-4">
                <TrendingUp size={26} color="#4f46e5" />
              </div>
              <p className="text-slate-800 dark:text-slate-100 font-semibold mb-1">No investment accounts</p>
              <p className="text-slate-400 dark:text-slate-500 text-sm mb-5">
                Upload a quarterly statement from Vanguard, Wealthify, Hargreaves Lansdown, Fidelity, or AJ Bell.
              </p>
              <button
                onClick={() => setShowInvestmentUpload(true)}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white font-semibold px-5 py-3 rounded-xl text-sm"
              >
                <Upload size={16} />
                Upload Statement
              </button>
            </div>
          ) : (
            investmentAccounts.map(inv => {
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
            })
          )}
        </div>
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

      {modals}

      <BottomNav />
    </div>
  );
}
