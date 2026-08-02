"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { ArrowLeft, Plus, Landmark, RefreshCw, Upload, Trash2, AlertTriangle, TrendingUp, TrendingDown, Eye, EyeOff, ChevronDown, ChevronUp, ChevronRight, Pencil, PiggyBank, Wallet, CreditCard, Search, X } from "lucide-react";
import { api, Account, Transaction, InvestmentAccount, InvestmentHolding, ManualAccount, ManualAccountType, ManualAccountRule, RuleMatchType, RuleSign, AccountCategorySummary, KPIs } from "@/lib/api";
import AccountMiniCard, { BANK_META, accountBrand } from "@/components/AccountMiniCard";
import TransactionRow from "@/components/TransactionRow";
import TransactionSheet from "@/components/TransactionSheet";
import { CategoryData } from "@/components/CategoryRow";
import CategorySheet from "@/components/CategorySheet";
import { useColours } from "@/components/ColourProvider";
import { useCategoryIcons } from "@/components/IconProvider";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import SegmentedControl from "@/components/SegmentedControl";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import MonoConnectWidget from "@/components/MonoConnect";
import StatementUpload from "@/components/StatementUpload";
import InvestmentUpload from "@/components/InvestmentUpload";
import BankPickerSheet from "@/components/BankPickerSheet";
import { usePreferences } from "@/components/PreferencesContext";
import CustomSelect from "@/components/CustomSelect";
import { createPortal } from "react-dom";
import { getAllTransactionsCached } from "@/lib/useAllTransactions";

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

/** Value to store as a rule's match_value when the user picks a transaction.
 *
 *  The backend matches with `match_value in (description + " " + merchant_name).lower()`
 *  — plain substring containment. So whatever we store MUST still be a literal
 *  substring of that haystack. That rules out reusing the existing key helpers
 *  (backend `normalise_merchant`, `_description_stem`): they SPLICE — dropping
 *  internal date fragments and rewriting punctuation to spaces — which yields a
 *  string that is no longer a substring ("TESCO 29MAY STORES" -> "TESCO STORES",
 *  "A/C 76526682" -> "a c 76526682") and would match nothing.
 *
 *  So: prefer merchant_name (always in the haystack, stable across future
 *  transactions from the same merchant); otherwise TRUNCATE the description at the
 *  first token that varies between cycles. Truncation keeps a leading substring,
 *  which can only ever broaden the match — never break it.
 *
 *  Everything from the first digit onward is per-transaction noise: amounts
 *  ("AMOUNT IN USD 14.40"), FX rates, dates, card and reference numbers, store
 *  codes. Cutting at the first digit-bearing token (or at a leading "ON <date>"
 *  fragment, whichever comes first) leaves the stable merchant stem.
 */
const DATE_FRAG = /\b(?:ON\s+)?\d{1,2}\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:\s*\d{2,4})?\b/i;
const FIRST_NUMERIC = /\b\d/;
/** Statement connectives and ISO currency codes left dangling by the cut. */
const TAIL_NOISE = /(?:^|\s)(?:ON|AT|IN|TO|VIA|REF|FROM|CARD|VISA|AMOUNT|GBP|USD|EUR|FT|CPM|BCC|BGC|DDR|STO|CLP|CB|FP|FPI|FPO|BP|TFR|DD|SO)\s*$/i;

function ruleValueFor(tx: Transaction): string {
  const merchant = (tx.merchant_name ?? "").trim();
  if (merchant) return merchant.slice(0, 80);
  const desc = (tx.description ?? "").trim();
  if (!desc) return "";
  const cuts = [DATE_FRAG, FIRST_NUMERIC]
    .map(re => desc.search(re))
    .filter(i => i > 0);
  let stem = (cuts.length ? desc.slice(0, Math.min(...cuts)) : desc).trim();
  // Peel dangling connectives/currency codes, then trailing punctuation.
  let prev = "";
  while (stem !== prev && stem.length > 3) {
    prev = stem;
    stem = stem.replace(TAIL_NOISE, "").trim();
  }
  stem = stem.replace(/[\s\-–,/&.]+$/, "").trim();
  // Too short to be a meaningful merchant stem — keep the raw description.
  return (stem.length >= 3 ? stem : desc).slice(0, 80);
}

const PAGE_SIZE = 20;

const MANUAL_TYPES: { value: ManualAccountType; label: string; Icon: typeof Wallet }[] = [
  { value: "savings",     label: "Savings",     Icon: PiggyBank },
  { value: "current",     label: "Current",     Icon: Wallet },
  { value: "credit_card", label: "Credit card", Icon: CreditCard },
];

export default function AccountsPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  // Set to true for exactly one effect run after we strip ?id= via router.replace
  // so the else-branch (clear selectedAccountId) doesn't fire on our own replace.
  const consumedDeepLink = useRef(false);
  const { hideNetWorth, setHideNetWorth, region } = usePreferences();
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
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

  // Transaction search state for description_contains rule building
  const [ruleSearchResults, setRuleSearchResults] = useState<Transaction[]>([]);
  const [ruleSearchOpen, setRuleSearchOpen] = useState(false);
  const [ruleMatchCount, setRuleMatchCount] = useState<number | null>(null);
  const [rulePool, setRulePool] = useState<Transaction[] | null>(null);

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

  // Custom confirm dialog (replaces native window.confirm)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean; message: string; resolve: (v: boolean) => void;
  } | null>(null);

  function showConfirm(message: string): Promise<boolean> {
    return new Promise(resolve => {
      setConfirmDialog({ open: true, message, resolve });
    });
  }

  function handleConfirmClose(result: boolean) {
    confirmDialog?.resolve(result);
    setConfirmDialog(null);
  }

  // Transaction search (server-side for bank accounts, debounced)
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Server-paginated transactions for the selected bank account
  const [serverTxns, setServerTxns] = useState<Transaction[]>([]);
  const [serverPages, setServerPages] = useState(1);
  const [refreshTick, setRefreshTick] = useState(0);

  // Server-aggregated category rollup + lazily-fetched per-category txns
  const [catSummaries, setCatSummaries] = useState<AccountCategorySummary[] | null>(null);
  const [catTxns, setCatTxns] = useState<Record<string, Transaction[]>>({});

  // Swipe between transaction pages
  const swipeTouchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Lazy-load the transaction pool when the rule modal opens in description mode
  useEffect(() => {
    if (!ruleModalOpen || ruleMatchType !== "description_contains" || rulePool !== null) return;
    let cancelled = false;
    getAllTransactionsCached()
      .then(data => { if (!cancelled) setRulePool(data); })
      .catch(() => { if (!cancelled) setRulePool([]); });
    return () => { cancelled = true; };
  }, [ruleModalOpen, ruleMatchType, rulePool]);

  // Debounced search + match count for description_contains rules
  useEffect(() => {
    if (ruleMatchType !== "description_contains" || !ruleMatchValue.trim() || rulePool === null) {
      setRuleSearchResults([]);
      setRuleMatchCount(null);
      return;
    }
    const t = setTimeout(() => {
      const v = ruleMatchValue.trim().toLowerCase();
      const hits = rulePool.filter(tx =>
        `${tx.description ?? ""} ${tx.merchant_name ?? ""}`.toLowerCase().includes(v)
      );
      setRuleMatchCount(hits.length);
      if (ruleSearchOpen) {
        // Dedupe by ruleValueFor key, keep first (newest), slice to 6
        const seen = new Set<string>();
        const deduped: Transaction[] = [];
        for (const tx of hits) {
          const key = ruleValueFor(tx).toLowerCase();
          if (!seen.has(key)) { seen.add(key); deduped.push(tx); }
          if (deduped.length >= 6) break;
        }
        setRuleSearchResults(deduped);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [ruleMatchValue, ruleMatchType, rulePool, ruleSearchOpen, ruleModalOpen]);

  const anyModalOpen = manualModalOpen || manualTxModalOpen || ruleModalOpen || !!confirmDialog?.open;
  useEffect(() => {
    const el = document.getElementById("app-shell");
    if (anyModalOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      if (el) el.classList.add("sheet-open");
      return () => {
        document.body.style.overflow = prev;
        if (el) el.classList.remove("sheet-open");
      };
    }
  }, [anyModalOpen]);

  const loadAccounts = useCallback(async () => {
    try {
      const [accs, invAccs, manuals, mrules, kpiResult] = await Promise.all([
        api.accounts().catch(() => [] as Account[]),
        api.getInvestmentAccounts().catch(() => [] as InvestmentAccount[]),
        api.manualAccounts().catch(() => [] as ManualAccount[]),
        api.manualAccountRules().catch(() => [] as ManualAccountRule[]),
        api.kpis().catch(() => null),
      ]);
      setAccounts(accs);
      setInvestmentAccounts(invAccs);
      setManualAccounts(manuals);
      setRules(mrules);
      setKpis(kpiResult);

      // Validate reconnect: check if the newly connected account matches what was expected
      const raw = localStorage.getItem("reconnect_expected");
      if (raw) {
        try {
          const expected = JSON.parse(raw) as { provider: string; account_number: string; sort_code: string | null };
          localStorage.removeItem("reconnect_expected");
          const masked = (n: string) => `••••${(n ?? "").slice(-4)}`;
          const providerAccts = accs.filter(a =>
            a.provider.toUpperCase() === expected.provider.toUpperCase() &&
            a.status === "connected" &&
            !!a.account_number
          );
          // Only warn if the account we set out to reconnect is genuinely missing
          // from what came back (match on full number or last-4, since a bank can
          // legitimately have several accounts under one connection).
          const expectedPresent = providerAccts.some(a =>
            a.account_number === expected.account_number ||
            masked(a.account_number as string) === masked(expected.account_number)
          );
          if (providerAccts.length > 0 && !expectedPresent) {
            const got = providerAccts.map(a => masked(a.account_number as string)).join(", ");
            setReconnectWarning(
              `We couldn't find your ${expected.provider} account ${masked(expected.account_number)} in what was reconnected (found ${got}). If this is wrong, remove it and reconnect again.`
            );
          }
        } catch { /* ignore parse errors */ }
      }
    } catch {}
    finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Keep selectedAccountId in lockstep with the ?id= deep link.
  //
  // WHY window.location.search instead of searchParams.get():
  // Next.js App Router caches RSC payloads per URL. On the round-trip
  //   Home → /accounts?id=X  (mini-card)  → Home → /accounts  (Manage button)
  // the router reuses the cached component instance. When it does, the
  // `searchParams` object reference React delivers may be the *same* reference
  // it delivered during a prior visit to /accounts (no ?id), so the effect dep
  // hasn't changed and React skips re-running it — leaving selectedAccountId
  // stuck at the value set during the ?id=X visit.
  // Reading window.location.search bypasses the stale hook value entirely and
  // always reflects the real URL at effect-run time.
  // (Doc: instant-navigation.md §"client-side hooks behave differently";
  //  use-search-params.md §"Good to know: not supported in Server Components
  //  to prevent stale values during partial rendering")
  //
  // WHY pathname in deps:
  // Pairing `pathname` with `searchParams` in the dep array ensures the effect
  // re-fires whenever the router records a navigation to this pathname, even
  // when the searchParams reference is stable.
  //
  // WHY consumedDeepLink ref:
  // After we consume ?id=X we immediately call router.replace("/accounts") to
  // strip the param. That replace triggers one more effect run with
  // window.location.search === "" — without the guard the else-branch would
  // clear selectedAccountId right after we just set it. The ref skips the
  // clear for exactly that one follow-up run.
  useEffect(() => {
    if (consumedDeepLink.current) {
      consumedDeepLink.current = false;
      return;
    }
    // Use the live URL, not the potentially-stale hook value.
    const deepId = new URLSearchParams(window.location.search).get("id");
    if (deepId) {
      setSelectedAccountId(deepId);
      setSegment("Transactions");
      setPage(1);
      setLoadingTxns(deepId);
      // Strip the param so no cache node retains ?id=X. Mark the ref first so
      // the replace-triggered re-run of this effect skips the else-branch.
      consumedDeepLink.current = true;
      router.replace("/accounts", { scroll: false });
    } else {
      setSelectedAccountId(null);
    }
  }, [pathname, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const isManual = accounts.find(a => a.id === accountId)?.manual;
    if (!isManual) {
      // Bank accounts are server-paginated — nudge the fetch effect instead
      setRefreshTick(t => t + 1);
      return;
    }
    if (txnMap[accountId] && !force) return;
    setLoadingTxns(accountId);
    try {
      const txns = await api.manualTransactions(accountId);
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
    setSearchQuery("");
    setDebouncedQuery("");
    setServerTxns([]);
    setServerPages(1);
    setCatSummaries(null);
    setCatTxns({});
    if (acc.manual) {
      await loadAccountTxns(acc.id);
    } else {
      setLoadingTxns(acc.id); // fetch effect clears this after page 1 arrives
    }
  }

  // Fetch the current page for the selected bank account whenever the page,
  // search query or refresh tick changes. Manual accounts keep their full
  // (tiny) client-side ledger.
  useEffect(() => {
    if (!selectedAccountId) return;
    const acc = accounts.find(a => a.id === selectedAccountId);
    if (!acc || acc.manual) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.transactions(selectedAccountId, {
          page, q: debouncedQuery || undefined,
        });
        if (cancelled) return;
        setServerTxns(r.items);
        setServerPages(r.pages);
      } catch {}
      finally {
        if (!cancelled) setLoadingTxns(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, page, debouncedQuery, refreshTick, accounts]);

  // Category rollup is fetched lazily, first time the Categories tab opens
  useEffect(() => {
    if (!selectedAccountId || segment !== "Categories" || catSummaries !== null) return;
    const acc = accounts.find(a => a.id === selectedAccountId);
    if (!acc || acc.manual) return;
    api.accountCategories(selectedAccountId)
      .then(setCatSummaries)
      .catch(() => setCatSummaries([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, segment, catSummaries, accounts]);

  async function openCategorySheet(name: string) {
    setExpandedCat(name);
    if (!catTxns[name] && selectedAccountId) {
      try {
        // Same 90-day debit-only window as the rollup, so counts and rows agree
        const r = await api.transactions(selectedAccountId, {
          category: name, pageSize: 100, days: 90, txnType: "debit",
        });
        setCatTxns(prev => ({ ...prev, [name]: r.items }));
      } catch {}
    }
  }

  function handleBack() {
    if (window.history.state?.accountDetail) {
      // Consume the history entry pushed on open — popstate closes the view,
      // keeping the in-app arrow and the system back gesture in sync.
      // For in-page opens (handleSelectAccount) this returns to the list.
      // For deep-linked opens the effect already stripped ?id= via router.replace,
      // so this entry's URL is /accounts — back returns to wherever the user
      // came from (e.g. Home).
      window.history.back();
    } else {
      // Post-delete or any case where no pushState entry was recorded.
      // ?id= was already stripped by the effect's router.replace, so no
      // URL scrub needed here — just clear state.
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
    const confirmed = await showConfirm("Remove this account and all its transactions?");
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
    if (!await showConfirm("Remove this offline account?")) return;
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
    setRuleSearchOpen(false);
    setRuleSearchResults([]);
    setRuleMatchCount(null);
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
    if (!await showConfirm("Delete this entry?")) return;
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
    setRuleSearchOpen(false);
    setRuleSearchResults([]);
    setRuleMatchCount(null);
    setRuleModalOpen(true);
  }

  function pickRuleTransaction(tx: Transaction) {
    setRuleMatchValue(ruleValueFor(tx));
    setRuleSearchOpen(false);
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
      setRuleSearchOpen(false);
      setRuleSearchResults([]);
      setRuleMatchCount(null);
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
    if (!await showConfirm("Delete this rule? Its mirrored amounts will be reversed.")) return;
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
    if (!await showConfirm("Remove this investment account and all its holdings?")) return;
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
    const apply = (t: Transaction) =>
      t.id === updated.id || additionalIds?.includes(t.id)
        ? { ...t, category: updated.category }
        : t;
    setServerTxns(prev => prev.map(apply));
    // Category totals shifted — drop the rollup so it refetches on next view
    setCatSummaries(null);
    setCatTxns({});
  }

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const isManualSelected = !!selectedAccount?.manual;
  const accountTxns = selectedAccountId ? (txnMap[selectedAccountId] ?? []) : [];

  // Manual accounts: tiny hand-entered ledgers, filtered and paged client-side.
  // Bank accounts: server-paginated, search included in the query.
  const filteredTxns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return accountTxns;
    return accountTxns.filter(tx =>
      (tx.description ?? "").toLowerCase().includes(q) ||
      (tx.merchant_name ?? "").toLowerCase().includes(q) ||
      (tx.category ?? "").toLowerCase().includes(q)
    );
  }, [accountTxns, searchQuery]);

  const totalPages = isManualSelected
    ? Math.ceil(filteredTxns.length / PAGE_SIZE)
    : serverPages;
  const pagedTxns = isManualSelected
    ? filteredTxns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : serverTxns;

  // Categories: server rollup + lazily-fetched transactions per category
  const categories = useMemo((): CategoryData[] =>
    (catSummaries ?? []).map(c => ({ ...c, transactions: catTxns[c.name] ?? [] })),
  [catSummaries, catTxns]);

  // Rules added from within an offline account are scoped to it (no picker).
  const inManualDetail = !!accounts.find(a => a.id === selectedAccountId)?.manual;

  const [modalsMounted, setModalsMounted] = useState(false);
  useEffect(() => setModalsMounted(true), []);

  // Modals shared by both the list and detail views (same component scope).
  const modals = (
    <>
      {confirmDialog?.open && modalsMounted && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-6">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-xs rounded-2xl p-6 shadow-2xl">
            <p className="text-sm text-slate-100 leading-relaxed mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleConfirmClose(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-600 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirmClose(true)}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-sm font-semibold text-white transition-colors"
              >
                {confirmDialog.message.trimStart().startsWith("Delete") ? "Delete" : "Remove"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {showMpesaUpload && (
        <StatementUpload
          onSuccess={handleStatementSuccess}
          onClose={() => setShowMpesaUpload(false)}
        />
      )}
      {manualModalOpen && modalsMounted && createPortal(
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40" onClick={() => !manualSaving && setManualModalOpen(false)}>
          <div className="glass-sheet w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[85dvh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0 sm:hidden">
              <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
            </div>
            {/* Header */}
            <div className="px-5 pt-4 pb-2 flex-shrink-0">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {manualEditId ? "Edit offline account" : "Add offline account"}
              </h2>
            </div>
            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-5 pb-5" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 mt-3">Name</label>
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
        </div>,
        document.body
      )}

      {manualTxModalOpen && modalsMounted && createPortal(
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40" onClick={() => !manualTxSaving && setManualTxModalOpen(false)}>
          <div className="glass-sheet w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[85dvh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0 sm:hidden">
              <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
            </div>
            {/* Header */}
            <div className="px-5 pt-4 pb-2 flex-shrink-0">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {manualTxEditId ? "Edit transaction" : "Add transaction"}
              </h2>
            </div>
            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-5" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 mt-3">Description</label>
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
        </div>,
        document.body
      )}

      {ruleModalOpen && modalsMounted && createPortal(
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40" onClick={() => { if (!ruleSaving) { setRuleModalOpen(false); setRuleSearchOpen(false); setRuleSearchResults([]); setRuleMatchCount(null); } }}>
          <div className="glass-sheet w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[85dvh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0 sm:hidden">
              <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
            </div>
            {/* Header */}
            <div className="px-5 pt-4 pb-2 flex-shrink-0">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {ruleEditId ? "Edit rule" : "Add rule"}
              </h2>
            </div>
            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-5" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 mt-3">Name</label>
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
              {ruleMatchType === "category" ? (
                <input
                  value={ruleMatchValue}
                  onChange={e => setRuleMatchValue(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. Groceries"
                  className="w-full mb-4 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              ) : (
                <div
                  className="mb-4"
                  onBlur={e => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setRuleSearchOpen(false);
                    }
                  }}
                >
                  <input
                    value={ruleMatchValue}
                    onChange={e => { setRuleMatchValue(e.target.value); setRuleSearchOpen(true); }}
                    onFocus={() => setRuleSearchOpen(true)}
                    maxLength={80}
                    placeholder="Search your transactions"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {ruleSearchOpen && ruleSearchResults.length > 0 && (
                    <div className="glass-tile rounded-xl overflow-hidden mt-2 divide-y divide-slate-200/60 dark:divide-slate-700/40">
                      {ruleSearchResults.map(tx => (
                        <TransactionRow key={tx.id} transaction={tx} onClick={() => pickRuleTransaction(tx)} />
                      ))}
                    </div>
                  )}
                  {ruleMatchValue.trim() && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                      {rulePool === null ? (
                        "Checking…"
                      ) : ruleMatchCount === null ? null : ruleMatchCount === 0 ? (
                        "No transactions match this yet"
                      ) : (
                        <>Matches <span className="text-emerald-600 dark:text-emerald-400 font-medium">{ruleMatchCount}</span> {ruleMatchCount === 1 ? "transaction" : "transactions"}</>
                      )}
                    </p>
                  )}
                </div>
              )}

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
                  onClick={() => { setRuleModalOpen(false); setRuleSearchOpen(false); setRuleSearchResults([]); setRuleMatchCount(null); }}
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
        </div>,
        document.body
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
    // Use the shared brand resolver so Finexer accounts (logo_url/bg_colors) get
    // the same branding as the card, and TrueLayer accounts fall through to BANK_META.
    const brand = accountBrand(selectedAccount);
    const providerBg = brand.background;
    const headerTextColor = brand.textOnBrand;

    return (
      <div className="min-h-dvh pb-20 lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        {/* Header */}
        <div
          className="mx-4 mt-4 rounded-3xl px-4 pt-5 pb-6"
          style={{ background: providerBg, color: headerTextColor }}
        >
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 transition-colors"
              style={{ color: headerTextColor === "#fff" ? "rgba(255,255,255,0.8)" : "rgba(15,23,42,0.6)" }}
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
                    if (!await showConfirm("Remove this offline account?")) return;
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
              className="text-2xl font-bold"
              style={{ color: balance < 0 ? (headerTextColor === "#fff" ? "#fca5a5" : "#b91c1c") : headerTextColor }}
            >
              {hideNetWorth ? "••••" : `${balance < 0 ? "-" : ""}${selectedAccount.currency === "KES" ? "KES " : "£"}${Math.abs(balance).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </span>
          </div>
        </div>

        {/* Segmented control */}
        <div className="px-4 pt-4">
          {isManual ? (
            <SegmentedControl
              ariaLabel="Account view"
              options={["Transactions", "Rules"]}
              value={detailSegment}
              onChange={(v) => setDetailSegment(v as typeof detailSegment)}
            />
          ) : (
            <SegmentedControl
              ariaLabel="Account view"
              options={["Transactions", "Categories"]}
              value={segment}
              onChange={(v) => setSegment(v as typeof segment)}
            />
          )}
        </div>

        <div className="px-4 pt-4 space-y-2">
          {/* Search bar — only shown when viewing transactions */}
          {showTransactions && (
            <div className="relative mb-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                placeholder="Search transactions…"
                className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); setPage(1); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

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
              <div
                className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden"
                onTouchStart={e => {
                  swipeTouchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                }}
                onTouchEnd={e => {
                  if (!swipeTouchStart.current || totalPages <= 1) return;
                  const dx = e.changedTouches[0].clientX - swipeTouchStart.current.x;
                  const dy = e.changedTouches[0].clientY - swipeTouchStart.current.y;
                  swipeTouchStart.current = null;
                  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
                  if (dx < 0 && page < totalPages) setPage(p => p + 1);
                  if (dx > 0 && page > 1) setPage(p => p - 1);
                }}
              >
                {pagedTxns.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-slate-400 dark:text-slate-500">
                      {searchQuery
                        ? `No transactions matching "${searchQuery}"`
                        : isManual ? "No transactions yet — add one or set up a rule." : "No transactions"}
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
                        className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full flex-shrink-0 ${rule.active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}
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
            /* Categories view — same card grid as the Spend page */
            catSummaries === null ? (
              <div className="flex items-center justify-center py-16">
                <Spinner size={32} />
              </div>
            ) : categories.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
                <p className="text-sm text-slate-400 dark:text-slate-500">No spending data</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {categories.map((cat) => {
                  const colour = colours[cat.name] ?? CATEGORY_COLOURS[cat.name as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
                  const Icon = getCategoryIcon(cat.name, iconOverrides);
                  return (
                    <button
                      key={cat.name}
                      onClick={() => openCategorySheet(cat.name)}
                      className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 text-left active:scale-95 transition-transform flex flex-col gap-2 overflow-hidden"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${colour}26` }}
                        >
                          <Icon size={16} style={{ color: colour }} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">{cat.name}</p>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{cat.count} txn{cat.count !== 1 ? "s" : ""}</p>
                        </div>
                      </div>
                      <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                        £{cat.total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(cat.pct, 100)}%`, backgroundColor: colour }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Category sheet — opened from the category grid */}
        {expandedCat && (() => {
          const cat = categories.find(c => c.name === expandedCat);
          return cat ? (
            <CategorySheet
              name={cat.name}
              total={cat.total}
              count={cat.count}
              transactions={cat.transactions}
              onClose={() => setExpandedCat(null)}
              onTransactionClick={(tx) => { setExpandedCat(null); setSelectedTx(tx); }}
            />
          ) : null;
        })()}

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
    <div className="min-h-dvh pb-20" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Header */}
      <div
        className="mx-4 mt-4 rounded-3xl px-4 pt-5 pb-6 bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700"
      >
        <div className="mb-4">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Accounts</h1>
          {kpis && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mt-3">Net worth</p>
              <div className="flex items-center gap-2">
                <span
                  className="text-3xl font-bold tracking-tight num text-slate-900 dark:text-slate-100"
                  aria-label={hideNetWorth ? "Balance hidden" : undefined}
                >
                  {hideNetWorth
                    ? "••••••"
                    : `${kpis.net_worth < 0 ? "−" : ""}${region === "Kenya" ? "KES " : "£"}${Math.abs(kpis.net_worth).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}
                </span>
                {kpis.net_worth < 0
                  ? <TrendingDown size={16} strokeWidth={2} className="text-slate-400 dark:text-slate-500" />
                  : <TrendingUp size={16} strokeWidth={2} className="text-slate-400 dark:text-slate-500" />}
                <button
                  onClick={() => setHideNetWorth(!hideNetWorth)}
                  aria-label={hideNetWorth ? "Show balance" : "Hide balance"}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {hideNetWorth ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {(() => {
                const cardTotal = accounts
                  .filter(a => {
                    const t = (a.type ?? "").toLowerCase();
                    const s = (a.subtype ?? "").toLowerCase();
                    return t.includes("credit") || s.includes("credit");
                  })
                  .reduce((sum, a) => sum + Math.abs(Math.min(a.balance, 0)), 0);
                return cardTotal > 0 ? (
                  <p className="text-base font-semibold num text-slate-700 dark:text-slate-200 mt-0.5">
                    {hideNetWorth ? "−£••••" : `−£${cardTotal.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 ml-1.5">across cards</span>
                  </p>
                ) : null;
              })()}
            </>
          )}
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {bankAccounts.length} bank · {investmentAccounts.length} investment
            {manualAccounts.length > 0 && ` · ${manualAccounts.length} offline`}
          </p>
        </div>

        {/* Context-aware action buttons */}
        {tab === "Banks" ? (
          region === "UK" ? (
            <>
              <div className="grid grid-cols-3 gap-2 mb-2">
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
              <button
                onClick={async () => {
                  try {
                    const { auth_url } = await api.finexerConnectLink();
                    window.location.href = auth_url;
                  } catch {
                    // no-op; user stays on page
                  }
                }}
                className="flex w-full items-center justify-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 active:scale-95 transition-all px-2 py-2.5 rounded-xl text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-2"
              >
                <Plus size={14} />
                Finexer (beta)
              </button>
            </>
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
                      calm
                      glass
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
                      <ChevronRight size={16} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
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
                <div key={inv.id} className="glass-card rounded-2xl overflow-hidden">
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
                      {isExpanded ? <ChevronUp size={14} className="text-slate-500 dark:text-slate-400" /> : <ChevronDown size={14} className="text-slate-500 dark:text-slate-400" />}
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
