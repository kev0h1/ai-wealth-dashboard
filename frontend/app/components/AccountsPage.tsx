"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { ArrowLeft, Plus, Landmark, RefreshCw, Upload, Trash2, AlertTriangle, TrendingUp, Eye, EyeOff, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Pencil, PiggyBank, Wallet, CreditCard, Search, X, CircleDashed, Check, FileText, Star, Percent, Info } from "lucide-react";
import { api, Account, Transaction, InvestmentAccount, InvestmentHolding, InvestmentNote, ManualAccount, ManualAccountType, ManualAccountRule, RuleMatchType, RuleMatchField, RuleSign, AccountCategorySummary, KPIs, CardTermsCard } from "@/lib/api";
import { accountBrand, BankBadge, TermsPill } from "@/components/AccountMiniCard";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import { buildEstate, filterEstate, type EstateRow, type EstateLens } from "@/lib/accountsEstate";
import { accountKind, accountKindLabel } from "@/lib/accountKind";
import CardTermsSheet from "@/components/CardTermsSheet";
import { RadioDot } from "@/components/PlanOneOffSheet";
import TransactionRow from "@/components/TransactionRow";
import TeachingSheet from "@/components/TeachingSheet";
import { useColours } from "@/components/ColourProvider";
import { useCategoryIcons } from "@/components/IconProvider";
import { getCategoryColour } from "@/lib/categories";
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
import MoneyText from "@/components/MoneyText";

/** One row inside the condensed "+ Add" menu (header Variant B). Mirrors the
 *  MenuItem pattern already used by SpendTrends' widget overflow menu. */
function AddMenuItem({
  icon, label, onClick, disabled, tutorialId,
}: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; tutorialId?: string;
}) {
  return (
    <button
      data-tutorial-id={tutorialId}
      onClick={onClick}
      disabled={disabled}
      className="w-full min-h-[44px] flex items-center gap-2.5 px-3.5 py-3 text-sm font-medium text-left text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 active:bg-slate-100 dark:active:bg-white/10 disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

/** Muted terms pill for a confirmed card. APR is information, not alarm —
 *  slate ink; amber only when the soonest active promo ends within 60 days
 *  (genuine approaching risk). Shows count of additional promos. Expired
 *  promos are filtered out; standard rate shown when no active promos. */
function termsPillFor(card: CardTermsCard | undefined): TermsPill | null {
  const t = card?.terms; if (!t || t.status !== "confirmed") return null;
  const now = Date.now();
  const active = (t.promos ?? [])
    .map(p => ({ ...p, end: new Date(`${p.until}T00:00:00`) }))
    .filter(p => Math.ceil((p.end.getTime() - now) / 86_400_000) >= 0)
    .sort((a, b) => a.end.getTime() - b.end.getTime());
  if (active.length > 0) {
    const soonest = active[0];
    const days = Math.ceil((soonest.end.getTime() - now) / 86_400_000);
    const rateStr = `${soonest.apr_pct}%`;
    let label = days <= 60
      ? `${rateStr} ends ${soonest.end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
      : `${rateStr} until ${soonest.end.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`;
    if (active.length > 1) label += ` · +${active.length - 1}`;
    return { label, amber: days <= 60 };
  }
  if (t.apr_pct != null) return { label: `${t.apr_pct}% APR` };
  return null;
}

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

/** Fragments that make a description unusable for exact matching: they change
 *  on every transaction (reference numbers, dates, amounts), so an equals rule
 *  built on one would match that single row and then nothing, ever. */
const VOLATILE_PATTERNS: RegExp[] = [
  /\d{3,}/,                                    // account / card / reference numbers
  DATE_FRAG,                                   // "29MAY", "ON 3 JUN 25"
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,   // 03/06, 3-6-25
  /\b\d+[.,]\d{2}\b/,                          // 14.40 — an amount
  /[£$€]\s?\d/,                                // £12
];

function isVolatileDescription(desc: string): boolean {
  return VOLATILE_PATTERNS.some(re => re.test(desc));
}

type PickedMatch = {
  matchType: RuleMatchType;
  matchField: RuleMatchField;
  value: string;
  /** Set when we had to widen to `contains`; explains why, in the UI. */
  widenedBecause: "volatile" | "too-long" | null;
};

function matchForPicked(tx: Transaction): PickedMatch {
  const merchant = (tx.merchant_name ?? "").trim();
  if (merchant) {
    // Merchant names are stable across future transactions from the same merchant
    return { matchType: "description_equals", matchField: "merchant", value: merchant.slice(0, 80), widenedBecause: null };
  }
  const desc = (tx.description ?? "").trim();
  if (desc && desc.length <= 80 && !isVolatileDescription(desc)) {
    // Stable, short enough, non-volatile — safe to match exactly
    return { matchType: "description_equals", matchField: "description", value: desc, widenedBecause: null };
  }
  // Fall back to contains with the truncated stem from ruleValueFor
  const widenedBecause = desc.length > 80 && !isVolatileDescription(desc) ? "too-long" : "volatile";
  return { matchType: "description_contains", matchField: "description", value: ruleValueFor(tx), widenedBecause };
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
  const [loadingTxns, setLoadingTxns] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [tab, setTab] = useState<"Banks" | "Investments">(
    searchParams.get("tab") === "Investments" ? "Investments" : "Banks"
  );
  const [showMpesaUpload, setShowMpesaUpload] = useState(false);
  const [showBankPicker, setShowBankPicker] = useState(false);
  // Header Variant B: the four/three "add" actions condense into one primary
  // button that opens this menu — same handlers/routes, just one entry point.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [reconnectWarning, setReconnectWarning] = useState<string | null>(null);
  const [investmentAccounts, setInvestmentAccounts] = useState<InvestmentAccount[]>([]);
  const [showInvestmentUpload, setShowInvestmentUpload] = useState(false);
  const [expandedInvestment, setExpandedInvestment] = useState<string | null>(null);
  const [investmentHoldings, setInvestmentHoldings] = useState<Record<string, InvestmentHolding[]>>({});
  const [loadingHoldings, setLoadingHoldings] = useState<string | null>(null);
  const [refreshingInvestment, setRefreshingInvestment] = useState<string | null>(null);
  const [deletingInvestment, setDeletingInvestment] = useState<string | null>(null);
  const [investmentNotes, setInvestmentNotes] = useState<Record<string, InvestmentNote[]>>({});
  const [loadingNotes, setLoadingNotes] = useState<string | null>(null);
  const [noteUploadError, setNoteUploadError] = useState<Record<string, string | null>>({});
  const [statementUploadError, setStatementUploadError] = useState<Record<string, string | null>>({});
  const [uploadingNote, setUploadingNote] = useState<string | null>(null);
  const [deletingNote, setDeletingNote] = useState<string | null>(null);
  const [confirmDeleteNote, setConfirmDeleteNote] = useState<string | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  // "How this account stays current" explainer — answer first, evidence
  // second: collapsed by default behind a small ⓘ toggle per account.
  const [howItWorksOpen, setHowItWorksOpen] = useState<Record<string, boolean>>({});
  const [showNoteUploadFor, setShowNoteUploadFor] = useState<string | null>(null);
  const [noteFile, setNoteFile] = useState<File | null>(null);
  const [notePassword, setNotePassword] = useState("");
  const [showNotePassword, setShowNotePassword] = useState(false);
  // Cold-start "Add contract note" — accountless upload from Investments tab header
  const [showColdStartNote, setShowColdStartNote] = useState(false);
  const [coldStartFile, setColdStartFile] = useState<File | null>(null);
  const [coldStartPassword, setColdStartPassword] = useState("");
  const [showColdStartPassword, setShowColdStartPassword] = useState(false);
  const [coldStartError, setColdStartError] = useState<string | null>(null);
  const [uploadingColdStart, setUploadingColdStart] = useState(false);
  const coldStartFileRef = useRef<HTMLInputElement>(null);
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
  // Optional source-account scope: "" = any account (how every older rule behaves)
  const [ruleSource, setRuleSource] = useState("");
  const [ruleMatchValue, setRuleMatchValue] = useState("");
  const [ruleSign, setRuleSign] = useState<RuleSign>("opposite");
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);

  // Transaction search state for rule building
  const [ruleSearchResults, setRuleSearchResults] = useState<Transaction[]>([]);
  const [ruleSearchOpen, setRuleSearchOpen] = useState(false);
  const [ruleCounts, setRuleCounts] = useState<{ contains: number; equals: number } | null>(null);
  const [rulePool, setRulePool] = useState<Transaction[] | null>(null);
  const [ruleMatchField, setRuleMatchField] = useState<RuleMatchField>("description");
  // True only when value came from picking a transaction (or editing an existing equals rule)
  const [rulePicked, setRulePicked] = useState(false);
  const [ruleWidened, setRuleWidened] = useState<"volatile" | "too-long" | null>(null);
  const [ruleBackfill, setRuleBackfill] = useState(false);

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

  // Card terms — pills on credit-card rows + the capture sheet
  const [cardTermsCards, setCardTermsCards] = useState<CardTermsCard[]>([]);
  const [cardTermsReady, setCardTermsReady] = useState(false);
  const [cardTermsOpen, setCardTermsOpen] = useState(false);
  const [cardTermsStartId, setCardTermsStartId] = useState<string | null>(null);

  const loadCardTerms = useCallback(() => {
    api.getCardTerms()
      .then(r => { setCardTermsCards(r.cards); setCardTermsReady(true); })
      .catch(() => setCardTermsReady(true));
  }, []);

  useEffect(() => { loadCardTerms(); }, [loadCardTerms]);

  // ?cardTerms=1 opens the full card walk (from the ask card).
  // ?cardTerms=<accountId> opens a single-card session directly (from cliff cards).
  // Both modes strip the param after opening, same live-URL read pattern.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ct = params.get("cardTerms");
    if (ct) {
      setCardTermsStartId(ct === "1" ? null : ct);
      setCardTermsOpen(true);
      params.delete("cardTerms");
      const rest = params.toString();
      router.replace(rest ? `/accounts?${rest}` : "/accounts", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  function openCardTermsAt(accountId: string | null) {
    setCardTermsStartId(accountId);
    setCardTermsOpen(true);
  }

  const cardTermsByAccount = useMemo(() => {
    const m: Record<string, CardTermsCard> = {};
    for (const c of cardTermsCards) m[c.account_id] = c;
    return m;
  }, [cardTermsCards]);

  // Close the "+ Add" menu on outside tap (same pattern as SpendTrends' widget menu)
  useEffect(() => {
    if (!addMenuOpen) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [addMenuOpen]);

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
  // Category filter chip on the Transactions tab — set from a Categories-tab
  // row tap (switches segment + scopes the fetch). Direction-aware: a
  // "Spending" row scopes to debit, a "Money in" row scopes to credit, so
  // card payments / refunds are reachable the same way spend categories are.
  const [detailCatFilter, setDetailCatFilter] = useState<{ name: string; txnType: "debit" | "credit" } | null>(null);

  // Server-paginated transactions for the selected bank account
  const [serverTxns, setServerTxns] = useState<Transaction[]>([]);
  const [serverPages, setServerPages] = useState(1);
  const [refreshTick, setRefreshTick] = useState(0);

  // Server-aggregated category rollups for the Categories tab — debit
  // (spend, default) and credit ("money in": card payments, refunds,
  // incoming transfers) fetched side by side.
  const [catSummaries, setCatSummaries] = useState<AccountCategorySummary[] | null>(null);
  const [catSummariesCredit, setCatSummariesCredit] = useState<AccountCategorySummary[] | null>(null);

  // Swipe between transaction pages
  const swipeTouchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Lazy-load the transaction pool whenever the rule modal opens (cached, so cheap to always fetch)
  useEffect(() => {
    if (!ruleModalOpen || rulePool !== null) return;
    let cancelled = false;
    getAllTransactionsCached()
      .then(data => { if (!cancelled) setRulePool(data); })
      .catch(() => { if (!cancelled) setRulePool([]); });
    return () => { cancelled = true; };
  }, [ruleModalOpen, rulePool]);

  // Debounced search + match counts for all rule modes.
  // Computes both contains and equals counts every run so the strictness picker
  // can show both live without an extra fetch.
  useEffect(() => {
    if (!ruleMatchValue.trim() || rulePool === null) {
      setRuleSearchResults([]);
      setRuleCounts(null);
      return;
    }
    const t = setTimeout(() => {
      const v = ruleMatchValue.trim().toLowerCase();
      // The account scopes all three: what you browse, what we count, and what
      // the rule will catch — so the numbers on screen are exactly truthful.
      const scoped = rulePool.filter(tx => !ruleSource || tx.account_id === ruleSource);

      if (ruleMatchType === "category") {
        // Category mode: exact match on the category field
        const n = scoped.filter(tx => (tx.category ?? "").trim().toLowerCase() === v).length;
        setRuleCounts({ contains: n, equals: n });
        setRuleSearchResults([]);
        return;
      }

      const containsHits = scoped.filter(tx =>
        `${tx.description ?? ""} ${tx.merchant_name ?? ""}`.toLowerCase().includes(v)
      );
      const equalsHits = scoped.filter(tx =>
        (ruleMatchField === "merchant"
          ? (tx.merchant_name ?? "")
          : (tx.description ?? "")
        ).trim().toLowerCase() === v
      );
      setRuleCounts({ contains: containsHits.length, equals: equalsHits.length });

      if (ruleSearchOpen) {
        // Dedupe by ruleValueFor key, keep first (newest), slice to 6
        const seen = new Set<string>();
        const deduped: Transaction[] = [];
        for (const tx of containsHits) {
          const key = ruleValueFor(tx).toLowerCase();
          if (!seen.has(key)) { seen.add(key); deduped.push(tx); }
          if (deduped.length >= 6) break;
        }
        setRuleSearchResults(deduped);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [ruleMatchValue, ruleMatchType, ruleMatchField, ruleSource, rulePool, ruleSearchOpen, ruleModalOpen]);

  // The count that matches the currently selected mode
  const ruleActiveCount = ruleCounts === null ? null : (ruleMatchType === "description_equals" ? ruleCounts.equals : ruleCounts.contains);

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
  const noteFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api.getPreferences().then(p => setPinnedIds(p.home_pinned_accounts ?? [])).catch(() => {});
  }, []);
  function togglePin(id: string) {
    if (!pinnedIds.includes(id) && pinnedIds.length >= MAX_PINS) {
      setPinMsg(`Home shows up to ${MAX_PINS} pinned accounts, unpin one first.`);
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
    setDetailCatFilter(null);
    setSearchQuery("");
    setDebouncedQuery("");
    setServerTxns([]);
    setServerPages(1);
    setCatSummaries(null);
    setCatSummariesCredit(null);
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
        // When scoped to a Categories-tab filter, match the rollup's own
        // window exactly (last 90 days, same direction) — GET
        // /accounts/{id}/categories aggregates on those same terms, so an
        // unscoped fetch here would show a different (all-time, wrong
        // direction) set than the count/total the chip was opened from.
        const r = await api.transactions(selectedAccountId, {
          page, q: debouncedQuery || undefined, category: detailCatFilter?.name || undefined,
          ...(detailCatFilter ? { days: 90, txnType: detailCatFilter.txnType } : {}),
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
  }, [selectedAccountId, page, debouncedQuery, detailCatFilter, refreshTick, accounts]);

  // Category rollups (spend + money-in) are fetched lazily, first time the
  // Categories tab opens — both sides of the same 90-day window.
  useEffect(() => {
    if (!selectedAccountId || segment !== "Categories" || catSummaries !== null) return;
    const acc = accounts.find(a => a.id === selectedAccountId);
    if (!acc || acc.manual) return;
    api.accountCategories(selectedAccountId)
      .then(setCatSummaries)
      .catch(() => setCatSummaries([]));
    api.accountCategories(selectedAccountId, "credit")
      .then(setCatSummariesCredit)
      .catch(() => setCatSummariesCredit([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, segment, catSummaries, accounts]);

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
    setRuleSource("");
    setRuleMatchType("description_contains");
    setRuleMatchValue("");
    setRuleSign("opposite");
    setRuleError(null);
    setRuleSearchOpen(false);
    setRuleSearchResults([]);
    setRuleCounts(null);
    setRuleMatchField("description");
    setRulePicked(false);
    setRuleWidened(null);
    setRuleBackfill(false);
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
    setRuleSource(rule.source_account_id ?? "");  // pre-scoping rules → Any account
    setRuleMatchType(rule.match_type);
    setRuleMatchValue(rule.match_value);
    setRuleSign(rule.sign);
    setRuleError(null);
    setRuleSearchOpen(false);
    setRuleSearchResults([]);
    setRuleCounts(null);
    setRuleMatchField(rule.match_field ?? "description");
    setRulePicked(rule.match_type === "description_equals");
    setRuleWidened(null);
    // A rule with no applies_from already matches all history — keep that behaviour on a no-op save
    setRuleBackfill(rule.applies_from == null);
    setRuleModalOpen(true);
  }

  function pickRuleTransaction(tx: Transaction) {
    const m = matchForPicked(tx);
    setRuleMatchValue(m.value);
    setRuleMatchType(m.matchType);
    setRuleMatchField(m.matchField);
    setRulePicked(true);
    setRuleWidened(m.widenedBecause);
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
      const matchField = ruleMatchType === "description_equals" ? ruleMatchField : null;
      if (ruleEditId) {
        await api.updateManualAccountRule(ruleEditId, {
          name, match_type: ruleMatchType, match_value: matchValue, sign: ruleSign,
          source_account_id: ruleSource || null,
          match_field: matchField, backfill: ruleBackfill,
        });
      } else {
        await api.createManualAccountRule({
          name, target_account_id: ruleTarget,
          match_type: ruleMatchType, match_value: matchValue, sign: ruleSign,
          source_account_id: ruleSource || null,
          match_field: matchField, backfill: ruleBackfill,
        });
      }
      setRuleModalOpen(false);
      setRuleSearchOpen(false);
      setRuleSearchResults([]);
      setRuleCounts(null);
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
    // Load holdings if not cached
    if (!investmentHoldings[id]) {
      setLoadingHoldings(id);
      try {
        const h = await api.getInvestmentHoldings(id);
        setInvestmentHoldings(prev => ({ ...prev, [id]: h }));
      } catch { /* ignore */ }
      finally { setLoadingHoldings(null); }
    }
    // Load notes if not cached
    if (!investmentNotes[id]) {
      setLoadingNotes(id);
      try {
        const notes = await api.investmentNotes(id);
        setInvestmentNotes(prev => ({ ...prev, [id]: notes }));
      } catch { /* ignore */ }
      finally { setLoadingNotes(null); }
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

  async function handleUploadNote(accountId: string) {
    if (!noteFile || uploadingNote) return;
    setUploadingNote(accountId);
    setNoteUploadError(prev => ({ ...prev, [accountId]: null }));
    try {
      const res = await api.uploadInvestmentNote(accountId, noteFile, notePassword || undefined);
      setInvestmentAccounts(prev => prev.map(a => a.id === accountId ? res.account : a));
      setInvestmentNotes(prev => ({ ...prev, [accountId]: [res.note, ...(prev[accountId] ?? [])] }));
      setNoteFile(null);
      setNotePassword("");
      setShowNoteUploadFor(null);
      if (noteFileRef.current) noteFileRef.current.value = "";
    } catch (err: unknown) {
      setNoteUploadError(prev => ({ ...prev, [accountId]: err instanceof Error ? err.message : "Upload failed" }));
    } finally {
      setUploadingNote(null);
    }
  }

  async function handleDeleteNote(noteId: string, accountId: string) {
    setDeletingNote(noteId);
    try {
      const res = await api.deleteInvestmentNote(noteId);
      setInvestmentAccounts(prev => prev.map(a => a.id === accountId ? res.account : a));
      setInvestmentNotes(prev => ({
        ...prev,
        [accountId]: (prev[accountId] ?? []).filter(n => n.id !== noteId),
      }));
      setConfirmDeleteNote(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete note");
    } finally {
      setDeletingNote(null);
    }
  }

  async function handleUploadColdStartNote() {
    if (!coldStartFile || uploadingColdStart) return;
    setUploadingColdStart(true);
    setColdStartError(null);
    try {
      await api.uploadInvestmentNoteColdStart(coldStartFile, coldStartPassword || undefined);
      // Refresh the full accounts list so the new (or updated) account appears
      await loadAccounts();
      setColdStartFile(null);
      setColdStartPassword("");
      setShowColdStartNote(false);
      if (coldStartFileRef.current) coldStartFileRef.current.value = "";
    } catch (err: unknown) {
      setColdStartError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingColdStart(false);
    }
  }

  function refreshNotesForAccount(accountId: string) {
    api.investmentNotes(accountId)
      .then(notes => setInvestmentNotes(prev => ({ ...prev, [accountId]: notes })))
      .catch(() => {});
  }

  // Backend already filters by region — accounts contains only the right source.
  // Manual (offline) accounts come back in /accounts too; they're shown in their
  // own editable section, so keep them out of the connected-bank list.
  const bankAccounts = accounts.filter(a => !a.manual);

  // Navigable ledger-rows estate (Wave 2) — combines bank + investment
  // accounts into one normalized list for the Banks-tab view. Replaces the
  // old separate bank-grid + per-provider "expired" banner: attention
  // (expired) and inactive (dormant £0) are now derived from the estate
  // itself, see accountsEstate.ts.
  const estate = useMemo(
    () => buildEstate(bankAccounts, investmentAccounts, pinnedIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, investmentAccounts, pinnedIds]
  );
  const [estateQuery, setEstateQuery] = useState("");
  const [estateLens, setEstateLens] = useState<EstateLens>("All");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const estateIsFiltering = estateQuery.trim().length > 0 || estateLens !== "All";
  const estateFilteredRows = useMemo(
    () => (estateIsFiltering ? filterEstate(estate.rows, { query: estateQuery, lens: estateLens }) : []),
    [estate.rows, estateQuery, estateLens, estateIsFiltering]
  );
  // An account that's both expired AND £0 belongs only in Attention — don't
  // also show it in the collapsed Inactive bucket underneath.
  const inactiveRows = useMemo(
    () => estate.inactive.filter(r => !estate.attention.some(a => a.id === r.id)),
    [estate.inactive, estate.attention]
  );
  function toggleEstateGroup(label: string) {
    setCollapsedGroups(c => ({ ...c, [label]: !c[label] }));
  }
  function handleEstateRowClick(row: EstateRow) {
    if (row.source === "investment") {
      setTab("Investments");
      handleToggleInvestment(row.id);
      window.scrollTo(0, 0);
    } else {
      handleSelectAccount(row.raw as Account);
    }
  }

  /** Credit-row terms-pill props (confirmed APR/promo pill, or a quiet "Add
   *  rates" affordance) — same entry point AccountMiniCard used to expose,
   *  carried over onto the ledger rows so it isn't lost in the redesign. */
  function estateTermsProps(row: EstateRow) {
    if (row.kind !== "Credit" || row.source !== "bank") return {};
    const termsCard = cardTermsByAccount[row.id];
    const pill = termsPillFor(termsCard);
    return {
      termsPill: pill,
      onTermsClick: pill ? () => openCardTermsAt(row.id) : undefined,
      onAddRates: !pill && termsCard ? () => openCardTermsAt(row.id) : undefined,
    };
  }

  function handleTxUpdated(updated: Transaction, additionalIds?: string[]) {
    const apply = (t: Transaction) =>
      t.id === updated.id || additionalIds?.includes(t.id)
        ? { ...t, category: updated.category }
        : t;
    setServerTxns(prev => prev.map(apply));
    // Category totals shifted — drop both rollups so they refetch on next view
    setCatSummaries(null);
    setCatSummariesCredit(null);
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

  // Categories: server rollup for the account's Categories tab card grid.
  const categories = catSummaries ?? [];

  // Rules added from within an offline account are scoped to it (no picker).
  const inManualDetail = !!accounts.find(a => a.id === selectedAccountId)?.manual;

  const [modalsMounted, setModalsMounted] = useState(false);
  useEffect(() => setModalsMounted(true), []);

  // Modals shared by both the list and detail views (same component scope).
  const modals = (
    <>
      {cardTermsOpen && (
        <CardTermsSheet
          cards={cardTermsCards}
          ready={cardTermsReady}
          startAccountId={cardTermsStartId}
          onClose={() => { setCardTermsOpen(false); setCardTermsStartId(null); }}
          onSaved={loadCardTerms}
        />
      )}
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
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40" onClick={() => { if (!ruleSaving) { setRuleModalOpen(false); setRuleSearchOpen(false); setRuleSearchResults([]); setRuleCounts(null); } }}>
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

              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Linked account</label>
              <div
                role="radiogroup"
                aria-label="Which account should this rule watch?"
                className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] overflow-hidden"
              >
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-white/[0.06]">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={ruleSource === ""}
                    onClick={() => setRuleSource("")}
                    className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
                  >
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-white/[0.06] ring-1 ring-black/[0.06] dark:ring-white/[0.12] flex-shrink-0">
                      <CircleDashed size={16} className="text-slate-400 dark:text-slate-500" />
                    </span>
                    <span className="flex-1 min-w-0 text-sm font-medium text-slate-700 dark:text-slate-200">Any account</span>
                    <RadioDot selected={ruleSource === ""} />
                  </button>
                  {bankAccounts.map(acc => {
                    const brand = accountBrand(acc);
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        role="radio"
                        aria-checked={ruleSource === acc.id}
                        onClick={() => setRuleSource(acc.id)}
                        className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
                      >
                        <BankBadge
                          logoSrc={brand.logoSrc}
                          initials={brand.initials}
                          altText={brand.label}
                          brandBg={brand.background}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{acc.name}</span>
                          {acc.provider && (
                            <span className="block text-xs text-slate-400 dark:text-slate-500 truncate">{acc.provider}</span>
                          )}
                        </span>
                        <RadioDot selected={ruleSource === acc.id} />
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 mb-4">
                {ruleSource
                  ? "Only transactions on this account will match."
                  : "Transactions on any account will match."}
              </p>

              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Match transactions by</label>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {/* Description covers both contains and equals — selected when not in category mode */}
                <button
                  onClick={() => {
                    if (ruleMatchType === "category") {
                      setRuleMatchType("description_contains");
                      setRulePicked(false);
                      setRuleWidened(null);
                    }
                  }}
                  className={`py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                    ruleMatchType !== "category"
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  Description
                </button>
                <button
                  onClick={() => {
                    setRuleMatchType("category");
                    setRulePicked(false);
                    setRuleWidened(null);
                  }}
                  className={`py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                    ruleMatchType === "category"
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  Category
                </button>
              </div>
              {ruleMatchType === "category" ? (
                <input
                  value={ruleMatchValue}
                  onChange={e => setRuleMatchValue(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. Groceries"
                  className="w-full mb-3 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              ) : (
                <div
                  className="mb-3"
                  onBlur={e => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setRuleSearchOpen(false);
                    }
                  }}
                >
                  <input
                    value={ruleMatchValue}
                    onChange={e => {
                      setRuleMatchValue(e.target.value);
                      setRuleSearchOpen(true);
                      // Typing after a pick means free text — revert to contains
                      if (rulePicked) {
                        setRulePicked(false);
                        setRuleWidened(null);
                        if (ruleMatchType === "description_equals") {
                          setRuleMatchType("description_contains");
                          setRuleMatchField("description");
                        }
                      }
                    }}
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
                  {/* Strictness picker — only when a transaction was picked and it wasn't widened */}
                  {rulePicked && !ruleWidened && (
                    <div
                      role="radiogroup"
                      aria-label="How strictly should this rule match?"
                      className="grid grid-cols-2 gap-2 mt-2"
                    >
                      {([
                        { value: "description_equals" as RuleMatchType, label: "Exactly this", countKey: "equals" as const },
                        { value: "description_contains" as RuleMatchType, label: "Contains this", countKey: "contains" as const },
                      ]).map(({ value, label, countKey }) => {
                        const n = ruleCounts?.[countKey] ?? null;
                        const hint = n === null ? "—" : n === 1 ? "1 match" : `${n} matches`;
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={ruleMatchType === value}
                            onClick={() => setRuleMatchType(value)}
                            className={`flex flex-col items-center gap-0.5 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                              ruleMatchType === value
                                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                                : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {label}
                            <span className="text-[10px] font-normal opacity-80">{hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {/* Widened explanation — only when we had to fall back to contains */}
                  {rulePicked && ruleWidened && ruleMatchValue.trim() && (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                      {ruleWidened === "volatile"
                        ? <>This description changes each time, so the rule matches anything containing &ldquo;{ruleMatchValue}&rdquo;.</>
                        : <>This description is too long to match exactly, so the rule matches anything containing &ldquo;{ruleMatchValue}&rdquo;.</>
                      }
                    </p>
                  )}
                </div>
              )}

              {/* Count line — shared between description and category modes */}
              {ruleMatchValue.trim() && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  {rulePool === null ? (
                    "Checking…"
                  ) : ruleActiveCount === null ? null : ruleActiveCount === 0 ? (
                    "No transactions match this yet"
                  ) : (() => {
                    const countSpan = ruleActiveCount === 1
                      ? <><span className="font-medium text-slate-600 dark:text-slate-300">1</span> past transaction matches</>
                      : <><span className="font-medium text-slate-600 dark:text-slate-300">{ruleActiveCount}</span> past transactions match</>;
                    return ruleBackfill
                      ? <>{countSpan} · they&apos;ll be mirrored</>
                      : <>{countSpan} · they won&apos;t be mirrored unless you backfill</>;
                  })()}
                </p>
              )}

              {/* Backfill opt-in — shown for both description and category modes */}
              <button
                type="button"
                role="checkbox"
                aria-checked={ruleBackfill}
                onClick={() => setRuleBackfill(v => !v)}
                className="flex items-center gap-3 mb-4 w-full min-h-[44px] active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
              >
                <span className={`w-[18px] h-[18px] flex-shrink-0 rounded-md border flex items-center justify-center transition-colors ${
                  ruleBackfill
                    ? "bg-indigo-600 border-indigo-600"
                    : "bg-transparent border-slate-300 dark:border-slate-600"
                }`}>
                  {ruleBackfill && <Check size={12} strokeWidth={3} className="text-white" />}
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-300 text-left">
                  {ruleActiveCount !== null && ruleActiveCount > 0
                    ? ruleActiveCount === 1
                      ? "Also apply to the 1 past transaction that matches"
                      : `Also apply to the ${ruleActiveCount} past transactions that match`
                    : "Also apply to past transactions"
                  }
                </span>
              </button>

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
                  onClick={() => { setRuleModalOpen(false); setRuleSearchOpen(false); setRuleSearchResults([]); setRuleCounts(null); }}
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
    const isCredit = accountKind(selectedAccount) === "Credit";
    const balance = selectedAccount.balance;
    const isManual = !!selectedAccount.manual;
    const isStatement = selectedAccount.id.startsWith("statement-");
    const isExpired = selectedAccount.status === "expired";
    const manualAcc = manualAccounts.find(m => m.id === selectedAccount.id);
    const accountRules = rules.filter(r => r.target_account_id === selectedAccount.id);
    const showTransactions = isManual ? detailSegment === "Transactions" : segment === "Transactions";
    // Use the shared brand resolver so Finexer accounts (logo_url/bg_colors) get
    // the same branding as the card, and TrueLayer accounts fall through to accountBrand's own defaults.
    const brand = accountBrand(selectedAccount);
    const isPinned = pinnedIds.includes(selectedAccount.id);
    const termsCard = cardTermsByAccount[selectedAccount.id];
    const termsPill = termsPillFor(termsCard);

    // Categories tab — one row-panel renderer shared by the "Spending"
    // (debit) and "Money in" (credit) sections so card payments/refunds
    // are reachable the same way spend categories are, without duplicating
    // the row markup for each direction.
    function renderCategoryRows(rows: AccountCategorySummary[], txnType: "debit" | "credit") {
      return (
        <div className="glass-card rounded-2xl overflow-hidden">
          {[...rows].sort((a, b) => b.total - a.total).map((cat, idx) => {
            const colour = getCategoryColour(cat.name, colours);
            const Icon = getCategoryIcon(cat.name, iconOverrides);
            return (
              <button
                key={cat.name}
                type="button"
                onClick={() => {
                  setDetailCatFilter({ name: cat.name, txnType });
                  setPage(1);
                  setSegment("Transactions");
                }}
                className={`w-full flex items-center gap-3 px-4 min-h-[56px] text-left active:bg-slate-50 dark:active:bg-white/5 transition-colors ${idx > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}`}
              >
                <span
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${colour}26` }}
                >
                  <Icon size={16} style={{ color: colour }} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate">{cat.name}</p>
                  <p className="text-[12.5px] text-slate-400 dark:text-slate-500 mt-0.5">{cat.count} payment{cat.count !== 1 ? "s" : ""}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[15px] font-bold money text-slate-900 dark:text-slate-100">
                    £{cat.total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden="true" />
                </div>
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        {/* Header — mini statement: back + compact icon actions, reconnect
            banner only when genuinely expired, then balance-forward block. */}
        <div className="mx-4 mt-4 rounded-3xl px-4 pt-5 pb-6 glass-card">
          <div className="flex items-center justify-between mb-4 gap-2">
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors min-h-[44px] shrink-0"
            >
              <ArrowLeft size={18} />
              <span className="text-sm font-medium">Accounts</span>
            </button>
            <div className="flex items-center gap-1 shrink-0">
              {isManual && (
                <button
                  onClick={() => manualAcc && openEditManual(manualAcc)}
                  aria-label="Edit account"
                  className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-white/[0.08] hover:bg-slate-200 dark:hover:bg-white/[0.14] text-slate-600 dark:text-slate-300 transition-colors"
                >
                  <Pencil size={16} />
                </button>
              )}
              {isStatement && (
                <button
                  onClick={() => setShowMpesaUpload(true)}
                  aria-label="Add statement"
                  className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-white/[0.08] hover:bg-slate-200 dark:hover:bg-white/[0.14] text-slate-600 dark:text-slate-300 transition-colors"
                >
                  <Upload size={16} />
                </button>
              )}
              {!isManual && !isExpired && (
                <button
                  onClick={() => togglePin(selectedAccount.id)}
                  aria-label={isPinned ? "Unpin from Home" : "Pin to Home"}
                  className={`w-11 h-11 flex items-center justify-center rounded-xl transition-colors ${
                    isPinned
                      ? "bg-amber-50 dark:bg-amber-900/20 text-amber-500 dark:text-amber-400"
                      : "bg-slate-100 dark:bg-white/[0.08] hover:bg-slate-200 dark:hover:bg-white/[0.14] text-slate-500 dark:text-slate-300"
                  }`}
                >
                  <Star size={16} className={isPinned ? "fill-current" : ""} />
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
                aria-label="Remove account"
                className="w-11 h-11 flex items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 transition-colors disabled:opacity-50"
              >
                {deletingAccount ? <Spinner size={16} /> : <Trash2 size={16} />}
              </button>
            </div>
          </div>

          {/* Reconnect — only when genuinely expired, never a standing chip */}
          {!isManual && !isStatement && isExpired && (
            <button
              onClick={() => handleReconnect(selectedAccount?.provider_id, selectedAccount)}
              className="mb-4 w-full flex items-center justify-center gap-1.5 min-h-[44px] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors"
            >
              <RefreshCw size={15} />
              Reconnect
            </button>
          )}

          {/* Statement block */}
          <div className="flex items-center gap-3 mb-3">
            <BankBadge
              logoSrc={brand.logoSrc}
              initials={brand.initials}
              altText={brand.label}
              brandBg={brand.background}
            />
            <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 min-w-0 truncate">{selectedAccount.name}</h1>
          </div>

          <p
            className={`text-[30px] leading-none font-bold money ${isCredit || balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}
          >
            {hideNetWorth ? "••••" : `${!isCredit && balance < 0 ? "-" : ""}${selectedAccount.currency === "KES" ? "KES " : "£"}${Math.abs(balance).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </p>
          {isCredit && <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">owed</p>}

          {isCredit && (termsPill ? (
            <button
              type="button"
              onClick={() => openCardTermsAt(selectedAccount.id)}
              aria-label={`${termsPill.label}, edit this card's rates`}
              className="relative mt-2 inline-flex items-center min-h-[28px] before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[''] active:opacity-70 transition-opacity"
            >
              <span
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full num ${
                  termsPill.amber
                    ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                    : "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400"
                }`}
              >
                {termsPill.label}
              </span>
            </button>
          ) : termsCard ? (
            <button
              type="button"
              onClick={() => openCardTermsAt(selectedAccount.id)}
              className="relative mt-2 inline-flex items-center gap-1 min-h-[28px] text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[''] active:opacity-70 transition-opacity"
            >
              <Percent size={11} aria-hidden="true" />
              Add rates
            </button>
          ) : null)}

          <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
            {accountKindLabel(accountKind(selectedAccount))} · {selectedAccount.provider}
          </p>
        </div>

        {pinMsg && (
          <div className="mx-4 mt-4 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-xs font-medium text-slate-700 dark:text-slate-300">
            {pinMsg}
          </div>
        )}

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

          {/* Category filter chip — set from a Categories-tab row tap. Shows
              direction ("· in") when scoped to the credit ("Money in") side
              so the list is self-explanatory without opening the row. */}
          {showTransactions && !isManual && detailCatFilter && (
            <div className="flex items-center gap-2 mb-1">
              <button
                type="button"
                onClick={() => { setDetailCatFilter(null); setPage(1); }}
                aria-label={`Remove ${detailCatFilter.name} filter`}
                className="relative inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full min-h-[28px] before:absolute before:-inset-y-2 before:-inset-x-1 before:content-['']"
                style={{ backgroundColor: `${getCategoryColour(detailCatFilter.name, colours)}1f`, color: getCategoryColour(detailCatFilter.name, colours) }}
              >
                {detailCatFilter.name}
                <span className="opacity-70 font-medium">
                  {detailCatFilter.txnType === "credit" ? "· in · 90 days" : "· 90 days"}
                </span>
                <X size={12} />
              </button>
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
                        : isManual ? "No transactions yet, add one or set up a rule." : "No transactions"}
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
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 active:scale-95 transition-transform"
                  >
                    <ChevronLeft size={16} className="flex-shrink-0" aria-hidden="true" />
                    Prev
                  </button>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {page} / {totalPages}
                  </span>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 active:scale-95 transition-transform"
                  >
                    Next
                    <ChevronRight size={16} className="flex-shrink-0" aria-hidden="true" />
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
                          {rule.match_type === "category" ? "Category" : rule.match_type === "description_equals" ? "Exactly" : "Contains"}{" "}&ldquo;{rule.match_value}&rdquo;{" "}&middot;{" "}{rule.sign === "opposite" ? "Offset" : "Shadow"}
                          {rule.source_account_id && <>{" "}&middot;{" "}{rule.source_account_name ?? "One account"}</>}
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
            /* Categories view — Spend-page card language: tap routes to the
               Transactions tab, scoped by the category filter chip (B2) —
               no CategorySheet, no bottom sheet, one destination for a
               category's payments across the app. Two direction-separated
               sections so card payments / refunds / incoming transfers
               (credit) aren't invisible next to spend (debit) — same row
               anatomy, same 90-day window, captioned honestly for each. */
            <>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2 px-0.5">
                Spending · last 90 days
              </p>
              {catSummaries === null ? (
                <div className="flex items-center justify-center py-16">
                  <Spinner size={32} />
                </div>
              ) : categories.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
                  <p className="text-sm text-slate-400 dark:text-slate-500">No spending data</p>
                </div>
              ) : (
                renderCategoryRows(categories, "debit")
              )}

              {/* "Money in" — credit-side rollup (card payments, refunds,
                  incoming transfers). Only rendered once loaded and
                  non-empty; amounts stay neutral ink here, same as the
                  Spending rows — green stays reserved for TransactionRow's
                  own income treatment, not a whole section. */}
              {catSummariesCredit !== null && catSummariesCredit.length > 0 && (
                <>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-5 mb-2 px-0.5">
                    Money in · last 90 days
                  </p>
                  {renderCategoryRows(catSummariesCredit, "credit")}
                </>
              )}
            </>
          )}
        </div>

        {/* Transaction sheet — the Engine's teaching surface, same one the
            transactions hub uses, so recategorising here or there is
            identical behaviour. */}
        {selectedTx && (
          <TeachingSheet
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
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))]" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Header — hidden once actually drilled into an investment (tab ===
          "Investments" with at least one account) so that view owns the
          screen the same way the bank account detail does; the zero-state
          (no investments yet) keeps the hero, since its cold-start "Add
          contract note" flow is the only way to create a first investment
          account without a statement. relative + z-30 so this card's own
          backdrop-filter stacking context (from .glass-card) doesn't trap
          the "+ Add" popover beneath later siblings (find bar, lens chips,
          sticky group headers) that paint after it in DOM order. */}
      {(tab === "Banks" || investmentAccounts.length === 0) && (
      <div
        className="relative z-30 mx-4 mt-4 rounded-3xl px-4 pt-5 pb-5 glass-card"
      >
        <div className="mb-4">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Accounts</h1>
          {kpis && (() => {
            const cardTotal = accounts
              .filter(a => {
                const t = (a.type ?? "").toLowerCase();
                const s = (a.subtype ?? "").toLowerCase();
                return t.includes("credit") || s.includes("credit");
              })
              .reduce((sum, a) => sum + Math.abs(Math.min(a.balance, 0)), 0);
            // Net worth is a position, not a risk — it stays hero-white even
            // when negative (Red Is Risk keeps red for genuine risk states).
            // Quieter than the old 3xl treatment: present, not shouting.
            return (
              <div className="flex items-start justify-between gap-3 mt-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Net worth</p>
                  <p
                    className="mt-1 text-2xl font-bold tracking-tight money text-slate-900 dark:text-slate-100 leading-none"
                    aria-label={hideNetWorth ? "Balance hidden" : undefined}
                  >
                    {hideNetWorth
                      ? "••••••"
                      : `${kpis.net_worth < 0 ? "−" : ""}${region === "Kenya" ? "KES " : "£"}${Math.abs(kpis.net_worth).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}
                  </p>
                  {/* The two stats + counts, whispered onto one line. No
                      month-over-month trend here — KPIs carries only a
                      point-in-time net_worth, no history/delta to report
                      honestly, so nothing is fabricated in its place. */}
                  <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                    {cardTotal > 0 && (
                      <span className="font-mono tabular-nums">
                        {hideNetWorth ? "−£••••" : `−£${cardTotal.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}
                      </span>
                    )}
                    {cardTotal > 0 && " across cards · "}
                    {bankAccounts.length} bank · {investmentAccounts.length} investment
                    {manualAccounts.length > 0 && ` · ${manualAccounts.length} offline`}
                  </p>
                </div>
                <button
                  onClick={() => setHideNetWorth(!hideNetWorth)}
                  aria-label={hideNetWorth ? "Show balance" : "Hide balance"}
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex-shrink-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {hideNetWorth ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            );
          })()}
        </div>

        {/* Context-aware action: one primary "+ Add" — condensed from the
            old 3/4-button row (header Variant B). Every destination below is
            the exact same handler the separate buttons used to call; only
            the entry point changed. */}
        {tab === "Banks" ? (
          <div className="relative" ref={addMenuRef}>
            <button
              data-tutorial-id="tutorial-add-account"
              onClick={() => setAddMenuOpen(v => !v)}
              className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
              aria-expanded={addMenuOpen}
              aria-haspopup="menu"
            >
              <Plus size={15} />
              Add
              <ChevronDown size={13} className={`opacity-70 transition-transform ${addMenuOpen ? "rotate-180" : ""}`} />
            </button>
            {addMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-100 dark:border-white/10 py-1 divide-y divide-slate-100 dark:divide-white/5 overflow-hidden"
              >
                {region === "UK" ? (
                  <>
                    <AddMenuItem
                      icon={<Plus size={14} className="text-slate-400 flex-shrink-0" />}
                      label="Add Bank"
                      onClick={() => { setAddMenuOpen(false); setShowBankPicker(true); }}
                    />
                    <AddMenuItem
                      icon={<Upload size={14} className="text-slate-400 flex-shrink-0" />}
                      label="Statement"
                      onClick={() => { setAddMenuOpen(false); setShowMpesaUpload(true); }}
                    />
                    <AddMenuItem
                      icon={<TrendingUp size={14} className="text-slate-400 flex-shrink-0" />}
                      label="Investment"
                      onClick={() => { setAddMenuOpen(false); setShowInvestmentUpload(true); }}
                    />
                    <AddMenuItem
                      icon={<Plus size={14} className="text-slate-400 flex-shrink-0" />}
                      label="Offline"
                      onClick={() => { setAddMenuOpen(false); openAddManual(); }}
                    />
                    <AddMenuItem
                      icon={<Plus size={14} className="text-slate-400 flex-shrink-0" />}
                      label="Finexer (beta)"
                      onClick={async () => {
                        setAddMenuOpen(false);
                        try {
                          const { auth_url } = await api.finexerConnectLink();
                          window.location.href = auth_url;
                        } catch {
                          // no-op; user stays on page
                        }
                      }}
                    />
                  </>
                ) : (
                  <>
                    <MonoConnectWidget onSuccess={handleMonoSuccess}>
                      {(open, monoLoading) => (
                        <AddMenuItem
                          icon={<Plus size={14} className="text-slate-400 flex-shrink-0" />}
                          label={monoLoading ? "Opening…" : "Mono"}
                          disabled={monoLoading}
                          onClick={() => { setAddMenuOpen(false); open(); }}
                        />
                      )}
                    </MonoConnectWidget>
                    <AddMenuItem
                      icon={<Upload size={14} className="text-slate-400 flex-shrink-0" />}
                      label="Statement"
                      onClick={() => { setAddMenuOpen(false); setShowMpesaUpload(true); }}
                    />
                    <AddMenuItem
                      icon={<Plus size={14} className="text-slate-400 flex-shrink-0" />}
                      label="Offline"
                      onClick={() => { setAddMenuOpen(false); openAddManual(); }}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowInvestmentUpload(true)}
                className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all px-2 py-2.5 rounded-xl text-xs font-semibold text-white"
              >
                <Upload size={14} />
                Upload Statement
              </button>
              <button
                onClick={() => {
                  setShowColdStartNote(v => !v);
                  setColdStartFile(null);
                  setColdStartPassword("");
                  setColdStartError(null);
                  if (coldStartFileRef.current) coldStartFileRef.current.value = "";
                }}
                className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 active:scale-95 transition-all px-2 py-2.5 rounded-xl text-xs font-semibold text-indigo-700 dark:text-indigo-300"
              >
                <FileText size={14} />
                Add contract note
              </button>
            </div>
            {/* Hidden file input — always in DOM so the ref is stable */}
            <input
              ref={coldStartFileRef}
              type="file"
              accept=".pdf"
              className="sr-only"
              onChange={e => {
                setColdStartFile(e.target.files?.[0] ?? null);
                setColdStartError(null);
              }}
            />
            {/* Cold-start contract note upload form */}
            {showColdStartNote && (
              <div className="mt-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700 rounded-2xl px-4 py-3 space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
                  No statement yet? Upload a contract note to create an account and start tracking from <span className="font-mono tabular-nums">£0</span>.
                </p>
                {/* Password field */}
                <div className="relative">
                  <input
                    type={showColdStartPassword ? "text" : "password"}
                    value={coldStartPassword}
                    onChange={e => setColdStartPassword(e.target.value)}
                    placeholder="PDF password (if protected)"
                    className="w-full text-xs bg-white dark:bg-slate-600 dark:text-slate-100 border border-slate-200 dark:border-slate-500 rounded-xl px-3 py-2 pr-9 outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowColdStartPassword(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    {showColdStartPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                {/* File picker */}
                <button
                  type="button"
                  onClick={() => coldStartFileRef.current?.click()}
                  className="w-full border border-dashed border-slate-300 dark:border-slate-500 rounded-xl py-2.5 px-3 flex items-center gap-2 hover:bg-white dark:hover:bg-slate-600 transition-colors text-left"
                >
                  {coldStartFile ? (
                    <>
                      <FileText size={14} className="text-indigo-500 flex-shrink-0" />
                      <span className="text-xs text-slate-700 dark:text-slate-200 font-medium truncate">{coldStartFile.name}</span>
                    </>
                  ) : (
                    <>
                      <Upload size={14} className="text-slate-400 flex-shrink-0" />
                      <span className="text-xs text-slate-400">Choose PDF contract note…</span>
                    </>
                  )}
                </button>
                {coldStartError && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl px-3 py-2">
                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-snug">{coldStartError}</p>
                  </div>
                )}
                <button
                  onClick={handleUploadColdStartNote}
                  disabled={!coldStartFile || uploadingColdStart}
                  className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                >
                  {uploadingColdStart ? (
                    <><RefreshCw size={12} className="animate-spin" /> Uploading…</>
                  ) : (
                    <><FileText size={12} /> Import note</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Banks|Investments tab bar removed (Wave 2) — investment accounts
            are now folded into the unified estate list below; the
            "Investments" tab value still exists internally as the drill-in
            view an investment row navigates to (see handleEstateRowClick),
            reachable via the existing ?tab=Investments deep link too. No
            trailing spacer here — the card's own pb-5 is the only space
            below the Add button/upload row; don't reintroduce dead space. */}
      </div>
      )}

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

          <div className="px-4 pt-4 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Spinner size={32} />
              </div>
            ) : bankAccounts.length === 0 && investmentAccounts.length === 0 ? (
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
                  <div className="mb-1 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-xs font-medium text-slate-700 dark:text-slate-300">
                    {pinMsg}
                  </div>
                )}

                {/* Find bar */}
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" aria-hidden="true" />
                  <input
                    type="text"
                    value={estateQuery}
                    onChange={(e) => setEstateQuery(e.target.value)}
                    placeholder="Find an account…"
                    aria-label="Find an account"
                    className="w-full min-h-[44px] rounded-xl glass-tile pl-9 pr-3 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Lens chips */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {(["All", "Current", "Savings", "Credit", "Investment", "Owed"] as const).map((l) => {
                    const active = estateLens === l;
                    return (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setEstateLens(l)}
                        aria-pressed={active}
                        className={`shrink-0 min-h-[44px] px-3.5 rounded-full text-[13px] font-semibold transition-colors ${
                          active
                            ? "bg-indigo-500 text-white"
                            : "glass-tile text-slate-500 dark:text-slate-400 active:bg-slate-100 dark:active:bg-white/10"
                        }`}
                      >
                        {l}
                      </button>
                    );
                  })}
                </div>

                {estateIsFiltering ? (
                  <div>
                    <p className="px-1 mb-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                      {estateFilteredRows.length} result{estateFilteredRows.length === 1 ? "" : "s"}
                    </p>
                    {estateFilteredRows.length === 0 ? (
                      <div className="glass-card rounded-2xl px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                        No accounts match
                      </div>
                    ) : (
                      <div className="glass-card rounded-2xl overflow-hidden">
                        {estateFilteredRows.map((row, i) => (
                          <div key={row.id} className={i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
                            <AccountLedgerRow
                              row={row}
                              onReconnect={row.attention ? () => handleReconnect((row.raw as Account).provider_id, row.raw as Account) : undefined}
                              onClick={handleEstateRowClick}
                              {...estateTermsProps(row)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Attention — expired connections, prominent (not tucked away) */}
                    {estate.attention.length > 0 && (
                      <div>
                        <div className="px-1 mb-1.5 flex items-center gap-1.5">
                          <AlertTriangle size={12} className="text-amber-500 dark:text-amber-400" aria-hidden="true" />
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Needs reconnecting
                            <span className="text-slate-400 dark:text-slate-500 font-medium normal-case"> · {estate.attention.length}</span>
                          </span>
                        </div>
                        <div className="glass-card rounded-2xl overflow-hidden border border-amber-200/70 dark:border-amber-800/60">
                          {estate.attention.map((row, i) => (
                            <div key={row.id} className={i > 0 ? "border-t border-amber-100 dark:border-amber-900/40" : ""}>
                              <AccountLedgerRow
                                row={row}
                                onReconnect={() => handleReconnect((row.raw as Account).provider_id, row.raw as Account)}
                                onClick={handleEstateRowClick}
                                {...estateTermsProps(row)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Pinned band */}
                    {estate.pinned.length > 0 && (
                      <div>
                        <p className="px-1 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Pinned</p>
                        <div className="glass-card rounded-2xl overflow-hidden">
                          {estate.pinned.map((row, i) => (
                            <div key={row.id} className={i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
                              <AccountLedgerRow row={row} onClick={handleEstateRowClick} {...estateTermsProps(row)} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Collapsible groups — sticky header, chevron, subtotal */}
                    {estate.groups.length === 0 ? (
                      <div className="glass-card rounded-2xl px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                        No accounts in this view
                      </div>
                    ) : (
                      estate.groups.map((group) => {
                        const isCollapsed = collapsedGroups[group.label] ?? (group.kind === "Credit" && group.count > 4);
                        return (
                          <div key={group.label}>
                            <button
                              type="button"
                              onClick={() => toggleEstateGroup(group.label)}
                              aria-expanded={!isCollapsed}
                              className="sticky top-0 z-10 mb-1.5 w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 bg-slate-50/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-100/80 dark:border-white/5 shadow-sm"
                            >
                              <span className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                {group.label}
                                <span className="text-slate-400 dark:text-slate-600 font-medium normal-case">· {group.count}</span>
                              </span>
                              <span className="flex items-center gap-1.5">
                                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 money">
                                  {hideNetWorth
                                    ? "••••"
                                    : `${group.subtotal < 0 ? "-" : ""}£${Math.abs(Math.round(group.subtotal)).toLocaleString("en-GB")}`}
                                </span>
                                <ChevronDown
                                  size={14}
                                  className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 motion-reduce:transition-none ${isCollapsed ? "" : "rotate-180"}`}
                                  aria-hidden="true"
                                />
                              </span>
                            </button>
                            <div
                              className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0 ${
                                isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
                              }`}
                            >
                              <div
                                className={`overflow-hidden transition-opacity duration-200 motion-reduce:transition-none motion-reduce:duration-0 ${
                                  isCollapsed ? "opacity-0" : "opacity-100"
                                }`}
                              >
                                <div className="glass-card rounded-2xl overflow-hidden">
                                  {group.rows.map((row, i) => (
                                    <div key={row.id} className={i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
                                      <AccountLedgerRow row={row} onClick={handleEstateRowClick} {...estateTermsProps(row)} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {/* Inactive — dormant £0 accounts, collapsed by default.
                        Dedupe: an account that's both expired AND £0 already
                        appears in Attention above — don't show it twice. */}
                    {inactiveRows.length > 0 && (
                      <div>
                        <button
                          type="button"
                          onClick={() => setInactiveOpen(o => !o)}
                          aria-expanded={inactiveOpen}
                          className="sticky top-0 z-10 mb-1.5 w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 bg-slate-50/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-100/80 dark:border-white/5 shadow-sm"
                        >
                          <span className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Inactive
                            <span className="text-slate-400 dark:text-slate-600 font-medium normal-case">· {inactiveRows.length}</span>
                          </span>
                          <ChevronDown
                            size={14}
                            className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 motion-reduce:transition-none ${inactiveOpen ? "rotate-180" : ""}`}
                            aria-hidden="true"
                          />
                        </button>
                        <div
                          className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0 ${
                            inactiveOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                          }`}
                        >
                          <div
                            className={`overflow-hidden transition-opacity duration-200 motion-reduce:transition-none motion-reduce:duration-0 ${
                              inactiveOpen ? "opacity-100" : "opacity-0"
                            }`}
                          >
                            <div className="glass-card rounded-2xl overflow-hidden">
                              {inactiveRows.map((row, i) => (
                                <div key={row.id} className={i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
                                  <AccountLedgerRow row={row} onClick={handleEstateRowClick} />
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* ── Offline accounts ── */}
          <div className="px-4 pt-6">
            <div className="mb-2">
              <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">Offline accounts</h2>
              <p className="text-xs text-slate-400 dark:text-slate-500">Track balances we can&apos;t connect to: pots, cash, store cards. Tap to add transactions &amp; rules.</p>
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
                      <span className={`text-sm font-bold flex-shrink-0 font-mono tabular-nums ${isCredit ? "text-rose-500" : "text-slate-800 dark:text-slate-100"}`}>
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

      {/* ── Investments tab — drill-in view reached from an estate investment
          row (or the ?tab=Investments deep link); "Banks" tab above is now
          the default unified estate list. ── */}
      {tab === "Investments" && (
        <div className="px-4 pt-4 space-y-3">
          <button
            type="button"
            onClick={() => setTab("Banks")}
            className="flex items-center gap-1.5 min-h-[44px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <ArrowLeft size={18} />
            <span className="text-sm font-medium">Accounts</span>
          </button>
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
              const isLoadingN = loadingNotes === inv.id;
              const refreshDate = inv.last_refreshed
                ? new Date(inv.last_refreshed).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                : null;

              // Display value (display_value if available, else total_value)
              const displayValue = inv.display_value ?? inv.total_value;
              const addedSince = inv.added_since ?? 0;
              const notesSince = inv.notes_since ?? 0;
              const isProvisional = (inv as InvestmentAccount & { provisional?: boolean }).provisional === true;

              // Statement date formatted — guarded against null
              const stmtDate = inv.statement_date
                ? new Date(inv.statement_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                : null;

              // Whether prices were refreshed after the statement
              const hasRefreshAfterStatement =
                !isProvisional &&
                inv.last_refreshed !== null &&
                inv.statement_date !== null &&
                new Date(inv.last_refreshed) > new Date(inv.statement_date);

              // Decomposed value line (Change 2 + Change 3)
              let decomposedLine: React.ReactNode = null;
              if (isProvisional) {
                // Provisional: running total from £0
                decomposedLine = (
                  <span><MoneyText text="No statement yet: running total of your contract notes, from £0." /></span>
                );
              } else if (stmtDate) {
                if (hasRefreshAfterStatement) {
                  // Prices refreshed after statement — provenance only;
                  // the headline £value already lives in the statement
                  // block above, so this line must not repeat it.
                  if (notesSince > 0 && addedSince !== 0) {
                    const sign = addedSince > 0 ? "+" : "−";
                    const absVal = Math.abs(addedSince).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const noteWord = notesSince === 1 ? "note" : "notes";
                    decomposedLine = (
                      <span><MoneyText text={`Prices refreshed ${refreshDate} · ${sign}£${absVal} since ${stmtDate} statement · ${notesSince} ${noteWord}`} /></span>
                    );
                  } else {
                    decomposedLine = (
                      <span>Prices refreshed {refreshDate} · statement {stmtDate}</span>
                    );
                  }
                } else {
                  // No refresh since statement — keep existing form
                  if (notesSince > 0 && addedSince !== 0) {
                    const sign = addedSince > 0 ? "+" : "−";
                    const absVal = Math.abs(addedSince).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const verb = addedSince > 0 ? "added" : "net trades";
                    const noteWord = notesSince === 1 ? "contract note" : "contract notes";
                    decomposedLine = (
                      <span><MoneyText text={`Valued £${(displayValue - addedSince).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on ${stmtDate} · ${sign}£${absVal} ${verb} since (${notesSince} ${noteWord})`} /></span>
                    );
                  } else {
                    decomposedLine = <span>Statement dated {stmtDate}</span>;
                  }
                }
              }

              // Notes for this account
              const allNotes = investmentNotes[inv.id] ?? [];
              const activeNotes = allNotes.filter(n => !n.superseded);
              const supersededCount = allNotes.filter(n => n.superseded).length;

              const isShowingNoteUpload = showNoteUploadFor === inv.id;
              const thisNoteError = noteUploadError[inv.id] ?? null;
              const thisStatementError = statementUploadError[inv.id] ?? null;

              const isInvPinned = pinnedIds.includes(inv.id);
              const updatedDate = new Date(inv.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

              return (
                <div key={inv.id} className="glass-card rounded-2xl overflow-hidden">
                  {/* Account row — collapsed: badge, name, meta, value,
                      expand chevron. Expanded: badge, name, collapse
                      chevron ONLY — the value moves to the statement block
                      below and pin/refresh/remove get their own row, so
                      nothing fights for space on a 390px-wide phone. */}
                  <div className="w-full flex items-center gap-3 px-4 py-3.5">
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center flex-shrink-0">
                      <TrendingUp size={16} className="text-indigo-500" />
                    </div>
                    {isExpanded ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleToggleInvestment(inv.id)}
                          className="min-w-0 flex-1 flex items-center gap-2 text-left"
                        >
                          <div className="min-w-0 flex-1 flex items-center gap-2">
                            <p className="min-w-0 text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                              {inv.provider} {inv.account_type}
                            </p>
                            {isProvisional && (
                              <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide flex-shrink-0">
                                no statement yet
                              </span>
                            )}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleInvestment(inv.id)}
                          aria-label="Collapse"
                          className="w-11 h-11 flex items-center justify-center text-slate-500 dark:text-slate-400 flex-shrink-0"
                        >
                          <ChevronUp size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleToggleInvestment(inv.id)}
                          className="min-w-0 flex-1 flex items-center gap-2 text-left"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                                {inv.provider} {inv.account_type}
                              </p>
                              {isProvisional && (
                                <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                                  no statement yet
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5 truncate">
                              {inv.account_reference}
                              {refreshDate && <span className="ml-1.5">· updated {refreshDate}</span>}
                            </p>
                          </div>
                          <span className="text-sm font-bold money text-slate-800 dark:text-slate-100 flex-shrink-0">
                            {hideNetWorth ? "••••" : `£${displayValue.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleInvestment(inv.id)}
                          aria-label="Expand"
                          className="w-11 h-11 flex items-center justify-center text-slate-500 dark:text-slate-400 flex-shrink-0"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="flex items-center justify-end gap-1 px-3 pb-2 -mt-1">
                      <button
                        type="button"
                        onClick={() => togglePin(inv.id)}
                        aria-label={isInvPinned ? "Unpin from Home" : "Pin to Home"}
                        className={`w-11 h-11 flex items-center justify-center rounded-xl transition-colors ${
                          isInvPinned
                            ? "text-amber-500 dark:text-amber-400"
                            : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                        }`}
                      >
                        <Star size={15} className={isInvPinned ? "fill-current" : ""} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRefreshInvestment(inv.id)}
                        disabled={isRefreshing}
                        aria-label="Refresh prices"
                        className="w-11 h-11 flex items-center justify-center rounded-xl text-indigo-600 dark:text-indigo-400 disabled:opacity-50"
                      >
                        <RefreshCw size={15} className={isRefreshing ? "animate-spin" : ""} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteInvestment(inv.id)}
                        disabled={isDeleting}
                        aria-label="Remove investment"
                        className="w-11 h-11 flex items-center justify-center rounded-xl text-rose-500 dark:text-rose-400 disabled:opacity-50"
                      >
                        {isDeleting ? <Spinner size={15} /> : <Trash2 size={15} />}
                      </button>
                    </div>
                  )}

                  {isExpanded && (
                    <div className="border-t border-slate-50 dark:border-slate-700">
                      {/* ── Statement block: big value, real dates, quiet
                          provenance line ── */}
                      <div className="px-4 pt-3 pb-1">
                        <p className="text-[30px] leading-none font-bold money text-slate-900 dark:text-slate-100">
                          {hideNetWorth ? "••••" : `£${displayValue.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </p>
                        <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
                          Investment · {inv.provider} · updated {updatedDate}
                        </p>
                        {decomposedLine && (
                          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500 leading-snug">{decomposedLine}</p>
                        )}
                      </div>

                      {/* ── How this account stays current — answer (upload
                          actions) first, evidence (explainer) collapsed
                          behind a small ⓘ toggle. ── */}
                      <div className="mx-4 mt-3 mb-4 bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700 rounded-2xl px-4 py-4">
                        {/* Upload action buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => setShowInvestmentUpload(true)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 text-xs font-semibold text-slate-700 dark:text-slate-200 active:scale-95 transition-all hover:bg-slate-50 dark:hover:bg-slate-500"
                          >
                            <Upload size={13} />
                            Upload statement
                          </button>
                          <button
                            onClick={() => {
                              setShowNoteUploadFor(isShowingNoteUpload ? null : inv.id);
                              setNoteFile(null);
                              setNotePassword("");
                              setNoteUploadError(prev => ({ ...prev, [inv.id]: null }));
                              if (noteFileRef.current) noteFileRef.current.value = "";
                            }}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold active:scale-95 transition-all"
                          >
                            <FileText size={13} />
                            Add contract note
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => setHowItWorksOpen(prev => ({ ...prev, [inv.id]: !prev[inv.id] }))}
                          className="mt-3 inline-flex items-center gap-1 min-h-[28px] text-[11px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
                          aria-expanded={!!howItWorksOpen[inv.id]}
                        >
                          <Info size={12} aria-hidden="true" />
                          How this stays current
                          {howItWorksOpen[inv.id] ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                        </button>
                        {howItWorksOpen[inv.id] && (
                          <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {isProvisional && (
                              <>This account started from a contract note, so its value is a running total from <span className="font-mono tabular-nums">£0</span>, upload your first statement to set the real value.<br /><br /></>
                            )}
                            A statement sets the account&apos;s value. Contract notes add each buy or sell on top until the next statement arrives, then the statement takes over and earlier notes fold into it. Add every contract note when it lands. Notes dated before your latest statement won&apos;t add: that value is already counted, and duplicates are rejected.
                          </p>
                        )}

                        {/* Inline contract note upload form */}
                        {isShowingNoteUpload && (
                          <div className="mt-3 space-y-2">
                            {/* Password field */}
                            <div className="relative">
                              <input
                                type={showNotePassword ? "text" : "password"}
                                value={notePassword}
                                onChange={(e) => setNotePassword(e.target.value)}
                                placeholder="PDF password (if protected)"
                                className="w-full text-xs bg-white dark:bg-slate-600 dark:text-slate-100 border border-slate-200 dark:border-slate-500 rounded-xl px-3 py-2 pr-9 outline-none focus:ring-2 focus:ring-indigo-400"
                              />
                              <button
                                type="button"
                                onClick={() => setShowNotePassword(!showNotePassword)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                              >
                                {showNotePassword ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                            </div>

                            {/* File picker */}
                            <button
                              type="button"
                              onClick={() => noteFileRef.current?.click()}
                              className="w-full border border-dashed border-slate-300 dark:border-slate-500 rounded-xl py-2.5 px-3 flex items-center gap-2 hover:bg-white dark:hover:bg-slate-600 transition-colors text-left"
                            >
                              {noteFile ? (
                                <>
                                  <FileText size={14} className="text-indigo-500 flex-shrink-0" />
                                  <span className="text-xs text-slate-700 dark:text-slate-200 font-medium truncate">{noteFile.name}</span>
                                </>
                              ) : (
                                <>
                                  <Upload size={14} className="text-slate-400 flex-shrink-0" />
                                  <span className="text-xs text-slate-400">Choose PDF contract note…</span>
                                </>
                              )}
                            </button>
                            <input
                              ref={noteFileRef}
                              type="file"
                              accept=".pdf"
                              className="sr-only"
                              onChange={(e) => {
                                setNoteFile(e.target.files?.[0] ?? null);
                                setNoteUploadError(prev => ({ ...prev, [inv.id]: null }));
                              }}
                            />

                            {/* Error message */}
                            {thisNoteError && (
                              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl px-3 py-2">
                                <p className="text-xs text-slate-700 dark:text-slate-300 leading-snug">{thisNoteError}</p>
                              </div>
                            )}

                            {/* Submit button */}
                            <button
                              onClick={() => handleUploadNote(inv.id)}
                              disabled={!noteFile || uploadingNote === inv.id}
                              className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                            >
                              {uploadingNote === inv.id ? (
                                <><RefreshCw size={12} className="animate-spin" /> Uploading…</>
                              ) : (
                                <><FileText size={12} /> Import note</>
                              )}
                            </button>
                          </div>
                        )}

                        {/* Statement upload error */}
                        {thisStatementError && (
                          <div className="mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl px-3 py-2">
                            <p className="text-xs text-slate-700 dark:text-slate-300 leading-snug">{thisStatementError}</p>
                          </div>
                        )}
                      </div>

                      {/* ── Contract notes list ── */}
                      {(isLoadingN) ? (
                        <div className="flex items-center justify-center py-4 mb-2">
                          <Spinner size={20} />
                        </div>
                      ) : activeNotes.length > 0 ? (
                        <div className="mx-4 mb-4">
                          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">Contract Notes</p>
                          <div className="bg-white dark:bg-slate-800 rounded-xl divide-y divide-slate-50 dark:divide-slate-700 border border-slate-100 dark:border-slate-700">
                            {(expandedNotes[inv.id] ? activeNotes : activeNotes.slice(-6)).map(note => {
                              const noteDate = new Date(note.trade_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                              const isSale = note.kind === "sale";
                              const absAmount = Math.abs(note.amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                              const isConfirmingDelete = confirmDeleteNote === note.id;
                              const isDeletingThis = deletingNote === note.id;

                              return (
                                <div key={note.id} className="px-3 py-2.5 flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs text-slate-500 dark:text-slate-400">{noteDate}</span>
                                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{note.fund_name}</span>
                                      {isSale && (
                                        <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">sold</span>
                                      )}
                                    </div>
                                    <p className={`text-xs font-semibold mt-0.5 font-mono tabular-nums ${isSale ? "text-rose-500 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                      {isSale ? "−" : "+"}£{absAmount}
                                    </p>
                                  </div>
                                  <div className="flex-shrink-0 flex items-center gap-1">
                                    {isConfirmingDelete ? (
                                      <>
                                        <button
                                          onClick={() => handleDeleteNote(note.id, inv.id)}
                                          disabled={isDeletingThis}
                                          className="text-xs font-semibold text-rose-500 px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-900/20 active:scale-95 transition-all"
                                        >
                                          {isDeletingThis ? "…" : "Delete"}
                                        </button>
                                        <button
                                          onClick={() => setConfirmDeleteNote(null)}
                                          className="text-xs text-slate-400 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-700 active:scale-95 transition-all"
                                        >
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        onClick={() => setConfirmDeleteNote(note.id)}
                                        className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                                        aria-label="Delete note"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {activeNotes.length > 6 && (
                            <button
                              onClick={() => setExpandedNotes(prev => ({ ...prev, [inv.id]: !prev[inv.id] }))}
                              className="mt-1.5 px-1 text-xs font-semibold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 active:opacity-70 transition-colors"
                            >
                              {expandedNotes[inv.id] ? "Show fewer" : `Show all ${activeNotes.length}`}
                            </button>
                          )}
                          {supersededCount > 0 && stmtDate && (
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 px-1">
                              {supersededCount} earlier {supersededCount === 1 ? "note" : "notes"} folded into your {stmtDate} statement
                            </p>
                          )}
                        </div>
                      ) : supersededCount > 0 && stmtDate ? (
                        <p className="text-xs text-slate-400 dark:text-slate-500 mx-4 mb-4 px-1">
                          {supersededCount} earlier {supersededCount === 1 ? "note" : "notes"} folded into your {stmtDate} statement
                        </p>
                      ) : null}

                      {/* ── Holdings ── */}
                      {isLoadingH ? (
                        <div className="flex items-center justify-center py-6">
                          <Spinner size={24} />
                        </div>
                      ) : holdings.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-6">No holdings found</p>
                      ) : (
                        <div className="divide-y divide-slate-50 dark:divide-slate-700">
                          {holdings.map(h => {
                            const hDisplayValue = h.current_value ?? h.statement_value;
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
                                          {hasLivePrice ? "Live " : ""}<span className="font-mono tabular-nums">£{displayPrice.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span> / unit
                                        </span>
                                      </p>
                                    )}
                                  </div>
                                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100 flex-shrink-0 font-mono tabular-nums">
                                    {hideNetWorth ? "••••" : `£${hDisplayValue.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
